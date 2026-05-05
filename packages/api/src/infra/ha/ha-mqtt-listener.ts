import { EventEmitter } from 'events';
import type { HaMqttClient } from './ha-mqtt-client.js';

export interface CoverPositionEvent { entityId: string; position: number; }
export interface SensorValueEvent { entityId: string; value: number; }

interface Events {
  coverPosition: (e: CoverPositionEvent) => void;
  sensorValue: (e: SensorValueEvent) => void;
}

export class HaMqttListener extends EventEmitter {
  on<K extends keyof Events>(event: K, listener: Events[K]): this { return super.on(event, listener); }
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean { return super.emit(event, ...args); }

  constructor(private client: HaMqttClient) { super(); }

  start(): void {
    this.client.subscribe(['homeassistant/cover/#', 'homeassistant/sensor/#']);
    this.client.onMessage((topic, payload) => this.handle(topic, payload));
  }

  private handle(topic: string, payload: Buffer): void {
    const parts = topic.split('/');
    if (parts.length < 4) return;
    const [, domain, entity, leaf] = parts;
    const text = payload.toString('utf-8');

    if (domain === 'cover' && leaf === 'current_position') {
      const position = Number(text);
      if (!Number.isFinite(position)) return;
      this.emit('coverPosition', { entityId: `cover.${entity}`, position });
      return;
    }
    if (domain === 'sensor' && leaf === 'state') {
      const value = Number(text);
      if (!Number.isFinite(value)) return;
      this.emit('sensorValue', { entityId: `sensor.${entity}`, value });
      return;
    }
  }
}
