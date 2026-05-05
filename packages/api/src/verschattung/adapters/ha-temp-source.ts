import type { IndoorTempSource } from '../ports.js';
import type { HaMqttListener } from '../../infra/ha/ha-mqtt-listener.js';

export class HaTempSource implements IndoorTempSource {
  private value: number | null = null;
  private observers = new Set<(v: number) => void>();

  constructor(listener: HaMqttListener, private entityId: string) {
    listener.on('sensorValue', ({ entityId, value }) => {
      if (entityId !== this.entityId) return;
      this.value = value;
      for (const cb of this.observers) cb(value);
    });
  }

  current(): number | null { return this.value; }
  observe(cb: (v: number) => void): void { this.observers.add(cb); }
}
