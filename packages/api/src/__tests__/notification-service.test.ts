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

describe('NotificationService — wallbox notifications', () => {
  let push: FakePushService;

  beforeEach(() => {
    energyEvents.removeAllListeners();
    push = new FakePushService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new NotificationService(push as any);
  });

  it('sends a push when pv charging starts', () => {
    energyEvents.emit('wallbox:charging-started', { phases: 3, currentA: 8, surplusW: 5600, capped: false });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].title).toBe('Wallbox');
    expect(push.payloads[0].tag).toBe('wallbox-charging');
    expect(push.payloads[0].body).toBe('🔌 Ladung gestartet — 3-phasig mit 8 A (Überschuss 5600 W)');
  });

  it('appends the AC-limit suffix when charging-started was capped', () => {
    energyEvents.emit('wallbox:charging-started', { phases: 3, currentA: 8, surplusW: 5600, capped: true });
    expect(push.payloads[0].body).toBe('🔌 Ladung gestartet — 3-phasig mit 8 A (Überschuss 5600 W) — AC-Limit aktiv');
  });

  it('sends a push when pv charging stops', () => {
    energyEvents.emit('wallbox:charging-stopped', { surplusW: 800, capped: false });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('wallbox-charging');
    expect(push.payloads[0].body).toBe('⏹️ Ladung gestoppt — Überschuss zu gering (800 W)');
  });

  it('appends the AC-limit suffix when charging-stopped was capped', () => {
    energyEvents.emit('wallbox:charging-stopped', { surplusW: 800, capped: true });
    expect(push.payloads[0].body).toBe('⏹️ Ladung gestoppt — Überschuss zu gering (800 W) — AC-Limit aktiv');
  });

  it('sends a push when the phases are switched', () => {
    energyEvents.emit('wallbox:phases-switched', { from: 3, to: 1, currentA: 13, surplusW: 3000, capped: false });
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('wallbox-phases');
    expect(push.payloads[0].body).toBe('⚡ Von 3- auf 1-phasig umgeschaltet (Überschuss 3000 W)');
  });

  it('appends the AC-limit suffix when phases-switched was capped', () => {
    energyEvents.emit('wallbox:phases-switched', { from: 3, to: 1, currentA: 13, surplusW: 3000, capped: true });
    expect(push.payloads[0].body).toBe('⚡ Von 3- auf 1-phasig umgeschaltet (Überschuss 3000 W) — AC-Limit aktiv');
  });

  it('sends a push when the vehicle is plugged in', () => {
    energyEvents.emit('wallbox:vehicle-plugged');
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('wallbox-vehicle');
    expect(push.payloads[0].body).toBe('🚗 Fahrzeug angesteckt');
  });

  it('sends a push when the vehicle is unplugged', () => {
    energyEvents.emit('wallbox:vehicle-unplugged');
    expect(push.payloads).toHaveLength(1);
    expect(push.payloads[0].tag).toBe('wallbox-vehicle');
    expect(push.payloads[0].body).toBe('🚗 Fahrzeug abgesteckt');
  });
});
