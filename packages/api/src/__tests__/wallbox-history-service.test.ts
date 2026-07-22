import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WallboxHistoryService } from '../wallbox-history-service.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

describe('WallboxHistoryService', () => {
  let tmpDir: string;
  let service: WallboxHistoryService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallbox-history-test-'));
    service = new WallboxHistoryService(tmpDir);
  });

  afterEach(() => {
    service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when nothing has been recorded', () => {
    expect(service.getSlots()).toEqual({});
  });

  it('the first recorded reading establishes a baseline without creating a slot', () => {
    service.recordEnergyTotalKwh(10.0);
    expect(service.getSlots()).toEqual({});
  });

  it('records the delta between consecutive readings as Wh', () => {
    service.recordEnergyTotalKwh(10.0);
    service.recordEnergyTotalKwh(10.5);
    const slots = service.getSlots();
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(1);
    expect(slots[keys[0]].energyWh).toBe(500);
  });

  it('accumulates multiple deltas within the same slot', () => {
    service.recordEnergyTotalKwh(10.0);
    service.recordEnergyTotalKwh(10.2);
    service.recordEnergyTotalKwh(10.5);
    const slots = service.getSlots();
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(1);
    expect(slots[keys[0]].energyWh).toBe(500);
  });

  it('ignores a decreasing reading (counter reset/rollover) instead of going negative, and resumes correctly afterward', () => {
    service.recordEnergyTotalKwh(10.0);
    service.recordEnergyTotalKwh(10.5); // +500Wh
    service.recordEnergyTotalKwh(0.2);  // reset: ignored, re-baselines to 0.2
    service.recordEnergyTotalKwh(0.5);  // +300Wh
    const slots = service.getSlots();
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(1);
    expect(slots[keys[0]].energyWh).toBe(800);
  });

  it('injectSlot sets a raw Wh value for testing', () => {
    service.injectSlot('10:00', 750);
    expect(service.getSlots()['10:00']).toEqual({ energyWh: 750 });
  });

  describe('persistence', () => {
    it('saves and loads accumulators from file', () => {
      service.injectSlot('12:00', 1500);
      service.save();

      const service2 = new WallboxHistoryService(tmpDir);
      const slots = service2.getSlots();
      expect(slots['12:00']).toEqual({ energyWh: 1500 });
      service2.stop();
    });

    it('returns empty for a non-existent historical date', () => {
      expect(service.getSlots('2020-01-01')).toEqual({});
    });
  });

  describe('getDailyTotals', () => {
    it('sums energyWh across slots for the current day, converted to kWh', () => {
      service.injectSlot('10:00', 500);
      service.injectSlot('14:00', 1500);
      const totals = service.getDailyTotals();
      const today = totals.find((t) => t.date === todayStr());
      expect(today?.chargedKwh).toBeCloseTo(2.0);
    });

    it('includes historical days read from saved files on disk', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '2020-01-01.json'),
        JSON.stringify({ date: '2020-01-01', accumulators: { '09:00': 1000 } }),
        'utf-8',
      );
      const totals = service.getDailyTotals();
      const historical = totals.find((t) => t.date === '2020-01-01');
      expect(historical?.chargedKwh).toBe(1);
    });
  });
});
