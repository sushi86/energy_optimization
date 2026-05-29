import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildServer } from '../server.js';
import { AppState } from '../app-state.js';
import type { FastifyInstance } from 'fastify';

const DEVICE_ID = 'test-device';

function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
  return new Promise((resolve) => {
    const broker = new Aedes();
    const server = createServer(broker.handle);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ broker, server, port });
    });
  });
}

describe('API Endpoints', () => {
  let broker: Aedes;
  let netServer: Server;
  let port: number;
  let app: FastifyInstance;
  let appState: AppState;
  let tmpDir: string;
  let pvSettingsPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'api-test-'));
    pvSettingsPath = join(tmpDir, 'pv-settings.json');
    ({ broker, server: netServer, port } = await startBroker());
    appState = await AppState.create({
      mqttUrl: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
      vrmToken: 'test',
      vrmSiteId: 'test',
      batteryCapacityKwh: 16,
      minSocPercent: 20,
      targetSocPercent: 100,
      maxAcPowerW: 12000,
      winterModeThresholdFactor: 1.2,
      regulationIntervalMs: 60000,
      largeChangeThresholdW: 3000,
      deadbandW: 50,
      priceOptimization: false,
      allowFeedInNegativePrice: false,
      feedInRateCentPerKwh: 7,
      preferredMaxChargeW: 5000,
      activeMorningDischarge: false,
      activeMorningDischargeMinSocPercent: 5,
      forecastCorrectionOverride: null,
      consumptionDayW: 500,
      consumptionNightW: 350,
      multiplusRatedPowerW: 4000,
      manualModeFloorPercent: 50,
      dataDir: tmpDir,
    });
    app = buildServer({ testing: true, appState, pvSettingsPath });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await appState.stop();
    rmSync(tmpDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      netServer.close(() => {
        broker.close(() => resolve());
      });
    });
  });

  it('GET /api/status returns system status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('pv');
    expect(body).toHaveProperty('grid');
    expect(body).toHaveProperty('battery');
    expect(body).toHaveProperty('consumption');
    expect(body).toHaveProperty('controller');
    expect(body).toHaveProperty('timestamp');
  });

  it('GET /api/config returns config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batteryCapacityKwh).toBe(16);
    expect(body.minSocPercent).toBe(20);
  });

  it('PUT /api/config updates config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        batteryCapacityKwh: 20,
        minSocPercent: 25,
        targetSocPercent: 100,
        maxAcPowerW: 12000,
        winterModeThresholdFactor: 1.2,
        regulationIntervalMs: 60000,
        largeChangeThresholdW: 3000,
        deadbandW: 50,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().batteryCapacityKwh).toBe(20);
  });

  it('POST /api/controller/mode sets mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'manual' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controller.mode).toBe('manual');
  });

  it('PUT /api/controller/setpoint works in manual mode', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'manual' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/controller/setpoint',
      payload: { setpointW: -3000 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/controller/setpoint rejects when not in manual mode', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'auto' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/controller/setpoint',
      payload: { setpointW: -3000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /api/forecast returns forecast', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/forecast' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('hours');
    expect(body).toHaveProperty('totalKwh');
    expect(body).toHaveProperty('winterModeActive');
  });

  it('GET /api/settings/pv-system returns defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/pv-system' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kwp).toBe(17.8);
    expect(body.tiltDeg).toBe(35);
    expect(body.azimuthDeg).toBe(2);
    expect(body.latitude).toBe(51.22731665478406);
    expect(body.longitude).toBe(9.311660517083372);
  });

  it('PUT /api/settings/pv-system saves and returns updated settings', async () => {
    const updated = {
      latitude: 48.1,
      longitude: 11.5,
      tiltDeg: 30,
      azimuthDeg: 180,
      kwp: 10.0,
    };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/pv-system',
      payload: updated,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kwp).toBe(10.0);
    expect(body.tiltDeg).toBe(30);
    expect(body.azimuthDeg).toBe(180);
    expect(body.latitude).toBe(48.1);
    expect(body.longitude).toBe(11.5);
  });

  it('GET /api/settings/pv-system returns previously saved values', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/pv-system' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kwp).toBe(10.0);
    expect(body.tiltDeg).toBe(30);
    expect(body.azimuthDeg).toBe(180);
  });
});
