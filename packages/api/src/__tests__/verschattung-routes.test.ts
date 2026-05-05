import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerVerschattungRoutes } from '../verschattung/routes.js';
import type { Engine } from '../verschattung/engine.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function makeStubEngine(): Engine {
  return {
    recentDecisions: () => [],
    trackerSnapshot: () => ({}),
    buildContext: () => ({
      now: new Date(),
      sun: { azimuthDeg: 100, elevationDeg: 20 },
      pvPowerW: 1000, indoorTempC: 22, pvThresholdW: 500,
      pvBelowHalfThresholdSinceMs: null, isSummerMode: true,
      coverPositions: new Map(), zones: {
        ost:  { inZone: false, azimuthDeg: 100 },
        sued: { inZone: false, azimuthDeg: 100 },
        west: { inZone: false, azimuthDeg: 100 },
      },
    }),
    setManualPosition: async () => {},
    releaseOverride: () => {},
  } as unknown as Engine;
}

describe('verschattung routes', () => {
  let app: FastifyInstance;
  let configPath: string;

  beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vroutes-'));
    configPath = path.join(dir, 'config.json');
    app = Fastify();
    registerVerschattungRoutes(app, { engine: makeStubEngine(), configPath });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('GET /api/verschattung/state returns snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/state' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('covers');
    expect(body).toHaveProperty('inputs');
  });

  it('GET /api/verschattung/decisions returns array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/decisions' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/verschattung/config returns defaults if missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('PUT /api/verschattung/config persists', async () => {
    const updated = { ...DEFAULT_VERSCHATTUNG_CONFIG, indoorTempThresholdC: 25 };
    const res = await app.inject({
      method: 'PUT', url: '/api/verschattung/config',
      payload: updated, headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().indoorTempThresholdC).toBe(25);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).indoorTempThresholdC).toBe(25);
  });

  it('PUT /api/verschattung/cover/:id/position calls engine.setManualPosition', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/verschattung/cover/cover.galerie_rolladen/position',
      payload: { position: 50 }, headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('POST /api/verschattung/cover/:id/auto releases override', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/verschattung/cover/cover.galerie_rolladen/auto',
    });
    expect(res.statusCode).toBe(204);
  });
});
