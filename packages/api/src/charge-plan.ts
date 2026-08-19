import type { Forecast } from './vrm-service.js';
import type { PriceEntry } from './controller.js';

export interface ChargePlanConfig {
  currentSoc: number;
  batteryCapacityKwh: number;
  targetSocPercent: number;
  minSocPercent: number;
  maxAcPowerW: number;
  feedInRateCentPerKwh: number;
  consumptionDayW: number;
  consumptionNightW: number;
  priceOptimization: boolean;
  allowFeedInNegativePrice: boolean;
  preferredMaxChargeW: number;
  /** Active morning discharge: drain battery into grid before clipping starts */
  activeMorningDischarge?: boolean;
  /** SOC floor for active morning discharge (default 5%) */
  activeMorningDischargeMinSocPercent?: number;
  /** Actual current PV power — used to correct optimistic forecasts */
  actualPvPowerW?: number;
  /** Manual override for forecast correction factor (0.1–2.0). null = auto. */
  forecastCorrectionOverride?: number | null;
  /** Installed PV peak capacity (kWp) — basis for the corrected forecast ceiling. */
  pvPeakKwp?: number;
}

/**
 * Fraction of the nameplate kWp a real array reaches at its best. Losses from
 * cell temperature, soiling and imperfect angle mean the STC rating is never
 * met in the field; 0.85 sits just above the observed summer maximum.
 */
export const PV_PEAK_DERATE = 0.85;

export type DischargeState = 'active' | 'hold' | 'trickle';

export interface ChargePlanSlot {
  hour: number;
  minute: number;
  timestamp: string;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
  clippingW: number;
  consumptionW: number;
  /** Day-ahead market price in EUR/MWh for this slot (null = no price data) */
  priceMwh: number | null;
  /** Set when this slot is part of an active-morning-discharge sequence. */
  dischargeState?: DischargeState;
}

export interface ChargePlan {
  slots: ChargePlanSlot[];
  intervalMinutes: 15;
  totalFeedInKwh: number;
  totalRevenueFixedCent: number;
  totalRevenueMarketCent: number;
  feedInRateCentPerKwh: number;
  estimatedFullHour: number | null;
  currentSoc: number;
  forecastCorrectionFactor: number;
  /** EEG §51: true when 6+ consecutive hours of negative prices reduce compensation */
  negativeStreak6hActive: boolean;
  /** Cents deducted from EEG revenue due to §51 negative price streak rule */
  negativeStreak6hDeductionCent: number;
  /** Summary of active morning discharge for this plan, if any. */
  activeDischarge: {
    floorPercent: number;
    holdTargetPercent: number;
    reason: string;
    endsAt: string | null;
  } | null;
  /** Debug info for charge planning decisions */
  debug: {
    batteryNeedKwh: number;
    totalClippingKwh: number;
    voluntaryNeedKwh: number;
    totalNetSurplusKwh: number;
    surplusRatio: number;
    tightForecast: boolean;
    priceOptCandidateCount: number;
  };
}

/** Find the price entry matching a given unix timestamp (floored to 15min). */
function findPrice(prices: PriceEntry[], timestampSec: number): number | null {
  const slotFloor = Math.floor(timestampSec / 900) * 900;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].timestamp <= slotFloor) {
      return prices[i].price;
    }
  }
  return null;
}

/**
 * Compute optimal charge/feed-in plan for each 15-min slot.
 *
 * Strategy:
 * 1. Calculate forced charge from clipping (energy that MUST go to battery)
 * 2. Calculate voluntary battery need (target - current - clipping)
 * 3. With price optimization: sort slots by price, charge in cheapest, feed-in in most expensive
 *    → minimizes opportunity cost of charging = maximizes feed-in revenue
 * 4. Without price optimization: spread charging evenly across all surplus slots
 * 5. Negative prices: always charge, never feed-in
 * 6. Battery must reach targetSoc by end of solar production
 */
/**
 * Remaining PV production for the rest of the day, derived from the plan's own
 * slots. Those already carry the decayed forecast correction and the PV-peak
 * cap, so this matches what the chart draws — unlike multiplying the raw
 * forecast by the flat correction factor, which overshoots the whole day with
 * a correction that is only valid for the next couple of hours.
 *
 * The slot the current time falls into is counted pro rata for the part that is
 * still ahead, so "produced so far + remaining" stays consistent with the
 * corrected day total.
 */
