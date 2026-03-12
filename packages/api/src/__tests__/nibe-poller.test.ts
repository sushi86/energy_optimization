import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NibePoller } from '../nibe-poller.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const NIBE_OPTIONS = {
  url: 'https://192.168.1.100:8443',
  username: 'admin',
  password: 'secret',
};

function createPointsResponse(variableId: number, integerValue: number) {
  return {
    [String(variableId)]: {
      value: { integerValue, isOk: true },
    },
  };
}

describe('NibePoller', () => {
  let poller: NibePoller;

  beforeEach(() => {
    mockFetch.mockReset();
    poller = new NibePoller(NIBE_OPTIONS);
  });

  afterEach(() => {
    poller.stop();
  });

  it('returns null before first successful poll', () => {
    expect(poller.getPowerW()).toBeNull();
  });

  it('parses current_power_consumption correctly (150 raw → 1.5kW → 1500W)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createPointsResponse(25165, 150),
    });

    await poller.poll();

    expect(poller.getPowerW()).toBe(1500);
  });

  it('returns null for invalid sensor value -32768', async () => {
    // First poll with valid value
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createPointsResponse(25165, 150),
    });
    await poller.poll();
    expect(poller.getPowerW()).toBe(1500);

    // Second poll with invalid sensor value
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createPointsResponse(25165, -32768),
    });
    await poller.poll();

    expect(poller.getPowerW()).toBeNull();
  });

  it('keeps last value on fetch error', async () => {
    // First poll succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createPointsResponse(25165, 200),
    });
    await poller.poll();
    expect(poller.getPowerW()).toBe(2000);

    // Second poll fails with network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await poller.poll();

    expect(poller.getPowerW()).toBe(2000);
  });

  it('calls the correct URL and sends Basic Auth header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createPointsResponse(25165, 100),
    });

    await poller.poll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://192.168.1.100:8443/api/v1/devices/0/points');
    const expectedAuth = 'Basic ' + Buffer.from('admin:secret').toString('base64');
    expect(options.headers['Authorization']).toBe(expectedAuth);
    expect(options.headers['Accept']).toBe('application/json');
  });

  it('returns null when variableId is not present in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ '99999': { value: { integerValue: 500, isOk: true } } }),
    });

    await poller.poll();

    expect(poller.getPowerW()).toBeNull();
  });
});
