import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';
import { buildServer } from '../server.js';
import { AppState } from '../app-state.js';
import { savePvSettings } from '../pv-settings.js';
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

describe('WebSocket', () => {
  let broker: Aedes;
  let netServer: Server;
  let mqttPort: number;
  let app: FastifyInstance;
  let appState: AppState;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ws-test-'));
    ({ broker, server: netServer, port: mqttPort } = await startBroker());
    appState = await AppState.create({
      mqttUrl: `tcp://localhost:${mqttPort}`,
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
      manualModeFloorPercent: 50,
      dataDir: tmpDir,
    });
    app = buildServer({ testing: true, appState, pvSettingsPath: join(tmpDir, 'pv-settings.json') });
    await app.listen({ port: 0 });
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

  it('receives real-time updates via WebSocket', async () => {
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    const messages: unknown[] = [];
    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Trigger a PV update via MQTT
    const topic = `N/${DEVICE_ID}/system/0/Dc/Pv/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 7500 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 700));
    ws.close();

    expect(messages.length).toBeGreaterThan(0);
    const lastMsg = messages[messages.length - 1] as Record<string, unknown>;
    expect(lastMsg).toHaveProperty('pv');
  });

  it('broadcasts inverter phase data', async () => {
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    const messages: unknown[] = [];
    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Trigger consumption update on L1
    const topic = `N/${DEVICE_ID}/system/0/Ac/Consumption/L1/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 3000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 700));
    ws.close();

    expect(messages.length).toBeGreaterThan(0);
    const lastMsg = messages[messages.length - 1] as Record<string, unknown>;
    expect(lastMsg).toHaveProperty('inverter');
    const inverter = lastMsg.inverter as { phases: { L1: number; L2: number; L3: number } };
    expect(inverter.phases).toHaveProperty('L1');
    expect(inverter.phases).toHaveProperty('L2');
    expect(inverter.phases).toHaveProperty('L3');
  });

  it('excludes a disabled forecast source from the broadcast charge plan', async () => {
    // The chart (/api/forecast) honours the pv-settings source toggles, so the
    // plan must use the same ensemble — otherwise its correction factor is
    // derived from a curve the dashboard never draws.
    savePvSettings(join(tmpDir, 'pv-settings.json'), {
      latitude: 51, longitude: 9, tiltDeg: 35, azimuthDeg: 0, kwp: 17.8,
      vrmForecastEnabled: true,
      forecastSolarEnabled: false,
    });

    const intervalMs = 15 * 60 * 1000;
    const slotStart = Math.floor(Date.now() / intervalMs) * intervalMs;
    const flat = (powerW: number) => ({
      hours: Array.from({ length: 8 }, (_, i) => ({
        timestamp: new Date(slotStart + i * intervalMs),
        powerW,
      })),
      totalKwh: powerW * 2 / 1000,
      intervalHours: 0.25,
    });
    appState.vrm.getForecast = () => flat(10000);
    appState.forecastSolar.getForecast = () => flat(2000);

    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    const messages: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => { ws.on('open', () => resolve()); });
    ws.on('message', (data) => { messages.push(JSON.parse(data.toString())); });

    broker.publish(
      { topic: `N/${DEVICE_ID}/system/0/Dc/Pv/Power`, payload: Buffer.from(JSON.stringify({ value: 10000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 700));
    ws.close();

    const lastMsg = messages[messages.length - 1];
    const plan = lastMsg.chargePlan as { forecastCorrectionFactor: number; slots: { forecastW: number }[] };
    // VRM-only: actual 10000 matches forecast 10000 → no correction. Blending
    // the disabled solar source in would give 6000 and a bogus factor of 1.67.
    expect(plan.forecastCorrectionFactor).toBe(1);
    expect(plan.slots[0].forecastW).toBe(10000);
  });
});
