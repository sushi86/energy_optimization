import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VrmService } from '../vrm-service.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createForecastResponse(hours: Array<{ timestamp: number; wh: number }>) {
  const records: Record<string, Array<[number, number]>> = {};
  records['solar_yield_forecast'] = hours.map((h) => [h.timestamp * 1000, h.wh]);
  return { records, success: true };
}

describe('VrmService', () => {
  let service: VrmService;

  beforeEach(() => {
    mockFetch.mockReset();
    service = new VrmService({
      token: 'test-token',
      siteId: 'test-site',
    });
  });

  afterEach(() => {
    service.stop();
  });

  it('fetches and caches forecast data', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createForecastResponse([
          { timestamp: now, wh: 2000 },
          { timestamp: now + 3600, wh: 4000 },
          { timestamp: now + 7200, wh: 3000 },
        ]),
    });

    await service.refreshForecast();
    const forecast = service.getForecast();

    expect(forecast.hours).toHaveLength(3);
    // 3 slots × 0.25h interval: (2000+4000+3000) * 0.25 / 1000 = 2.25 kWh
    expect(forecast.totalKwh).toBeCloseTo(2.25);
  });

  it('returns empty forecast when no data', () => {
    const forecast = service.getForecast();
    expect(forecast.hours).toEqual([]);
    expect(forecast.totalKwh).toBe(0);
  });

  it('calls VRM API with correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createForecastResponse([]),
    });

    await service.refreshForecast();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('https://vrmapi.victronenergy.com/v2/installations/test-site/stats');
    expect(url).toContain('type=forecast');
    expect(url).toContain('interval=15mins');
    expect(options.headers['X-Authorization']).toBe('Token test-token');
  });

  it('determines winter mode based on threshold', async () => {
    const now = Math.floor(Date.now() / 1000);
    // 2 slots × 5000W × 0.25h = 2.5 kWh — below 16 * 1.2 = 19.2 kWh threshold
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createForecastResponse([
          { timestamp: now, wh: 5000 },
          { timestamp: now + 900, wh: 5000 },
        ]),
    });

    await service.refreshForecast();
    expect(service.isWinterMode(16, 1.2)).toBe(true);
  });

  it('is not winter mode when forecast exceeds threshold', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Generate enough 15-min slots to exceed 19.2 kWh threshold
    // 100 slots × 1000W × 0.25h = 25 kWh
    const slots = Array.from({ length: 100 }, (_, i) => ({
      timestamp: now + i * 900,
      wh: 1000,
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createForecastResponse(slots),
    });

    await service.refreshForecast();
    expect(service.isWinterMode(16, 1.2)).toBe(false);
  });
});
