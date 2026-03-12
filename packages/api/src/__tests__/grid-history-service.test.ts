import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GridHistoryService } from '../grid-history-service.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('GridHistoryService', () => {
  let tmpDir: string;
  let service: GridHistoryService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-history-test-'));
    service = new GridHistoryService(tmpDir);
  });

  afterEach(() => {
    service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records samples and computes slot average', () => {
    service.injectSlot('10:00', { sum: -6000, count: 3 });

    const slots = service.getSlots();
    expect(slots['10:00']).toBeDefined();
    expect(slots['10:00'].avgPowerW).toBe(-2000);
    expect(slots['10:00'].samples).toBe(3);
    expect(slots['10:00'].energyWh).toBe(-500);
  });

  it('recordSample adds to current slot', () => {
    service.recordSample(-2000);
    const slots = service.getSlots();
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(1);
    expect(slots[keys[0]].avgPowerW).toBe(-2000);
    expect(slots[keys[0]].samples).toBe(1);
  });

  it('returns empty object when no samples recorded', () => {
    expect(service.getSlots()).toEqual({});
  });

  it('separates samples into different slots based on time', () => {
    service.recordSample(-1000);
    service.injectSlot('03:00', { sum: -6000, count: 2 });

    const slots = service.getSlots();
    expect(slots['03:00']).toBeDefined();
    expect(slots['03:00'].avgPowerW).toBe(-3000);
    expect(slots['03:00'].samples).toBe(2);
    expect(slots['03:00'].energyWh).toBe(-750);
  });

  describe('persistence', () => {
    it('saves and loads accumulators from file', () => {
      service.injectSlot('12:00', { sum: -6000, count: 2 });
      service.save();

      const service2 = new GridHistoryService(tmpDir);
      const slots = service2.getSlots();
      expect(slots['12:00']).toBeDefined();
      expect(slots['12:00'].avgPowerW).toBe(-3000);
      expect(slots['12:00'].samples).toBe(2);
      service2.stop();
    });

    it('returns empty for non-existent historical date', () => {
      const slots = service.getSlots('2020-01-01');
      expect(slots).toEqual({});
    });
  });
});
