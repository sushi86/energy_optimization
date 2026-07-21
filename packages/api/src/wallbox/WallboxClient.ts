import ModbusRTU from 'modbus-serial';
import {
  EM2GO_REGISTERS,
  MAX_CHARGING_CURRENT_A,
  MIN_CHARGING_CURRENT_A,
  type WallboxConfig,
  type WallboxState,
  type WallboxStatus,
} from './types.js';

function statusFromRaw(raw: number): WallboxStatus {
  switch (raw) {
    case 1:
      return 'available';
    case 2:
    case 3:
    case 6:
      return 'connected';
    case 4:
      return 'charging';
    default:
      return 'error';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// EM2GO's Modbus TCP stack cannot handle overlapping requests on one connection,
// needs a pause between consecutive requests (evcc uses the same 60ms delay), and
// after a response timeout a late reply left in the TCP stream desynchronizes every
// following transaction on that socket. All register access therefore goes through
// request(): serialized, delayed, and — like evcc's shared Modbus layer — the
// connection is closed on ANY request error and lazily reopened on the next request.
const RESPONSE_TIMEOUT_MS = 5000;
const INTER_REQUEST_DELAY_MS = 60;

// Values that never change at runtime (evcc reads them only at init/diagnose).
// Reading them once at connect keeps the per-poll transaction count minimal.
interface WallboxStatics {
  evseMaxCurrentA: number;
  evseMinCurrentA: number;
  cableMaxCurrentA: number;
  safeCurrentA: number;
  commTimeoutS: number;
  chargeMode: number;
  serial: string;
}

export class WallboxClient {
  private readonly client = new ModbusRTU();
  private readonly config: WallboxConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: WallboxState | null = null;
  private lastError: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private statics: WallboxStatics | null = null;
  private lastCommandedCurrentA = MIN_CHARGING_CURRENT_A;

  constructor(config: WallboxConfig) {
    this.config = config;
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private request<T>(fn: () => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      if (!this.client.isOpen) {
        await this.client.connectTCP(this.config.host, { port: this.config.port });
        this.client.setID(this.config.unitId);
        this.client.setTimeout(RESPONSE_TIMEOUT_MS);
      }
      await sleep(INTER_REQUEST_DELAY_MS);
      try {
        return await fn();
      } catch (err) {
        await new Promise<void>((resolve) => this.client.close(() => resolve()));
        throw err;
      }
    });
  }

  async connect(): Promise<void> {
    this.statics = await this.readStatics();
    this.startHeartbeat(this.statics.commTimeoutS);
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.stopHeartbeat();
    await new Promise<void>((resolve) => this.client.close(() => resolve()));
  }

  private readU16(reg: number): Promise<number> {
    return this.request(async () => (await this.client.readHoldingRegisters(reg, 1)).data[0]);
  }

  private readU32(reg: number): Promise<number> {
    return this.request(async () => {
      const res = await this.client.readHoldingRegisters(reg, 2);
      return ((res.data[0] << 16) | res.data[1]) >>> 0;
    });
  }

  private write(reg: number, values: number[]): Promise<void> {
    return this.request(async () => {
      await this.client.writeRegisters(reg, values);
    });
  }

  private async readPhaseTriplet(reg: number): Promise<[number, number, number]> {
    const l1 = await this.readU16(reg);
    const l2 = await this.readU16(reg + 2);
    const l3 = await this.readU16(reg + 4);
    return [l1 / 10, l2 / 10, l3 / 10];
  }

  // The serial spans 16 registers, but the EM2GO's fragile Modbus stack is only known
  // to handle 1-2 register reads (evcc never requests more), so fetch it in 2-register
  // chunks. Decoded byte-wise, which handles both packed ASCII and UTF16-style words.
  private async readSerial(): Promise<string> {
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await this.request(() =>
        this.client.readHoldingRegisters(EM2GO_REGISTERS.serial + 2 * i, 2),
      );
      for (const word of res.data) {
        bytes.push((word >> 8) & 0xff, word & 0xff);
      }
    }
    return String.fromCharCode(...bytes).replace(/\0/g, '').trim();
  }

  private async readStatics(): Promise<WallboxStatics> {
    return {
      evseMaxCurrentA: (await this.readU16(EM2GO_REGISTERS.maxCurrent)) / 10,
      evseMinCurrentA: (await this.readU16(EM2GO_REGISTERS.minCurrent)) / 10,
      cableMaxCurrentA: (await this.readU16(EM2GO_REGISTERS.cableMaxCurrent)) / 10,
      safeCurrentA: (await this.readU16(EM2GO_REGISTERS.safeCurrent)) / 10,
      commTimeoutS: await this.readU16(EM2GO_REGISTERS.commTimeout),
      chargeMode: await this.readU16(EM2GO_REGISTERS.chargeMode),
      serial: await this.readSerial(),
    };
  }

  async getState(): Promise<WallboxState> {
    try {
      const statics = (this.statics ??= await this.readStatics());
      const state = await this.readDynamicState(statics);
      this.lastError = null;
      return state;
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    }
  }

  private async readDynamicState(statics: WallboxStatics): Promise<WallboxState> {
    const rawStatus = await this.readU16(EM2GO_REGISTERS.status);
    const connectorState = await this.readU16(EM2GO_REGISTERS.connectorState);
    const errorCode = await this.readU16(EM2GO_REGISTERS.errorCode);
    const powerW = await this.readU32(EM2GO_REGISTERS.power);
    const energyTotalKwh = (await this.readU32(EM2GO_REGISTERS.energy)) / 10;
    const chargingCurrentA = (await this.readU16(EM2GO_REGISTERS.currentLimit)) / 10;
    const currentsA = await this.readPhaseTriplet(EM2GO_REGISTERS.currents);
    const voltagesV = await this.readPhaseTriplet(EM2GO_REGISTERS.voltages);
    const phasesRaw = await this.readU16(EM2GO_REGISTERS.phases);
    const chargeDurationS = await this.readU32(EM2GO_REGISTERS.chargeDuration);

    const state: WallboxState = {
      status: statusFromRaw(rawStatus),
      rawStatus,
      vehicleConnected: connectorState !== 0,
      connectorState,
      errorCode,
      powerW,
      energyTotalKwh,
      chargingCurrentA,
      currentsA,
      voltagesV,
      phases: phasesRaw === 3 ? 3 : 1,
      chargeDurationS,
      ...statics,
    };

    this.lastState = state;
    return state;
  }

  getLastState(): WallboxState | null {
    return this.lastState;
  }

  isConnected(): boolean {
    return this.lastState !== null && this.lastError === null;
  }

  async startCharging(): Promise<void> {
    await this.write(EM2GO_REGISTERS.chargeCommand, [1]);
    // stopCharging parks the limit at 0A; restore the last commanded current so a
    // bare start (e.g. manual mode via HTTP) never leaves the box enabled at 0A.
    await this.write(EM2GO_REGISTERS.currentLimit, [Math.round(this.lastCommandedCurrentA * 10)]);
  }

  async stopCharging(): Promise<void> {
    await this.write(EM2GO_REGISTERS.chargeCommand, [2]);
    // evcc additionally forces the current limit to 0 on disable — the stop command
    // alone doesn't reliably keep the EM2GO from resuming on its own.
    await this.write(EM2GO_REGISTERS.currentLimit, [0]);
  }

  async setChargingCurrent(ampere: number): Promise<void> {
    if (ampere < MIN_CHARGING_CURRENT_A || ampere > MAX_CHARGING_CURRENT_A) {
      throw new Error(
        `Charging current must be between ${MIN_CHARGING_CURRENT_A} and ${MAX_CHARGING_CURRENT_A}A, got ${ampere}`,
      );
    }
    await this.write(EM2GO_REGISTERS.currentLimit, [Math.round(ampere * 10)]);
    this.lastCommandedCurrentA = ampere;
  }

  async setPhases(phases: 1 | 3): Promise<void> {
    await this.write(EM2GO_REGISTERS.phases, [phases]);
  }

  startPolling(intervalMs: number, callback: (state: WallboxState) => void): void {
    this.stopPolling();
    let pollInFlight = false;
    this.pollTimer = setInterval(() => {
      // A failing read can take up to RESPONSE_TIMEOUT_MS to reject, which can exceed
      // intervalMs. Without this guard, ticks would queue up behind each other via
      // the request lock faster than they drain during a sustained outage — any other
      // caller waiting on that same lock (e.g. an HTTP request with no cached state
      // yet) would then be stuck behind an ever-growing backlog instead of a single
      // in-flight call.
      if (pollInFlight) return;
      pollInFlight = true;
      this.getState()
        .then((state) => callback(state))
        .catch((err) => {
          // request() already closed the connection; the next tick reconnects.
          console.error('[wallbox] Poll error:', (err as Error).message);
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // EM2GO failsafe: without Modbus traffic for commTimeout seconds the box falls back
  // to its safe current. Polling normally provides that traffic, but evcc keeps a
  // dedicated keepalive at half the failsafe interval so gaps in polling can't trip it.
  private startHeartbeat(commTimeoutS: number): void {
    this.stopHeartbeat();
    if (commTimeoutS <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      this.readU16(EM2GO_REGISTERS.safeCurrent).catch((err) => {
        console.error('[wallbox] Heartbeat error:', (err as Error).message);
      });
    }, (commTimeoutS * 1000) / 2);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export function createWallboxClient(config: WallboxConfig): WallboxClient {
  return new WallboxClient(config);
}
