import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DailySummaryService } from '../daily-summary-service.js';
import { energyEvents } from '../energy-events.js';

describe('DailySummaryService', () => {
  const testDir = path.join(import.meta.dirname, '../../test-data-daily-summary');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('writes daily summary on production-ended event', () => {
    new DailySummaryService(testDir);

    energyEvents.emit('pv:production-ended', {
      totalYieldKwh: 28.4,
      feedInKwh: 12.3,
      revenueFixedCent: 984,
      revenueMarketCent: 1107,
      finalSoc: 85,
      forecastCorrectionFactor: 0.92,
    });

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const filePath = path.join(testDir, `${today}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data).toEqual({
      date: today,
      totalYieldKwh: 28.4,
      feedInKwh: 12.3,
      revenueFixedCent: 984,
      revenueMarketCent: 1107,
    });
  });

  it('getSummary returns null for missing date', () => {
    const service = new DailySummaryService(testDir);
    expect(service.getSummary('2020-01-01')).toBeNull();
  });

  it('getAllSummaries returns all saved summaries sorted by date', () => {
    const service = new DailySummaryService(testDir);

    const s1 = { date: '2026-03-13', totalYieldKwh: 10, feedInKwh: 5, revenueFixedCent: 400, revenueMarketCent: 450 };
    const s2 = { date: '2026-03-14', totalYieldKwh: 20, feedInKwh: 8, revenueFixedCent: 640, revenueMarketCent: 720 };
    fs.writeFileSync(path.join(testDir, '2026-03-14.json'), JSON.stringify(s2));
    fs.writeFileSync(path.join(testDir, '2026-03-13.json'), JSON.stringify(s1));

    const all = service.getAllSummaries();
    expect(all).toHaveLength(2);
    expect(all[0].date).toBe('2026-03-13');
    expect(all[1].date).toBe('2026-03-14');
  });
});
