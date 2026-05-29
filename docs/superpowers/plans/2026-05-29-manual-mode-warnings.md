# Manual-Mode Warnings & 50% Auto-Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-Benachrichtigungen beim Wechsel in den Manuell-Modus, eine sich alle 10 min wiederholende Warnung solange der Manuell-Modus den Akku entlädt, und ein automatischer Rückwechsel auf Auto (mit Push) wenn der Akku im Manuell-Modus auf eine konfigurierbare Schwelle (Default 50 %) entladen wird.

**Architecture:** Folgt dem bestehenden Muster `energyEvents` (typisierter Event-Bus) → `NotificationService` → `PushService`. Drei neue Events. Der `Controller` emittiert `controller:switched-to-manual` an seinen beiden Übergangspunkten. Ein neuer `ManualModeTracker` (analog `PvTracker`) wird pro `regulate()`-Tick aufgerufen und emittiert die Entlade-Warnung bzw. löst den Auto-Rückwechsel aus. Eine neue konfigurierbare Einstellung `manualModeFloorPercent` steuert die Schwelle.

**Tech Stack:** TypeScript (ESM, `.js`-Endungen in Imports), Node `EventEmitter`, Vitest, Fastify (API), Zod (Config), Next.js/React (Web-Settings).

**Spec:** `docs/superpowers/specs/2026-05-29-manual-mode-warnings-design.md`

**Tests ausführen:** aus dem Repo-Root `pnpm --filter @energy-control/api test -- --run` (oder `pnpm test`). Einzelne Datei: `pnpm --filter @energy-control/api test -- --run src/__tests__/<file>`.

---

## File Structure

- **Create** `packages/api/src/manual-mode-tracker.ts` — Tracker mit Timing-Zustand für die 10-min-Warnung und der 50%-Auto-Rückwechsel-Logik.
- **Create** `packages/api/src/__tests__/manual-mode-tracker.test.ts` — Unit-Tests des Trackers.
- **Create** `packages/api/src/__tests__/notification-service.test.ts` — Tests der neuen Notification-Handler.
- **Modify** `packages/api/src/energy-events.ts` — drei neue Event-Typen + Map-Einträge.
- **Modify** `packages/api/src/controller.ts` — Emission von `controller:switched-to-manual` an den Übergangspunkten.
- **Modify** `packages/api/src/__tests__/controller.test.ts` — Tests der Controller-Emission.
- **Modify** `packages/api/src/notification-service.ts` — drei neue Handler.
- **Modify** `packages/api/src/config.ts` — `MANUAL_MODE_FLOOR_PERCENT` env.
- **Modify** `packages/api/src/app-state.ts` — `manualModeFloorPercent` in `AppStateOptions`, Persistenz, Tracker-Referenz + Aufruf in `regulate()`.
- **Modify** `packages/api/src/index.ts` — Config durchreichen, Tracker erzeugen + setzen.
- **Modify** `packages/api/src/server.ts` — `manualModeFloorPercent` in `GET`/`PUT /api/config`.
- **Modify** `packages/web/app/settings/page.tsx` — beschriftetes Eingabefeld + Ausschluss aus generischem Renderer.

---

## Task 1: Drei neue Events im Event-Bus

**Files:**
- Modify: `packages/api/src/energy-events.ts`

- [ ] **Step 1: Event-Typen + Map-Einträge hinzufügen**

In `packages/api/src/energy-events.ts` nach dem `TemperatureHighEvent`-Interface (vor `interface EnergyEventMap`) einfügen:

```ts
export interface SwitchedToManualEvent {
  trigger: 'external' | 'api';
  setpointW: number | null;
}

export interface ManualDischargeEvent {
  batterySoc: number;
  batteryPowerW: number;
}

export interface AutoRestoredEvent {
  batterySoc: number;
}
```

Dann den `EnergyEventMap`-Block um drei Einträge erweitern, sodass er so aussieht:

