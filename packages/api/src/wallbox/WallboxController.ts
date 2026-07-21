import { MAX_CHARGING_CURRENT_A, MIN_CHARGING_CURRENT_A, type WallboxState } from './types.js';
import { energyEvents } from '../energy-events.js';

export type WallboxControllerMode = 'off' | 'pv' | 'manual';

export interface WallboxControllerDeps {
  toleranceMs: number;
  /** Obergrenze für Hauslast + Wallbox (maxAcPowerW − Reserve); PV-Laden bleibt darunter. */
  acLoadCapW: number;
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
  startAttempts: number;
  pendingStart: boolean;
  rejected: boolean;
}

const VOLTAGE_V = 230;
const MIN_POWER_1P_W = 1 * MIN_CHARGING_CURRENT_A * VOLTAGE_V; // 1380 W
const MIN_POWER_3P_W = 3 * MIN_CHARGING_CURRENT_A * VOLTAGE_V; // 4140 W
// Hysterese: hochgeschaltet (bzw. 3-phasig gestartet) wird erst mit Marge über dem
// 3P-Minimum, damit ein um die Schwelle pendelnder Überschuss nicht ständig umschaltet.
const PHASE_SWITCH_MARGIN_W = 300;
const SWITCH_UP_W = MIN_POWER_3P_W + PHASE_SWITCH_MARGIN_W; // 4440 W
const START_ATTEMPT_LIMIT = 3;

function targetCurrent(surplusW: number, phases: 1 | 3): number {
  const ampere = Math.floor(surplusW / (phases * VOLTAGE_V));
  return Math.min(MAX_CHARGING_CURRENT_A, Math.max(MIN_CHARGING_CURRENT_A, ampere));
}

export class WallboxController {
  private config: WallboxControllerDeps;
  private mode: WallboxControllerMode = 'off';
  private insufficientSince: number | null = null;
  private sufficientSince: number | null = null;
  private switchUpSince: number | null = null;
  private switchDownSince: number | null = null;
  private lastDetails: WallboxControllerDetails | null = null;
  private startNotifiedPending = false;
  private startAttempts = 0;
  private pendingStart = false;
  private rejected = false;

  constructor(config: WallboxControllerDeps) {
    this.config = config;
  }

  getMode(): WallboxControllerMode {
    return this.mode;
  }

  getLastDetails(): WallboxControllerDetails | null {
    return this.lastDetails;
  }

  resetRejected(): void {
    this.rejected = false;
    this.startAttempts = 0;
    this.startNotifiedPending = false;
  }

  setMode(mode: WallboxControllerMode): void {
    if (this.mode !== mode) {
      console.log(`[wallbox-controller] Mode changed: ${this.mode} → ${mode}`);
    }
    this.mode = mode;
    this.insufficientSince = null;
    this.sufficientSince = null;
    this.switchUpSince = null;
    this.switchDownSince = null;
    this.startNotifiedPending = false;
    this.startAttempts = 0;
    this.pendingStart = false;
    this.rejected = false;
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
      this.switchUpSince = null;
      this.switchDownSince = null;
      this.lastDetails = null;
      if (client && wallboxState?.status === 'charging') {
        await client.stopCharging();
      }
      return;
    }

    if (this.mode === 'manual') {
      this.insufficientSince = null;
      this.sufficientSince = null;
      this.switchUpSince = null;
      this.switchDownSince = null;
      this.lastDetails = null;
      return;
    }

    // mode === 'pv'
    if (!wallboxState) {
      this.switchUpSince = null;
      this.switchDownSince = null;
      const surplusW = systemState.pvPower - systemState.consumptionPower;
      this.lastDetails = { surplusW: Math.round(surplusW), targetCurrentA: null, reason: 'Warte auf Wallbox-Daten', startAttempts: this.startAttempts, pendingStart: this.pendingStart, rejected: this.rejected };
      return;
    }

    const isCharging = wallboxState.status === 'charging';

    // Resolve the outcome of a start attempt issued on a previous tick before
    // doing anything else. Only tick() (client present) drives this so that
    // updateDetails() stays side-effect-free, matching the rest of this class.
    if (client && this.pendingStart) {
      this.pendingStart = false;
      if (isCharging) {
        this.startAttempts = 0;
      } else {
        this.startAttempts += 1;
        if (this.startAttempts >= START_ATTEMPT_LIMIT) {
          this.rejected = true;
        }
      }
    }

    // consumptionPower already includes the wallbox's own draw (same AC circuit), so add
    // it back — otherwise charging collapses its own computed surplus (self-defeating loop).
    const surplusW = systemState.pvPower - systemState.consumptionPower + wallboxState.powerW;

    // AC-Lastdeckel: Hauslast (ohne Wallbox) + Wallbox darf acLoadCapW nie übersteigen —
    // sonst käme der Rest aus dem Netz. Alles Weitere rechnet mit dem Minimum aus
    // PV-Überschuss und verbleibendem Deckel-Spielraum.
    const otherConsumptionW = systemState.consumptionPower - wallboxState.powerW;
    const availableW = Math.min(surplusW, this.config.acLoadCapW - otherConsumptionW);
    const capSuffix = availableW < surplusW ? ' — AC-Limit aktiv' : '';

