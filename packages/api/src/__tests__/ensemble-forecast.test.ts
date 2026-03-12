import { describe, it, expect } from 'vitest';
import { computeEnsembleForecast } from '../ensemble-forecast';
import type { Forecast } from '../vrm-service';

function makeSlot(hour: number, minute: number, powerW: number, date = '2026-03-09'): { timestamp: Date; powerW: number } {
  return { timestamp: new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`), powerW };
}

function makeHourlySlots(hour: number, powerW: number, date = '2026-03-09') {
  return [
    makeSlot(hour, 0, powerW, date),
    makeSlot(hour, 15, powerW, date),
    makeSlot(hour, 30, powerW, date),
    makeSlot(hour, 45, powerW, date),
  ];
}

describe('computeEnsembleForecast', () => {
  it('averages two forecasts with matching slots', () => {
    // VRM is 15-min, solar is hourly (gets upsampled)
    const vrm: Forecast = {
      hours: [
        ...makeHourlySlots(10, 1000),
        ...makeHourlySlots(11, 2000),
      ],
      totalKwh: (1000 + 2000) * 4 * 0.25 / 1000, // 3 kWh
      intervalHours: 0.25,
    };
    const solar: Forecast = {
      hours: [
        makeSlot(10, 0, 1200),
        makeSlot(11, 0, 1800),
      ],
      totalKwh: 3,
      intervalHours: 1,
    };

    const result = computeEnsembleForecast(vrm, solar);

    expect(result.intervalHours).toBe(0.25);
    // 8 VRM slots + 8 upsampled solar slots → 8 merged slots
    expect(result.hours).toHaveLength(8);
    // Hour 10: avg(1000, 1200) = 1100
    expect(result.hours[0].powerW).toBe(1100);
    // Hour 11: avg(2000, 1800) = 1900
    expect(result.hours[4].powerW).toBe(1900);
  });

  it('returns VRM forecast when solar is empty', () => {
    const vrm: Forecast = {
      hours: makeHourlySlots(10, 1000),
      totalKwh: 1,
      intervalHours: 0.25,
    };
    const solar: Forecast = { hours: [], totalKwh: 0, intervalHours: 1 };

    const result = computeEnsembleForecast(vrm, solar);

    expect(result.hours).toHaveLength(4);
    expect(result.intervalHours).toBe(0.25);
  });

  it('returns upsampled solar forecast when VRM is empty', () => {
    const solar: Forecast = {
      hours: [makeSlot(10, 0, 1500)],
      totalKwh: 1.5,
      intervalHours: 1,
    };
    const vrm: Forecast = { hours: [], totalKwh: 0, intervalHours: 0.25 };

    const result = computeEnsembleForecast(vrm, solar);

    // 1 hourly slot → 4 × 15-min slots
    expect(result.hours).toHaveLength(4);
    expect(result.intervalHours).toBe(0.25);
    expect(result.hours[0].powerW).toBe(1500);
    expect(result.hours[3].powerW).toBe(1500);
  });

  it('handles mismatched hours (some hours only in one source)', () => {
    const vrm: Forecast = {
      hours: [
        ...makeHourlySlots(9, 500),
        ...makeHourlySlots(10, 1000),
      ],
      totalKwh: 1.5 * 0.25 * 4 / 1, // simplified
      intervalHours: 0.25,
    };
    const solar: Forecast = {
      hours: [
        makeSlot(10, 0, 1200),
        makeSlot(11, 0, 2400),
      ],
      totalKwh: 3.6,
      intervalHours: 1,
    };

    const result = computeEnsembleForecast(vrm, solar);

    // Hour 9: 4 VRM only, Hour 10: 4 merged = 8 slots
    // Hour 11 solar-only is EXCLUDED (outside VRM time range) to prevent double-counting
    expect(result.hours).toHaveLength(8);
    // Sorted by timestamp
    expect(result.hours[0].powerW).toBe(500);   // 09:00 VRM only
    expect(result.hours[4].powerW).toBe(1100);  // 10:00 avg(1000, 1200)
  });
});
