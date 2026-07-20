import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mockConnectTCP = vi.fn().mockResolvedValue(undefined);
const mockSetID = vi.fn();
const mockClose = vi.fn((cb: () => void) => cb());
const mockReadHoldingRegisters = vi.fn();
const mockWriteRegisters = vi.fn().mockResolvedValue(undefined);

vi.mock('modbus-serial', () => ({
  default: vi.fn().mockImplementation(() => ({
    connectTCP: mockConnectTCP,
    setID: mockSetID,
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
    app = buildServer({ testing: true, wallboxClient });
    await app.ready();
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
});
