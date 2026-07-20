import { describe, it, expect, vi } from 'vitest';
import { WallboxController } from '../wallbox/WallboxController.js';
import type { WallboxState } from '../wallbox/types.js';

const TOLERANCE_MS = 120_000; // 2 minutes

function makeState(overrides: Partial<WallboxState> = {}): WallboxState {
  return {
    status: 'connected',
    rawStatus: 2,
    vehicleConnected: true,
    connectorState: 1,
    errorCode: 0,
    powerW: 0,
    energyTotalKwh: 0,
    chargingCurrentA: 6,
    currentsA: [0, 0, 0],
    voltagesV: [230, 230, 230],
    phases: 3,
    chargeDurationS: 0,
    evseMaxCurrentA: 16,
    evseMinCurrentA: 6,
    cableMaxCurrentA: 16,
    safeCurrentA: 6,
    commTimeoutS: 60,
    chargeMode: 0,
    serial: 'TEST',
    ...overrides,
  };
}

function makeClient() {
  return {
    startCharging: vi.fn().mockResolvedValue(undefined),
    stopCharging: vi.fn().mockResolvedValue(undefined),
    setChargingCurrent: vi.fn().mockResolvedValue(undefined),
    setPhases: vi.fn().mockResolvedValue(undefined),
  };
}

describe('WallboxController', () => {
  describe('mode management', () => {
    it('starts in off mode', () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      expect(ctrl.getMode()).toBe('off');
    });

    it('setMode changes the mode', () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      expect(ctrl.getMode()).toBe('pv');
    });
  });

  describe('off mode', () => {
    it('stops charging if currently charging', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      const client = makeClient();
      await ctrl.tick({ pvPower: 0, consumptionPower: 0 }, makeState({ status: 'charging' }), client);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
    });

    it('does not call stopCharging if not charging (idempotent)', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      const client = makeClient();
      await ctrl.tick({ pvPower: 0, consumptionPower: 0 }, makeState({ status: 'available' }), client);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });
  });

  describe('manual mode', () => {
    it('never calls any client method', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('manual');
      const client = makeClient();
      await ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, makeState({ status: 'available' }), client);
      expect(client.startCharging).not.toHaveBeenCalled();
      expect(client.stopCharging).not.toHaveBeenCalled();
      expect(client.setChargingCurrent).not.toHaveBeenCalled();
      expect(client.setPhases).not.toHaveBeenCalled();
    });
  });

  describe('pv mode — no wallbox data yet', () => {
    it('is a safe no-op when wallboxState is null', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      await expect(ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, null, client)).resolves.not.toThrow();
      expect(client.startCharging).not.toHaveBeenCalled();
    });
  });

  describe('pv mode — starting charge', () => {
    it('does not start immediately even with sufficient surplus (waits for tolerance)', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const now = 1_000_000;
      // surplus = 5000W >= 4140W (3*6A*230V) minimum
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, makeState({ status: 'available' }), client, now);
      expect(client.startCharging).not.toHaveBeenCalled();
    });

    it('starts charging after sufficient surplus persists for the full tolerance window', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      expect(client.startCharging).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(3);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(7); // floor(5000 / (3*230)) = 7
      expect(client.startCharging).toHaveBeenCalledTimes(1);
    });

    it('resets the sufficient-timer if surplus drops below minimum before tolerance elapses', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + 60_000); // surplus too low
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS + 1); // < 2min since reset
      expect(client.startCharging).not.toHaveBeenCalled();
    });

    it('does not start when no vehicle is connected, even with sufficient surplus', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available', vehicleConnected: false });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.startCharging).not.toHaveBeenCalled();
    });

    it('clamps the starting current to MAX_CHARGING_CURRENT_A (16)', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      // huge surplus: 20000W / (3*230) = 28.9A, must clamp to 16
      await ctrl.tick({ pvPower: 20500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 20500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(16);
    });
  });

  describe('pv mode — while charging', () => {
    it('adjusts the charging current to follow surplus without waiting for tolerance', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 7 });
      // surplus = 6000W → floor(6000/690) = 8A, above minimum, no tolerance wait needed
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(8);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('does not rewrite the current if the target matches the current value', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 8 });
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).not.toHaveBeenCalled();
    });

    it('does not stop immediately when surplus drops below minimum (waits for tolerance)', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('stops charging after insufficient surplus persists for the full tolerance window', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);
      expect(client.stopCharging).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
    });

    it('resets the insufficient-timer once surplus recovers before tolerance elapses', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + 60_000); // recovers
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS + 1);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('applies a new toleranceMs to subsequent ticks', async () => {
      const ctrl = new WallboxController({ toleranceMs: TOLERANCE_MS });
      ctrl.updateConfig({ toleranceMs: 1000 });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + 1000);
      expect(client.startCharging).toHaveBeenCalledTimes(1);
    });
  });
});
