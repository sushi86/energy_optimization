# Manual-Mode Warnungen & 50%-Sicherheitsrückwechsel

**Datum:** 2026-05-29
**Status:** Design genehmigt

## Problem

Die Anlage wechselt in letzter Zeit mehrfach unerklärlich in den Manuell-Modus.
Der Wechsel ist nicht nachvollziehbar, und im Manuell-Modus gibt es keinen
Schutz gegen ein Leerlaufen des Akkus. Gewünscht:

1. Push-Benachrichtigung, wenn auf Manuell gewechselt wird.
2. Alle 10 min eine Warnung, solange der Manuell-Modus den Akku entlädt.
3. Bei Entladung ≤ 50 % automatischer Rückwechsel auf Auto — ebenfalls mit Push.

## Kontext: bestehende Architektur

- **Manuell-Eintritt:** Zwei Wege.
  - Externer Setpoint-Schreibzugriff auf dem MQTT-Topic →
    `Controller.handleExternalSetpointChange()` (`controller.ts:101`) setzt
    `mode = 'manual'`. Das ist mit hoher Wahrscheinlichkeit die Ursache der
    „unerklärlichen" Wechsel (VRM / Node-RED / andere App schreibt den Setpoint).
  - Bewusst über die Web-UI → `POST /api/controller/mode` → `setMode()`
    (`controller.ts:86`).
- **Manuell-Austritt:** Nur über die Web-UI. Kein automatischer Austritt.
- **Notification-Plumbing (wird wiederverwendet):**
  `energyEvents` (Event-Bus, `energy-events.ts`) → `NotificationService`
  (`notification-service.ts`) → `PushService` (web-push, `push-service.ts`).
- **Tracker-Muster:** `PvTracker` (`pv-tracker.ts`) hält Timing-Zustand und wird
  pro `regulate()`-Tick (~`REGULATION_INTERVAL_MS`, Default 20 s) aufgerufen;
  emittiert Events bei Bedingungen.
- **SystemState:** `batterySoc`, `batteryPower` (negativ = Entladung, Konvention
  aus `controller.ts:350` / `:518`: `batteryPower < -100` = entlädt), `mode`.
- **Config-Defaults:** `minSocPercent` Default 20 % → der 50%-Manuell-Floor liegt
  bewusst darüber und ist ein eigenständiger Schutz.

## Entscheidungen (mit Nutzer abgestimmt)

- **Manuell-Push:** Bei *beiden* Eintrittswegen, aber im Text gekennzeichnet
  (extern vs. Web-UI).
- **50%-Schwelle:** Konfigurierbar, Default 50 %.
- **50%-Trigger:** Nur wenn im Manuell-Modus *entladen* wird UND SOC ≤ Schwelle.
  Verhindert, dass Manuell unterhalb 50 % sofort blockiert wird.
- **10-min-Warnung:** Feuert *sofort* zu Beginn jeder Entladephase, danach alle
  10 min.
- **Entlade-Schwellwert:** `batteryPower < -100 W`.

## Feature 1 — Push bei Wechsel auf Manuell

**Event:** `controller:switched-to-manual`
```ts
interface SwitchedToManualEvent {
  trigger: 'external' | 'api';
  setpointW: number | null; // gesetzter Setpoint bei externem Wechsel, sonst null
}
```

**Emission im Controller** — nur beim echten Übergang `≠ manual → manual`
(verhindert Doppel-Emit bei wiederholtem externem Schreiben):
- `handleExternalSetpointChange(valueW)`: wenn `mode !== 'manual'` →
  emit `{ trigger: 'external', setpointW: valueW }`.
- `setMode('manual')`: wenn `mode !== 'manual'` →
  emit `{ trigger: 'api', setpointW: null }`.

Der Controller importiert `energyEvents`. In Unit-Tests ohne registrierten
`NotificationService` ist die Emission wirkungslos (keine Listener).

**Notification (NotificationService):**
- extern: Titel „Manueller Modus", Body
  „⚠️ Auf Manuell gewechselt — externer Setpoint (X W)".
- api: Titel „Manueller Modus", Body
  „Auf Manuell gewechselt — über die Web-Oberfläche".
- `tag: 'mode-manual'`, `url: '/'`.

## Feature 2 — 10-min-Warnung bei Manuell-Entladung

**Neuer `ManualModeTracker`** (`manual-mode-tracker.ts`), analog `PvTracker`.

`check(ctx)` mit
```ts
interface ManualModeCheckContext {
  mode: ControllerMode;
  batterySoc: number;
  batteryPowerW: number;
  manualModeFloorPercent: number;
  switchToAuto: () => void; // Callback, ruft controller.setMode('auto')
}
```

Konstanten: `DISCHARGE_THRESHOLD_W = -100`, `WARN_INTERVAL_MS = 10 * 60 * 1000`.

**Entlade-Warnung:**
- Bedingung: `mode === 'manual' && batteryPowerW < DISCHARGE_THRESHOLD_W`.
- Bei erstmaligem Erfüllen der Bedingung (Beginn einer Entladephase): sofort
  `controller:manual-discharge` emittieren und `lastWarnAt = now`.
