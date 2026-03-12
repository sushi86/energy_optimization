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
  /** Actual current PV power — used to correct optimistic forecasts */
  actualPvPowerW?: number;
  /** Manual override for forecast correction factor (0.1–2.0). null = auto. */
  forecastCorrectionOverride?: number | null;
}

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
  const futureHours = forecastCorrectionFactor !== 1
    ? futureHoursRaw.map(h => ({ ...h, powerW: Math.round(h.powerW * forecastCorrectionFactor) }))
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
  // Safety charge (below minSoc) is handled as mandatory in the simulation.
  // Voluntary charge only covers the gap from max(currentSoc, minSoc) to target.
  const effectiveStartSoc = Math.max(currentSoc, config.minSocPercent);
  const batteryNeedKwh = Math.max(0, (targetSocPercent / 100 - effectiveStartSoc / 100) * batteryCapacityKwh);
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

  // --- Assign voluntary charge per slot ---
  const voluntaryChargeW = new Array<number>(analysis.length).fill(0);

  if (voluntaryNeedKwh > 0) {
    if (priceOptimization) {
      // PRICE OPTIMIZATION: charge in cheapest slots to minimize opportunity cost
      // → equivalent to maximizing revenue from feed-in in expensive slots
      const candidates = analysis
        .filter(s => s.voluntarySurplusW > 0 && s.price != null && (s.price >= 0 || config.allowFeedInNegativePrice))
        .map(s => ({ idx: s.idx, voluntarySurplusW: s.voluntarySurplusW, price: s.price! }))
        .sort((a, b) => a.price - b.price); // cheapest first

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
      // NO PRICE OPTIMIZATION: spread charging evenly
      const surplusSlots = analysis.filter(s => s.voluntarySurplusW > 0);
      if (surplusSlots.length > 0) {
        const perSlotKwh = voluntaryNeedKwh / surplusSlots.length;
        for (const s of surplusSlots) {
          voluntaryChargeW[s.idx] = Math.min(perSlotKwh / ih * 1000, s.voluntarySurplusW);
        }
      }
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

    if (s.surplusW < 0) {
      // Deficit: consumption exceeds PV — drain battery
      chargeW = s.surplusW; // negative = discharge
      feedInW = 0;
    } else if (soc < config.minSocPercent) {
      // Safety: SOC below minimum — charge from surplus before feeding in
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

    // Update SOC: clamp between minSocPercent and targetSocPercent
    soc = Math.max(config.minSocPercent, Math.min(targetSocPercent,
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
  };
}
