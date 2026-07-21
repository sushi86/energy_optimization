import { describe, it, expect, vi, afterEach } from 'vitest';
import { WallboxController } from '../wallbox/WallboxController.js';
import type { WallboxState } from '../wallbox/types.js';
import { energyEvents } from '../energy-events.js';

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

// acLoadCapW hoch genug, dass der Deckel in Alt-Tests nie greift.
function makeController(overrides: Partial<{ toleranceMs: number; acLoadCapW: number }> = {}) {
  return new WallboxController({ toleranceMs: TOLERANCE_MS, acLoadCapW: 100_000, ...overrides });
}

describe('WallboxController', () => {
  describe('mode management', () => {
    it('starts in off mode', () => {
      const ctrl = makeController();
      expect(ctrl.getMode()).toBe('off');
    });

    it('setMode changes the mode', () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      expect(ctrl.getMode()).toBe('pv');
    });
  });

  describe('off mode', () => {
    it('stops charging if currently charging', async () => {
      const ctrl = makeController();
      const client = makeClient();
      await ctrl.tick({ pvPower: 0, consumptionPower: 0 }, makeState({ status: 'charging' }), client);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
    });

    it('does not call stopCharging if not charging (idempotent)', async () => {
      const ctrl = makeController();
      const client = makeClient();
      await ctrl.tick({ pvPower: 0, consumptionPower: 0 }, makeState({ status: 'available' }), client);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });
  });

  describe('manual mode', () => {
    it('never calls any client method', async () => {
      const ctrl = makeController();
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
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      await expect(ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, null, client)).resolves.not.toThrow();
      expect(client.startCharging).not.toHaveBeenCalled();
    });
  });

  describe('pv mode — starting charge', () => {
    it('does not start immediately even with sufficient surplus (waits for tolerance)', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const now = 1_000_000;
      // surplus = 5000W >= 4140W (3*6A*230V) minimum
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, makeState({ status: 'available' }), client, now);
      expect(client.startCharging).not.toHaveBeenCalled();
    });

    it('starts charging after sufficient surplus persists for the full tolerance window', async () => {
      const ctrl = makeController();
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
      const ctrl = makeController();
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
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available', vehicleConnected: false });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.startCharging).not.toHaveBeenCalled();
    });

    it('clamps the starting current to MAX_CHARGING_CURRENT_A (16)', async () => {
      const ctrl = makeController();
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

  describe('pv mode — start phase decision', () => {
    it('starts 1-phase when surplus is between 1380 and 4440 W', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      // surplus = 2500W: >= 1380 (1p min) but < 4440 (3p start threshold)
      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0);
      expect(client.startCharging).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(1);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(10); // floor(2500 / 230) = 10
      expect(client.startCharging).toHaveBeenCalledTimes(1);
    });

    it('starts 1-phase in the 4140–4440 W band (margin applies to the start decision)', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      // surplus = 4200W: over 3p minimum (4140) but under start threshold (4440)
      await ctrl.tick({ pvPower: 4700, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 4700, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(1);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(16); // floor(4200/230) = 18 → clamp 16
      expect(client.startCharging).toHaveBeenCalledTimes(1);
    });

    it('starts 3-phase at surplus >= 4440 W', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 4940, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 4940, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(3);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(6); // floor(4440 / 690) = 6
      expect(client.startCharging).toHaveBeenCalledTimes(1);
    });

    it('does not start below 1380 W, even after the tolerance window', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1800, consumptionPower: 500 }, state, client, t0); // surplus 1300
      await ctrl.tick({ pvPower: 1800, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.startCharging).not.toHaveBeenCalled();
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 1300, targetCurrentA: null, reason: 'Zu wenig Überschuss (1300 W, benötigt 1380 W)' });
    });

    it('startup countdown names the 1-phase target when surplus is mid-range', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0 + 30_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 2500, targetCurrentA: null, reason: 'Ausreichend Überschuss (1-phasig) seit 30s — startet nach 120s' });
    });
  });

  describe('pv mode — while charging', () => {
    it('adjusts the charging current to follow surplus without waiting for tolerance', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 7 });
      // surplus = 6000W → floor(6000/690) = 8A, above minimum, no tolerance wait needed
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(8);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('does not rewrite the current if the target matches the current value', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 8 });
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).not.toHaveBeenCalled();
    });

    it('does not stop immediately when surplus drops below minimum (waits for tolerance)', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('stops charging after insufficient surplus persists for the full tolerance window', async () => {
      const ctrl = makeController();
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
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + 60_000); // recovers
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS + 1);
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('adds back the wallbox\'s own draw so its charging load (already counted inside consumptionPower) does not self-defeat the surplus calc', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      // House load 500W + wallbox draw 4830W (7A * 3 * 230V) = consumptionPower 5330W.
      // Naive surplus = 5500 - 5330 = 170W → looks insufficient, would trigger a stop.
      // Corrected surplus = 170 + 4830 = 5000W → sufficient, should keep charging at 7A.
      const state = makeState({ status: 'charging', chargingCurrentA: 7, powerW: 4830 });
      await ctrl.tick({ pvPower: 5500, consumptionPower: 5330 }, state, client, 1_000_000);
      expect(client.stopCharging).not.toHaveBeenCalled();
      expect(client.setChargingCurrent).not.toHaveBeenCalled(); // target 7A already matches current 7A
      expect(ctrl.getLastDetails()).toEqual({
        surplusW: 5000,
        targetCurrentA: 7,
        reason: 'Lädt 3-phasig mit 7 A (Überschuss 5000 W)',
      });
    });
  });

  describe('pv mode — phase switching while charging', () => {
    it('switches 1→3 after surplus stays >= 4440 W for the tolerance window', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0); // surplus 6000
      expect(client.setPhases).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(3);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(8); // floor(6000 / 690) = 8
      expect(client.stopCharging).not.toHaveBeenCalled();
      expect(client.startCharging).not.toHaveBeenCalled(); // direct register write, no restart
    });

    it('resets the switch-up timer when surplus drops below 4440 W before the window elapses', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0 + 60_000); // surplus 3000 < 4440
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS + 1);
      expect(client.setPhases).not.toHaveBeenCalled();
    });

    it('switches 3→1 instead of stopping when surplus stays in 1380–4140 W for the tolerance window', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0); // surplus 3000
      expect(client.setPhases).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).toHaveBeenCalledWith(1);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(13); // floor(3000 / 230) = 13
      expect(client.stopCharging).not.toHaveBeenCalled();
    });

    it('stays 3-phase in the 4140–4440 W hysteresis band and keeps regulating the current', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 7 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 4700, consumptionPower: 500 }, state, client, t0); // surplus 4200
      await ctrl.tick({ pvPower: 4700, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).not.toHaveBeenCalled();
      expect(client.stopCharging).not.toHaveBeenCalled();
      expect(client.setChargingCurrent).toHaveBeenCalledWith(6); // floor(4200 / 690) = 6
    });

    it('stays 1-phase below 4440 W and regulates with the 1-phase divisor (230 W/A)', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0); // surplus 3000
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).not.toHaveBeenCalled();
      expect(client.setChargingCurrent).toHaveBeenCalledWith(13); // floor(3000 / 230) = 13
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 3000, targetCurrentA: 13, reason: 'Lädt 1-phasig mit 13 A (Überschuss 3000 W)' });
    });

    it('reports the switch-up countdown while the timer runs', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + 45_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 6000, targetCurrentA: null, reason: 'Überschuss reicht für 3-phasig seit 45s — schaltet um nach 120s' });
    });

    it('reports the switch-down countdown while the timer runs', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0 + 30_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 3000, targetCurrentA: null, reason: 'Überschuss reicht nur für 1-phasig seit 30s — schaltet um nach 120s' });
    });

    it('stops from 1-phase charging when surplus stays below 1380 W for the tolerance window', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1300, consumptionPower: 500 }, state, client, t0); // surplus 800
      expect(client.stopCharging).not.toHaveBeenCalled();

      await ctrl.tick({ pvPower: 1300, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
      expect(client.setPhases).not.toHaveBeenCalled();
    });

    it('setMode resets the switch timers', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0);
      ctrl.setMode('off');
      ctrl.setMode('pv');
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).not.toHaveBeenCalled(); // timer restarted at t0 + TOLERANCE_MS
    });

    it('resets the switch-down timer when charging pauses, so a later dip waits the full window again', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const charging3p = makeState({ status: 'charging', phases: 3, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      // Surplus dips into the switch-down band (3000 W) and the timer starts.
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, charging3p, client, t0);
      // The EV pauses charging on its own (status leaves 'charging'), surplus unchanged.
      const paused = makeState({ status: 'connected', phases: 3 });
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, paused, client, t0 + 60_000);
      // Charging has resumed; surplus dips into the band again much later. Without the
      // pause-reset, the stale timer from t0 would fire the 3→1 switch immediately.
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, charging3p, client, t0 + TOLERANCE_MS + 60_000);
      expect(client.setPhases).not.toHaveBeenCalled();
    });

    it('resets the switch-up timer when charging pauses, so a later surge waits the full window again', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const charging1p = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      // Surplus rises into the switch-up band (6000 W) and the timer starts.
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, charging1p, client, t0);
      // The EV pauses charging on its own (status leaves 'charging'), surplus unchanged.
      const paused = makeState({ status: 'connected', phases: 1 });
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, paused, client, t0 + 60_000);
      // Charging has resumed; surplus is in the band again much later. Without the
      // pause-reset, the stale timer from t0 would fire the 1→3 switch immediately.
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, charging1p, client, t0 + TOLERANCE_MS + 60_000);
      expect(client.setPhases).not.toHaveBeenCalled();
    });
  });

  describe('updateDetails', () => {
    it('never calls any client method, even when the tolerance window has elapsed', () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      // Start the insufficient-surplus timer via a real tick (client present, but
      // tolerance not yet elapsed so no action is taken).
      ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);

      // Repeated live updateDetails() calls, well past the tolerance window, must
      // never touch the wallbox — only the gated tick() may act on it.
      ctrl.updateDetails({ pvPower: 1000, consumptionPower: 500 }, state, t0 + TOLERANCE_MS);
      ctrl.updateDetails({ pvPower: 1000, consumptionPower: 500 }, state, t0 + TOLERANCE_MS + 5000);
      expect(client.stopCharging).not.toHaveBeenCalled();
      expect(client.startCharging).not.toHaveBeenCalled();
      expect(client.setChargingCurrent).not.toHaveBeenCalled();
      expect(client.setPhases).not.toHaveBeenCalled();

      // But the displayed elapsed-seconds counter does keep advancing live.
      expect(ctrl.getLastDetails()?.reason).toBe('Überschuss unzureichend seit 125s — stoppt nach 120s');
    });

    it('updates surplusW and reason immediately for a fresh data point, without needing tick()', () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const state = makeState({ status: 'charging', chargingCurrentA: 8 });
      ctrl.updateDetails({ pvPower: 6500, consumptionPower: 500 }, state, 1_000_000);
      expect(ctrl.getLastDetails()).toEqual({
        surplusW: 6000,
        targetCurrentA: 8,
        reason: 'Lädt 3-phasig mit 8 A (Überschuss 6000 W)',
      });
    });

    it('is a no-op in off and manual mode', () => {
      const ctrl = makeController();
      ctrl.updateDetails({ pvPower: 8000, consumptionPower: 500 }, makeState({ status: 'charging' }));
      expect(ctrl.getLastDetails()).toBeNull();

      ctrl.setMode('manual');
      ctrl.updateDetails({ pvPower: 8000, consumptionPower: 500 }, makeState({ status: 'available' }));
      expect(ctrl.getLastDetails()).toBeNull();
    });
  });

  describe('getLastDetails', () => {
    it('returns null in off and manual mode', async () => {
      const ctrl = makeController();
      const client = makeClient();
      await ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, makeState({ status: 'available' }), client, 1_000_000);
      expect(ctrl.getLastDetails()).toBeNull();

      ctrl.setMode('manual');
      await ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, makeState({ status: 'available' }), client, 1_000_000);
      expect(ctrl.getLastDetails()).toBeNull();
    });

    it('reports the target current while charging with sufficient surplus', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 8 });
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 6000, targetCurrentA: 8, reason: 'Lädt 3-phasig mit 8 A (Überschuss 6000 W)' });
    });

    it('reports the countdown while charging with insufficient surplus', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + 45_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 500, targetCurrentA: null, reason: 'Überschuss unzureichend seit 45s — stoppt nach 120s' });
    });

    it('reports "Kein Fahrzeug verbunden" when not charging and no vehicle connected', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available', vehicleConnected: false });
      await ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, state, client, 1_000_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 7500, targetCurrentA: null, reason: 'Kein Fahrzeug verbunden' });
    });

    it('reports the startup countdown while not charging with sufficient surplus', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + 30_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 5000, targetCurrentA: null, reason: 'Ausreichend Überschuss (3-phasig) seit 30s — startet nach 120s' });
    });

    it('reports insufficient surplus with required-power figure while not charging', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, 1_000_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 500, targetCurrentA: null, reason: 'Zu wenig Überschuss (500 W, benötigt 1380 W)' });
    });

    it('reports "Warte auf Wallbox-Daten" when wallboxState is null', async () => {
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      await ctrl.tick({ pvPower: 8000, consumptionPower: 500 }, null, client, 1_000_000);
      expect(ctrl.getLastDetails()).toEqual({ surplusW: 7500, targetCurrentA: null, reason: 'Warte auf Wallbox-Daten' });
    });
  });

  describe('updateConfig', () => {
    it('applies a new toleranceMs to subsequent ticks', async () => {
      const ctrl = makeController();
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

  describe('pv mode — AC load cap', () => {
    it('caps the charging current at the AC load cap instead of the surplus', async () => {
      const ctrl = makeController({ acLoadCapW: 11_000 });
      ctrl.setMode('pv');
      const client = makeClient();
      // surplus = 15000, Hauslast (ohne Wallbox) = 500 → available = min(15000, 11000-500) = 10500
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 16 });
      await ctrl.tick({ pvPower: 15500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(15); // floor(10500/690) = 15, nicht 16
      expect(ctrl.getLastDetails()).toEqual({
        surplusW: 10500,
        targetCurrentA: 15,
        reason: 'Lädt 3-phasig mit 15 A (Überschuss 10500 W) — AC-Limit aktiv',
      });
    });

    it('does not start despite a huge surplus when house load eats the cap', async () => {
      const ctrl = makeController({ acLoadCapW: 11_000 });
      ctrl.setMode('pv');
      const client = makeClient();
      // surplus = 10000, Hauslast = 10000 → available = min(10000, 1000) = 1000 < 1380
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 20_000, consumptionPower: 10_000 }, state, client, t0);
      await ctrl.tick({ pvPower: 20_000, consumptionPower: 10_000 }, state, client, t0 + TOLERANCE_MS);
      expect(client.startCharging).not.toHaveBeenCalled();
      expect(ctrl.getLastDetails()).toEqual({
        surplusW: 1000,
        targetCurrentA: null,
        reason: 'Zu wenig Überschuss (1000 W, benötigt 1380 W) — AC-Limit aktiv',
      });
    });

    it('stops charging via the tolerance timer when house load pushes past the cap', async () => {
      const ctrl = makeController({ acLoadCapW: 11_000 });
      ctrl.setMode('pv');
      const client = makeClient();
      // Wallbox zieht 1380 W (1-phasig 6 A); Hauslast 10000 W.
      // surplus = 12000 - 11380 + 1380 = 2000 ≥ 1380, aber available = min(2000, 11000-10000) = 1000 < 1380
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 6, powerW: 1380 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 12_000, consumptionPower: 11_380 }, state, client, t0);
      expect(client.stopCharging).not.toHaveBeenCalled();
      await ctrl.tick({ pvPower: 12_000, consumptionPower: 11_380 }, state, client, t0 + TOLERANCE_MS);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
    });

    it('gates the switch-up threshold on availableW, not surplus', async () => {
      const ctrl = makeController({ acLoadCapW: 4_800 });
      ctrl.setMode('pv');
      const client = makeClient();
      // Wallbox zieht 3680 W (1-phasig 16 A); Hauslast 500 W.
      // surplus = 10000 - 4180 + 3680 = 9500 ≥ 4440, aber available = min(9500, 4800-500) = 4300 < 4440
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16, powerW: 3680 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 10_000, consumptionPower: 4_180 }, state, client, t0);
      await ctrl.tick({ pvPower: 10_000, consumptionPower: 4_180 }, state, client, t0 + TOLERANCE_MS);
      expect(client.setPhases).not.toHaveBeenCalled(); // kein Hochschalten, Deckel hält available unter 4440
      expect(ctrl.getLastDetails()?.reason).toBe('Lädt 1-phasig mit 16 A (Überschuss 4300 W) — AC-Limit aktiv');
    });

    it('emits event payloads carrying availableW when capped', async () => {
      const started: unknown[] = [];
      const onStarted = (e: unknown) => started.push(e);
      energyEvents.on('wallbox:charging-started', onStarted as never);
      try {
        const ctrl = makeController({ acLoadCapW: 11_000 });
        ctrl.setMode('pv');
        const client = makeClient();
        const state = makeState({ status: 'available' });
        const t0 = 1_000_000;
        // surplus = 15000, Hauslast 500 → available = 10500 → 3-phasig floor(10500/690) = 15 A
        await ctrl.tick({ pvPower: 15_500, consumptionPower: 500 }, state, client, t0);
        await ctrl.tick({ pvPower: 15_500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
        expect(started).toEqual([{ phases: 3, currentA: 15, surplusW: 10500, capped: true }]);
      } finally {
        energyEvents.off('wallbox:charging-started', onStarted as never);
      }
    });

    it('updateConfig({ acLoadCapW }) applies to subsequent ticks', async () => {
      const ctrl = makeController(); // Deckel zunächst wirkungslos (100 kW)
      ctrl.updateConfig({ acLoadCapW: 11_000 });
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 16 });
      await ctrl.tick({ pvPower: 15_500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(15);
    });
  });

  describe('pv mode — event emissions', () => {
    afterEach(() => {
      energyEvents.removeAllListeners('wallbox:charging-started');
      energyEvents.removeAllListeners('wallbox:charging-stopped');
      energyEvents.removeAllListeners('wallbox:phases-switched');
    });

    function listen<T>(event: 'wallbox:charging-started' | 'wallbox:charging-stopped' | 'wallbox:phases-switched'): T[] {
      const received: T[] = [];
      energyEvents.on(event, ((e: T) => received.push(e)) as never);
      return received;
    }

    it('emits wallbox:charging-started with payload on a 3-phase start', async () => {
      const started = listen<{ phases: 1 | 3; currentA: number; surplusW: number }>('wallbox:charging-started');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      expect(started).toHaveLength(0); // countdown läuft noch
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(started).toEqual([{ phases: 3, currentA: 7, surplusW: 5000, capped: false }]);
    });

    it('emits wallbox:charging-started with payload on a 1-phase start', async () => {
      const started = listen<{ phases: 1 | 3; currentA: number; surplusW: number }>('wallbox:charging-started');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 3000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(started).toEqual([{ phases: 1, currentA: 10, surplusW: 2500, capped: false }]);
    });

    it('emits wallbox:charging-stopped when stopping due to insufficient surplus', async () => {
      const stopped = listen<{ surplusW: number }>('wallbox:charging-stopped');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0);
      expect(stopped).toHaveLength(0);
      await ctrl.tick({ pvPower: 1000, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(stopped).toEqual([{ surplusW: 500, capped: false }]);
    });

    it('emits wallbox:phases-switched on switch-up 1→3', async () => {
      const switched = listen<{ from: 1 | 3; to: 1 | 3; currentA: number; surplusW: number }>('wallbox:phases-switched');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 1, chargingCurrentA: 16 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(switched).toEqual([{ from: 1, to: 3, currentA: 8, surplusW: 6000, capped: false }]);
    });

    it('emits wallbox:phases-switched on switch-down 3→1', async () => {
      const switched = listen<{ from: 1 | 3; to: 1 | 3; currentA: number; surplusW: number }>('wallbox:phases-switched');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', phases: 3, chargingCurrentA: 6 });
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 3500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS);
      expect(switched).toEqual([{ from: 3, to: 1, currentA: 13, surplusW: 3000, capped: false }]);
    });

    it('does not emit anything when the off-mode stop runs (user action, not automation)', async () => {
      const stopped = listen<{ surplusW: number }>('wallbox:charging-stopped');
      const ctrl = makeController();
      ctrl.setMode('pv');
      ctrl.setMode('off');
      const client = makeClient();
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, makeState({ status: 'charging' }), client, 1_000_000);
      expect(client.stopCharging).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveLength(0);
    });

    it('does not emit anything during plain current regulation', async () => {
      const started = listen<unknown>('wallbox:charging-started');
      const switched = listen<unknown>('wallbox:phases-switched');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'charging', chargingCurrentA: 7 });
      await ctrl.tick({ pvPower: 6500, consumptionPower: 500 }, state, client, 1_000_000);
      expect(client.setChargingCurrent).toHaveBeenCalledWith(8);
      expect(started).toHaveLength(0);
      expect(switched).toHaveLength(0);
    });

    it('deduplicates charging-started while start attempts never result in actual charging (car full)', async () => {
      const started = listen<unknown>('wallbox:charging-started');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const state = makeState({ status: 'available' }); // bleibt dauerhaft nicht-ladend
      const t0 = 1_000_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS); // 1. Startversuch
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + TOLERANCE_MS + 1000);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, state, client, t0 + 2 * TOLERANCE_MS + 1000); // 2. Startversuch
      expect(client.startCharging).toHaveBeenCalledTimes(2); // Retries laufen weiter
      expect(started).toHaveLength(1); // aber nur eine Meldung
    });

    it('emits charging-started again after an actual charging phase was observed', async () => {
      const started = listen<unknown>('wallbox:charging-started');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const t0 = 1_000_000;
      const idle = makeState({ status: 'available' });
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t0 + TOLERANCE_MS); // Start 1 → Meldung 1
      // Ladung läuft wirklich → Merker wird zurückgesetzt
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, makeState({ status: 'charging', chargingCurrentA: 7 }), client, t0 + TOLERANCE_MS + 20_000);
      // Wolken → Stopp; später wieder Sonne → Start 2 → Meldung 2
      const t1 = t0 + TOLERANCE_MS + 40_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t1);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t1 + TOLERANCE_MS);
      expect(started).toHaveLength(2);
    });

    it('resets the started-dedupe when the vehicle is unplugged', async () => {
      const started = listen<unknown>('wallbox:charging-started');
      const ctrl = makeController();
      ctrl.setMode('pv');
      const client = makeClient();
      const t0 = 1_000_000;
      const idle = makeState({ status: 'available' });
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t0);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t0 + TOLERANCE_MS); // Meldung 1
      // Fahrzeug abgesteckt → Merker zurück
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, makeState({ status: 'available', vehicleConnected: false }), client, t0 + TOLERANCE_MS + 20_000);
      // wieder angesteckt, Überschuss da → nächster Start meldet wieder
      const t1 = t0 + TOLERANCE_MS + 40_000;
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t1);
      await ctrl.tick({ pvPower: 5500, consumptionPower: 500 }, idle, client, t1 + TOLERANCE_MS);
      expect(started).toHaveLength(2);
    });
  });
});
