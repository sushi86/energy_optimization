import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildServer } from '../server.js';
import { WallboxHistoryService } from '../wallbox-history-service.js';

describe('wallbox history routes', () => {
  let app: FastifyInstance;
  let service: WallboxHistoryService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wallbox-history-routes-test-'));
    service = new WallboxHistoryService(tmpDir);
    app = buildServer({ testing: true, wallboxHistoryService: service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    service.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/wallbox/history returns slots for the requested date', async () => {
    service.injectSlot('10:00', 500);
    service.injectSlot('14:00', 1500);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

    const res = await app.inject({ method: 'GET', url: `/api/wallbox/history?date=${today}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe(today);
    expect(body.slots).toEqual(
      expect.arrayContaining([
        { time: '10:00', energyWh: 500 },
        { time: '14:00', energyWh: 1500 },
      ]),
    );
  });

  it('GET /api/wallbox/history returns empty slots when service is not configured', async () => {
    const bareApp = buildServer({ testing: true });
    await bareApp.ready();
    const res = await bareApp.inject({ method: 'GET', url: '/api/wallbox/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ date: '', slots: [] });
    await bareApp.close();
  });

  it('GET /api/wallbox/daily-summary filters by month', async () => {
    service.injectSlot('10:00', 2000); // today, 2 kWh
    const res = await app.inject({ method: 'GET', url: '/api/wallbox/daily-summary?month=2020-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ summaries: [] });
  });

  it('GET /api/wallbox/daily-summary returns all summaries when no month is given', async () => {
    service.injectSlot('10:00', 2000);
    const res = await app.inject({ method: 'GET', url: '/api/wallbox/daily-summary' });
    expect(res.statusCode).toBe(200);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const body = res.json();
    const todaySummary = body.summaries.find((s: { date: string }) => s.date === today);
    expect(todaySummary?.chargedKwh).toBeCloseTo(2.0);
  });

  it('GET /api/wallbox/daily-summary returns empty summaries when service is not configured', async () => {
    const bareApp = buildServer({ testing: true });
    await bareApp.ready();
    const res = await bareApp.inject({ method: 'GET', url: '/api/wallbox/daily-summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ summaries: [] });
    await bareApp.close();
  });
});
