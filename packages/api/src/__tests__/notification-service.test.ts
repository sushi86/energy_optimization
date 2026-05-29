import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from '../notification-service.js';
import { energyEvents } from '../energy-events.js';
import type { NotificationPayload } from '../push-service.js';

class FakePushService {
  payloads: NotificationPayload[] = [];
  async sendNotification(payload: NotificationPayload): Promise<void> {
    this.payloads.push(payload);
  }
}

describe('NotificationService — manual-mode notifications', () => {
  let push: FakePushService;

  beforeEach(() => {
    energyEvents.removeAllListeners();
    push = new FakePushService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new NotificationService(push as any);
  });

  it('sends a push when switched to manual via external setpoint', () => {
    energyEvents.emit('controller:switched-to-manual', { trigger: 'external', setpointW: -3000 });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('mode-manual');
    expect(push.payloads[0].body).toContain('extern');
    expect(push.payloads[0].body).toContain('-3000');
  });

  it('sends a push when switched to manual via the UI', () => {
    energyEvents.emit('controller:switched-to-manual', { trigger: 'api', setpointW: null });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('mode-manual');
    expect(push.payloads[0].body).toContain('Web');
  });

  it('sends a push on manual discharge', () => {
    energyEvents.emit('controller:manual-discharge', { batterySoc: 73, batteryPowerW: -1234 });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('manual-discharge');
    expect(push.payloads[0].body).toContain('73');
    expect(push.payloads[0].body).toContain('1234');
  });

  it('sends a push when auto is restored', () => {
    energyEvents.emit('controller:auto-restored', { batterySoc: 50 });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('auto-restored');
    expect(push.payloads[0].body).toContain('50');
  });
});
