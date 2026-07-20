import ModbusRTU from 'modbus-serial';
import {
  EM2GO_REGISTERS,
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

export class WallboxClient {
  private readonly client = new ModbusRTU();
  private readonly config: WallboxConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: WallboxState | null = null;

  constructor(config: WallboxConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    await this.client.connectTCP(this.config.host, { port: this.config.port });
    this.client.setID(this.config.unitId);
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    await new Promise<void>((resolve) => this.client.close(() => resolve()));
  }

  private async readU16(reg: number): Promise<number> {
    const res = await this.client.readHoldingRegisters(reg, 1);
    return res.data[0];
  }

  private async readU32(reg: number): Promise<number> {
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
    const res = await this.client.readHoldingRegisters(EM2GO_REGISTERS.serial, 16);
    const bytes = Buffer.alloc(res.data.length * 2);
    res.data.forEach((word: number, i: number) => bytes.writeUInt16BE(word, i * 2));
    return bytes.toString('utf16le').replace(/\x00/g, '');
  }

  async getState(): Promise<WallboxState> {
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
