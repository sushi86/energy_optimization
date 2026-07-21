import { MAX_CHARGING_CURRENT_A, MIN_CHARGING_CURRENT_A, type WallboxState } from './types.js';

export type WallboxControllerMode = 'off' | 'pv' | 'manual';

export interface WallboxControllerDeps {
  toleranceMs: number;
}

export interface WallboxControlClient {
  startCharging(): Promise<void>;
  stopCharging(): Promise<void>;
  setChargingCurrent(ampere: number): Promise<void>;
  setPhases(phases: 1 | 3): Promise<void>;
}

export interface WallboxControllerDetails {
  surplusW: number;
  targetCurrentA: number | null;
  reason: string;
}

const VOLTAGE_V = 230;
const PHASES = 3;
const MIN_POWER_W = PHASES * MIN_CHARGING_CURRENT_A * VOLTAGE_V;

function clampCurrent(ampere: number): number {
  return Math.min(MAX_CHARGING_CURRENT_A, Math.max(MIN_CHARGING_CURRENT_A, ampere));
}

export class WallboxController {
  private config: WallboxControllerDeps;
  private mode: WallboxControllerMode = 'off';
  private insufficientSince: number | null = null;
  private sufficientSince: number | null = null;
  private lastDetails: WallboxControllerDetails | null = null;

  constructor(config: WallboxControllerDeps) {
    this.config = config;
  }

  getMode(): WallboxControllerMode {
    return this.mode;
  }

  getLastDetails(): WallboxControllerDetails | null {
    return this.lastDetails;
  }

  setMode(mode: WallboxControllerMode): void {
    if (this.mode !== mode) {
      console.log(`[wallbox-controller] Mode changed: ${this.mode} → ${mode}`);
    }
    this.mode = mode;
    this.insufficientSince = null;
    this.sufficientSince = null;
  }

  updateConfig(partial: Partial<WallboxControllerDeps>): void {
    Object.assign(this.config, partial);
  }

  /**
   * Full regulation pass: recomputes the display details AND, when the resulting
   * decision calls for it, issues the actual start/stop/current commands to the
   * wallbox. Callers gate how often this runs (e.g. every 20s, like the PV
   * regulation loop) since every call can talk to the hardware.
   */
  async tick(
    systemState: { pvPower: number; consumptionPower: number },
    wallboxState: WallboxState | null,
    client: WallboxControlClient,
    now: number = Date.now(),
  ): Promise<void> {
    try {
      await this.evaluate(systemState, wallboxState, client, now);
    } catch (err) {
      console.error('[wallbox-controller] tick error:', (err as Error).message);
    }
  }

  /**
   * Recomputes only the display details (surplus, target current, reason text —
   * including live elapsed-seconds counters), without ever issuing hardware
   * commands. Safe to call as often as needed (e.g. on every incoming MQTT
   * packet, or once a second to keep a running countdown ticking).
   */
  updateDetails(
    systemState: { pvPower: number; consumptionPower: number },
    wallboxState: WallboxState | null,
    now: number = Date.now(),
  ): void {
    try {
      void this.evaluate(systemState, wallboxState, null, now);
    } catch (err) {
      console.error('[wallbox-controller] updateDetails error:', (err as Error).message);
    }
  }

  private async evaluate(
    systemState: { pvPower: number; consumptionPower: number },
    wallboxState: WallboxState | null,
    client: WallboxControlClient | null,
    now: number,
  ): Promise<void> {
    if (this.mode === 'off') {
      this.insufficientSince = null;
      this.sufficientSince = null;
      this.lastDetails = null;
      if (client && wallboxState?.status === 'charging') {
        await client.stopCharging();
      }
      return;
    }

    if (this.mode === 'manual') {
      this.insufficientSince = null;
      this.sufficientSince = null;
      this.lastDetails = null;
      return;
    }

    // mode === 'pv'
    if (!wallboxState) {
      const surplusW = systemState.pvPower - systemState.consumptionPower;
      this.lastDetails = { surplusW: Math.round(surplusW), targetCurrentA: null, reason: 'Warte auf Wallbox-Daten' };
      return;
    }

    // consumptionPower already includes the wallbox's own draw (same AC circuit), so add
    // it back — otherwise charging collapses its own computed surplus (self-defeating loop).
    const surplusW = systemState.pvPower - systemState.consumptionPower + wallboxState.powerW;

    const isCharging = wallboxState.status === 'charging';

    if (isCharging) {
      this.sufficientSince = null;
      if (surplusW >= MIN_POWER_W) {
        this.insufficientSince = null;
        const targetA = clampCurrent(Math.floor(surplusW / (PHASES * VOLTAGE_V)));
        if (client && Math.round(wallboxState.chargingCurrentA) !== targetA) {
          await client.setChargingCurrent(targetA);
        }
        this.lastDetails = {
          surplusW: Math.round(surplusW),
          targetCurrentA: targetA,
          reason: `Lädt mit ${targetA} A (Überschuss ${Math.round(surplusW)} W)`,
        };
      } else {
        if (this.insufficientSince === null) this.insufficientSince = now;
        const elapsedS = Math.round((now - this.insufficientSince) / 1000);
        const toleranceS = Math.round(this.config.toleranceMs / 1000);
        if (client && now - this.insufficientSince >= this.config.toleranceMs) {
          await client.stopCharging();
          this.insufficientSince = null;
        }
        this.lastDetails = {
          surplusW: Math.round(surplusW),
          targetCurrentA: null,
          reason: `Überschuss unzureichend seit ${elapsedS}s — stoppt nach ${toleranceS}s`,
        };
      }
    } else {
      this.insufficientSince = null;
      if (!wallboxState.vehicleConnected) {
        this.sufficientSince = null;
        this.lastDetails = { surplusW: Math.round(surplusW), targetCurrentA: null, reason: 'Kein Fahrzeug verbunden' };
        return;
      }
      if (surplusW >= MIN_POWER_W) {
        if (this.sufficientSince === null) this.sufficientSince = now;
        const elapsedS = Math.round((now - this.sufficientSince) / 1000);
        const toleranceS = Math.round(this.config.toleranceMs / 1000);
        if (client && now - this.sufficientSince >= this.config.toleranceMs) {
          const targetA = clampCurrent(Math.floor(surplusW / (PHASES * VOLTAGE_V)));
          await client.setPhases(3);
          await client.setChargingCurrent(targetA);
          await client.startCharging();
          this.sufficientSince = null;
        }
        this.lastDetails = {
          surplusW: Math.round(surplusW),
          targetCurrentA: null,
          reason: `Ausreichend Überschuss seit ${elapsedS}s — startet nach ${toleranceS}s`,
        };
      } else {
        this.sufficientSince = null;
        this.lastDetails = {
          surplusW: Math.round(surplusW),
          targetCurrentA: null,
          reason: `Zu wenig Überschuss (${Math.round(surplusW)} W, benötigt ${MIN_POWER_W} W)`,
        };
      }
    }
  }
}
