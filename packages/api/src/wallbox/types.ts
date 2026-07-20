// packages/api/src/wallbox/types.ts

export interface WallboxConfig {
  host: string;
  port: number;
  unitId: number;
}

export type WallboxStatus = 'available' | 'connected' | 'charging' | 'error' | 'unknown';

export interface WallboxState {
  status: WallboxStatus;
  rawStatus: number;
  vehicleConnected: boolean;
  connectorState: number;
  errorCode: number;
  powerW: number;
  energyTotalKwh: number;
  chargingCurrentA: number;
  currentsA: [number, number, number];
  voltagesV: [number, number, number];
  phases: 1 | 3;
  chargeDurationS: number;
  evseMaxCurrentA: number;
  evseMinCurrentA: number;
  cableMaxCurrentA: number;
  safeCurrentA: number;
  commTimeoutS: number;
  chargeMode: number;
  serial: string;
}

// TODO: verify register addresses against official EM2GO Modbus documentation
// Source: https://github.com/evcc-io/evcc/blob/master/charger/em2go.go (evcc-io charger driver),
// which references "ModBus TCP Registers EM2GO Series.pdf". All addresses are decimal
// Modbus holding registers, read via Function Code 3, written via Function Code 16
// (WriteMultipleRegisters) — NOT Function Code 6.
export const EM2GO_REGISTERS = {
  status: 0,          // u16 RO enum: 1=Standby 2=Connected 3=Starting 4=Charging 6=ChargingEnd
  connectorState: 2,   // u16 RO enum — vehicle/plug connection state
  errorCode: 4,        // u16 RO
  currents: 6,         // u16 RO 0.1A, L1 at +0, L2 at +2, L3 at +4
  power: 12,           // u32 RO 1W
  energy: 28,          // u32 RO 0.1kWh
  maxCurrent: 32,       // u16 RO 0.1A — EVSE max current
  minCurrent: 34,       // u16 RO 0.1A — EVSE min current
  cableMaxCurrent: 36,  // u16 RO 0.1A
  serial: 38,           // chr[16] RO UTF16, 16 registers (32 bytes)
  chargeDuration: 78,   // u32 RO 1s
  safeCurrent: 87,      // u16 RO 0.1A — failsafe fallback current
  commTimeout: 89,      // u16 RO 1s — failsafe comm timeout
  currentLimit: 91,     // u16 WR 0.1A — set charging current
  chargeMode: 93,       // u16 WR enum
  chargeCommand: 95,    // u16 WR enum: 1=start, 2=stop
  voltages: 109,        // u16 RO 0.1V, L1 at +0, L2 at +2, L3 at +4
  phases: 200,          // u16 WR: 1 or 3
} as const;

export const MIN_CHARGING_CURRENT_A = 6;
export const MAX_CHARGING_CURRENT_A = 16;