export function computeRemainingForecastKwh(plan: ChargePlan, now: Date = new Date()): number {
  const slotMs = plan.intervalMinutes * 60 * 1000;
  const slotHours = plan.intervalMinutes / 60;
  const nowMs = now.getTime();
  let kwh = 0;
  for (const slot of plan.slots) {
    const startMs = new Date(slot.timestamp).getTime();
    const endMs = startMs + slotMs;
    if (endMs <= nowMs) continue;
    const remainingFraction = nowMs > startMs ? (endMs - nowMs) / slotMs : 1;
    kwh += (slot.forecastW * slotHours * remainingFraction) / 1000;
  }
  return kwh;
}

export function computeChargePlan(
  forecast: Forecast,
  prices: PriceEntry[],
  config: ChargePlanConfig,
): ChargePlan {
  const {
    currentSoc,
    batteryCapacityKwh,
    targetSocPercent,
    maxAcPowerW,
    feedInRateCentPerKwh,
    consumptionDayW,
    consumptionNightW,
    priceOptimization,
    preferredMaxChargeW,
  } = config;

  const ih = forecast.intervalHours;
  const nowMs = Date.now();
  const intervalMs = ih * 3600 * 1000;
  const currentSlotStartMs = Math.floor(nowMs / intervalMs) * intervalMs;

  const futureHoursRaw = forecast.hours.filter(h => h.timestamp.getTime() >= currentSlotStartMs);

  // --- Forecast correction ---
  // Manual override takes precedence. Otherwise, only correct during stable
  // production (current slot ≥ 50% of day peak) to avoid morning ramp-up errors.
  // Floor at 0.1 to prevent overcorrection.
  let forecastCorrectionFactor = 1;
  if (config.forecastCorrectionOverride != null) {
    forecastCorrectionFactor = Math.min(2, Math.max(0.1, config.forecastCorrectionOverride));
  } else if (config.actualPvPowerW != null && futureHoursRaw.length > 0) {
    const currentForecastW = futureHoursRaw[0].powerW;
    const peakForecastW = Math.max(...futureHoursRaw.map(h => h.powerW));
    const relevantPowerW = Math.max(currentForecastW, config.actualPvPowerW ?? 0);
    const isStableProduction = relevantPowerW > 500 && relevantPowerW >= peakForecastW * 0.5;
    if (isStableProduction) {
      const rawFactor = config.actualPvPowerW / currentForecastW;
      forecastCorrectionFactor = Math.min(2, Math.max(0.1, rawFactor));
    }
  }
  // Decay the correction's influence to 0 over 2h: a live PV reading is a good
  // predictor for the next slot but says nothing about conditions hours later
  // (clouds move, sun angle changes). Applying it flat to the whole day
  // overshoots the peak hour whenever the current-slot mismatch is large.
  // Cap at the realistically achievable PV peak: real output tops out well
  // below the STC nameplate rating (cell temperature, soiling, angle), so the
  // raw kWp is too generous a ceiling to catch an overshooting correction.
  // A live reading still beats the rule of thumb — never cap below it.
  const CORRECTION_DECAY_HOURS = 2;
  const pvPeakW = config.pvPeakKwp != null
    ? Math.max(config.pvPeakKwp * 1000 * PV_PEAK_DERATE, config.actualPvPowerW ?? 0)
    : Infinity;
  const futureHours = forecastCorrectionFactor !== 1
    ? futureHoursRaw.map(h => {
        const hoursAhead = (h.timestamp.getTime() - currentSlotStartMs) / 3600_000;
        const decayedFactor = 1 + (forecastCorrectionFactor - 1) * Math.max(0, 1 - hoursAhead / CORRECTION_DECAY_HOURS);
        return { ...h, powerW: Math.min(Math.round(h.powerW * decayedFactor), pvPeakW) };
      })
    : futureHoursRaw;

  // --- Per-slot analysis ---
  interface SlotAnalysis {
    idx: number;
    timestamp: Date;
    forecastW: number;
    /** Positive = excess PV, negative = deficit (consumption from battery) */
    surplusW: number;
    clippingW: number;
    voluntarySurplusW: number;
    consumptionW: number;
    price: number | null;
  }

  const analysis: SlotAnalysis[] = futureHours.map((fh, idx) => {
    const hour = fh.timestamp.getHours();
    const consumptionW = (hour >= 7 && hour < 18) ? consumptionDayW : consumptionNightW;
    const surplusW = fh.powerW - consumptionW;
    const clippingW = Math.max(0, fh.powerW - maxAcPowerW);
    const slotSec = Math.floor(fh.timestamp.getTime() / 1000);
    const price = findPrice(prices, slotSec);
    return {
      idx,
      timestamp: fh.timestamp,
      forecastW: fh.powerW,
      surplusW,
      clippingW,
      voluntarySurplusW: Math.max(0, surplusW - clippingW),
      consumptionW,
      price,
    };
  });

  // --- Battery need & clipping ---
  // Total need from actual SOC to target. When SOC < minSoc, the safety charge
  // in the simulation will override early voluntary slots, consuming their surplus.
  // By using currentSoc (not effectiveStartSoc), we allocate enough voluntary charge
  // to compensate for the safety-overridden slots and still reach targetSoc.
  //
  // When active morning discharge is enabled and will trigger, the simulation will
  // drain SOC down to dischargeFloorSoc. The late-charging plan must size the need
  // from that post-discharge floor, otherwise the battery never returns to target.
  //
  // --- Active morning discharge: hysteresis band ---
  // floor      = configured minimum (hard lower bound during morning discharge window)
  // holdTarget = floor + HOLD_BUFFER_PCT (discharge stop and trickle-refill target)
  // 1 pp deadband prevents oscillation at the floor.
  const HOLD_BUFFER_PCT = 1;
  const dischargeFloorSoc = config.activeMorningDischargeMinSocPercent ?? 5;
  const dischargeHoldTargetSoc = dischargeFloorSoc + HOLD_BUFFER_PCT;
  const totalNetSurplusKwhPre = analysis.reduce((sum, s) => sum + Math.max(0, s.surplusW) * ih / 1000, 0);
  // Gate active discharge on the POST-DRAIN refill need, not the current
  // gap to target. Otherwise the trigger fires on a few-kWh need (high SOC),
  // we drain to floor, and then the day's surplus turns out to be too small
  // to refill the now-much-larger gap. The threshold (2×) gives headroom for
  // forecast revisions; reaching targetSoc has priority over morning feed-in.
  const postDrainNeedKwh = Math.max(0, (targetSocPercent / 100 - dischargeFloorSoc / 100) * batteryCapacityKwh);
  const willActivelyDischarge =
    (config.activeMorningDischarge ?? false)
    && currentSoc > dischargeHoldTargetSoc
    && postDrainNeedKwh > 0
    && totalNetSurplusKwhPre / postDrainNeedKwh >= 2;
  const effectiveStartSocForNeed = willActivelyDischarge ? dischargeFloorSoc : currentSoc;
  const batteryNeedKwh = Math.max(0, (targetSocPercent / 100 - effectiveStartSocForNeed / 100) * batteryCapacityKwh);
  const totalClippingKwh = analysis.reduce((sum, s) => sum + Math.max(0, s.clippingW) * ih / 1000, 0);
  // When allowFeedInNegativePrice is false, negative-price slots always charge
  // full surplus in simulation, so subtract their expected contribution to avoid
  // unnecessary voluntary charging at positive prices.
  // When allowFeedInNegativePrice is true, negative-price slots are treated as
  // normal candidates (they're just cheap slots), so don't subtract them.
  const negativePriceChargeKwh = config.allowFeedInNegativePrice
    ? 0
    : analysis
      .filter(s => s.price != null && s.price < 0 && s.surplusW > 0)
      .reduce((sum, s) => sum + s.surplusW * ih / 1000, 0);
  const voluntaryNeedKwh = Math.max(0, batteryNeedKwh - totalClippingKwh - negativePriceChargeKwh);

  // --- Tight forecast check (must match controller threshold) ---
  // When the net surplus barely covers battery need, the controller ignores the
  // charge plan and sets setpoint=0 (charge everything). Mirror that decision
  // here so the displayed plan matches the actual controller behaviour.
  const totalNetSurplusKwh = totalNetSurplusKwhPre;
  const surplusRatio = batteryNeedKwh > 0 ? totalNetSurplusKwh / batteryNeedKwh : Infinity;
  const tightForecast = surplusRatio < 1.5 && batteryNeedKwh > 0;

  // --- Assign voluntary charge per slot ---
  const voluntaryChargeW = new Array<number>(analysis.length).fill(0);
  let priceOptCandidateCount = 0;

  if (tightForecast) {
    // Tight forecast: charge all surplus — the controller will override any
    // feed-in decision anyway. The forward simulation still caps at targetSoc
    // and redirects excess to feed-in once the battery is full.
    for (const s of analysis) {
      if (s.voluntarySurplusW > 0) {
        voluntaryChargeW[s.idx] = s.voluntarySurplusW;
      }
    }
  } else if (voluntaryNeedKwh > 0) {
    if (priceOptimization) {
      // PRICE OPTIMIZATION: charge in cheapest slots to minimize opportunity cost
      // → equivalent to maximizing revenue from feed-in in expensive slots
      const candidates = analysis
        .filter(s => s.voluntarySurplusW > 0 && s.price != null && (s.price >= 0 || config.allowFeedInNegativePrice))
        .map(s => ({ idx: s.idx, voluntarySurplusW: s.voluntarySurplusW, price: s.price! }))
        .sort((a, b) => a.price - b.price); // cheapest first
      priceOptCandidateCount = candidates.length;

      if (candidates.length > 0) {
        // First pass: assign up to preferredMaxChargeW per slot
        let remaining = voluntaryNeedKwh;
        for (const c of candidates) {
          if (remaining <= 0) break;
          const maxW = Math.min(c.voluntarySurplusW, preferredMaxChargeW);
          const chargeW = Math.min(maxW, remaining / ih * 1000);
          voluntaryChargeW[c.idx] = chargeW;
          remaining -= chargeW * ih / 1000;
        }

        // Second pass: if capped charge wasn't enough, allow above preferredMaxChargeW
        if (remaining > 0.05) {
          for (const c of candidates) {
            if (remaining <= 0) break;
            const current = voluntaryChargeW[c.idx];
            const additional = Math.min(c.voluntarySurplusW - current, remaining / ih * 1000);
            if (additional > 0) {
              voluntaryChargeW[c.idx] = current + additional;
              remaining -= additional * ih / 1000;
            }
          }
        }
      } else {
        // No price data available — fall back to spreading evenly
        const surplusSlots = analysis.filter(s => s.voluntarySurplusW > 0);
        if (surplusSlots.length > 0) {
          const perSlotKwh = voluntaryNeedKwh / surplusSlots.length;
          for (const s of surplusSlots) {
            voluntaryChargeW[s.idx] = Math.min(perSlotKwh / ih * 1000, s.voluntarySurplusW);
          }
        }
      }
    } else {
      // NO PRICE OPTIMIZATION: late-charging — fill battery as late as possible
      // so morning/midday peak is fully fed in. Avoids curtailment when forecast
      // underestimates production.
      // Combined safety buffer: target 20% extra kWh + extend one slot earlier.
      const surplusSlots = analysis.filter(s => s.voluntarySurplusW > 0);
      if (surplusSlots.length > 0) {
        const safeNeed = voluntaryNeedKwh * 1.2;
        let remaining = safeNeed;
        let earliestUsedK = surplusSlots.length; // out-of-range sentinel

        // First pass: latest-first, capped at preferredMaxChargeW
        for (let k = surplusSlots.length - 1; k >= 0 && remaining > 0; k--) {
          const s = surplusSlots[k];
          const cappedW = Math.min(s.voluntarySurplusW, preferredMaxChargeW);
          const slotKwh = cappedW * ih / 1000;
          const useKwh = Math.min(slotKwh, remaining);
          voluntaryChargeW[s.idx] = useKwh / ih * 1000;
          remaining -= useKwh;
          earliestUsedK = k;
        }

        // Second pass: lift cap to voluntarySurplusW if still short
        if (remaining > 0.05) {
          for (let k = surplusSlots.length - 1; k >= 0 && remaining > 0; k--) {
            const s = surplusSlots[k];
            const headroomW = s.voluntarySurplusW - voluntaryChargeW[s.idx];
            if (headroomW <= 0) continue;
            const slotKwh = headroomW * ih / 1000;
            const useKwh = Math.min(slotKwh, remaining);
            voluntaryChargeW[s.idx] += useKwh / ih * 1000;
            remaining -= useKwh;
            if (k < earliestUsedK) earliestUsedK = k;
          }
        }

        // Time buffer: one extra earlier slot at preferredMaxChargeW
        if (earliestUsedK > 0) {
          const bufferSlot = surplusSlots[earliestUsedK - 1];
          voluntaryChargeW[bufferSlot.idx] = Math.min(bufferSlot.voluntarySurplusW, preferredMaxChargeW);
        }
      }
    }
  }

  // --- Active morning discharge (optional) ---
  // When enabled and the day's surplus comfortably exceeds battery need,
  // actively drain the battery into the grid in the earliest surplus slots
  // so that more clipping later in the day fits into the battery.
  // Triggers only at surplusRatio ≥ 2 (forecast surplus ≥ 2× battery need).
  const activeDischargeEnabled = willActivelyDischarge && !tightForecast;
  if (activeDischargeEnabled && currentSoc > dischargeHoldTargetSoc) {
    let socSim = currentSoc;
    for (let i = 0; i < analysis.length; i++) {
      if (socSim <= dischargeHoldTargetSoc) break;
      const s = analysis[i];
      // Only discharge while there is PV surplus and before clipping begins.
      if (s.surplusW <= 0) continue;
      if (s.clippingW > 0) break;
      // Skip negative-price slots when feed-in there is forbidden.
      const isNegPrice = s.price != null && s.price <= 0 && !config.allowFeedInNegativePrice;
      if (isNegPrice) continue;
      // Headroom on AC limit: remaining export capacity after PV surplus.
      const headroomW = Math.max(0, maxAcPowerW - s.surplusW);
      if (headroomW <= 0) break;
      // Cap by SOC hold target (floor + 1pp deadband).
      const maxKwhFromSoc = ((socSim - dischargeHoldTargetSoc) / 100) * batteryCapacityKwh;
      const maxKwhThisSlot = Math.min(headroomW * ih / 1000, maxKwhFromSoc);
      if (maxKwhThisSlot <= 0.01) break;
      const dischargeW = maxKwhThisSlot / ih * 1000;
      voluntaryChargeW[i] = -dischargeW; // override any prior allocation
      socSim -= (maxKwhThisSlot / batteryCapacityKwh) * 100;
    }
  }

  // --- Forward simulation: generate plan slots with SOC tracking ---
  let soc = currentSoc;
  let estimatedFullHour: number | null = null;
  let totalFeedInKwh = 0;
  let totalRevenueFixedCent = 0;
  let totalRevenueMarketCent = 0;
  const slots: ChargePlanSlot[] = [];

  for (let i = 0; i < analysis.length; i++) {
    const s = analysis[i];
    const hour = s.timestamp.getHours();
    const minute = s.timestamp.getMinutes();
    const isNegativePrice = s.price != null && s.price <= 0 && !config.allowFeedInNegativePrice;

    let chargeW: number;
    let feedInW: number;
    let slotState: DischargeState | undefined;

    const isActiveDischargeSlot = activeDischargeEnabled && voluntaryChargeW[i] < 0 && s.surplusW > 0;
    const morningDischargeFeatureOn = (config.activeMorningDischarge ?? false);
    const inMorningDischargeWindow = morningDischargeFeatureOn && s.clippingW <= 0;
    const inHoldBand = soc >= dischargeFloorSoc && soc <= dischargeHoldTargetSoc;
    const belowFloor = soc < dischargeFloorSoc;

    if (isActiveDischargeSlot) {
      // Active morning discharge: feed PV surplus + battery power to grid.
      // Cap discharge so SOC doesn't drop below dischargeHoldTargetSoc (1pp deadband).
      const maxKwhFromSoc = Math.max(0, ((soc - dischargeHoldTargetSoc) / 100) * batteryCapacityKwh);
      const requestedDischargeKwh = Math.abs(voluntaryChargeW[i]) * ih / 1000;
      const actualDischargeKwh = Math.min(requestedDischargeKwh, maxKwhFromSoc);
      chargeW = -(actualDischargeKwh / ih * 1000);
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
      slotState = 'active';
    } else if (inMorningDischargeWindow && belowFloor && s.surplusW > 0 && !isNegativePrice && voluntaryChargeW[i] <= 0) {
      // Trickle refill: SOC dropped below floor — refill from surplus, capped at
      // preferredMaxChargeW, only up to holdTarget. No grid pull.
      // Skipped when the voluntary charge plan has explicitly allocated charge here.
      const refillKwh = ((dischargeHoldTargetSoc - soc) / 100) * batteryCapacityKwh;
      const refillW = Math.min(s.surplusW, preferredMaxChargeW, refillKwh / ih * 1000);
      chargeW = Math.max(0, refillW);
      feedInW = Math.max(0, s.surplusW - chargeW);
      slotState = 'trickle';
    } else if (inMorningDischargeWindow && inHoldBand && s.surplusW > 0 && voluntaryChargeW[i] <= 0) {
      // Hold mode: SOC inside deadband — battery rests, all surplus to feed-in.
      // Skipped when the voluntary charge plan has explicitly allocated charge here.
      chargeW = 0;
      feedInW = isNegativePrice ? 0 : s.surplusW;
      slotState = 'hold';
    } else if (s.surplusW < 0) {
      // Deficit: consumption exceeds PV — drain battery, but not below minSoc
      if (soc <= config.minSocPercent) {
        // Battery at or below minimum — grid covers deficit, no discharge
        chargeW = 0;
      } else {
        // Discharge but cap so SOC doesn't drop below minSocPercent
        const maxDischargeKwh = ((soc - config.minSocPercent) / 100) * batteryCapacityKwh;
        const deficitKwh = Math.abs(s.surplusW) * ih / 1000;
        const actualDischargeKwh = Math.min(maxDischargeKwh, deficitKwh);
        chargeW = -(actualDischargeKwh / ih * 1000);
      }
      feedInW = 0;
    } else if (soc < config.minSocPercent && !activeDischargeEnabled) {
      // Safety: SOC below minimum — charge from surplus before feeding in.
      // Skipped when active morning discharge is in play: the late-charging plan
      // is sized to refill from dischargeFloorSoc → targetSoc, so refilling now
      // would just consume morning surplus that should be fed in.
      const safetyNeedKwh = ((config.minSocPercent - soc) / 100) * batteryCapacityKwh;
      const safetyChargeW = Math.min(s.surplusW, safetyNeedKwh / ih * 1000);
      chargeW = safetyChargeW;
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
    } else if (soc >= targetSocPercent) {
      // Battery full — only absorb clipping excess
      chargeW = s.clippingW;
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
    } else if (isNegativePrice) {
      // Negative price: charge everything, never feed in
      chargeW = s.surplusW;
      feedInW = 0;
    } else {
      // Normal slot: clipping (forced) + voluntary assignment
      chargeW = s.clippingW + voluntaryChargeW[i];
      chargeW = Math.min(chargeW, s.surplusW);
      feedInW = Math.max(0, s.surplusW - chargeW);
    }

    // Detect SOC reaching target — redirect excess to feed-in
    const chargeKwh = chargeW * ih / 1000;
    const projectedSoc = soc + (chargeKwh / batteryCapacityKwh) * 100;

    if (chargeW >= 0 && projectedSoc >= targetSocPercent && soc < targetSocPercent) {
      const neededKwh = ((targetSocPercent - soc) / 100) * batteryCapacityKwh;
      const actualChargeW = neededKwh / ih * 1000;
      const excessW = chargeW - actualChargeW;
      if (excessW > 0 && !isNegativePrice) {
        chargeW = actualChargeW;
        feedInW += excessW;
      }
      if (estimatedFullHour === null) estimatedFullHour = hour;
    }

    // Update SOC: clamp between 0 and targetSocPercent
    // (Don't clamp to minSocPercent — actual SOC can be below it)
    soc = Math.max(0, Math.min(targetSocPercent,
      soc + ((chargeW * ih / 1000) / batteryCapacityKwh) * 100));

    // Revenue calculation
    const feedInKwh = feedInW * ih / 1000;
    const revenueFixedCent = feedInKwh * feedInRateCentPerKwh;
    const revenueMarketCent = s.price != null ? feedInKwh * (s.price / 10) : 0;

    totalFeedInKwh += feedInKwh;
    totalRevenueFixedCent += revenueFixedCent;
    totalRevenueMarketCent += revenueMarketCent;

    slots.push({
      hour,
      minute,
      timestamp: s.timestamp.toISOString(),
      chargePowerW: Math.round(chargeW),
      feedInPowerW: Math.round(feedInW),
      forecastW: s.forecastW,
      estimatedSoc: Math.round(soc * 10) / 10,
      revenueFixedCent: Math.round(revenueFixedCent * 100) / 100,
      revenueMarketCent: Math.round(revenueMarketCent * 100) / 100,
      clippingW: Math.round(s.clippingW),
      consumptionW: Math.round(s.consumptionW),
      priceMwh: s.price,
      ...(slotState ? { dischargeState: slotState } : {}),
    });
  }

  // --- EEG §51: No compensation during 6+ consecutive hours of negative prices ---
  // Group slots by hour and check for consecutive negative-price hours.
  // For any streak of ≥6 hours, deduct the EEG fixed revenue of those slots.
  let negativeStreak6hDeductionCent = 0;
  if (slots.length > 0) {
    // Build a map of hour → { hasNegativePrice, revenueFixedCent }
    const hourMap = new Map<number, { negative: boolean; revenueCent: number }>();
    for (let i = 0; i < analysis.length; i++) {
      const hourKey = analysis[i].timestamp.getHours();
      const existing = hourMap.get(hourKey);
      const slotRevenue = slots[i].revenueFixedCent;
      if (!existing) {
        hourMap.set(hourKey, {
          negative: analysis[i].price != null && analysis[i].price! < 0,
          revenueCent: slotRevenue,
        });
      } else {
        // All slots in the hour must have negative prices for the hour to count
        existing.negative = existing.negative && (analysis[i].price != null && analysis[i].price! < 0);
        existing.revenueCent += slotRevenue;
      }
    }

    // Get hours in chronological order and find streaks of ≥6 consecutive negative hours
    const hours = Array.from(hourMap.entries())
      .sort((a, b) => {
        // Sort by actual timestamp order, not just hour number (handles day boundary)
        const aIdx = analysis.findIndex(s => s.timestamp.getHours() === a[0]);
        const bIdx = analysis.findIndex(s => s.timestamp.getHours() === b[0]);
        return aIdx - bIdx;
      });

    let streakStart = 0;
    for (let i = 0; i <= hours.length; i++) {
      const isNeg = i < hours.length && hours[i][1].negative;
      if (!isNeg) {
        const streakLen = i - streakStart;
        if (streakLen >= 6) {
          for (let j = streakStart; j < i; j++) {
            negativeStreak6hDeductionCent += hours[j][1].revenueCent;
          }
        }
        streakStart = i + 1;
      }
    }
  }

  const adjustedRevenueFixedCent = totalRevenueFixedCent - negativeStreak6hDeductionCent;

  const lastActiveSlot = [...slots].reverse().find(s => s.dischargeState === 'active');
  const activeDischarge: ChargePlan['activeDischarge'] = activeDischargeEnabled
    ? {
        floorPercent: dischargeFloorSoc,
        holdTargetPercent: dischargeHoldTargetSoc,
        reason: `Prognose ${surplusRatio.toFixed(1)}× Bedarf — Platz für mittäglichen Clipping schaffen`,
        endsAt: lastActiveSlot ? lastActiveSlot.timestamp : null,
      }
    : null;

  return {
    slots,
    intervalMinutes: 15,
    totalFeedInKwh: Math.round(totalFeedInKwh * 1000) / 1000,
    totalRevenueFixedCent: Math.round(adjustedRevenueFixedCent * 100) / 100,
    totalRevenueMarketCent: Math.round(totalRevenueMarketCent * 100) / 100,
    feedInRateCentPerKwh,
    estimatedFullHour,
    currentSoc,
    forecastCorrectionFactor: Math.round(forecastCorrectionFactor * 100) / 100,
    negativeStreak6hActive: negativeStreak6hDeductionCent > 0,
    negativeStreak6hDeductionCent: Math.round(negativeStreak6hDeductionCent * 100) / 100,
    activeDischarge,
    debug: {
      batteryNeedKwh: Math.round(batteryNeedKwh * 100) / 100,
      totalClippingKwh: Math.round(totalClippingKwh * 100) / 100,
      voluntaryNeedKwh: Math.round(voluntaryNeedKwh * 100) / 100,
      totalNetSurplusKwh: Math.round(totalNetSurplusKwh * 100) / 100,
      surplusRatio: Math.round(surplusRatio * 100) / 100,
      tightForecast,
      priceOptCandidateCount,
    },
  };
}
