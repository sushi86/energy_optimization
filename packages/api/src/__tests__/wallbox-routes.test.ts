import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppState as AppStateClass } from '../app-state.js';

const mockConnectTCP = vi.fn().mockResolvedValue(undefined);
const mockSetID = vi.fn();
const mockSetTimeout = vi.fn();
const mockClose = vi.fn((cb: () => void) => cb());
const mockReadHoldingRegisters = vi.fn();
const mockWriteRegisters = vi.fn().mockResolvedValue(undefined);

vi.mock('modbus-serial', () => ({
  default: vi.fn().mockImplementation(() => ({
    connectTCP: mockConnectTCP,
    setID: mockSetID,
    setTimeout: mockSetTimeout,
    close: mockClose,
    readHoldingRegisters: mockReadHoldingRegisters,
    writeRegisters: mockWriteRegisters,
  })),
}));

const { buildServer } = await import('../server.js');
const { createWallboxClient } = await import('../wallbox/WallboxClient.js');

function regResponse(values: number[]) {
  return { data: values, buffer: Buffer.alloc(values.length * 2) };
}

describe('wallbox routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReadHoldingRegisters.mockResolvedValue(regResponse([1]));
    const wallboxClient = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await wallboxClient.connect();
    // Prime the state cache the way the background poller would — the status route
    // serves only cached state and never issues Modbus traffic itself.
    await wallboxClient.getState();
    app = buildServer({ testing: true, wallboxClient });
    await app.ready();
  });

  it('GET /api/wallbox/status reports initializing before the first poll has cached a state', async () => {
    const coldClient = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await coldClient.connect();
    const coldApp = buildServer({ testing: true, wallboxClient: coldClient });
    await coldApp.ready();

    const reads = mockReadHoldingRegisters.mock.calls.length;
    const res = await coldApp.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().initializing).toBe(true);
    expect(res.json().connected).toBe(false);
    // No fresh Modbus read may be triggered by the HTTP request — a box that is
    // unreachable during startup would otherwise pile up state reads behind the lock.
    expect(mockReadHoldingRegisters.mock.calls.length).toBe(reads);

    await coldApp.close();
  });

  it('GET /api/wallbox/status returns the current state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('available');
  });

  it('POST /api/wallbox/start calls startCharging', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/start' });
    expect(res.statusCode).toBe(200);
    expect(mockWriteRegisters).toHaveBeenCalledWith(95, [1]);
  });

  it('POST /api/wallbox/stop calls stopCharging', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockWriteRegisters).toHaveBeenCalledWith(95, [2]);
  });

  it('POST /api/wallbox/current sets the charging current', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/current', payload: { ampere: 10 } });
    expect(res.statusCode).toBe(200);
    expect(mockWriteRegisters).toHaveBeenCalledWith(91, [100]);
  });

  it('POST /api/wallbox/current returns 400 for out-of-range ampere', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/current', payload: { ampere: 20 } });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/wallbox/current returns 502 when Modbus write fails', async () => {
    mockWriteRegisters.mockRejectedValueOnce(new Error('ECONNRESET'));
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/current', payload: { ampere: 10 } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('ECONNRESET');
  });

  it('POST /api/wallbox/phases sets phases', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/phases', payload: { phases: 1 } });
    expect(res.statusCode).toBe(200);
    expect(mockWriteRegisters).toHaveBeenCalledWith(200, [1]);
  });

  it('GET /api/wallbox/status returns 503 when wallbox is not configured', async () => {
    const noWallboxApp = buildServer({ testing: true });
    await noWallboxApp.ready();
    const res = await noWallboxApp.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(res.statusCode).toBe(503);
    await noWallboxApp.close();
  });

  it('GET /api/wallbox/status includes connected and mode fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(body.mode).toBe('off');
  });

  it('GET /api/wallbox/status includes controllerDetails as null when no AppState is wired', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(res.json().controllerDetails).toBeNull();
  });

  it('POST /api/wallbox/mode without AppState returns 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/mode', payload: { mode: 'pv' } });
    expect(res.statusCode).toBe(500);
  });
});

describe('wallbox routes — with AppState', () => {
  let app: FastifyInstance;
  let broker: Aedes;
  let netServer: Server;
  let appState: AppStateClass;
  let tmpDir: string;

  function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
    return new Promise((resolve) => {
      const b = new Aedes();
      const s = createServer(b.handle);
      s.listen(0, () => {
        const addr = s.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({ broker: b, server: s, port });
      });
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReadHoldingRegisters.mockResolvedValue(regResponse([1]));
    const wallboxClient = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await wallboxClient.connect();

    tmpDir = mkdtempSync(join(tmpdir(), 'wallbox-routes-test-'));
    let port: number;
    ({ broker, server: netServer, port } = await startBroker());
    appState = await AppStateClass.create({
      mqttUrl: `tcp://localhost:${port}`,
      deviceId: 'test-device',
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
    app = buildServer({ testing: true, wallboxClient, appState });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await appState.stop();
    rmSync(tmpDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      netServer.close(() => broker.close(() => resolve()));
    });
  });

  it('POST /api/wallbox/mode sets the mode and GET /api/wallbox/status reflects it', async () => {
    const setRes = await app.inject({ method: 'POST', url: '/api/wallbox/mode', payload: { mode: 'pv' } });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json().mode).toBe('pv');

    const statusRes = await app.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(statusRes.json().mode).toBe('pv');
  });

  it('POST /api/wallbox/mode rejects an invalid mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/wallbox/mode', payload: { mode: 'bogus' } });
    expect(res.statusCode).toBe(400);
  });

  it('picks up a wallbox client set on AppState after the server was already built', async () => {
    const lateApp = buildServer({ testing: true, appState });
    await lateApp.ready();

    const before = await lateApp.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(before.statusCode).toBe(503);

    const wallboxClient = createWallboxClient({ host: '192.168.1.254', port: 502, unitId: 255 });
    await wallboxClient.connect();
    appState.setWallboxClient(wallboxClient);

    const after = await lateApp.inject({ method: 'GET', url: '/api/wallbox/status' });
    expect(after.statusCode).toBe(200);

    await lateApp.close();
  });
});
