import { energyEvents } from '../energy-events.js';
import type { WallboxState } from './types.js';

/**
 * Beobachtet den gepollten Wallbox-Zustand und meldet Stecker-Ereignisse.
 * Der erste beobachtete Zustand nach Serverstart wird nur gemerkt, nicht
 * gemeldet — sonst gäbe es bei jedem Neustart mit angestecktem Auto eine
 * falsche "angesteckt"-Meldung.
 */
export class WallboxVehicleWatcher {
  private lastConnected: boolean | null = null;

  observe(state: WallboxState): void {
    const connected = state.vehicleConnected;
    if (this.lastConnected !== null && connected !== this.lastConnected) {
      energyEvents.emit(connected ? 'wallbox:vehicle-plugged' : 'wallbox:vehicle-unplugged');
    }
    this.lastConnected = connected;
  }
}
