import type { Forecast, ForecastHour } from './vrm-service';

/**
 * Upsample hourly forecast to 15-min slots using linear interpolation.
 * Instead of repeating the same value 4×, interpolate between consecutive
 * hourly values for smooth transitions (no staircase effect).
 */
function upsampleTo15min(forecast: Forecast): ForecastHour[] {
  if (forecast.intervalHours <= 0.25) return forecast.hours;

  const hours = forecast.hours;
  const result: ForecastHour[] = [];

  for (let i = 0; i < hours.length; i++) {
    const curr = hours[i];
    const next = i + 1 < hours.length ? hours[i + 1] : null;

    for (let q = 0; q < 4; q++) {
      // Interpolate: q=0 → current value, q=3 → 75% towards next value
      let powerW: number;
      if (next) {
        const t = q / 4; // 0, 0.25, 0.5, 0.75
        powerW = curr.powerW + (next.powerW - curr.powerW) * t;
      } else {
        // Last hour: no next value to interpolate towards, keep flat
        powerW = curr.powerW;
      }

      result.push({
        timestamp: new Date(curr.timestamp.getTime() + q * 15 * 60 * 1000),
        powerW: Math.max(0, Math.round(powerW)),
      });
    }
  }
  return result;
}

export function computeEnsembleForecast(vrm: Forecast, solar: Forecast): Forecast {
  const intervalHours = 0.25; // output is always 15-min

  if (solar.hours.length === 0) {
    // VRM might already be 15-min or hourly
    const hours = vrm.intervalHours > 0.25
      ? upsampleTo15min(vrm)
      : vrm.hours;
    const totalKwh = hours.reduce((sum, h) => sum + h.powerW * intervalHours, 0) / 1000;
    return { hours, totalKwh, intervalHours };
  }
  if (vrm.hours.length === 0) {
    const hours = upsampleTo15min(solar);
    const totalKwh = hours.reduce((sum, h) => sum + h.powerW * intervalHours, 0) / 1000;
    return { hours, totalKwh, intervalHours };
  }

  // Build 15-min lookup maps keyed by timestamp in ms
  const vrmSlots = vrm.intervalHours > 0.25 ? upsampleTo15min(vrm) : vrm.hours;
  const solarSlots = upsampleTo15min(solar);

  // Limit to VRM time range — solar API returns 2-day forecasts but we only want today
  const vrmMinTs = vrmSlots.length > 0 ? vrmSlots[0].timestamp.getTime() : -Infinity;
  const vrmMaxTs = vrmSlots.length > 0 ? vrmSlots[vrmSlots.length - 1].timestamp.getTime() : Infinity;
  const filteredSolarSlots = solarSlots.filter(h => {
    const ts = h.timestamp.getTime();
    return ts >= vrmMinTs && ts <= vrmMaxTs;
  });

  const vrmByTs = new Map<number, ForecastHour>();
  for (const h of vrmSlots) {
    vrmByTs.set(h.timestamp.getTime(), h);
  }

  const solarByTs = new Map<number, ForecastHour>();
  for (const h of filteredSolarSlots) {
    solarByTs.set(h.timestamp.getTime(), h);
  }

  const allTimestamps = new Set([...vrmByTs.keys(), ...solarByTs.keys()]);
  const ensembleHours: ForecastHour[] = [];

  for (const ts of allTimestamps) {
    const vrmSlot = vrmByTs.get(ts);
    const solarSlot = solarByTs.get(ts);

    if (vrmSlot && solarSlot) {
      ensembleHours.push({
        timestamp: vrmSlot.timestamp,
        powerW: Math.round((vrmSlot.powerW + solarSlot.powerW) / 2),
      });
    } else if (vrmSlot) {
      ensembleHours.push({ ...vrmSlot });
    } else if (solarSlot) {
      ensembleHours.push({ ...solarSlot });
    }
  }

  ensembleHours.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const totalKwh = ensembleHours.reduce((sum, h) => sum + h.powerW * intervalHours, 0) / 1000;

  return { hours: ensembleHours, totalKwh, intervalHours };
}