    if (isCharging) {
      this.sufficientSince = null;
      this.startNotifiedPending = false;
      const phases = wallboxState.phases;
      const toleranceS = Math.round(this.config.toleranceMs / 1000);

      if (availableW < MIN_POWER_1P_W) {
        this.switchUpSince = null;
        this.switchDownSince = null;
        if (this.insufficientSince === null) this.insufficientSince = now;
        const elapsedS = Math.round((now - this.insufficientSince) / 1000);
        if (client && now - this.insufficientSince >= this.config.toleranceMs) {
          await client.stopCharging();
          this.insufficientSince = null;
          energyEvents.emit('wallbox:charging-stopped', { surplusW: Math.round(availableW), capped: availableW < surplusW });
        }
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: null,
          reason: `Überschuss unzureichend seit ${elapsedS}s — stoppt nach ${toleranceS}s${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      } else if (phases === 1 && availableW >= SWITCH_UP_W) {
        this.insufficientSince = null;
        this.switchDownSince = null;
        if (this.switchUpSince === null) this.switchUpSince = now;
        const elapsedS = Math.round((now - this.switchUpSince) / 1000);
        if (client && now - this.switchUpSince >= this.config.toleranceMs) {
          const newCurrentA = targetCurrent(availableW, 3);
          await client.setPhases(3);
          await client.setChargingCurrent(newCurrentA);
          this.switchUpSince = null;
          energyEvents.emit('wallbox:phases-switched', { from: 1, to: 3, currentA: newCurrentA, surplusW: Math.round(availableW), capped: availableW < surplusW });
        }
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: null,
          reason: `Überschuss reicht für 3-phasig seit ${elapsedS}s — schaltet um nach ${toleranceS}s${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      } else if (phases === 3 && availableW < MIN_POWER_3P_W) {
        this.insufficientSince = null;
        this.switchUpSince = null;
        if (this.switchDownSince === null) this.switchDownSince = now;
        const elapsedS = Math.round((now - this.switchDownSince) / 1000);
        if (client && now - this.switchDownSince >= this.config.toleranceMs) {
          const newCurrentA = targetCurrent(availableW, 1);
          await client.setPhases(1);
          await client.setChargingCurrent(newCurrentA);
          this.switchDownSince = null;
          energyEvents.emit('wallbox:phases-switched', { from: 3, to: 1, currentA: newCurrentA, surplusW: Math.round(availableW), capped: availableW < surplusW });
        }
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: null,
          reason: `Überschuss reicht nur für 1-phasig seit ${elapsedS}s — schaltet um nach ${toleranceS}s${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      } else {
        this.insufficientSince = null;
        this.switchUpSince = null;
        this.switchDownSince = null;
        const targetA = targetCurrent(availableW, phases);
        if (client && Math.round(wallboxState.chargingCurrentA) !== targetA) {
          await client.setChargingCurrent(targetA);
        }
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: targetA,
          reason: `Lädt ${phases}-phasig mit ${targetA} A (Überschuss ${Math.round(availableW)} W)${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      }
    } else {
      this.insufficientSince = null;
      this.switchUpSince = null;
      this.switchDownSince = null;
      if (!wallboxState.vehicleConnected) {
        this.sufficientSince = null;
        this.startNotifiedPending = false;
        this.startAttempts = 0;
        this.pendingStart = false;
        this.rejected = false;
        this.lastDetails = { surplusW: Math.round(surplusW), targetCurrentA: null, reason: 'Kein Fahrzeug verbunden', startAttempts: this.startAttempts, pendingStart: this.pendingStart, rejected: this.rejected };
        return;
      }
      if (availableW >= MIN_POWER_1P_W) {
        if (this.rejected) {
          this.sufficientSince = null;
          this.lastDetails = {
            surplusW: Math.round(availableW),
            targetCurrentA: null,
            reason: 'Ladung abgelehnt, Auto voll?',
            startAttempts: this.startAttempts,
            pendingStart: this.pendingStart,
            rejected: this.rejected,
          };
          return;
        }
        if (this.sufficientSince === null) this.sufficientSince = now;
        const startPhases: 1 | 3 = availableW >= SWITCH_UP_W ? 3 : 1;
        const elapsedS = Math.round((now - this.sufficientSince) / 1000);
        const toleranceS = Math.round(this.config.toleranceMs / 1000);
        if (client && now - this.sufficientSince >= this.config.toleranceMs) {
          const startCurrentA = targetCurrent(availableW, startPhases);
          await client.setPhases(startPhases);
          await client.setChargingCurrent(startCurrentA);
          await client.startCharging();
          this.sufficientSince = null;
          this.pendingStart = true;
          if (!this.startNotifiedPending) {
            this.startNotifiedPending = true;
            energyEvents.emit('wallbox:charging-started', {
              phases: startPhases,
              currentA: startCurrentA,
              surplusW: Math.round(availableW),
              capped: availableW < surplusW,
            });
          }
        }
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: null,
          reason: `Ausreichend Überschuss (${startPhases}-phasig) seit ${elapsedS}s — startet nach ${toleranceS}s${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      } else {
        this.sufficientSince = null;
        this.lastDetails = {
          surplusW: Math.round(availableW),
          targetCurrentA: null,
          reason: `Zu wenig Überschuss (${Math.round(availableW)} W, benötigt ${MIN_POWER_1P_W} W)${capSuffix}`,
          startAttempts: this.startAttempts,
          pendingStart: this.pendingStart,
          rejected: this.rejected,
        };
      }
    }
  }
}
