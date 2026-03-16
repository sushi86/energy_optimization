import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from '../server.js';
import { DailySummaryService } from '../daily-summary-service.js';
import type { FastifyInstance } from 'fastify';

describe('API Server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer({ testing: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('daily-summary endpoints', () => {
  const testDir = path.join(import.meta.dirname, '../../test-data-server-summary');
  let app: FastifyInstance;

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const dailySummaryService = new DailySummaryService(testDir);
    app = buildServer({ testing: true, dailySummaryService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('GET /api/daily-summary returns all summaries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/daily-summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('summaries');
    expect(Array.isArray(body.summaries)).toBe(true);
  });

  it('GET /api/daily-summary?month= filters by month', async () => {
    const s = { date: '2026-03-13', totalYieldKwh: 10, feedInKwh: 5, revenueFixedCent: 400, revenueMarketCent: 450 };
    fs.writeFileSync(path.join(testDir, '2026-03-13.json'), JSON.stringify(s));
    const s2 = { date: '2026-04-01', totalYieldKwh: 15, feedInKwh: 7, revenueFixedCent: 560, revenueMarketCent: 630 };
    fs.writeFileSync(path.join(testDir, '2026-04-01.json'), JSON.stringify(s2));

    const res = await app.inject({ method: 'GET', url: '/api/daily-summary?month=2026-03' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0].date).toBe('2026-03-13');
  });

  it('GET /api/daily-summary/:date returns single summary or null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/daily-summary/2020-01-01' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toBeNull();
  });
});
