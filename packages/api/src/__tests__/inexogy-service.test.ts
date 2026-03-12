import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InexogyService } from '../inexogy-service.js';
import { buildServer } from '../server.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) };
}

describe('InexogyService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('meter discovery', () => {
    it('auto-discovers first ELECTRICITY meter when no meterId configured', async () => {
      const meters = [
        { meterId: 'gas-1', measurementType: 'GAS', serialNumber: '1', fullSerialNumber: '1', location: {} },
        { meterId: 'elec-1', measurementType: 'ELECTRICITY', serialNumber: '2', fullSerialNumber: '2', location: {} },
      ];
      mockFetch
        .mockResolvedValueOnce(jsonResponse(meters))
        .mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const readingsUrl = mockFetch.mock.calls[1][0] as string;
      expect(readingsUrl).toContain('meterId=elec-1');
    });

    it('uses configured meterId and skips discovery', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'my-meter' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('meterId=my-meter');
    });

    it('caches meter ID after first discovery', async () => {
      const meters = [
        { meterId: 'elec-1', measurementType: 'ELECTRICITY', serialNumber: '1', fullSerialNumber: '1', location: {} },
      ];
      mockFetch
        .mockResolvedValueOnce(jsonResponse(meters))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(mockFetch).toHaveBeenCalledTimes(3); // meters + readings + readings
    });

    it('throws when no electricity meter found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await expect(svc.getReadings(new Date(), new Date())).rejects.toThrow('No electricity meter found');
    });
  });

  describe('getReadings', () => {
    it('fetches readings and normalizes values', async () => {
      const rawReadings = [
        { time: 1741564800000, values: { power: 450000, energy: 12345600000000, energyOut: 7890100000000 } },
        { time: 1741565700000, values: { power: -200000, energy: 12345700000000, energyOut: 7890200000000 } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(rawReadings));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'meter-1' });
      const readings = await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(readings).toHaveLength(2);
      expect(readings[0]).toEqual({
        time: new Date(1741564800000),
        powerW: 450,
        energyKwh: 1234.56,
        energyOutKwh: 789.01,
      });
      expect(readings[1]).toEqual({
        time: new Date(1741565700000),
        powerW: -200,
        energyKwh: 1234.57,
        energyOutKwh: 789.02,
      });
    });

    it('sends correct Authorization header and URL params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'test@x.com', password: 'secret', meterId: 'M1' });
      const from = new Date('2026-03-10T00:00:00+01:00');
      const to = new Date('2026-03-11T00:00:00+01:00');
      await svc.getReadings(from, to);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('https://api.inexogy.com/public/v1/readings');
      expect(url).toContain('meterId=M1');
      expect(url).toContain('resolution=fifteen_minutes');
      expect(url).toContain(`from=${from.getTime()}`);
      expect(url).toContain(`to=${to.getTime()}`);
      expect(opts.headers.Authorization).toBe('Basic ' + btoa('test@x.com:secret'));
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'M1' });
      await expect(svc.getReadings(new Date(), new Date())).rejects.toThrow('inexogy API error: 401');
    });
  });
});

describe('GET /api/meter/history', () => {
  it('returns 404 when inexogy is not configured', async () => {
    const app = buildServer({ testing: true });
    const res = await app.inject({ method: 'GET', url: '/api/meter/history' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain('not configured');
  });
});
