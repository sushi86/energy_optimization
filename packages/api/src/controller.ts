import type { SystemState } from './mqtt-service.js';
import type { Forecast } from './vrm-service.js';
import type { ChargePlan, ChargePlanSlot } from './charge-plan.js';

/** Format watts for display: ≥1000 → "10.7 kW", else "950 W" */
function fmtW(w: number): string {
  return Math.abs(w) >= 1000
    ? `${(w / 1000).toFixed(1)} kW`
    : `${Math.round(w)} W`;
}

export interface PriceEntry {
  timestamp: number;  // unix seconds
  price: number | null;
}

export type ControllerMode = 'auto' | 'manual' | 'winter';

export interface ControllerDeps {
  batteryCapacityKwh: number;
  minSocPercent: number;
  targetSocPercent: number;
  maxAcPowerW: number;
  winterModeThresholdFactor: number;
  deadbandW: number;
  priceOptimization: boolean;
  allowFeedInNegativePrice: boolean;
  activeMorningDischarge: boolean;
  activeMorningDischargeMinSocPercent: number;
}

export interface ControllerDetails {
  currentSurplusW: number;
  desiredChargePowerW: number;
  feedInW: number;
  batteryNeedKwh: number;
  remainingHours: number;
  remainingForecastKwh: number;
  isClippingRisk: boolean;
  earlyClippingOverride: boolean;
  batterySoc: number;
  targetSocPercent: number;
  goal: string;
  forcedChargeKwh: number;
  voluntaryChargeKwh: number;
  clippingHours: number;
  strategy: string;
  priceOptimization?: {
    active: boolean;
    currentPriceEurMwh: number | null;
    avgPriceEurMwh: number;
    mode: 'feed-in' | 'charge' | 'negative';
    reason: string;
  };
  dischargeMode?: 'active' | 'hold' | 'trickle';
  dischargeBand?: { floor: number; holdTarget: number };
  dischargeReason?: string;
  dischargePlanEndsAt?: string;
}

export interface SetpointResult {
  setpointW: number;
  mode: ControllerMode;
  reason: string;
  details: ControllerDetails | null;
}

function roundTo50(value: number): number {
  return Math.round(value / 50) * 50;
}

export class Controller {
  private config: ControllerDeps;
  private mode: ControllerMode = 'auto';
  private lastAppliedSetpoint: number | null = null;
  private lastResult: SetpointResult | null = null;

  constructor(config: ControllerDeps) {
    this.config = config;
  }

  getMode(): ControllerMode {
    return this.mode;
  }

  setMode(mode: ControllerMode): void {
    if (this.mode !== mode) {
      console.log(`[controller] Mode changed: ${this.mode} → ${mode}`);
    }
    this.mode = mode;
  }

  getLastResult(): SetpointResult | null {
    return this.lastResult;
  }

  updateConfig(config: Partial<ControllerDeps>): void {
    Object.assign(this.config, config);
  }

  handleExternalSetpointChange(valueW: number): void {
    if (this.mode !== 'manual') {
      console.log(`[controller] External setpoint change detected (${fmtW(valueW)}) — switching from ${this.mode} to manual`);
    }
    this.mode = 'manual';
    this.lastAppliedSetpoint = valueW;
  }

  applySetpoint(valueW: number): void {
    this.lastAppliedSetpoint = valueW;
  }

  computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices?: PriceEntry[], chargePlan?: ChargePlan): SetpointResult {
    const result = this._computeSetpoint(state, forecast, remainingForecastKwh, prices ?? [], chargePlan ?? null);
    this.lastResult = result;
    return result;
  }

  private _computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices: PriceEntry[], chargePlan: ChargePlan | null): SetpointResult {
    const { batteryCapacityKwh, minSocPercent, targetSocPercent, winterModeThresholdFactor, deadbandW } = this.config;

    const noDetails: ControllerDetails | null = null;

    // Manual mode — don't compute (must be checked before winter mode to respect user override)
    if (this.mode === 'manual') {
      return {
        setpointW: this.lastAppliedSetpoint ?? 0,
        mode: 'manual',
        reason: 'Manual mode active',
        details: noDetails,
      };
    }

    // Winter mode check
    if (forecast.totalKwh < batteryCapacityKwh * winterModeThresholdFactor) {
      return { setpointW: 0, mode: 'winter', reason: 'Winter mode: forecast below threshold', details: noDetails };
    }

    // Active-discharge slots get a lowered SOC floor.
    // The lowered floor also persists for the rest of the day after the discharge
    // window, so that the post-drain SOC is allowed to stay low until the
    // late-charging plan refills it — instead of forcing an immediate refill
    // to minSocPercent that consumes morning surplus that should be fed in.
    const plannedSlot = chargePlan ? this.findCurrentPlanSlot(chargePlan) : null;
    const isActiveDischargeSlot = plannedSlot != null
      && plannedSlot.chargePowerW < 0
      && this.config.activeMorningDischarge;
    const planHasDischargeToday = this.config.activeMorningDischarge
      && chargePlan != null
      && (chargePlan.slots.some(s => s.chargePowerW < 0) || chargePlan.activeDischarge != null);
    const effectiveMinSoc = (isActiveDischargeSlot || planHasDischargeToday)
      ? this.config.activeMorningDischargeMinSocPercent
      : minSocPercent;

    // Safety: SOC below (effective) minimum
    if (state.batterySoc < effectiveMinSoc) {
      return { setpointW: 0, mode: 'auto', reason: `SOC (${state.batterySoc}%) below minimum (${effectiveMinSoc}%)`, details: noDetails };
    }

    // Safety: no meaningful PV production
    if (state.pvPower <= state.consumptionPower) {
      return { setpointW: 0, mode: 'auto', reason: 'PV production below consumption', details: noDetails };
    }

    // Calculate how much energy the battery still needs
    const currentSocFraction = state.batterySoc / 100;
    const targetSocFraction = targetSocPercent / 100;
    const batteryNeedKwh = (targetSocFraction - currentSocFraction) * batteryCapacityKwh;

    // Current actual surplus (what PV produces beyond consumption)
    const currentSurplusW = state.pvPower - state.consumptionPower;

    // Battery full or nearly full (skip when in any discharge-related slot — that's the whole point)
    const isAnyDischargeRelatedSlot = isActiveDischargeSlot
      || plannedSlot?.dischargeState === 'hold'
      || plannedSlot?.dischargeState === 'trickle';
    if (!isAnyDischargeRelatedSlot && (state.batterySoc >= 99 || batteryNeedKwh <= 0)) {
      // At 99% with high PV: limit charge to ~2kW to prevent inverter dumping full surplus.
      // At 100%: battery is truly full, let the system self-regulate.
      const highPvThreshold = 5000;
      if (state.batterySoc < 100 && currentSurplusW > highPvThreshold) {
        const limitedChargeW = 2000;
        const feedInW = currentSurplusW - limitedChargeW;
        const setpoint = -feedInW;
        return {
          setpointW: roundTo50(setpoint),
          mode: 'auto',
          reason: `Battery ${state.batterySoc >= 99 ? `at ${Math.round(state.batterySoc)}%` : 'full'} — high PV, limiting charge to ${fmtW(limitedChargeW)}`,
          details: {
            currentSurplusW,
            desiredChargePowerW: limitedChargeW,
            feedInW: Math.round(feedInW),
            batteryNeedKwh: 0,
            remainingHours: 0,
            remainingForecastKwh,
            isClippingRisk: state.pvPower > this.config.maxAcPowerW,
            earlyClippingOverride: false,
            batterySoc: state.batterySoc,
            targetSocPercent,
            goal: `Batterie voll — hohe PV-Leistung, Ladung auf ${fmtW(limitedChargeW)} begrenzt, Rest einspeisen`,
            forcedChargeKwh: 0,
            voluntaryChargeKwh: 0,
            clippingHours: 0,
            strategy: `Batterie voll bei hoher PV — ${fmtW(limitedChargeW)} Erhaltungsladung, ${fmtW(feedInW)} einspeisen`,
          },
        };
      }
      return {
        setpointW: 0,
        mode: 'auto',
        reason: `Battery ${state.batterySoc >= 99 ? `at ${Math.round(state.batterySoc)}%` : 'full'} — system self-regulating`,
        details: {
          currentSurplusW,
          desiredChargePowerW: 0,
          feedInW: 0,
          batteryNeedKwh: 0,
          remainingHours: 0,
          remainingForecastKwh,
          isClippingRisk: false,
          earlyClippingOverride: false,
          batterySoc: state.batterySoc,
          targetSocPercent,
          goal: 'Batterie voll — Anlage regelt selbst (Setpoint 0W)',
          forcedChargeKwh: 0,
          voluntaryChargeKwh: 0,
          clippingHours: 0,
          strategy: '',
        },
      };
    }

    // Calculate surplus ratio — use charge plan net surplus (accounts for correction factor
    // and consumption) when available, fall back to raw forecast otherwise
    const ih = forecast.intervalHours || 0.25;
    const netForecastKwh = chargePlan
      ? chargePlan.slots.reduce((sum, s) => sum + Math.max(0, s.chargePowerW + s.feedInPowerW) * ih / 1000, 0)
      : remainingForecastKwh;
    const surplusKwh = netForecastKwh - batteryNeedKwh;
    const surplusRatio = batteryNeedKwh > 0 ? netForecastKwh / batteryNeedKwh : Infinity;

    const isDischargeRelatedSlot = isActiveDischargeSlot
      || plannedSlot?.dischargeState === 'hold'
      || plannedSlot?.dischargeState === 'trickle';
    if (!isDischargeRelatedSlot && (surplusKwh <= 0 || surplusRatio < 1.5)) {
      const now = new Date();
      return {
        setpointW: 0,
        mode: 'auto',
        reason: 'Prioritizing battery charge — tight forecast',
        details: {
          currentSurplusW,
          desiredChargePowerW: currentSurplusW,
          feedInW: 0,
          batteryNeedKwh,
          remainingHours: this.getRemainingProductionHours(forecast, now),
          remainingForecastKwh: Math.round(netForecastKwh * 10) / 10,
          isClippingRisk: false,
          earlyClippingOverride: false,
          batterySoc: state.batterySoc,
          targetSocPercent,
          goal: `Batterie laden priorisieren — Prognose knapp (${netForecastKwh.toFixed(1)} kWh netto verbleibend, ${batteryNeedKwh.toFixed(1)} kWh benötigt, Ratio ${surplusRatio.toFixed(1)}x)`,
          forcedChargeKwh: 0,
          voluntaryChargeKwh: 0,
          clippingHours: 0,
          strategy: '',
        },
      };
    }

    // --- Plan-guided charge/feed-in decision ---
    if (chargePlan) {
      const currentSlot = plannedSlot;
      if (currentSlot) {
        const dischargeState = currentSlot.dischargeState; // 'active' | 'hold' | 'trickle' | undefined
        const isHoldSlot = dischargeState === 'hold';
        const isTrickleSlot = dischargeState === 'trickle';

        // When actual surplus < planned: reduce feed-in first, protect charging.
        // When actual surplus > planned: keep planned charge, extra goes to feed-in.
        // Negative chargePowerW = active discharge: feed-in includes battery power.
        let desiredChargePowerW: number;
        let feedInW: number;

        if (currentSurplusW <= 0) {
          desiredChargePowerW = 0;
          feedInW = 0;
        } else if (isActiveDischargeSlot) {
          desiredChargePowerW = currentSlot.chargePowerW; // negative
          feedInW = Math.min(this.config.maxAcPowerW, currentSurplusW - desiredChargePowerW);
        } else if (isHoldSlot) {
          desiredChargePowerW = 0;
          feedInW = Math.min(this.config.maxAcPowerW, currentSurplusW);
        } else {
          // Trickle (positive chargePowerW capped) reuses normal path: planned chargePowerW is the cap.
          desiredChargePowerW = Math.min(currentSlot.chargePowerW, currentSurplusW);
          feedInW = Math.max(0, currentSurplusW - desiredChargePowerW);
        }

        // Safety: anti-clipping takes priority (skip during active discharge)
        const antiClipChargeW = Math.max(0, state.pvPower - this.config.maxAcPowerW);
        if (!isActiveDischargeSlot && antiClipChargeW > desiredChargePowerW) {
          const extra = antiClipChargeW - desiredChargePowerW;
          desiredChargePowerW = antiClipChargeW;
          feedInW = Math.max(0, feedInW - extra);
        }

        const setpoint = feedInW > 0 ? -feedInW : 0;

        const now = new Date();
        const plannedSurplusW = currentSlot.chargePowerW + currentSlot.feedInPowerW;
        const ad = chargePlan.activeDischarge;
        const dischargeStrategyOverride =
          isHoldSlot && ad ? `Halten ${ad.floorPercent}–${ad.holdTargetPercent}% — Akku ruht (Setpoint 0 W)` :
          isTrickleSlot && ad ? `Sanftes Auffüllen auf ${ad.holdTargetPercent}% (max ${fmtW(currentSlot.chargePowerW)} aus PV)` :
          dischargeState === 'active' && ad ? `Aktiv entladen — Ziel: Halten bei ${ad.holdTargetPercent}%` :
          null;
        const strategy = `Ladeplan: ${fmtW(desiredChargePowerW)} laden, ${fmtW(feedInW)} einspeisen (Plan: ${fmtW(currentSlot.chargePowerW)}/${fmtW(currentSlot.feedInPowerW)}, Überschuss ${fmtW(currentSurplusW)}/${fmtW(plannedSurplusW)})`;

        const details: ControllerDetails = {
          currentSurplusW: Math.round(currentSurplusW),
          desiredChargePowerW: Math.round(desiredChargePowerW),
          feedInW: Math.round(feedInW),
          batteryNeedKwh: Math.round(batteryNeedKwh * 10) / 10,
          remainingHours: this.getRemainingProductionHours(forecast, now),
          remainingForecastKwh,
          isClippingRisk: state.pvPower > this.config.maxAcPowerW,
          earlyClippingOverride: false,
          batterySoc: Math.round(state.batterySoc),
          targetSocPercent,
          goal: `Ladeplan folgen — ${currentSlot.timestamp.slice(11, 16)}: ${fmtW(desiredChargePowerW)} laden, ${fmtW(feedInW)} einspeisen`,
          forcedChargeKwh: 0,
          voluntaryChargeKwh: 0,
          clippingHours: 0,
          strategy: dischargeStrategyOverride ?? strategy,
          ...(dischargeState ? { dischargeMode: dischargeState } : {}),
          ...(ad ? {
            dischargeBand: { floor: ad.floorPercent, holdTarget: ad.holdTargetPercent },
            dischargeReason: ad.reason,
            ...(ad.endsAt ? { dischargePlanEndsAt: ad.endsAt } : {}),
          } : {}),
        };

        // Battery discharge correction (skip during active discharge — discharge is intentional)
        let correctedSetpoint = setpoint;
        const batteryDischargingWhileShouldCharge = !isActiveDischargeSlot && batteryNeedKwh > 0 && state.batteryPower < -100;
        if (batteryDischargingWhileShouldCharge) {
          const correction = Math.abs(state.batteryPower) + desiredChargePowerW;
          correctedSetpoint = setpoint + correction;
          correctedSetpoint = Math.min(correctedSetpoint, 0);
          details.goal = `KORREKTUR: Batterie entlädt mit ${fmtW(Math.abs(state.batteryPower))} statt ${fmtW(desiredChargePowerW)} zu laden — Einspeisung reduzieren`;
        }

        // Deadband
        if (!batteryDischargingWhileShouldCharge && this.lastAppliedSetpoint !== null) {
          const diff = Math.abs(correctedSetpoint - this.lastAppliedSetpoint);
          if (diff < this.config.deadbandW) {
            return {
              setpointW: this.lastAppliedSetpoint,
              mode: 'auto',
              reason: `Im deadband (${diff.toFixed(0)} W < ${this.config.deadbandW} W), Sollwert beibehalten`,
              details,
            };
          }
        }

        return {
          setpointW: roundTo50(correctedSetpoint),
          mode: 'auto',
          reason: `Ladeplan: Einspeisung ${fmtW(Math.abs(roundTo50(correctedSetpoint)))}, Ladung ${fmtW(desiredChargePowerW)}`,
          details,
        };
      }
    }
    // --- Fallback: existing logic (when no plan or no matching slot) ---

    // Determine remaining production hours from forecast (not hardcoded sunset)
    const now = new Date();
    const remainingHours = this.getRemainingProductionHours(forecast, now);

    // Forecast clipping analysis: predict how much energy will be forced into battery
    const clippingAnalysis = this.analyzeForecastClipping(forecast, now);
    let voluntaryChargeKwh = Math.max(0, batteryNeedKwh - clippingAnalysis.forcedChargeKwh);

    // Early clipping override: if we're already clipping before the solar peak
    // and battery is sufficiently charged, stop voluntary charging and maximize feed-in.
    // The battery will fill from clipping alone.
    const clippingThreshold = this.config.maxAcPowerW * 0.92;
    const peakHour = this.getForecastPeakHour(forecast);
    const isBeforePeak = peakHour != null && now < peakHour;
    const isCurrentlyClipping = state.pvPower > clippingThreshold;
    const earlyClippingOverride = isBeforePeak && isCurrentlyClipping && state.batterySoc >= 65;
    if (earlyClippingOverride) {
      voluntaryChargeKwh = 0;
    }

    // Price optimization: determine if this is a charge hour or feed-in hour
    const schedule = this.getChargeSchedule(prices, forecast, batteryNeedKwh, now);
    const isNegativePrice = schedule != null && schedule.currentPrice <= 0 && !this.config.allowFeedInNegativePrice;
    const isFeedInHour = schedule != null && !schedule.isChargeHour && !isNegativePrice;

    // During feed-in hours: skip voluntary charging, maximize feed-in
    if (isFeedInHour) {
      voluntaryChargeKwh = 0;
    }

    // Reserve: finish charging 1h early to account for forecast inaccuracy
    // If remaining time is short, use at least half of it
    const effectiveHours = Math.max(0.5, remainingHours - 1);

    // Generate strategy text
    const chargeDistribution = this.config.priceOptimization
      ? `preisoptimiert über ${effectiveHours.toFixed(1)}h`
      : `gleichmäßig über ${effectiveHours.toFixed(1)}h`;
    let strategy: string;
    if (isFeedInHour) {
      strategy = `Einspeisestunde (${(schedule!.currentPrice / 10).toFixed(1)} ct vs Ø ${(schedule!.avgPrice / 10).toFixed(1)} ct) — alles einspeisen, Ladung in günstigere Stunden verschoben`;
    } else if (isNegativePrice) {
      strategy = `Negativpreis — keine Einspeisung, alles in Batterie`;
    } else if (earlyClippingOverride) {
      strategy = `Früh-Clipping bei ${Math.round(state.batterySoc)}% SOC — voll einspeisen, Batterie füllt durch Clipping`;
    } else if (clippingAnalysis.clippingHours > 0 && voluntaryChargeKwh <= 0) {
      strategy = `Volle Einspeisung morgens — Batterie wird durch ${clippingAnalysis.clippingHours} Clipping-Stunden gefüllt (${clippingAnalysis.forcedChargeKwh.toFixed(1)} kWh)`;
    } else if (clippingAnalysis.clippingHours > 0) {
      strategy = `${clippingAnalysis.forcedChargeKwh.toFixed(1)} kWh durch Clipping gesichert, ${voluntaryChargeKwh.toFixed(1)} kWh freiwillig ${chargeDistribution} verteilt`;
    } else {
      strategy = `Kein Clipping erwartet — ${batteryNeedKwh.toFixed(1)} kWh ${chargeDistribution} laden`;
    }
    const spreadChargePowerW = (voluntaryChargeKwh / effectiveHours) * 1000;

    // Clipping detection: PV DC production alone exceeds AC inverter capacity
    // Only PV matters — battery discharge doesn't go through MPPT trackers
    const { maxAcPowerW } = this.config;
    const isClippingRisk = state.pvPower > maxAcPowerW;
    // Minimum charge needed to prevent clipping: absorb excess DC
    const antiClipChargeW = Math.max(0, state.pvPower - maxAcPowerW);

    // Proportional charge: allocate share of current surplus based on voluntary need vs remaining forecast
    const proportionalChargeW = remainingForecastKwh > 0
      ? (voluntaryChargeKwh / remainingForecastKwh) * currentSurplusW
      : currentSurplusW;

    let desiredChargePowerW: number;
    if (isNegativePrice) {
      // Negative price: charge everything, no feed-in
      desiredChargePowerW = currentSurplusW;
    } else if (isFeedInHour || earlyClippingOverride) {
      // Feed-in hour or early clipping: don't request any charging — maximize feed-in.
      // The inverter will handle clipping naturally (battery absorbs what can't be exported).
      desiredChargePowerW = 0;
    } else if (isClippingRisk) {
      // During peak: battery MUST absorb excess DC to prevent clipping
      // Charge at least enough to prevent clipping, plus normal charge rate if possible
      desiredChargePowerW = Math.max(antiClipChargeW, spreadChargePowerW, proportionalChargeW);
    } else {
      // No clipping risk: use the higher of time-based spread and proportional allocation
      desiredChargePowerW = Math.max(spreadChargePowerW, proportionalChargeW, 500);
      // Don't use more than 80% of surplus for charging (leave some for feed-in)
      desiredChargePowerW = Math.min(desiredChargePowerW, currentSurplusW * 0.8);
      // But always at least 500W if surplus allows
      if (currentSurplusW > 500) {
        desiredChargePowerW = Math.max(desiredChargePowerW, 500);
      }
    }

    // How much of that surplus we want to feed in (rest goes to battery)
    const availableForGrid = currentSurplusW - desiredChargePowerW;

    // Clamp: never feed in more than actual surplus minus safety margin
    // Safety margin prevents battery discharge when PV/consumption fluctuates
    // In feed-in hours: no safety margin — maximize revenue
    const safetyMarginW = isFeedInHour ? 0 : 500;
    const maxFeedIn = Math.max(0, currentSurplusW - safetyMarginW);
    const feedIn = isNegativePrice ? 0 : Math.min(Math.max(0, availableForGrid), maxFeedIn);

    const setpoint = feedIn > 0 ? -feedIn : 0;

    const goal = isClippingRisk
      ? `Clipping vermeiden — PV ${fmtW(state.pvPower)} > AC-Limit ${fmtW(maxAcPowerW)}, Batterie absorbiert ${fmtW(desiredChargePowerW)} (davon ${fmtW(antiClipChargeW)} Anti-Clip)`
      : isFeedInHour
        ? `Einspeisestunde — alles ins Netz (${fmtW(feedIn)}), Batterie laden in günstigeren Stunden`
        : `Batterie laden mit ${fmtW(desiredChargePowerW)} (${batteryNeedKwh.toFixed(1)} kWh in ${effectiveHours.toFixed(1)}h, ${remainingHours.toFixed(1)}h PV übrig), Rest einspeisen`;

    const details: ControllerDetails = {
      currentSurplusW: Math.round(currentSurplusW),
      desiredChargePowerW: Math.round(desiredChargePowerW),
      feedInW: Math.round(feedIn),
      batteryNeedKwh: Math.round(batteryNeedKwh * 10) / 10,
      remainingHours: Math.round(remainingHours * 10) / 10,
      remainingForecastKwh: Math.round(remainingForecastKwh * 10) / 10,
      isClippingRisk,
      earlyClippingOverride,
      batterySoc: Math.round(state.batterySoc),
      targetSocPercent,
      goal,
      forcedChargeKwh: clippingAnalysis.forcedChargeKwh,
      voluntaryChargeKwh: Math.round(voluntaryChargeKwh * 10) / 10,
      clippingHours: clippingAnalysis.clippingHours,
      strategy,
      ...(schedule ? {
        priceOptimization: {
          active: true,
          currentPriceEurMwh: schedule.currentPrice,
          avgPriceEurMwh: schedule.avgPrice,
          mode: isNegativePrice ? 'negative' as const : isFeedInHour ? 'feed-in' as const : 'charge' as const,
          reason: schedule.reason,
        },
      } : {}),
    };

    // Battery discharge correction: if battery is discharging but should be charging,
    // override the setpoint to account for the actual discharge.
    // This ensures we don't keep feeding too much into the grid while the battery drains.
    const batteryDischargingWhileShouldCharge = batteryNeedKwh > 0 && state.batteryPower < -100;
    let correctedSetpoint = setpoint;
    if (batteryDischargingWhileShouldCharge) {
      // Battery is discharging at |batteryPower| W — reduce feed-in by that amount + desired charge
      const correction = Math.abs(state.batteryPower) + desiredChargePowerW;
      correctedSetpoint = setpoint + correction; // setpoint is negative, so adding makes it less negative
      correctedSetpoint = Math.min(correctedSetpoint, 0); // never request grid import
      details.goal = `KORREKTUR: Batterie entlädt mit ${fmtW(Math.abs(state.batteryPower))} statt ${fmtW(desiredChargePowerW)} zu laden — Einspeisung reduzieren`;
    }

    // Deadband — skip when:
    // - battery is discharging when it should be charging (needs immediate correction)
    // - price schedule mode changed (feed-in hour vs charge hour switch is a deliberate decision)
    const skipDeadband = batteryDischargingWhileShouldCharge || isFeedInHour || isNegativePrice;
    if (!skipDeadband && this.lastAppliedSetpoint !== null) {
      const diff = Math.abs(correctedSetpoint - this.lastAppliedSetpoint);
      if (diff < deadbandW) {
        return {
          setpointW: this.lastAppliedSetpoint,
          mode: 'auto',
          reason: `Im deadband (${diff.toFixed(0)} W < ${deadbandW} W), Sollwert beibehalten`,
          details,
        };
      }
    }

    return {
      setpointW: roundTo50(correctedSetpoint),
      mode: 'auto',
      reason: `Einspeisung ${fmtW(Math.abs(roundTo50(correctedSetpoint)))}, Ladung ${fmtW(desiredChargePowerW)} (${batteryNeedKwh.toFixed(1)} kWh in ${effectiveHours.toFixed(1)}h)`,
      details,
    };
  }

  private findCurrentPlanSlot(plan: ChargePlan): ChargePlanSlot | null {
    const now = new Date();
    const nowMs = now.getTime();
    const slotMs = plan.intervalMinutes * 60 * 1000;
    const currentSlotStart = Math.floor(nowMs / slotMs) * slotMs;

    for (const slot of plan.slots) {
      const slotStart = new Date(slot.timestamp).getTime();
      if (slotStart === currentSlotStart) {
        return slot;
      }
    }
    return null;
  }

  /**
   * Determine if the current hour is a "charge hour" or a "feed-in hour".
   *
   * Strategy: pair each future PV-producing hour with its electricity price,
   * then pick the cheapest hours as charge hours (enough to fill the battery).
   * Expensive hours are feed-in hours to maximize revenue.
   *
   * When the forecast is tight (surplusRatio < 1.5), the controller skips
   * price optimization entirely and charges at full rate — self-consumption
   * takes priority over feed-in revenue.
   *
   * Returns null if price optimization is disabled or data is insufficient.
   */
  private getChargeSchedule(
    prices: PriceEntry[],
    forecast: Forecast,
    batteryNeedKwh: number,
    now: Date,
  ): { isChargeHour: boolean; currentPrice: number; avgPrice: number; reason: string } | null {
    if (!this.config.priceOptimization || prices.length === 0) return null;

    const nowSec = Math.floor(now.getTime() / 1000);

    // Find current hour's price
    let currentPrice: number | null = null;
    for (let i = 0; i < prices.length; i++) {
      const start = prices[i].timestamp;
      const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 3600;
      if (nowSec >= start && nowSec < end) {
        currentPrice = prices[i].price;
        break;
      }
    }
    if (currentPrice == null) return null;

    // Average of remaining today's prices (for display)
    const futurePrices = prices
      .filter(p => p.timestamp >= nowSec && p.price != null)
      .map(p => p.price!);
    if (futurePrices.length === 0) return null;
    const avgPrice = futurePrices.reduce((a, b) => a + b, 0) / futurePrices.length;

    // Negative price: charge (never feed in) — unless explicitly allowed
    if (currentPrice <= 0 && !this.config.allowFeedInNegativePrice) {
      return {
        isChargeHour: true,
        currentPrice,
        avgPrice,
        reason: `Negativpreis (${(currentPrice / 10).toFixed(1)} ct/kWh) — keine Einspeisung`,
      };
    }

    // No battery need — nothing to schedule
    if (batteryNeedKwh <= 0) {
      return {
        isChargeHour: false,
        currentPrice,
        avgPrice,
        reason: `Batterie voll — alles einspeisen`,
      };
    }

    // Build list of future PV slots paired with prices
    // Align current slot start to the forecast interval
    const ih = forecast.intervalHours;
    const intervalMs = ih * 3600 * 1000;
    const currentSlotStart = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);

    interface ForecastSlot {
      slotStart: number; // unix seconds
      powerW: number;
      price: number;
    }

    // Get future forecast slots with meaningful production
    const futureSlots = forecast.hours.filter(h => h.timestamp >= currentSlotStart && h.powerW > 100);
    if (futureSlots.length === 0) return null;

    // Pair forecast slots with prices
    const slots: ForecastSlot[] = [];
    for (const fh of futureSlots) {
      const fhSec = Math.floor(fh.timestamp.getTime() / 1000);
      // Find matching price
      const priceEntry = prices.find((p, i) => {
        const start = p.timestamp;
        const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 3600;
        return fhSec >= start && fhSec < end;
      });
      if (priceEntry?.price != null) {
        slots.push({
          slotStart: fhSec,
          powerW: fh.powerW,
          price: priceEntry.price,
        });
      }
    }

    if (slots.length === 0) return null;

    // Sort all slots by price ascending, pick cheapest until battery need is met
    const sortedSlots = [...slots].sort((a, b) => a.price - b.price);
    const chargeSlotTimestamps = new Set<number>();

    let accumulatedKwh = 0;
    for (const slot of sortedSlots) {
      if (accumulatedKwh >= batteryNeedKwh) break;
      chargeSlotTimestamps.add(slot.slotStart);
      accumulatedKwh += slot.powerW * ih / 1000;
    }

    // Check if current slot is a charge slot
    const currentSlotSec = Math.floor(currentSlotStart.getTime() / 1000);
    const isChargeHour = chargeSlotTimestamps.has(currentSlotSec);

    const ctCurrent = (currentPrice / 10).toFixed(1);
    const ctAvg = (avgPrice / 10).toFixed(1);

    let reason: string;
    if (isChargeHour) {
      reason = `Ladestunde (${ctCurrent} ct vs Ø ${ctAvg} ct) — Batterie laden`;
    } else {
      reason = `Einspeisestunde (${ctCurrent} ct vs Ø ${ctAvg} ct) — alles einspeisen`;
    }

    return { isChargeHour, currentPrice, avgPrice, reason };
  }

  private analyzeForecastClipping(forecast: Forecast, now: Date): { forcedChargeKwh: number; clippingHours: number } {
    const threshold = this.config.maxAcPowerW * 0.92;
    const ih = forecast.intervalHours;
    let forcedChargeWh = 0;
    let clippingSlots = 0;

    for (const hour of forecast.hours) {
      if (hour.timestamp >= now && hour.powerW > threshold) {
        forcedChargeWh += (hour.powerW - threshold) * ih;
        clippingSlots++;
      }
    }

    return {
      forcedChargeKwh: Math.round((forcedChargeWh / 1000) * 100) / 100,
      clippingHours: Math.round(clippingSlots * ih * 10) / 10,
    };
  }

  private getForecastPeakHour(forecast: Forecast): Date | null {
    if (forecast.hours.length === 0) return null;
    let peak = forecast.hours[0];
    for (const h of forecast.hours) {
      if (h.powerW > peak.powerW) peak = h;
    }
    return peak.powerW > 0 ? peak.timestamp : null;
  }

  private getRemainingProductionHours(forecast: Forecast, now: Date): number {
    if (forecast.hours.length === 0) {
      return 2;
    }

    // Calculate weighted remaining hours: each slot contributes proportionally
    // to its production relative to the peak. This gives "equivalent full-power hours"
    // and avoids overestimating when late slots produce very little.
    const futureHours = forecast.hours.filter((h) => h.timestamp >= now && h.powerW > 100);
    if (futureHours.length === 0) {
      return 0.5;
    }

    const maxPower = Math.max(...futureHours.map((h) => h.powerW));
    if (maxPower <= 0) {
      return 0.5;
    }

    const ih = forecast.intervalHours;
    // Each slot contributes (its power / peak power) * intervalHours of "effective" production time
    const weightedHours = futureHours.reduce((sum, h) => sum + (h.powerW / maxPower) * ih, 0);
    return Math.max(0.5, weightedHours);
  }
}
