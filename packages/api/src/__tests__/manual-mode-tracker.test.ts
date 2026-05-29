import { describe, it, expect, beforeEach } from 'vitest';
import { ManualModeTracker, type ManualModeCheckContext } from '../manual-mode-tracker.js';
import { energyEvents } from '../energy-events.js';

const WARN_INTERVAL_MS = 10 * 60 * 1000;

function ctx(overrides: Partial<ManualModeCheckContext> = {}): ManualModeCheckContext {
  return {
    mode: 'manual',
    batterySoc: 80,
    batteryPowerW: -500,
    manualModeFloorPercent: 50,
    switchToAuto: () => {},
    ...overrides,
  };
}

function capture<T>(event: 'controller:manual-discharge' | 'controller:auto-restored'): T[] {
  const calls: T[] = [];
  energyEvents.on(event, (e) => calls.push(e as T));
  return calls;
}

describe('ManualModeTracker', () => {
  beforeEach(() => {
    energyEvents.removeAllListeners();
  });

  it('emits manual-discharge immediately at the start of a discharge phase', () => {
    const tracker = new ManualModeTracker();
    const calls = capture<{ batterySoc: number; batteryPowerW: number }>('controller:manual-discharge');
    tracker.check(ctx(), 0);
    expect(calls).toEqual([{ batterySoc: 80, batteryPowerW: -500 }]);
  });

  it('does not re-emit before 10 minutes have passed', () => {
    const tracker = new ManualModeTracker();
    const calls = capture('controller:manual-discharge');
    tracker.check(ctx(), 0);
    tracker.check(ctx(), WARN_INTERVAL_MS - 1);
    expect(calls).toHaveLength(1);
  });

  it('re-emits once 10 minutes have passed', () => {
    const tracker = new ManualModeTracker();
    const calls = capture('controller:manual-discharge');
    tracker.check(ctx(), 0);
    tracker.check(ctx(), WARN_INTERVAL_MS);
    expect(calls).toHaveLength(2);
  });

  it('resets when discharge stops, so the next phase warns immediately', () => {
    const tracker = new ManualModeTracker();
    const calls = capture('controller:manual-discharge');
    tracker.check(ctx({ batteryPowerW: -500 }), 0);
    tracker.check(ctx({ batteryPowerW: 0 }), 60_000);      // charging/idle: condition clears
    tracker.check(ctx({ batteryPowerW: -500 }), 120_000);  // new discharge phase
    expect(calls).toHaveLength(2);
  });

  it('resets when leaving manual mode, so the next manual discharge warns immediately', () => {
    const tracker = new ManualModeTracker();
    const calls = capture('controller:manual-discharge');
    tracker.check(ctx({ mode: 'manual', batteryPowerW: -500 }), 0);
    tracker.check(ctx({ mode: 'auto', batteryPowerW: -500 }), 60_000);
    tracker.check(ctx({ mode: 'manual', batteryPowerW: -500 }), 120_000);
    expect(calls).toHaveLength(2);
  });

  it('switches to auto and emits auto-restored when discharging at/below the floor', () => {
    const tracker = new ManualModeTracker();
    const restored = capture<{ batterySoc: number }>('controller:auto-restored');
    const discharge = capture('controller:manual-discharge');
    let switched = false;
    tracker.check(ctx({ batterySoc: 50, batteryPowerW: -500, switchToAuto: () => { switched = true; } }), 0);
    expect(switched).toBe(true);
    expect(restored).toEqual([{ batterySoc: 50 }]);
    expect(discharge).toHaveLength(0);
  });

  it('does not switch to auto when below floor but not discharging', () => {
    const tracker = new ManualModeTracker();
    const restored = capture('controller:auto-restored');
    let switched = false;
    tracker.check(ctx({ batterySoc: 40, batteryPowerW: 200, switchToAuto: () => { switched = true; } }), 0);
    expect(switched).toBe(false);
    expect(restored).toHaveLength(0);
  });

  it('keeps warning (no switch) while discharging above the floor', () => {
    const tracker = new ManualModeTracker();
    const restored = capture('controller:auto-restored');
    const discharge = capture('controller:manual-discharge');
    let switched = false;
    tracker.check(ctx({ batterySoc: 80, batteryPowerW: -500, switchToAuto: () => { switched = true; } }), 0);
    expect(switched).toBe(false);
    expect(restored).toHaveLength(0);
    expect(discharge).toHaveLength(1);
  });

  it('does nothing when not in manual mode', () => {
    const tracker = new ManualModeTracker();
    const discharge = capture('controller:manual-discharge');
    const restored = capture('controller:auto-restored');
    tracker.check(ctx({ mode: 'auto', batterySoc: 40, batteryPowerW: -500 }), 0);
    expect(discharge).toHaveLength(0);
    expect(restored).toHaveLength(0);
  });
});