```ts
interface EnergyEventMap {
  'pv:morning-briefing': [MorningBriefingEvent];
  'pv:production-ended': [ProductionEndedEvent];
  'mppt:temperature-high': [TemperatureHighEvent];
  'controller:switched-to-manual': [SwitchedToManualEvent];
  'controller:manual-discharge': [ManualDischargeEvent];
  'controller:auto-restored': [AutoRestoredEvent];
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @energy-control/api exec tsc --noEmit`
Expected: PASS (keine Fehler). Es ändert sich nur die Typdefinition; bestehende Aufrufe bleiben gültig.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/energy-events.ts
git commit -m "feat(events): add controller manual-mode events"
```

---

## Task 2: Controller emittiert `switched-to-manual`

Der Controller emittiert beim echten Übergang `≠ manual → manual` — einmal pro Übergang, nicht bei wiederholtem externem Schreiben.

**Files:**
- Modify: `packages/api/src/controller.ts:101-107` (`handleExternalSetpointChange`), `controller.ts:86-91` (`setMode`), Import oben
- Test: `packages/api/src/__tests__/controller.test.ts`

- [ ] **Step 1: Failing tests schreiben**

Den Import `import { energyEvents } from '../energy-events.js';` oben zu den bestehenden Imports hinzufügen. Diesen Block als neues, eigenständiges Top-Level-`describe` ganz **ans Dateiende** anhängen (nach dem letzten `});` der Datei — die Datei hat ein umschließendes `describe`, der neue Block wird ein Geschwister-Block davon):

```ts
describe('manual mode switch notifications', () => {
  it('emits switched-to-manual with external trigger on external setpoint change', () => {
    const c = makeController();
    const calls: Array<{ trigger: string; setpointW: number | null }> = [];
    const listener = (e: { trigger: string; setpointW: number | null }) => calls.push(e);
    energyEvents.on('controller:switched-to-manual', listener);
    c.handleExternalSetpointChange(-3000);
    energyEvents.off('controller:switched-to-manual', listener);
    expect(calls).toEqual([{ trigger: 'external', setpointW: -3000 }]);
  });

  it('does not re-emit when an external change arrives while already manual', () => {
    const c = makeController();
    c.handleExternalSetpointChange(-3000);
    const calls: unknown[] = [];
    const listener = (e: unknown) => calls.push(e);
    energyEvents.on('controller:switched-to-manual', listener);
    c.handleExternalSetpointChange(-2000);
    energyEvents.off('controller:switched-to-manual', listener);
    expect(calls).toHaveLength(0);
  });

  it('emits switched-to-manual with api trigger on setMode("manual")', () => {
    const c = makeController();
    const calls: Array<{ trigger: string; setpointW: number | null }> = [];
    const listener = (e: { trigger: string; setpointW: number | null }) => calls.push(e);
    energyEvents.on('controller:switched-to-manual', listener);
    c.setMode('manual');
    energyEvents.off('controller:switched-to-manual', listener);
    expect(calls).toEqual([{ trigger: 'api', setpointW: null }]);
  });

  it('does not emit when setMode is called with a non-manual mode', () => {
    const c = makeController();
    const calls: unknown[] = [];
    const listener = (e: unknown) => calls.push(e);
    energyEvents.on('controller:switched-to-manual', listener);
    c.setMode('winter');
    energyEvents.off('controller:switched-to-manual', listener);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/controller.test.ts`
Expected: Die vier neuen Tests schlagen fehl (`calls` bleibt leer bzw. erwartetes Event wird nicht emittiert).

- [ ] **Step 3: Import in controller.ts ergänzen**

Oben in `packages/api/src/controller.ts` nach den bestehenden `import type`-Zeilen hinzufügen:

```ts
import { energyEvents } from './energy-events.js';
```

- [ ] **Step 4: `setMode` anpassen**

`setMode` (`controller.ts:86`) ersetzen durch:

```ts
  setMode(mode: ControllerMode): void {
    if (this.mode !== mode) {
      console.log(`[controller] Mode changed: ${this.mode} → ${mode}`);
      if (mode === 'manual') {
        energyEvents.emit('controller:switched-to-manual', { trigger: 'api', setpointW: null });
      }
    }
    this.mode = mode;
  }
```

- [ ] **Step 5: `handleExternalSetpointChange` anpassen**

`handleExternalSetpointChange` (`controller.ts:101`) ersetzen durch:

```ts
  handleExternalSetpointChange(valueW: number): void {
    if (this.mode !== 'manual') {
      console.log(`[controller] External setpoint change detected (${fmtW(valueW)}) — switching from ${this.mode} to manual`);
      energyEvents.emit('controller:switched-to-manual', { trigger: 'external', setpointW: valueW });
    }
    this.mode = 'manual';
    this.lastAppliedSetpoint = valueW;
  }
```

- [ ] **Step 6: Tests laufen lassen, Erfolg prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/controller.test.ts`
Expected: Alle Tests (inkl. der vier neuen) PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat(controller): emit switched-to-manual on transition into manual mode"
```

---

## Task 3: ManualModeTracker (10-min-Warnung + 50%-Auto-Rückwechsel)

**Files:**
- Create: `packages/api/src/manual-mode-tracker.ts`
- Test: `packages/api/src/__tests__/manual-mode-tracker.test.ts`

- [ ] **Step 1: Failing tests schreiben**

Datei `packages/api/src/__tests__/manual-mode-tracker.test.ts` anlegen:

```ts
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
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/manual-mode-tracker.test.ts`
Expected: FAIL — Modul `../manual-mode-tracker.js` existiert nicht.

- [ ] **Step 3: Tracker implementieren**

Datei `packages/api/src/manual-mode-tracker.ts` anlegen:

```ts
import { energyEvents } from './energy-events.js';
import type { ControllerMode } from './controller.js';

/** Battery power below this (W) counts as discharging (negative = discharge). */
const DISCHARGE_THRESHOLD_W = -100;
/** Repeat the manual-discharge warning at most every 10 minutes. */
const WARN_INTERVAL_MS = 10 * 60 * 1000;

export interface ManualModeCheckContext {
  mode: ControllerMode;
  batterySoc: number;
  batteryPowerW: number;
  /** SOC threshold at/below which manual discharge forces a switch back to auto. */
  manualModeFloorPercent: number;
  /** Called to switch the controller back to auto (e.g. () => controller.setMode('auto')). */
  switchToAuto: () => void;
}

/**
 * Monitors the manual mode during each regulation tick.
 *
 * - While manual mode discharges the battery, emits `controller:manual-discharge`
 *   immediately at the start of each discharge phase and then at most every 10 min.
 * - When manual mode discharges at/below `manualModeFloorPercent`, switches the
 *   controller back to auto and emits `controller:auto-restored`.
 */
export class ManualModeTracker {
  private lastWarnAt: number | null = null;

  check(ctx: ManualModeCheckContext, now: number = Date.now()): void {
    const isManual = ctx.mode === 'manual';
    const isDischarging = ctx.batteryPowerW < DISCHARGE_THRESHOLD_W;

    // Safety: manual discharge at/below floor → back to auto (evaluated before the warning)
    if (isManual && isDischarging && ctx.batterySoc <= ctx.manualModeFloorPercent) {
      ctx.switchToAuto();
      energyEvents.emit('controller:auto-restored', { batterySoc: ctx.batterySoc });
      this.lastWarnAt = null;
      return;
    }

    // Recurring warning while manual mode discharges the battery
    if (isManual && isDischarging) {
      if (this.lastWarnAt === null || now - this.lastWarnAt >= WARN_INTERVAL_MS) {
        energyEvents.emit('controller:manual-discharge', {
          batterySoc: ctx.batterySoc,
          batteryPowerW: ctx.batteryPowerW,
        });
        this.lastWarnAt = now;
      }
      return;
    }

    // Condition no longer holds — reset so the next discharge phase warns immediately
    this.lastWarnAt = null;
  }
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/manual-mode-tracker.test.ts`
Expected: Alle Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/manual-mode-tracker.ts packages/api/src/__tests__/manual-mode-tracker.test.ts
git commit -m "feat(controller): add ManualModeTracker for discharge warning and 50% auto-restore"
```

---

## Task 4: NotificationService-Handler für die drei Events

**Files:**
- Modify: `packages/api/src/notification-service.ts`
- Test: `packages/api/src/__tests__/notification-service.test.ts` (neu)

- [ ] **Step 1: Failing tests schreiben**

Datei `packages/api/src/__tests__/notification-service.test.ts` anlegen:

```ts
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
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/notification-service.test.ts`
Expected: FAIL — keine Push-Payloads, da die Handler noch nicht registriert sind.

- [ ] **Step 3: Handler implementieren**

In `packages/api/src/notification-service.ts` die Import-Zeile oben erweitern, sodass die neuen Event-Typen mit importiert werden:

```ts
import { energyEvents, type MorningBriefingEvent, type ProductionEndedEvent, type TemperatureHighEvent, type SwitchedToManualEvent, type ManualDischargeEvent, type AutoRestoredEvent } from './energy-events.js';
```

Im Konstruktor nach der Zeile `energyEvents.on('mppt:temperature-high', ...)` drei Registrierungen ergänzen:

```ts
    energyEvents.on('controller:switched-to-manual', (event) => this.handleSwitchedToManual(event));
    energyEvents.on('controller:manual-discharge', (event) => this.handleManualDischarge(event));
    energyEvents.on('controller:auto-restored', (event) => this.handleAutoRestored(event));
```

Nach der Methode `handleTemperatureHigh` (vor der schließenden Klammer der Klasse) drei Methoden einfügen:

```ts
  private handleSwitchedToManual(event: SwitchedToManualEvent): void {
    const body = event.trigger === 'external'
      ? `⚠️ Auf Manuell gewechselt — externer Setpoint (${event.setpointW ?? '?'} W)`
      : `⚠️ Auf Manuell gewechselt — über die Web-Oberfläche`;

    void this.pushService.sendNotification({
      title: 'Manueller Modus',
      body,
      url: '/',
      tag: 'mode-manual',
    });
  }

  private handleManualDischarge(event: ManualDischargeEvent): void {
    void this.pushService.sendNotification({
      title: 'Manueller Modus',
      body: `🔋 Manueller Modus entlädt den Akku — SOC ${event.batterySoc.toFixed(0)} %, ${Math.abs(event.batteryPowerW).toFixed(0)} W`,
      url: '/',
      tag: 'manual-discharge',
    });
  }

  private handleAutoRestored(event: AutoRestoredEvent): void {
    void this.pushService.sendNotification({
      title: 'Zurück auf Automatik',
      body: `✅ Zurück auf Automatik — Akku bei ${event.batterySoc.toFixed(0)} % (Manuell-Schutz)`,
      url: '/',
      tag: 'auto-restored',
    });
  }
```

- [ ] **Step 4: Tests laufen lassen, Erfolg prüfen**

Run: `pnpm --filter @energy-control/api test -- --run src/__tests__/notification-service.test.ts`
Expected: Alle vier Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/notification-service.ts packages/api/src/__tests__/notification-service.test.ts
git commit -m "feat(notifications): push on manual switch, manual discharge, and auto-restore"
```

---

## Task 5: Konfigurierbare Schwelle `manualModeFloorPercent`

Schwelle als Einstellung mit Default 50, über env steuerbar, persistiert und in der Config-API sichtbar/änderbar.

**Files:**
- Modify: `packages/api/src/config.ts`
- Modify: `packages/api/src/app-state.ts` (`AppStateOptions`, `saveConfigOverrides`)
- Modify: `packages/api/src/index.ts` (Mapping in `AppState.create`)
- Modify: `packages/api/src/server.ts` (`GET`/`PUT /api/config`)
- Modify: `packages/api/src/__tests__/websocket.test.ts`, `packages/api/src/__tests__/api-endpoints.test.ts` (Pflichtfeld in `AppState.create`-Aufrufen)

- [ ] **Step 1: env in config.ts ergänzen**

In `packages/api/src/config.ts` im `configSchema` nach der Zeile `ACTIVE_MORNING_DISCHARGE_MIN_SOC_PERCENT: z.coerce.number().default(5),` einfügen:

```ts
  MANUAL_MODE_FLOOR_PERCENT: z.coerce.number().default(50),
```

- [ ] **Step 2: AppStateOptions erweitern**

In `packages/api/src/app-state.ts` im `interface AppStateOptions` nach `multiplusRatedPowerW: number;` einfügen:

```ts
  manualModeFloorPercent: number;
```

- [ ] **Step 3: Persistenz ergänzen**

In `packages/api/src/app-state.ts` in `saveConfigOverrides()` im `persistable`-Objekt nach `multiplusRatedPowerW: this.config.multiplusRatedPowerW,` einfügen:

```ts
      manualModeFloorPercent: this.config.manualModeFloorPercent,
```

(`loadConfigOverrides()` und `getConfig()` übernehmen das Feld automatisch via `Object.assign` bzw. Spread — keine Änderung nötig.)

- [ ] **Step 4: Mapping in index.ts ergänzen**

In `packages/api/src/index.ts` im `AppState.create({...})`-Aufruf nach `multiplusRatedPowerW: 4000,` einfügen:

```ts
    manualModeFloorPercent: config.MANUAL_MODE_FLOOR_PERCENT,
```

- [ ] **Step 5: Config-API ergänzen**

In `packages/api/src/server.ts` im Rückgabeobjekt von `GET /api/config` (nach `activeMorningDischargeMinSocPercent: c.activeMorningDischargeMinSocPercent,`) einfügen:

```ts
      manualModeFloorPercent: c.manualModeFloorPercent,
```

Im Rückgabeobjekt von `PUT /api/config` (nach `activeMorningDischargeMinSocPercent: updated.activeMorningDischargeMinSocPercent,`, vor der schließenden `};`) einfügen:

```ts
      manualModeFloorPercent: updated.manualModeFloorPercent,
```

(Der `PUT`-Handler übergibt `request.body` unverändert an `state.updateConfig(body)`, das `Object.assign` nutzt — das neue Feld wird damit ohne weitere Änderung übernommen.)

- [ ] **Step 6: Pflichtfeld in den beiden Test-Aufrufen ergänzen**

Da `manualModeFloorPercent` jetzt Pflicht in `AppStateOptions` ist, bricht `tsc` an den zwei Test-Stellen, die ein vollständiges Options-Objekt bauen. In **beiden** Dateien — `packages/api/src/__tests__/websocket.test.ts` und `packages/api/src/__tests__/api-endpoints.test.ts` — im `AppState.create({...})`-Aufruf nach der Zeile `multiplusRatedPowerW: 4000,` einfügen:

```ts
      manualModeFloorPercent: 50,
```

- [ ] **Step 7: Typecheck + bestehende Tests**

Run: `pnpm --filter @energy-control/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @energy-control/api test -- --run`
Expected: Alle Tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/config.ts packages/api/src/app-state.ts packages/api/src/index.ts packages/api/src/server.ts packages/api/src/__tests__/websocket.test.ts packages/api/src/__tests__/api-endpoints.test.ts
git commit -m "feat(config): add configurable manualModeFloorPercent (default 50)"
```

---

## Task 6: ManualModeTracker in AppState/regulate verdrahten

**Files:**
- Modify: `packages/api/src/app-state.ts` (Import, Feld, Setter, Aufruf in `regulate()`)
- Modify: `packages/api/src/index.ts` (Tracker erzeugen + setzen)

- [ ] **Step 1: Import + Feld in app-state.ts**

In `packages/api/src/app-state.ts` bei den Imports oben hinzufügen:

```ts
import type { ManualModeTracker } from './manual-mode-tracker.js';
```

In der Klasse `AppState` zu den privaten Feldern (z. B. nach `private pvTracker: PvTracker | null = null;`) hinzufügen:

```ts
  private manualModeTracker: ManualModeTracker | null = null;
```

- [ ] **Step 2: Setter ergänzen**

In `packages/api/src/app-state.ts` direkt nach der Methode `setPvTracker(...)` einfügen:

```ts
  setManualModeTracker(tracker: ManualModeTracker): void {
    this.manualModeTracker = tracker;
  }
```

- [ ] **Step 3: Aufruf in regulate() einfügen**

In `packages/api/src/app-state.ts` in `regulate()` direkt nach dem schließenden `}` des `if (this.pvTracker) { ... }`-Blocks und **vor** der Zeile `if (result.mode === 'manual') return;` einfügen:

```ts
    if (this.manualModeTracker) {
      this.manualModeTracker.check({
        mode: result.mode,
        batterySoc: systemState.batterySoc,
        batteryPowerW: systemState.batteryPower,
        manualModeFloorPercent: this.config.manualModeFloorPercent,
        switchToAuto: () => this.controller.setMode('auto'),
      });
    }
```

Hinweis: Der Tracker läuft bewusst vor dem `return` im Manuell-Modus. Ein durch die 50%-Logik ausgelöster `setMode('auto')` greift erst beim nächsten Tick (~20 s) für die tatsächliche Sollwert-Berechnung — die Push-Benachrichtigung erfolgt sofort.

- [ ] **Step 4: Tracker in index.ts erzeugen + setzen**

In `packages/api/src/index.ts` den Import ergänzen (bei den übrigen Imports oben):

```ts
import { ManualModeTracker } from './manual-mode-tracker.js';
```

Im Push-Notifications-Block nach `const pvTracker = new PvTracker();` einfügen:

```ts
  const manualModeTracker = new ManualModeTracker();
```

Nach `appState.setPvTracker(pvTracker, gridHistoryService, pvHistoryService);` einfügen:

```ts
  appState.setManualModeTracker(manualModeTracker);
```

- [ ] **Step 5: Typecheck + volle Testsuite**

Run: `pnpm --filter @energy-control/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @energy-control/api test -- --run`
Expected: Alle Tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/app-state.ts packages/api/src/index.ts
git commit -m "feat(controller): wire ManualModeTracker into regulation loop"
```

---

## Task 7: Web-Settings-Feld für die Schwelle

**Files:**
- Modify: `packages/web/app/settings/page.tsx`

- [ ] **Step 1: Feld aus dem generischen Renderer ausnehmen**

In `packages/web/app/settings/page.tsx` die `if (...)`-Zeile im generischen Config-Renderer (die mit `key === 'activeMorningDischargeMinSocPercent'` endet) um eine Bedingung erweitern, sodass sie endet mit:

```tsx
              if (typeof value === 'object' || typeof value === 'boolean' || key === 'feedInRateCentPerKwh' || key === 'preferredMaxChargeW' || key === 'consumptionDayW' || key === 'consumptionNightW' || key === 'multiplusRatedPowerW' || key === 'activeMorningDischargeMinSocPercent' || key === 'manualModeFloorPercent') return null;
```

- [ ] **Step 2: Beschriftetes Eingabefeld hinzufügen**

In `packages/web/app/settings/page.tsx` direkt nach dem schließenden `</div>` der „Einspeisevergütung"-Karte (dem Block, der mit dem Kommentar `{/* Feed-in Rate */}` beginnt) eine neue Karte einfügen:

```tsx
      {/* Manual-Mode Auto-Restore */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Manuell-Modus Auto-Rückwechsel</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Entlädt der Manuell-Modus den Akku bis auf diesen SOC, wird automatisch auf Automatik zurückgeschaltet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number(config?.manualModeFloorPercent ?? 50)}
              onChange={(e) => updateConfigField('manualModeFloorPercent', e.target.value)}
              onBlur={(e) => flushConfigField('manualModeFloorPercent', e.target.value)}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">%</span>
            <SavedTick visible={!!savedFlash.manualModeFloorPercent} />
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Web-Build/Lint prüfen**

Run: `pnpm --filter @energy-control/web exec tsc --noEmit`
Expected: PASS. (`config` ist `{[key: string]: unknown}`, daher ist `Number(config?.manualModeFloorPercent ?? 50)` typkorrekt; `updateConfigField`/`flushConfigField`/`savedFlash`/`SavedTick` existieren bereits.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/settings/page.tsx
git commit -m "feat(web): add manual-mode auto-restore threshold setting"
```

---

## Task 8: Gesamtverifikation

- [ ] **Step 1: Volle Testsuite + Typecheck (API)**

Run: `pnpm --filter @energy-control/api test -- --run`
Expected: Alle Tests PASS.

Run: `pnpm --filter @energy-control/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Web-Typecheck**

Run: `pnpm --filter @energy-control/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manuelle Plausibilitätsprüfung (optional, lokal)**

`GET /api/config` enthält `manualModeFloorPercent`; ein `PUT /api/config` mit `{ "manualModeFloorPercent": 55 }` wird gespeichert (`data/config-overrides.json`) und bei `GET` zurückgegeben.

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Feature 1 → Tasks 1,2,4. Feature 2 → Tasks 1,3,4,6. Feature 3 → Tasks 1,3,4,5,6,7. Verdrahtung → Tasks 5,6. Tests → Tasks 2,3,4.
- **Reihenfolge im Tick** (50%-Prüfung vor Entlade-Warnung) ist in `ManualModeTracker.check` durch die Anordnung der `if`-Blöcke umgesetzt und in Task 3 getestet.
- **Typkonsistenz:** Eventnamen `controller:switched-to-manual` / `controller:manual-discharge` / `controller:auto-restored` und Payload-Felder (`trigger`, `setpointW`, `batterySoc`, `batteryPowerW`) sind über Tasks 1–6 identisch verwendet.
- **`auto-restored` nur aus dem Tracker:** `setMode('auto')` emittiert nichts (Task 2 ändert nur den `manual`-Zweig) — ein UI-Wechsel auf Auto löst keine Push aus.
