import type { PvPowerSource } from '../ports.js';
import type { MqttService } from '../../mqtt-service.js';

export class VictronPvSource implements PvPowerSource {
  private observers = new Set<(w: number) => void>();

  constructor(private svc: MqttService) {
    this.svc.on('stateChange', () => {
      const w = this.svc.getState().pvPower;
      for (const cb of this.observers) cb(w);
    });
  }

  current(): number | null {
    const w = this.svc.getState().pvPower;
    return Number.isFinite(w) ? w : null;
  }

  observe(cb: (w: number) => void): void {
    this.observers.add(cb);
  }
}
