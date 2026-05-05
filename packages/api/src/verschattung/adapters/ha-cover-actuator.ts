import type { CoverActuator } from '../ports.js';
import type { HaMqttListener } from '../../infra/ha/ha-mqtt-listener.js';
import type { HaMqttPublisher } from '../../infra/ha/ha-mqtt-publisher.js';

export class HaCoverActuator implements CoverActuator {
  private positions = new Map<string, number>();
  private observers = new Set<(id: string, pos: number) => void>();

  constructor(private listener: HaMqttListener, private publisher: HaMqttPublisher) {
    this.listener.on('coverPosition', ({ entityId, position }) => {
      this.positions.set(entityId, position);
      for (const cb of this.observers) cb(entityId, position);
    });
  }

  current(entityId: string): number | null {
    return this.positions.get(entityId) ?? null;
  }

  observePosition(cb: (id: string, pos: number) => void): void {
    this.observers.add(cb);
  }

  setPosition(entityId: string, position: number): Promise<void> {
    return this.publisher.callService('cover', 'set_cover_position', { entity_id: entityId, position });
  }
}