- Danach erneut, sobald `now - lastWarnAt >= WARN_INTERVAL_MS`.
- Sobald die Bedingung nicht mehr gilt (Manuell verlassen ODER keine Entladung):
  internen Zustand zurücksetzen, sodass die nächste Entladephase wieder sofort
  feuert.

**Event:** `controller:manual-discharge` `{ batterySoc, batteryPowerW }`.
**Push:** Titel „Manueller Modus", Body
„🔋 Manueller Modus entlädt den Akku — SOC X %, Y W", `tag: 'manual-discharge'`.

## Feature 3 — Rückwechsel auf Auto bei Entladung ≤ Schwelle

**Neue Einstellung `manualModeFloorPercent`, Default 50:**
- `config.ts`: `MANUAL_MODE_FLOOR_PERCENT: z.coerce.number().default(50)`.
- `index.ts`: an `AppStateOptions` durchreichen.
- `app-state.ts`: Feld in `AppStateOptions`; in `saveConfigOverrides()`
  persistable-Liste aufnehmen.
- `server.ts`: in `GET /api/config` und `PUT /api/config` mappen.
- `web/app/settings/page.tsx`: eigenes beschriftetes Number-Feld
  („Manuell-Modus Auto-Rückwechsel bei SOC %") mit dem bestehenden
  `updateConfigField`/`flushConfigField`-Muster; im generischen Config-Renderer
  ausschließen (Denylist, wie `activeMorningDischargeMinSocPercent`).

**Trigger im `ManualModeTracker`** (vor der Entlade-Warnung ausgewertet):
- Bedingung: `mode === 'manual' && batteryPowerW < DISCHARGE_THRESHOLD_W &&
  batterySoc <= manualModeFloorPercent`.
- Aktion: `ctx.switchToAuto()` aufrufen UND `controller:auto-restored`
  `{ batterySoc }` emittieren. Danach gilt die Entlade-Warnung im selben Tick
  nicht mehr (Modus ist jetzt Auto).

**Event:** `controller:auto-restored` `{ batterySoc }`.
**Push:** Titel „Zurück auf Automatik", Body
„✅ Zurück auf Automatik — Akku bei X % (Manuell-Schutz)", `tag: 'auto-restored'`.

Hinweis: `auto-restored` wird *nur* von diesem Tracker-Pfad emittiert, nicht aus
`setMode()` allgemein — ein manueller Auto-Wechsel über die UI löst keine Push aus.

## Verdrahtung

- `index.ts`: `const manualModeTracker = new ManualModeTracker();` und
  `appState.setManualModeTracker(manualModeTracker)`.
- `app-state.ts`: `setManualModeTracker()` speichert die Referenz;
  in `regulate()` im bestehenden Tracker-Block (vor
  `if (result.mode === 'manual') return;`) `manualModeTracker.check({...})`
  aufrufen, mit `switchToAuto: () => this.controller.setMode('auto')` und
  `manualModeFloorPercent: this.config.manualModeFloorPercent`.
- `regulate()` läuft auch im Manuell-Modus bis zum Tracker-Block durch (der
  `return` kommt erst danach), daher wird der Tracker auch in Manuell aufgerufen.

## Ablauf pro Tick (Reihenfolge)

1. 50 %-Prüfung (Feature 3): ggf. `setMode('auto')` + `auto-restored`.
2. Entlade-Warnung (Feature 2): nur falls weiterhin `mode === 'manual'`.

So entsteht nach einem Rückwechsel keine widersprüchliche Entlade-Warnung mehr.

## Tests

- **`ManualModeTracker`** (`manual-mode-tracker.test.ts`):
  - Sofort-Warnung bei Entladebeginn; zweite Warnung erst nach 10 min.
  - Reset, wenn Manuell verlassen oder Entladung endet → nächste Phase feuert
    sofort.
  - 50%-Trigger nur bei Entladung UND SOC ≤ Schwelle; ruft `switchToAuto` und
    emittiert `auto-restored`; danach keine Entlade-Warnung im selben Tick.
  - Kein Trigger bei `mode !== 'manual'` oder beim Laden (`batteryPowerW ≥ 0`).
- **Controller** (`controller.test.ts`):
  - `handleExternalSetpointChange` emittiert `switched-to-manual` mit
    `trigger: 'external'` nur beim Übergang; kein Doppel-Emit bei wiederholtem
    externem Schreiben im Manuell-Modus.
  - `setMode('manual')` emittiert mit `trigger: 'api'` nur beim Übergang.
- **NotificationService**: Handler erzeugen die erwarteten Titel/Body-Texte und
  Tags für alle drei Events.

## Nicht im Scope (YAGNI)

- Konfigurierbarkeit von 10-min-Intervall oder Entlade-Schwellwert.
- Historie/Logging der Manuell-Wechselgründe über den Konsolen-Log hinaus.
- Quiet-Hours / Stummschaltung der Wiederhol-Warnung.
