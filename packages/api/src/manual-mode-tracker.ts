import { energyEvents } from './energy-events.js';
import type { ControllerMode } from './controller.js';

/** Battery power below this (W) counts as discharging (negative = discharge). */
const DISCHARGE_THRESHOLD_W = -100;
/** Repeat the manual-discharge warning at most every 10 minutes. */
const WARN_INTERVAL_MS = 10 * 60 * 1000;

export interface ManualModeCheckContext {
  mode: ControllerMode;
  batterySoc: number;
  batteryPowerW: number;
  /** SOC threshold at/below which manual discharge forces a switch back to auto. */
  manualModeFloorPercent: number;
  /** Called to switch the controller back to auto (e.g. () => controller.setMode('auto')). */
  switchToAuto: () => void;
}

/**
 * Monitors the manual mode during each regulation tick.
 *
 * - While manual mode discharges the battery, emits `controller:manual-discharge`
 *   immediately at the start of each discharge phase and then at most every 10 min.
 * - When manual mode discharges at/below `manualModeFloorPercent`, switches the
 *   controller back to auto and emits `controller:auto-restored`.
 */
export class ManualModeTracker {
  private lastWarnAt: number | null = null;

  check(ctx: ManualModeCheckContext, now: number = Date.now()): void {
    const isManual = ctx.mode === 'manual';
    const isDischarging = ctx.batteryPowerW < DISCHARGE_THRESHOLD_W;

    // Safety: manual discharge at/below floor → back to auto (evaluated before the warning)
    if (isManual && isDischarging && ctx.batterySoc <= ctx.manualModeFloorPercent) {
      ctx.switchToAuto();
      energyEvents.emit('controller:auto-restored', { batterySoc: ctx.batterySoc });
      this.lastWarnAt = null;
      return;
    }

    // Recurring warning while manual mode discharges the battery
    if (isManual && isDischarging) {
      if (this.lastWarnAt === null || now - this.lastWarnAt >= WARN_INTERVAL_MS) {
        energyEvents.emit('controller:manual-discharge', {
          batterySoc: ctx.batterySoc,
          batteryPowerW: ctx.batteryPowerW,
        });
        this.lastWarnAt = now;
      }
      return;
    }

    // Condition no longer holds — reset so the next discharge phase warns immediately
    this.lastWarnAt = null;
  }
}
