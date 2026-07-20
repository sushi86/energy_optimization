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

// EM2GO's Modbus TCP stack cannot handle overlapping requests on one connection —
// concurrent access (e.g. the background poller and an HTTP-triggered read racing)
// causes a request to hang forever with no error. All requests are serialized through
// this connection and given a hard response timeout so a stuck transaction can never
// wedge every future call.
const RESPONSE_TIMEOUT_MS = 5000;
const INTER_REQUEST_DELAY_MS = 60;

export class WallboxClient {
  private readonly client = new ModbusRTU();
  private readonly config: WallboxConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: WallboxState | null = null;
  private lastError: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

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

  async connect(): Promise<void> {
    await this.client.connectTCP(this.config.host, { port: this.config.port });
    this.client.setID(this.config.unitId);
    this.client.setTimeout(RESPONSE_TIMEOUT_MS);
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    await new Promise<void>((resolve) => this.client.close(() => resolve()));
  }

  private async readU16(reg: number): Promise<number> {
    await sleep(INTER_REQUEST_DELAY_MS);
    const res = await this.client.readHoldingRegisters(reg, 1);
    return res.data[0];
  }

  private async readU32(reg: number): Promise<number> {
    await sleep(INTER_REQUEST_DELAY_MS);
    const res = await this.client.readHoldingRegisters(reg, 2);
    return ((res.data[0] << 16) | res.data[1]) >>> 0;
  }

  private async readPhaseTriplet(reg: number): Promise<[number, number, number]> {
    const l1 = await this.readU16(reg);
    const l2 = await this.readU16(reg + 2);
    const l3 = await this.readU16(reg + 4);
    return [l1 / 10, l2 / 10, l3 / 10];
  }

  private async readSerial(): Promise<string> {
    await sleep(INTER_REQUEST_DELAY_MS);
    const res = await this.client.readHoldingRegisters(EM2GO_REGISTERS.serial, 16);
    return String.fromCharCode(...res.data).replace(/\0/g, '').trim();
  }

  async getState(): Promise<WallboxState> {
    try {
      const state = await this.withLock(() => this.readState());
      this.lastError = null;
      return state;
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    }
  }

  private async readState(): Promise<WallboxState> {
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
    const evseMaxCurrentA = (await this.readU16(EM2GO_REGISTERS.maxCurrent)) / 10;
    const evseMinCurrentA = (await this.readU16(EM2GO_REGISTERS.minCurrent)) / 10;
    const cableMaxCurrentA = (await this.readU16(EM2GO_REGISTERS.cableMaxCurrent)) / 10;
    const safeCurrentA = (await this.readU16(EM2GO_REGISTERS.safeCurrent)) / 10;
    const commTimeoutS = await this.readU16(EM2GO_REGISTERS.commTimeout);
    const chargeMode = await this.readU16(EM2GO_REGISTERS.chargeMode);
    const serial = await this.readSerial();

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
      evseMaxCurrentA,
      evseMinCurrentA,
      cableMaxCurrentA,
      safeCurrentA,
      commTimeoutS,
      chargeMode,
      serial,
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
    await this.withLock(() => this.client.writeRegisters(EM2GO_REGISTERS.chargeCommand, [1]));
  }

  async stopCharging(): Promise<void> {
    await this.withLock(() => this.client.writeRegisters(EM2GO_REGISTERS.chargeCommand, [2]));
  }

  async setChargingCurrent(ampere: number): Promise<void> {
    if (ampere < MIN_CHARGING_CURRENT_A || ampere > MAX_CHARGING_CURRENT_A) {
      throw new Error(
        `Charging current must be between ${MIN_CHARGING_CURRENT_A} and ${MAX_CHARGING_CURRENT_A}A, got ${ampere}`,
      );
    }
    await this.withLock(() => this.client.writeRegisters(EM2GO_REGISTERS.currentLimit, [Math.round(ampere * 10)]));
  }

  async setPhases(phases: 1 | 3): Promise<void> {
    await this.withLock(() => this.client.writeRegisters(EM2GO_REGISTERS.phases, [phases]));
  }

  startPolling(intervalMs: number, callback: (state: WallboxState) => void): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.getState()
        .then(callback)
        .catch((err) => console.error('[wallbox] Poll error:', (err as Error).message));
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export function createWallboxClient(config: WallboxConfig): WallboxClient {
  return new WallboxClient(config);
}
