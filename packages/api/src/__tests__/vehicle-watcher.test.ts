import { describe, it, expect, beforeEach } from 'vitest';
import { WallboxVehicleWatcher } from '../wallbox/VehicleWatcher.js';
import { energyEvents } from '../energy-events.js';
import type { WallboxState } from '../wallbox/types.js';

// Der Watcher liest ausschließlich vehicleConnected — ein minimaler Cast genügt.
function state(vehicleConnected: boolean): WallboxState {
  return { vehicleConnected } as WallboxState;
}

describe('WallboxVehicleWatcher', () => {
  let plugged: number;
  let unplugged: number;

  beforeEach(() => {
    energyEvents.removeAllListeners('wallbox:vehicle-plugged');
    energyEvents.removeAllListeners('wallbox:vehicle-unplugged');
    plugged = 0;
    unplugged = 0;
    energyEvents.on('wallbox:vehicle-plugged', () => plugged++);
    energyEvents.on('wallbox:vehicle-unplugged', () => unplugged++);
  });

  it('does not emit on the first observed state after startup', () => {
    const watcher = new WallboxVehicleWatcher();
    watcher.observe(state(true));
    expect(plugged).toBe(0);
    expect(unplugged).toBe(0);
  });

  it('emits vehicle-plugged exactly once on false→true', () => {
    const watcher = new WallboxVehicleWatcher();
    watcher.observe(state(false));
    watcher.observe(state(true));
    expect(plugged).toBe(1);
    expect(unplugged).toBe(0);
  });

  it('emits vehicle-unplugged exactly once on true→false', () => {
    const watcher = new WallboxVehicleWatcher();
    watcher.observe(state(true));
    watcher.observe(state(false));
    expect(unplugged).toBe(1);
    expect(plugged).toBe(0);
  });

  it('does not emit while the state is unchanged', () => {
    const watcher = new WallboxVehicleWatcher();
    watcher.observe(state(true));
    watcher.observe(state(true));
    watcher.observe(state(true));
    expect(plugged).toBe(0);
    expect(unplugged).toBe(0);
  });
});
