import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WallboxPoller } from '../wallbox-poller.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeVitalsResponse(overrides: Partial<{
  contactor_closed: boolean;
  vehicle_connected: boolean;
  vehicle_current_a: number;
  grid_v: number;
  currentA_a: number;
  currentB_a: number;
  currentC_a: number;
  voltageA_v: number;
  voltageB_v: number;
  voltageC_v: number;
  session_energy_wh: number;
}> = {}) {
  return {
    contactor_closed: true,
    vehicle_connected: true,
    vehicle_current_a: 0,
    grid_v: 230,
    currentA_a: 0,
    currentB_a: 0,
    currentC_a: 0,
    voltageA_v: 230,
    voltageB_v: 230,
    voltageC_v: 230,
    session_energy_wh: 0,
    ...overrides,
  };
}

describe('WallboxPoller', () => {
  let poller: WallboxPoller;

  beforeEach(() => {
    mockFetch.mockReset();
    poller = new WallboxPoller({ url: 'http://192.168.1.100' });
  });

  afterEach(() => {
    poller.stop();
  });

  it('returns null before first successful poll', () => {
    expect(poller.getPowerW()).toBeNull();
    expect(poller.isCharging()).toBe(false);
  });

  it('computes 3-phase power (16A × 230V × 3 phases = 11040W)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeVitalsResponse({
        currentA_a: 16, currentB_a: 16, currentC_a: 16,
        voltageA_v: 230, voltageB_v: 230, voltageC_v: 230,
        contactor_closed: true,
      }),
    });

    await poller.poll();

    expect(poller.getPowerW()).toBe(11040);
    expect(poller.isCharging()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.100/api/1/vitals');
  });

  it('reports 0W when not charging even if current reads non-zero', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeVitalsResponse({
        currentA_a: 10, currentB_a: 10, currentC_a: 10,
        voltageA_v: 230, voltageB_v: 230, voltageC_v: 230,
        contactor_closed: false,
      }),
    });

    await poller.poll();

    expect(poller.getPowerW()).toBe(0);
    expect(poller.isCharging()).toBe(false);
  });

  it('keeps last value on fetch error', async () => {
    // First successful poll
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeVitalsResponse({
        currentA_a: 16, currentB_a: 16, currentC_a: 16,
        voltageA_v: 230, voltageB_v: 230, voltageC_v: 230,
        contactor_closed: true,
      }),
    });
    await poller.poll();

    expect(poller.getPowerW()).toBe(11040);
    expect(poller.isCharging()).toBe(true);

    // Second poll fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await poller.poll();

    // Values should be unchanged
    expect(poller.getPowerW()).toBe(11040);
    expect(poller.isCharging()).toBe(true);
  });
});
