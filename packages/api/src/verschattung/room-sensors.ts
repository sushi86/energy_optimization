import type { HaMqttListener } from '../infra/ha/ha-mqtt-listener.js';
import { ROOMS, type RoomDef } from './rooms.js';

export interface RoomSnapshot {
  id: string;
  floor: 'EG' | 'OG';
  label: string;
  tempC: number | null;
  humidity: number | null;
}

/**
 * Subscribes to a fixed set of HA sensor entities (one temp + optional
 * humidity per room) and exposes the latest values for the UI. Has no
 * relation to the engine rule logic — pure display.
 */
export class RoomSensorRegistry {
  private temp = new Map<string, number>();
  private humidity = new Map<string, number>();

  constructor(listener: HaMqttListener, private rooms: RoomDef[] = ROOMS) {
    listener.on('sensorValue', ({ entityId, value }) => {
      for (const r of this.rooms) {
        if (r.tempEntity === entityId) this.temp.set(r.id, value);
        if (r.humidityEntity === entityId) this.humidity.set(r.id, value);
      }
    });
  }

  snapshot(): RoomSnapshot[] {
    return this.rooms.map((r) => ({
      id: r.id,
      floor: r.floor,
      label: r.label,
      tempC: this.temp.get(r.id) ?? null,
      humidity: this.humidity.get(r.id) ?? null,
    }));
  }
}
