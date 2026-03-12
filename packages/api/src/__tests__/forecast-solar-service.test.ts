import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ForecastSolarService,
  type ForecastSolarConfig,
} from '../forecast-solar-service.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const defaultConfig: ForecastSolarConfig = {
  latitude: 52.52,
  longitude: 13.405,
  tiltDeg: 30,
  azimuthDeg: 0,
  kwp: 10,
};

function createApiResponse(
  watts: Record<string, number>,
  wattHoursDay: Record<string, number> = {},
) {
  return {
    result: {
      watts,
      watt_hours_day: wattHoursDay,
    },
  };
}

describe('ForecastSolarService', () => {
  let service: ForecastSolarService;

  beforeEach(() => {
    mockFetch.mockReset();
    service = new ForecastSolarService(defaultConfig);
  });

  it('parses API response into ForecastHour[] correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createApiResponse(
          {
            '2026-03-09 08:00:00': 2500,
            '2026-03-09 09:00:00': 5800,
            '2026-03-09 10:00:00': 8200,
          },
          { '2026-03-09': 45200 },
        ),
    });

    await service.refresh();
    const forecast = service.getForecast();

    expect(forecast.hours).toHaveLength(3);
    expect(forecast.hours[0].powerW).toBe(2500);
    expect(forecast.hours[1].powerW).toBe(5800);
    expect(forecast.hours[2].powerW).toBe(8200);

    // Verify sorted by timestamp
    expect(forecast.hours[0].timestamp.getTime()).toBeLessThan(
      forecast.hours[1].timestamp.getTime(),
    );
    expect(forecast.hours[1].timestamp.getTime()).toBeLessThan(
      forecast.hours[2].timestamp.getTime(),
    );

    // Verify timestamps are parsed as Europe/Berlin
    // 2026-03-09 is before DST switch (March 29), so CET = UTC+1
    // "2026-03-09 08:00:00" in Europe/Berlin = 07:00 UTC
    expect(forecast.hours[0].timestamp.toISOString()).toBe(
      '2026-03-09T07:00:00.000Z',
    );

    // totalKwh should be derived from watt_hours_day
    expect(forecast.totalKwh).toBeCloseTo(45.2);

    expect(service.hasData()).toBe(true);
  });

  it('returns empty forecast on API error (no throw)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await service.refresh(); // should not throw

    const forecast = service.getForecast();
    expect(forecast.hours).toEqual([]);
    expect(forecast.totalKwh).toBe(0);
    expect(service.hasData()).toBe(false);
  });

  it('returns empty forecast on network error (no throw)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await service.refresh(); // should not throw

    const forecast = service.getForecast();
    expect(forecast.hours).toEqual([]);
    expect(forecast.totalKwh).toBe(0);
  });

  it('builds correct API URL from config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createApiResponse({}),
    });

    await service.refresh();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://api.forecast.solar/estimate/10/30/0/52.52/13.405',
    );
  });

  it('updateConfig changes the URL for next refresh', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createApiResponse({}),
    });

    await service.refresh();
    const [url1] = mockFetch.mock.calls[0];
    expect(url1).toBe(
      'https://api.forecast.solar/estimate/10/30/0/52.52/13.405',
    );

    service.updateConfig({
      latitude: 48.137,
      longitude: 11.576,
      tiltDeg: 25,
      azimuthDeg: -10,
      kwp: 8,
    });

    await service.refresh();
    const [url2] = mockFetch.mock.calls[1];
    expect(url2).toBe(
      'https://api.forecast.solar/estimate/8/25/-10/48.137/11.576',
    );
  });
});
