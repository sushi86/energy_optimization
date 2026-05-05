# Verschattung — EG Sonnenschutz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den EG-Sonnenschutz aus der Home-Assistant-YAML als eigenständiges, transparent visualisiertes `verschattung/`-Domain-Modul in dieser App neu aufbauen — mit MQTT-Anbindung an HA, hexagonaler Adapter-Architektur und voller UI-Erklärbarkeit jeder Engine-Entscheidung.

**Architecture:** Drei Schichten:
1. Infra: typed-EventEmitter MQTT-Adapter (Victron + HA), eine Connection pro Broker.
2. Domain: `verschattung/` mit `ports.ts` (Hexagonal), Sun-Calc, Per-Cover-State-Machine, Engine, Automation-Datei.
3. UI: Tab-Switch Manuell/Automation, SVG-Grundrisse für EG+OG, Decision-Log + Eingangswerte im Automation-Tab.

**Tech Stack:** TypeScript, Fastify, MQTT.js, suncalc, React 19, Next.js 15, Tailwind 4, lucide-react, vitest, Aedes (test-broker).

**Spec reference:** `docs/plans/2026-05-05-verschattung-eg-sonnenschutz-design.md`

---

## File Structure

### Created
- `packages/api/src/infra/ha/ha-mqtt-client.ts` — Connection-Verwaltung
- `packages/api/src/infra/ha/ha-mqtt-listener.ts` — Statestream-Subscribe → typed events
- `packages/api/src/infra/ha/ha-mqtt-publisher.ts` — Service-Bridge-Publish
- `packages/api/src/infra/ha/types.ts` — interne HA-Adapter-Typen
- `packages/api/src/__tests__/ha-mqtt-listener.test.ts`
- `packages/api/src/__tests__/ha-mqtt-publisher.test.ts`
- `packages/api/src/verschattung/sun.ts` — Sonnenposition lokal
- `packages/api/src/verschattung/config.ts` — Tunables-IO + Defaults
- `packages/api/src/verschattung/covers.ts` — Cover-Mapping-Konstanten
- `packages/api/src/verschattung/context.ts` — Engine-Eingangs-Snapshot-Typ
- `packages/api/src/verschattung/decision.ts` — Decision-Output-Typ
- `packages/api/src/verschattung/ports.ts` — Hexagonal-Interfaces
- `packages/api/src/verschattung/override-state.ts` — Per-Cover-State-Machine
- `packages/api/src/verschattung/automations/eg-sonnenschutz.ts` — Rule-Logik
- `packages/api/src/verschattung/engine.ts` — Tick-Loop + Orchestrierung
- `packages/api/src/verschattung/persistence.ts` — State-File-IO
- `packages/api/src/verschattung/adapters/ha-cover-actuator.ts`
- `packages/api/src/verschattung/adapters/ha-temp-source.ts`
- `packages/api/src/verschattung/adapters/victron-pv-source.ts`
- `packages/api/src/verschattung/routes.ts` — HTTP-Endpoints
- `packages/api/src/__tests__/sun.test.ts`
- `packages/api/src/__tests__/verschattung-config.test.ts`
- `packages/api/src/__tests__/override-state.test.ts`
- `packages/api/src/__tests__/eg-sonnenschutz.test.ts`
- `packages/api/src/__tests__/engine.test.ts`
- `packages/api/src/__tests__/verschattung-routes.test.ts`
- `packages/web/hooks/use-verschattung.ts` — WebSocket-Hook
- `packages/web/app/verschattung/types.ts` — Web-lokale Typen-Helpers
- `packages/web/app/verschattung/floor-plan-eg.tsx`
- `packages/web/app/verschattung/floor-plan-og.tsx`
- `packages/web/app/verschattung/cover-shape.tsx`
- `packages/web/app/verschattung/sun-indicator.tsx`
- `packages/web/app/verschattung/cover-detail-panel.tsx`
- `packages/web/app/verschattung/manual-tab.tsx`
- `packages/web/app/verschattung/automation-tab.tsx`
- `packages/web/app/verschattung/eingangswerte.tsx`
- `packages/web/app/verschattung/zone-evaluation.tsx`
- `packages/web/app/verschattung/decision-log.tsx`
- `packages/web/app/verschattung/settings-section.tsx`
- `docs/ha-config-snippets.md` — HA-Side-Konfiguration

### Modified
- `packages/api/src/config.ts` — neue env-vars (`HA_MQTT_URL`, `HA_MQTT_USER`, `HA_MQTT_PASSWORD`)
- `packages/api/src/index.ts` — Bootstrap der neuen Module
- `packages/api/src/server.ts` — WebSocket-Broadcast erweitert um Verschattungs-State
- `packages/api/src/mqtt-service.ts` — `largeChange`-Event auf alle PV-Werte erweitern (typed events)
- `openapi/spec.yaml` — neue Endpunkte
- `packages/shared/src/api-types.ts` — automatisch via `pnpm generate:types`
- `packages/web/app/verschattung/page.tsx` — Tab-Switch ersetzt Stub
- `packages/api/package.json` — `suncalc` als Dependency

---

## Phase 1 — Vorarbeit

### Task 1: Pending Nav-Bar-Arbeit committen

Damit die noch offene Nav-Bar-Arbeit nicht mit Verschattungs-Code vermischt wird.

**Files:**
- (no source changes; just commit existing working tree)

- [ ] **Step 1: Status prüfen**

```bash
git status
```
Expected: gelistete uncommitted Änderungen in `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/nav-bar.tsx`, `app/verschattung/page.tsx`.

- [ ] **Step 2: Stage und commit**

```bash
git add packages/web/app/globals.css \
        packages/web/app/layout.tsx \
        packages/web/app/page.tsx \
        packages/web/app/verschattung/page.tsx \
        packages/web/components/nav-bar.tsx
git commit -m "feat(web): bottom-nav (mobile) + top-nav (desktop) with dashboard/verschattung/solar tabs"
```

- [ ] **Step 3: Verifizieren**

```bash
git status
```
Expected: working tree clean (oder nur Spec-Files).

---

### Task 2: HA-MQTT-Konfiguration in env-Schema aufnehmen

**Files:**
- Modify: `packages/api/src/config.ts`

- [ ] **Step 1: env-Schema erweitern**

Insert after `WALLBOX_URL: z.string().optional(),` and before the closing `});`:

```ts
  HA_MQTT_URL: z.string().default('mqtt://homeassistant.local:1883'),
  HA_MQTT_USER: z.string().optional(),
  HA_MQTT_PASSWORD: z.string().optional(),
```

- [ ] **Step 2: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/config.ts
git commit -m "feat(api): add HA_MQTT_* env vars to config schema"
```

---

## Phase 2 — Infra: HA-MQTT-Adapter

### Task 3: HA-MQTT-Client (Connection-Verwaltung)

Niedrigste Schicht: einmalige Verbindung mit Reconnect-Backoff. Keine HA-Domänen-Logik.

**Files:**
- Create: `packages/api/src/infra/ha/ha-mqtt-client.ts`

- [ ] **Step 1: Datei anlegen**

```ts
import mqtt, { type MqttClient } from 'mqtt';

export interface HaMqttClientOptions {
  url: string;
  username?: string;
  password?: string;
  clientId?: string;
}

export class HaMqttClient {
  private client: MqttClient | null = null;
  private connectedListeners = new Set<() => void>();
  private messageListeners = new Set<(topic: string, payload: Buffer) => void>();

  constructor(private options: HaMqttClientOptions) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.client = mqtt.connect(this.options.url, {
        clientId: this.options.clientId ?? `energy-control-ha-${Date.now()}`,
        username: this.options.username,
        password: this.options.password,
        reconnectPeriod: 5000,
        connectTimeout: 10_000,
        clean: true,
      });

      this.client.on('connect', () => {
        for (const cb of this.connectedListeners) cb();
        resolve();
      });
      this.client.on('message', (topic, payload) => {
        for (const cb of this.messageListeners) cb(topic, payload);
      });
      this.client.on('error', (err) => {
        console.error('[ha-mqtt] error:', err.message);
      });
    });
  }

  onConnected(cb: () => void): void { this.connectedListeners.add(cb); }
  onMessage(cb: (topic: string, payload: Buffer) => void): void { this.messageListeners.add(cb); }

  subscribe(topics: string | string[]): void {
    if (!this.client) throw new Error('HaMqttClient not started');
    this.client.subscribe(topics);
  }

  publish(topic: string, payload: string): Promise<void> {
    if (!this.client) throw new Error('HaMqttClient not started');
    return new Promise((resolve, reject) => {
      this.client!.publish(topic, payload, (err) => err ? reject(err) : resolve());
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, () => resolve()));
      this.client = null;
    }
  }
}
```

- [ ] **Step 2: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/infra/ha/ha-mqtt-client.ts
git commit -m "feat(api): HA-MQTT client with reconnect and shared message listeners"
```

---

### Task 4: HA-MQTT-Listener — typed events für Cover und Sensor (TDD)

Statestream-Subscribe + Topic-Parsing → typisierte Events.

**Files:**
- Create: `packages/api/src/infra/ha/ha-mqtt-listener.ts`
- Test: `packages/api/src/__tests__/ha-mqtt-listener.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { HaMqttClient } from '../infra/ha/ha-mqtt-client.js';
import { HaMqttListener } from '../infra/ha/ha-mqtt-listener.js';

function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
  return new Promise((resolve) => {
    const broker = new Aedes();
    const server = createServer(broker.handle);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ broker, server, port });
    });
  });
}

function stopBroker(broker: Aedes, server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => broker.close(() => resolve()));
  });
}

describe('HaMqttListener', () => {
  let broker: Aedes; let server: Server; let port: number;
  let client: HaMqttClient; let listener: HaMqttListener;

  beforeEach(async () => { ({ broker, server, port } = await startBroker()); });
  afterEach(async () => {
    if (client) await client.stop();
    await stopBroker(broker, server);
  });

  it('emits coverPosition event when current_position arrives', async () => {
    client = new HaMqttClient({ url: `mqtt://localhost:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: { entityId: string; position: number }[] = [];
    listener.on('coverPosition', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/cover/galerie_rolladen/current_position',
      payload: Buffer.from('42'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual([{ entityId: 'cover.galerie_rolladen', position: 42 }]);
  });

  it('emits sensorValue event when sensor state arrives', async () => {
    client = new HaMqttClient({ url: `mqtt://localhost:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: { entityId: string; value: number }[] = [];
    listener.on('sensorValue', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/sensor/temp_eg/state',
      payload: Buffer.from('23.4'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual([{ entityId: 'sensor.temp_eg', value: 23.4 }]);
  });

  it('ignores non-numeric sensor payloads', async () => {
    client = new HaMqttClient({ url: `mqtt://localhost:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: unknown[] = [];
    listener.on('sensorValue', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/sensor/x/state',
      payload: Buffer.from('unavailable'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen — fail**

```bash
pnpm --filter @energy-control/api test ha-mqtt-listener
```
Expected: FAIL — `HaMqttListener` not found.

- [ ] **Step 3: Listener implementieren**

```ts
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
```

- [ ] **Step 4: Test laufen — pass**

```bash
pnpm --filter @energy-control/api test ha-mqtt-listener
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/infra/ha/ha-mqtt-listener.ts \
        packages/api/src/__tests__/ha-mqtt-listener.test.ts
git commit -m "feat(api): HA Statestream listener emits typed coverPosition + sensorValue events"
```

---

### Task 5: HA-MQTT-Publisher (Service-Bridge-Publish)

Publish auf `energy_control/service/<domain>/<service>` mit JSON-Payload.

**Files:**
- Create: `packages/api/src/infra/ha/ha-mqtt-publisher.ts`
- Test: `packages/api/src/__tests__/ha-mqtt-publisher.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { HaMqttClient } from '../infra/ha/ha-mqtt-client.js';
import { HaMqttPublisher } from '../infra/ha/ha-mqtt-publisher.js';
import mqtt from 'mqtt';

function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
  return new Promise((resolve) => {
    const broker = new Aedes();
    const server = createServer(broker.handle);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ broker, server, port });
    });
  });
}

describe('HaMqttPublisher', () => {
  let broker: Aedes; let server: Server; let port: number;
  let client: HaMqttClient;

  beforeEach(async () => { ({ broker, server, port } = await startBroker()); });
  afterEach(async () => {
    if (client) await client.stop();
    await new Promise<void>((r) => server.close(() => broker.close(() => r())));
  });

  it('publishes service call to correct topic with JSON payload', async () => {
    client = new HaMqttClient({ url: `mqtt://localhost:${port}` });
    await client.start();
    const publisher = new HaMqttPublisher(client);

    // Spy via separate subscriber
    const spy = mqtt.connect(`mqtt://localhost:${port}`);
    const messages: { topic: string; payload: string }[] = [];
    await new Promise<void>((r) => spy.on('connect', () => { spy.subscribe('energy_control/service/+/+', () => r()); }));
    spy.on('message', (topic, payload) => messages.push({ topic, payload: payload.toString() }));

    await publisher.callService('cover', 'set_cover_position', {
      entity_id: 'cover.galerie_rolladen', position: 20,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(1);
    expect(messages[0].topic).toBe('energy_control/service/cover/set_cover_position');
    expect(JSON.parse(messages[0].payload)).toEqual({
      entity_id: 'cover.galerie_rolladen', position: 20,
    });

    spy.end();
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test ha-mqtt-publisher
```
Expected: FAIL.

- [ ] **Step 3: Publisher implementieren**

```ts
import type { HaMqttClient } from './ha-mqtt-client.js';

export class HaMqttPublisher {
  constructor(private client: HaMqttClient) {}

  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const topic = `energy_control/service/${domain}/${service}`;
    return this.client.publish(topic, JSON.stringify(data));
  }
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test ha-mqtt-publisher
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/infra/ha/ha-mqtt-publisher.ts \
        packages/api/src/__tests__/ha-mqtt-publisher.test.ts
git commit -m "feat(api): HA service-bridge publisher"
```

---

## Phase 3 — Domain Foundations

### Task 6: Sun Position lokal (TDD, suncalc-Wrapper)

**Files:**
- Modify: `packages/api/package.json` (add `suncalc` dep)
- Create: `packages/api/src/verschattung/sun.ts`
- Test: `packages/api/src/__tests__/sun.test.ts`

- [ ] **Step 1: suncalc installieren**

```bash
pnpm --filter @energy-control/api add suncalc && pnpm --filter @energy-control/api add -D @types/suncalc
```

- [ ] **Step 2: Test schreiben**

Reference values from NOAA Solar Calculator for Munich (lat 48.137, lon 11.575) at 2026-06-21T12:00:00 local CEST = 10:00 UTC: azimuth ~180°, elevation ~64.5°.

```ts
import { describe, it, expect } from 'vitest';
import { computeSunPosition } from '../verschattung/sun.js';

describe('computeSunPosition', () => {
  it('returns azimuth and elevation for known reference (summer solstice noon Munich)', () => {
    const date = new Date('2026-06-21T10:00:00Z');
    const pos = computeSunPosition(date, 48.137, 11.575);
    expect(pos.azimuthDeg).toBeGreaterThan(170);
    expect(pos.azimuthDeg).toBeLessThan(190);
    expect(pos.elevationDeg).toBeGreaterThan(60);
    expect(pos.elevationDeg).toBeLessThan(68);
  });

  it('returns negative elevation at night', () => {
    const date = new Date('2026-06-21T00:00:00Z');
    const pos = computeSunPosition(date, 48.137, 11.575);
    expect(pos.elevationDeg).toBeLessThan(0);
  });

  it('azimuth is in 0..360', () => {
    for (const isoH of [0, 6, 12, 18]) {
      const date = new Date(`2026-06-21T${String(isoH).padStart(2, '0')}:00:00Z`);
      const pos = computeSunPosition(date, 48.137, 11.575);
      expect(pos.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(pos.azimuthDeg).toBeLessThan(360);
    }
  });
});
```

- [ ] **Step 3: Test fail**

```bash
pnpm --filter @energy-control/api test sun
```
Expected: FAIL.

- [ ] **Step 4: Implementierung**

```ts
import SunCalc from 'suncalc';

export interface SunPosition {
  azimuthDeg: number;   // 0..360, 0 = North, clockwise
  elevationDeg: number; // -90..+90
}

export function computeSunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  // SunCalc: azimuth = radians from south clockwise, altitude = radians above horizon
  const { azimuth, altitude } = SunCalc.getPosition(date, latitude, longitude);
  const radToDeg = 180 / Math.PI;
  // Convert SunCalc azimuth (south=0, west=+pi/2) to compass (north=0, east=+pi/2)
  let compass = azimuth * radToDeg + 180;
  if (compass < 0) compass += 360;
  if (compass >= 360) compass -= 360;
  return {
    azimuthDeg: compass,
    elevationDeg: altitude * radToDeg,
  };
}
```

- [ ] **Step 5: Test pass**

```bash
pnpm --filter @energy-control/api test sun
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/package.json packages/api/src/verschattung/sun.ts \
        packages/api/src/__tests__/sun.test.ts pnpm-lock.yaml
git commit -m "feat(verschattung): local sun position via suncalc"
```

---

### Task 7: Cover-Mapping (Konstanten, ohne SVG-Koordinaten zunächst)

Strukturelle Cover-Definitionen aus der YAML als TS-Konstante. SVG-Koordinaten sind initial Platzhalter, werden in Frontend-Phase gefüllt.

**Files:**
- Create: `packages/api/src/verschattung/covers.ts`

- [ ] **Step 1: Datei anlegen**

```ts
export type Zone = 'ost' | 'sued' | 'west';
export type Floor = 'EG' | 'OG';
export type WallSide = 'N' | 'S' | 'E' | 'W';

export interface CoverDef {
  id: string;          // HA entity id, z.B. 'cover.galerie_rolladen'
  zone: Zone;
  floor: Floor;
  label: string;       // UI-Anzeige
  svg: {
    x: number;         // 0..1000 viewBox-Koordinaten
    y: number;
    side: WallSide;
    widthMm: number;   // optisches Width-Mapping
  };
}

// Initial-Mapping aus der HA-YAML. SVG-Koordinaten sind Placeholders;
// werden in Frontend-Phase gemeinsam mit dem Endnutzer kalibriert.
export const COVERS: CoverDef[] = [
  // OST (Azimut 70°-145°)
  { id: 'cover.eingang_rolladen',       zone: 'ost',  floor: 'EG', label: 'Eingang',       svg: { x: 100,  y: 600, side: 'E', widthMm: 1000 } },
  { id: 'cover.kuche_vorn_rolladen',    zone: 'ost',  floor: 'EG', label: 'Küche vorn',    svg: { x: 100,  y: 200, side: 'E', widthMm: 1500 } },

  // SÜD (Azimut 110°-260°)
  { id: 'cover.kuche_garten_rolladen',          zone: 'sued', floor: 'EG', label: 'Küche Garten', svg: { x: 250, y: 50,  side: 'N', widthMm: 1500 } },
  { id: 'cover.galerie_rolladen',                zone: 'sued', floor: 'EG', label: 'Galerie',      svg: { x: 500, y: 50,  side: 'N', widthMm: 2700 } },
  { id: 'cover.shellyplus2pm_cc7b5c0f3484',     zone: 'sued', floor: 'EG', label: 'Wohnen Süd 1', svg: { x: 700, y: 50,  side: 'N', widthMm: 1100 } },
  { id: 'cover.shellyplus2pm_e465b8f35e50',     zone: 'sued', floor: 'EG', label: 'Wohnen Süd 2', svg: { x: 850, y: 50,  side: 'N', widthMm: 1100 } },

  // WEST (Azimut 215°-290°)
  { id: 'cover.westen_gross_rolladen',  zone: 'west', floor: 'EG', label: 'Wohnen West',   svg: { x: 950, y: 400, side: 'W', widthMm: 2400 } },
  { id: 'cover.west_klein_rolladen',    zone: 'west', floor: 'EG', label: 'Essen West',    svg: { x: 950, y: 250, side: 'W', widthMm: 1100 } },
];

export const ZONE_AZIMUTH_RANGES: Record<Zone, { from: number; to: number }> = {
  ost:  { from: 70,  to: 145 },
  sued: { from: 110, to: 260 },
  west: { from: 215, to: 290 },
};

export function coversInZone(zone: Zone): CoverDef[] {
  return COVERS.filter((c) => c.zone === zone);
}

export function coverById(id: string): CoverDef | undefined {
  return COVERS.find((c) => c.id === id);
}
```

> **Hinweis für die Implementation:** Die Cover-Liste enthält die exakten Entity-IDs aus der HA-YAML. SVG-Koordinaten sind grobe Platzhalter und werden in Phase 6 (Frontend) gemeinsam mit dem User korrigiert. Die Zone-Azimut-Ranges sind 1:1 aus der YAML übernommen.

- [ ] **Step 2: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/verschattung/covers.ts
git commit -m "feat(verschattung): cover mapping + zone azimuth ranges (placeholder svg coords)"
```

---

### Task 8: Verschattung-Config (load/save Tunables, TDD)

**Files:**
- Create: `packages/api/src/verschattung/config.ts`
- Test: `packages/api/src/__tests__/verschattung-config.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadVerschattungConfig, saveVerschattungConfig, DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';

describe('verschattung config', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verschattung-'));
    file = path.join(dir, 'config.json');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns defaults if file does not exist', () => {
    expect(loadVerschattungConfig(file)).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('returns defaults if file is corrupt', () => {
    fs.writeFileSync(file, 'not json {{', 'utf-8');
    expect(loadVerschattungConfig(file)).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('merges partial file with defaults', () => {
    fs.writeFileSync(file, JSON.stringify({ indoorTempThresholdC: 24 }), 'utf-8');
    const cfg = loadVerschattungConfig(file);
    expect(cfg.indoorTempThresholdC).toBe(24);
    expect(cfg.summerModeMonths).toEqual(DEFAULT_VERSCHATTUNG_CONFIG.summerModeMonths);
  });

  it('round-trip via save+load', () => {
    const updated = { ...DEFAULT_VERSCHATTUNG_CONFIG, indoorTempThresholdC: 21.5 };
    saveVerschattungConfig(file, updated);
    expect(loadVerschattungConfig(file).indoorTempThresholdC).toBe(21.5);
  });

  it('save uses atomic write (tmp + rename)', () => {
    saveVerschattungConfig(file, DEFAULT_VERSCHATTUNG_CONFIG);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test verschattung-config
```
Expected: FAIL.

- [ ] **Step 3: Implementierung**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Zone } from './covers.js';

export interface ZoneTunables {
  closePosition: number; // 0..100, default 20
}

export interface VerschattungConfig {
  zones: Record<Zone, ZoneTunables>;
  pvThreshold: { peakWp: number; factor: number; floorW: number };
  indoorTempThresholdC: number;
  hysteresisIndoorTempC: number;
  hysteresisPvFactor: number;          // 0..1, e.g. 0.5 = 50% der Schwelle
  hysteresisPvDurationMinutes: number;
  summerModeMonths: number[];          // 1..12
}

export const DEFAULT_VERSCHATTUNG_CONFIG: VerschattungConfig = {
  zones: {
    ost:  { closePosition: 20 },
    sued: { closePosition: 20 },
    west: { closePosition: 20 },
  },
  pvThreshold: { peakWp: 4700, factor: 0.85, floorW: 300 },
  indoorTempThresholdC: 22,
  hysteresisIndoorTempC: 1,
  hysteresisPvFactor: 0.5,
  hysteresisPvDurationMinutes: 10,
  summerModeMonths: [4, 5, 6, 7, 8, 9, 10],
};

export function loadVerschattungConfig(filePath: string): VerschattungConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<VerschattungConfig>;
    return {
      ...DEFAULT_VERSCHATTUNG_CONFIG,
      ...parsed,
      zones: { ...DEFAULT_VERSCHATTUNG_CONFIG.zones, ...(parsed.zones ?? {}) },
      pvThreshold: { ...DEFAULT_VERSCHATTUNG_CONFIG.pvThreshold, ...(parsed.pvThreshold ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_VERSCHATTUNG_CONFIG);
  }
}

export function saveVerschattungConfig(filePath: string, config: VerschattungConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test verschattung-config
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verschattung/config.ts \
        packages/api/src/__tests__/verschattung-config.test.ts
git commit -m "feat(verschattung): config load/save with defaults + atomic write"
```

---

### Task 9: Context + Decision Types

Reine Typ-Definitionen.

**Files:**
- Create: `packages/api/src/verschattung/context.ts`
- Create: `packages/api/src/verschattung/decision.ts`

- [ ] **Step 1: context.ts anlegen**

```ts
import type { Zone } from './covers.js';
import type { SunPosition } from './sun.js';

export interface ZoneContext {
  inZone: boolean;          // azimut ∈ zone-range
  azimuthDeg: number;
}

export interface VerschattungContext {
  now: Date;
  sun: SunPosition;
  pvPowerW: number | null;
  indoorTempC: number | null;
  pvThresholdW: number;
  pvBelowHalfThresholdSinceMs: number | null; // null wenn aktuell über Schwelle
  isSummerMode: boolean;
  coverPositions: Map<string, number>;        // entityId → 0..100
  zones: Record<Zone, ZoneContext>;
}
```

- [ ] **Step 2: decision.ts anlegen**

```ts
import type { Zone } from './covers.js';

export type CoverState = 'IDLE' | 'CLOSED_BY_AUTO' | 'OVERRIDE';
export type DecisionAction = 'close' | 'open' | 'skip';

export interface EvaluatedCondition {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Decision {
  coverId: string;
  zone: Zone;
  action: DecisionAction;
  reason: string;
  evaluatedConditions: EvaluatedCondition[];
  appliedAt: string;        // ISO
  resultingState: CoverState;
  expectedPosition: number | null;
}
```

- [ ] **Step 3: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/verschattung/context.ts \
        packages/api/src/verschattung/decision.ts
git commit -m "feat(verschattung): Context + Decision types"
```

---

### Task 10: Ports (Hexagonal-Interfaces)

**Files:**
- Create: `packages/api/src/verschattung/ports.ts`

- [ ] **Step 1: Datei anlegen**

```ts
export interface CoverActuator {
  setPosition(entityId: string, position: number): Promise<void>;
  observePosition(cb: (entityId: string, position: number) => void): void;
  current(entityId: string): number | null;
}

export interface IndoorTempSource {
  current(): number | null;
  observe(cb: (value: number) => void): void;
}

export interface PvPowerSource {
  current(): number | null;
  observe(cb: (powerW: number) => void): void;
}
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/api build && \
git add packages/api/src/verschattung/ports.ts && \
git commit -m "feat(verschattung): hexagonal port interfaces"
```

---

## Phase 4 — Domain Logic (TDD)

### Task 11: Override-State-Machine pro Cover (TDD)

**Files:**
- Create: `packages/api/src/verschattung/override-state.ts`
- Test: `packages/api/src/__tests__/override-state.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect } from 'vitest';
import { OverrideStateTracker, POSITION_TOLERANCE_PCT } from '../verschattung/override-state.js';

describe('OverrideStateTracker', () => {
  it('starts cover in IDLE', () => {
    const t = new OverrideStateTracker();
    expect(t.getState('cover.x')).toEqual({ state: 'IDLE', expectedPosition: null });
  });

  it('markClosedByAuto sets CLOSED_BY_AUTO with expected', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    expect(t.getState('cover.x').state).toBe('CLOSED_BY_AUTO');
    expect(t.getState('cover.x').expectedPosition).toBe(20);
  });

  it('observePosition transitions CLOSED_BY_AUTO → OVERRIDE if user opens further', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 60);
    expect(t.getState('cover.x').state).toBe('OVERRIDE');
  });

  it('observePosition transitions CLOSED_BY_AUTO → OVERRIDE if user closes further', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 5);
    expect(t.getState('cover.x').state).toBe('OVERRIDE');
  });

  it('observePosition stays in CLOSED_BY_AUTO within tolerance', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 20 + POSITION_TOLERANCE_PCT);
    expect(t.getState('cover.x').state).toBe('CLOSED_BY_AUTO');
  });

  it('observePosition in IDLE does not trigger OVERRIDE (no engine ownership)', () => {
    const t = new OverrideStateTracker();
    t.observePosition('cover.x', 100);
    expect(t.getState('cover.x').state).toBe('IDLE');
  });

  it('markIdle clears expected position and override', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 70);  // OVERRIDE
    t.markIdle('cover.x');
    expect(t.getState('cover.x').state).toBe('IDLE');
    expect(t.getState('cover.x').expectedPosition).toBeNull();
  });

  it('serialize/restore round-trip preserves states', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.a', 20);
    t.observePosition('cover.a', 75);  // → OVERRIDE
    t.markClosedByAuto('cover.b', 30);
    const snap = t.serialize();
    const t2 = new OverrideStateTracker();
    t2.restore(snap);
    expect(t2.getState('cover.a').state).toBe('OVERRIDE');
    expect(t2.getState('cover.b').state).toBe('CLOSED_BY_AUTO');
    expect(t2.getState('cover.b').expectedPosition).toBe(30);
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test override-state
```
Expected: FAIL.

- [ ] **Step 3: Implementierung**

```ts
import type { CoverState } from './decision.js';

export const POSITION_TOLERANCE_PCT = 5;

export interface CoverStateEntry {
  state: CoverState;
  expectedPosition: number | null;
  sinceTs: string;
  lastEvent: {
    ts: string;
    source: 'auto' | 'user' | 'reset';
    fromPosition: number | null;
    toPosition: number | null;
    reason: string | null;
  } | null;
}

export type OverrideSnapshot = Record<string, CoverStateEntry>;

export class OverrideStateTracker {
  private states: Map<string, CoverStateEntry> = new Map();

  getState(coverId: string): CoverStateEntry {
    return this.states.get(coverId) ?? { state: 'IDLE', expectedPosition: null, sinceTs: new Date().toISOString(), lastEvent: null };
  }

  markClosedByAuto(coverId: string, expectedPosition: number, reason?: string): void {
    const prev = this.getState(coverId);
    this.states.set(coverId, {
      state: 'CLOSED_BY_AUTO',
      expectedPosition,
      sinceTs: new Date().toISOString(),
      lastEvent: {
        ts: new Date().toISOString(),
        source: 'auto',
        fromPosition: prev.expectedPosition,
        toPosition: expectedPosition,
        reason: reason ?? null,
      },
    });
  }

  markIdle(coverId: string, source: 'auto' | 'reset' = 'auto', reason?: string): void {
    const prev = this.getState(coverId);
    this.states.set(coverId, {
      state: 'IDLE',
      expectedPosition: null,
      sinceTs: new Date().toISOString(),
      lastEvent: {
        ts: new Date().toISOString(),
        source,
        fromPosition: prev.expectedPosition,
        toPosition: null,
        reason: reason ?? null,
      },
    });
  }

  observePosition(coverId: string, currentPosition: number): void {
    const entry = this.getState(coverId);
    if (entry.state !== 'CLOSED_BY_AUTO') return;
    if (entry.expectedPosition === null) return;
    const drift = Math.abs(currentPosition - entry.expectedPosition);
    if (drift > POSITION_TOLERANCE_PCT) {
      this.states.set(coverId, {
        ...entry,
        state: 'OVERRIDE',
        sinceTs: new Date().toISOString(),
        lastEvent: {
          ts: new Date().toISOString(),
          source: 'user',
          fromPosition: entry.expectedPosition,
          toPosition: currentPosition,
          reason: 'Externe Position-Änderung erkannt',
        },
      });
    }
  }

  serialize(): OverrideSnapshot {
    const out: OverrideSnapshot = {};
    for (const [k, v] of this.states.entries()) out[k] = v;
    return out;
  }

  restore(snap: OverrideSnapshot): void {
    this.states = new Map(Object.entries(snap));
  }
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test override-state
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verschattung/override-state.ts \
        packages/api/src/__tests__/override-state.test.ts
git commit -m "feat(verschattung): per-cover override state machine"
```

---

### Task 12: EG-Sonnenschutz Automation (TDD)

Reine Funktion: nimmt Context + Tracker, gibt Decisions zurück. Keine I/O.

**Files:**
- Create: `packages/api/src/verschattung/automations/eg-sonnenschutz.ts`
- Test: `packages/api/src/__tests__/eg-sonnenschutz.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateEgSonnenschutz } from '../verschattung/automations/eg-sonnenschutz.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import { OverrideStateTracker } from '../verschattung/override-state.js';
import type { VerschattungContext } from '../verschattung/context.js';

function ctx(overrides: Partial<VerschattungContext> = {}): VerschattungContext {
  return {
    now: new Date('2026-05-20T13:00:00Z'),
    sun: { azimuthDeg: 180, elevationDeg: 50 },
    pvPowerW: 4500,
    indoorTempC: 23,
    pvThresholdW: 2000,
    pvBelowHalfThresholdSinceMs: null,
    isSummerMode: true,
    coverPositions: new Map([
      ['cover.galerie_rolladen', 100],
      ['cover.eingang_rolladen', 100],
      ['cover.westen_gross_rolladen', 100],
    ]),
    zones: {
      ost:  { inZone: false, azimuthDeg: 180 },
      sued: { inZone: true,  azimuthDeg: 180 },
      west: { inZone: false, azimuthDeg: 180 },
    },
    ...overrides,
  };
}

describe('evaluateEgSonnenschutz — close decisions', () => {
  it('emits close for sued covers when all conditions met', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const sued = decisions.filter((d) => d.zone === 'sued' && d.action === 'close');
    expect(sued.length).toBeGreaterThan(0);
    for (const d of sued) {
      expect(d.expectedPosition).toBe(20);
      expect(d.evaluatedConditions.every((c) => c.ok)).toBe(true);
    }
  });

  it('does NOT close ost covers when sun is in sued only', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const ost = decisions.filter((d) => d.zone === 'ost' && d.action === 'close');
    expect(ost).toHaveLength(0);
  });

  it('skips close when not summer mode', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ isSummerMode: false }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close when indoor temp below threshold', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ indoorTempC: 21 }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close when pv below threshold', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ pvPowerW: 1000 }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close for cover already in OVERRIDE', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    tracker.observePosition('cover.galerie_rolladen', 80);   // → OVERRIDE
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });

  it('skips close for cover already CLOSED_BY_AUTO at expected position', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const positions = new Map([
      ['cover.galerie_rolladen', 20],
      ['cover.eingang_rolladen', 100],
      ['cover.westen_gross_rolladen', 100],
    ]);
    const decisions = evaluateEgSonnenschutz(ctx({ coverPositions: positions }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });

  it('reports indoor temp unavailable as skip with reason', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ indoorTempC: null }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const sued = decisions.find((d) => d.zone === 'sued');
    expect(sued?.action).toBe('skip');
    expect(sued?.reason).toMatch(/Innentemp/);
  });
});

describe('evaluateEgSonnenschutz — open decisions', () => {
  it('opens cover when sun leaves zone and cover is CLOSED_BY_AUTO', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);

    const c = ctx({
      zones: {
        ost:  { inZone: false, azimuthDeg: 280 },
        sued: { inZone: false, azimuthDeg: 280 },
        west: { inZone: true,  azimuthDeg: 280 },
      },
    });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
    expect(galerie?.expectedPosition).toBe(100);
  });

  it('opens when pv has been below half threshold for >= duration', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const tenMinAgo = new Date('2026-05-20T13:00:00Z').getTime() - 10 * 60_000;
    const c = ctx({ pvPowerW: 500, pvBelowHalfThresholdSinceMs: tenMinAgo });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
  });

  it('does not open if pv below half but < duration', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const fiveMinAgo = new Date('2026-05-20T13:00:00Z').getTime() - 5 * 60_000;
    const c = ctx({ pvPowerW: 500, pvBelowHalfThresholdSinceMs: fiveMinAgo });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).not.toBe('open');
  });

  it('opens when indoor temp drops below threshold minus hysteresis', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const c = ctx({ indoorTempC: 20.5 });   // 22 - 1 - more
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
  });

  it('does NOT auto-open when state is OVERRIDE', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    tracker.observePosition('cover.galerie_rolladen', 70);  // → OVERRIDE
    const c = ctx({
      zones: {
        ost:  { inZone: false, azimuthDeg: 280 },
        sued: { inZone: false, azimuthDeg: 280 },
        west: { inZone: true,  azimuthDeg: 280 },
      },
    });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test eg-sonnenschutz
```
Expected: FAIL.

- [ ] **Step 3: Implementierung**

```ts
import { COVERS, ZONE_AZIMUTH_RANGES, type Zone, coversInZone } from '../covers.js';
import type { VerschattungConfig } from '../config.js';
import type { VerschattungContext } from '../context.js';
import type { Decision, EvaluatedCondition, CoverState } from '../decision.js';
import type { OverrideStateTracker } from '../override-state.js';

const ZONES: Zone[] = ['ost', 'sued', 'west'];

export function evaluateEgSonnenschutz(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  tracker: OverrideStateTracker,
): Decision[] {
  const decisions: Decision[] = [];

  for (const zone of ZONES) {
    const zoneCtx = ctx.zones[zone];
    const closePosition = config.zones[zone].closePosition;
    const covers = coversInZone(zone);

    // Build per-zone evaluated conditions (shared across covers in this zone).
    const sharedConditions = buildSharedConditions(ctx, config, zone);
    const allOk = sharedConditions.every((c) => c.ok);

    for (const cover of covers) {
      const stateEntry = tracker.getState(cover.id);
      const currentPos = ctx.coverPositions.get(cover.id) ?? null;

      // CASE 1: Cover in OVERRIDE → never touch
      if (stateEntry.state === 'OVERRIDE') {
        decisions.push(makeDecision({
          ctx, cover, zone, action: 'skip',
          reason: 'Cover ist in OVERRIDE — User-Position wird respektiert',
          conditions: sharedConditions,
          state: 'OVERRIDE',
          expectedPosition: stateEntry.expectedPosition,
        }));
        continue;
      }

      // CASE 2: Cover currently CLOSED_BY_AUTO — check open conditions
      if (stateEntry.state === 'CLOSED_BY_AUTO') {
        const openTrigger = checkOpenTrigger(ctx, config, zoneCtx);
        if (openTrigger) {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'open',
            reason: openTrigger,
            conditions: sharedConditions,
            state: 'IDLE',
            expectedPosition: 100,
          }));
        } else {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'skip',
            reason: 'Schließ-Bedingungen weiterhin gegeben — Cover bleibt geschlossen',
            conditions: sharedConditions,
            state: 'CLOSED_BY_AUTO',
            expectedPosition: stateEntry.expectedPosition,
          }));
        }
        continue;
      }

      // CASE 3: IDLE — evaluate close conditions
      if (allOk) {
        // Avoid redundant close if cover is already at expected
        if (currentPos !== null && Math.abs(currentPos - closePosition) <= 5) {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'skip',
            reason: 'Cover bereits in Schließ-Position',
            conditions: sharedConditions,
            state: 'IDLE',
            expectedPosition: null,
          }));
        } else {
          decisions.push(makeDecision({
            ctx, cover, zone, action: 'close',
            reason: oneLineCloseReason(ctx, config, zone),
            conditions: sharedConditions,
            state: 'CLOSED_BY_AUTO',
            expectedPosition: closePosition,
          }));
        }
      } else {
        const failing = sharedConditions.find((c) => !c.ok);
        decisions.push(makeDecision({
          ctx, cover, zone, action: 'skip',
          reason: failing ? `Schließ-Bedingung nicht erfüllt: ${failing.name} — ${failing.detail}` : 'Schließ-Bedingungen nicht erfüllt',
          conditions: sharedConditions,
          state: 'IDLE',
          expectedPosition: null,
        }));
      }
    }
  }

  return decisions;
}

function buildSharedConditions(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  zone: Zone,
): EvaluatedCondition[] {
  const range = ZONE_AZIMUTH_RANGES[zone];
  const inZone = ctx.zones[zone].inZone;
  const pv = ctx.pvPowerW;
  const temp = ctx.indoorTempC;
  const monthOk = ctx.isSummerMode;
  const month = ctx.now.getUTCMonth() + 1;

  return [
    {
      name: 'Sonne in Zone',
      ok: inZone,
      detail: `Azimut ${ctx.sun.azimuthDeg.toFixed(0)}° ∈ [${range.from}°, ${range.to}°]`,
    },
    {
      name: 'PV-Schwelle überschritten',
      ok: pv !== null && pv > ctx.pvThresholdW,
      detail: pv === null
        ? 'PV-Wert nicht verfügbar'
        : `${(pv / 1000).toFixed(2)} kW > ${(ctx.pvThresholdW / 1000).toFixed(2)} kW (Elev ${ctx.sun.elevationDeg.toFixed(0)}°)`,
    },
    {
      name: 'Innentemperatur ≥ Schwelle',
      ok: temp !== null && temp >= config.indoorTempThresholdC,
      detail: temp === null
        ? 'Innentemp nicht verfügbar'
        : `${temp.toFixed(1)} °C ≥ ${config.indoorTempThresholdC} °C`,
    },
    {
      name: 'Sommermodus aktiv',
      ok: monthOk,
      detail: `Monat ${month} ∈ [${config.summerModeMonths.join(', ')}]`,
    },
  ];
}

function checkOpenTrigger(
  ctx: VerschattungContext,
  config: VerschattungConfig,
  zoneCtx: VerschattungContext['zones'][Zone],
): string | null {
  if (!zoneCtx.inZone) return 'Sonne hat Zone verlassen';

  if (
    ctx.pvBelowHalfThresholdSinceMs !== null &&
    (ctx.now.getTime() - ctx.pvBelowHalfThresholdSinceMs) >= config.hysteresisPvDurationMinutes * 60_000
  ) {
    return `PV ≥ ${config.hysteresisPvDurationMinutes} min unter ${(config.hysteresisPvFactor * 100).toFixed(0)} % der Schwelle (Wolken)`;
  }

  if (
    ctx.indoorTempC !== null &&
    ctx.indoorTempC < (config.indoorTempThresholdC - config.hysteresisIndoorTempC)
  ) {
    return `Innentemp ${ctx.indoorTempC.toFixed(1)} °C < ${config.indoorTempThresholdC - config.hysteresisIndoorTempC} °C`;
  }

  if (!ctx.isSummerMode) return 'Sommermodus endet';

  return null;
}

function oneLineCloseReason(ctx: VerschattungContext, config: VerschattungConfig, zone: Zone): string {
  const pv = ctx.pvPowerW;
  const temp = ctx.indoorTempC;
  return `Sonne in ${zone.toUpperCase()} (${ctx.sun.azimuthDeg.toFixed(0)}°), PV ${pv !== null ? (pv / 1000).toFixed(1) + ' kW' : '?'} > ${(ctx.pvThresholdW / 1000).toFixed(1)} kW Schwelle, innen ${temp !== null ? temp.toFixed(1) + ' °C' : '?'} ≥ ${config.indoorTempThresholdC} °C`;
}

function makeDecision(args: {
  ctx: VerschattungContext;
  cover: { id: string };
  zone: Zone;
  action: Decision['action'];
  reason: string;
  conditions: EvaluatedCondition[];
  state: CoverState;
  expectedPosition: number | null;
}): Decision {
  return {
    coverId: args.cover.id,
    zone: args.zone,
    action: args.action,
    reason: args.reason,
    evaluatedConditions: args.conditions,
    appliedAt: args.ctx.now.toISOString(),
    resultingState: args.state,
    expectedPosition: args.expectedPosition,
  };
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test eg-sonnenschutz
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verschattung/automations/eg-sonnenschutz.ts \
        packages/api/src/__tests__/eg-sonnenschutz.test.ts
git commit -m "feat(verschattung): EG-Sonnenschutz rule logic with full TDD coverage"
```

---

## Phase 5 — Engine + Persistence

### Task 13: State-File Persistenz

**Files:**
- Create: `packages/api/src/verschattung/persistence.ts`

- [ ] **Step 1: Datei anlegen**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { OverrideSnapshot } from './override-state.js';

export interface PersistedState {
  covers: OverrideSnapshot;
  pvBelowHalfThresholdSinceMs: number | null;
  savedAt: string;
}

const EMPTY: PersistedState = { covers: {}, pvBelowHalfThresholdSinceMs: null, savedAt: '1970-01-01T00:00:00Z' };

export function loadPersistedState(filePath: string): PersistedState {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<PersistedState>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

export function savePersistedState(filePath: string, state: PersistedState): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/api build && \
git add packages/api/src/verschattung/persistence.ts && \
git commit -m "feat(verschattung): state-file persistence via atomic write"
```

---

### Task 14: Engine — Tick-Loop + Persistenz + Decision-Log

**Files:**
- Create: `packages/api/src/verschattung/engine.ts`
- Test: `packages/api/src/__tests__/engine.test.ts`

- [ ] **Step 1: Test schreiben** (mit Stub-Adaptern, kein echtes MQTT)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Engine } from '../verschattung/engine.js';
import type { CoverActuator, IndoorTempSource, PvPowerSource } from '../verschattung/ports.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

class FakeCovers implements CoverActuator {
  positions = new Map<string, number>();
  setCalls: { id: string; pos: number }[] = [];
  observers: ((id: string, pos: number) => void)[] = [];
  setPosition(id: string, pos: number): Promise<void> {
    this.setCalls.push({ id, pos });
    // simulate Statestream echo
    setTimeout(() => {
      this.positions.set(id, pos);
      for (const cb of this.observers) cb(id, pos);
    }, 5);
    return Promise.resolve();
  }
  observePosition(cb: (id: string, pos: number) => void): void { this.observers.push(cb); }
  current(id: string): number | null { return this.positions.get(id) ?? null; }
  externalSet(id: string, pos: number): void {
    this.positions.set(id, pos);
    for (const cb of this.observers) cb(id, pos);
  }
}
class FakeTemp implements IndoorTempSource {
  value: number | null = 23;
  obs: ((v: number) => void)[] = [];
  current(): number | null { return this.value; }
  observe(cb: (v: number) => void): void { this.obs.push(cb); }
  set(v: number): void { this.value = v; for (const cb of this.obs) cb(v); }
}
class FakePv implements PvPowerSource {
  value: number | null = 4500;
  obs: ((v: number) => void)[] = [];
  current(): number | null { return this.value; }
  observe(cb: (v: number) => void): void { this.obs.push(cb); }
  set(v: number): void { this.value = v; for (const cb of this.obs) cb(v); }
}

describe('Engine', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-')); });

  it('emits close decision and calls actuator when conditions met', async () => {
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);

    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: path.join(dir, 'state.json'),
      now: () => new Date('2026-05-20T11:00:00Z'),  // sun roughly south at this time
    });

    await engine.tick();

    const sudCloses = covers.setCalls.filter((c) => c.pos === 20);
    expect(sudCloses.length).toBeGreaterThan(0);
    const decisions = engine.recentDecisions();
    expect(decisions.some((d) => d.zone === 'sued' && d.action === 'close')).toBe(true);
  });

  it('persists override state on transitions', async () => {
    const stateFile = path.join(dir, 'state.json');
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);
    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: stateFile,
      now: () => new Date('2026-05-20T11:00:00Z'),
    });
    await engine.tick();
    await new Promise((r) => setTimeout(r, 30));   // wait for echoes
    expect(fs.existsSync(stateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(Object.keys(state.covers).length).toBeGreaterThan(0);
  });

  it('detects external override and skips next tick', async () => {
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);
    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: path.join(dir, 'state.json'),
      now: () => new Date('2026-05-20T11:00:00Z'),
    });
    await engine.tick();
    await new Promise((r) => setTimeout(r, 30));

    // user pushes one cover up to 80
    covers.externalSet('cover.galerie_rolladen', 80);
    await new Promise((r) => setTimeout(r, 30));

    // next tick: galerie should not be closed again
    covers.setCalls.length = 0;
    await engine.tick();
    expect(covers.setCalls.find((c) => c.id === 'cover.galerie_rolladen')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test engine
```
Expected: FAIL.

- [ ] **Step 3: Engine implementieren**

```ts
import { computeSunPosition } from './sun.js';
import { evaluateEgSonnenschutz } from './automations/eg-sonnenschutz.js';
import { OverrideStateTracker } from './override-state.js';
import { ZONE_AZIMUTH_RANGES, COVERS, type Zone } from './covers.js';
import { loadPersistedState, savePersistedState } from './persistence.js';
import type { VerschattungConfig } from './config.js';
import type { VerschattungContext } from './context.js';
import type { Decision } from './decision.js';
import type { CoverActuator, IndoorTempSource, PvPowerSource } from './ports.js';

export interface EngineOptions {
  covers: CoverActuator;
  pv: PvPowerSource;
  temp: IndoorTempSource;
  config: VerschattungConfig;
  latitude: number;
  longitude: number;
  stateFilePath: string;
  now?: () => Date;
  decisionLogSize?: number;
}

const DEFAULT_LOG_SIZE = 200;

export class Engine {
  private tracker = new OverrideStateTracker();
  private decisionLog: Decision[] = [];
  private pvBelowHalfThresholdSinceMs: number | null = null;
  private decisionListeners = new Set<(d: Decision) => void>();
  private now: () => Date;

  constructor(private opts: EngineOptions) {
    this.now = opts.now ?? (() => new Date());
    const persisted = loadPersistedState(opts.stateFilePath);
    this.tracker.restore(persisted.covers);
    this.pvBelowHalfThresholdSinceMs = persisted.pvBelowHalfThresholdSinceMs;

    // Subscribe to cover-position changes for override detection
    opts.covers.observePosition((id, pos) => {
      this.tracker.observePosition(id, pos);
      this.persist();
    });
  }

  onDecision(cb: (d: Decision) => void): void { this.decisionListeners.add(cb); }
  recentDecisions(): Decision[] { return [...this.decisionLog]; }
  trackerSnapshot() { return this.tracker.serialize(); }

  buildContext(): VerschattungContext {
    const now = this.now();
    const sun = computeSunPosition(now, this.opts.latitude, this.opts.longitude);
    const pv = this.opts.pv.current();
    const temp = this.opts.temp.current();
    const cfg = this.opts.config;

    const elevationFactor = Math.max(0, sun.elevationDeg) / 90;
    const pvThresholdW = Math.max(
      elevationFactor * cfg.pvThreshold.peakWp * cfg.pvThreshold.factor,
      cfg.pvThreshold.floorW,
    );

    const halfThreshold = pvThresholdW * cfg.hysteresisPvFactor;
    if (pv !== null && pv < halfThreshold) {
      if (this.pvBelowHalfThresholdSinceMs === null) {
        this.pvBelowHalfThresholdSinceMs = now.getTime();
      }
    } else {
      this.pvBelowHalfThresholdSinceMs = null;
    }

    const month = now.getUTCMonth() + 1;
    const isSummerMode = cfg.summerModeMonths.includes(month);

    const positions = new Map<string, number>();
    for (const c of COVERS) {
      const p = this.opts.covers.current(c.id);
      if (p !== null) positions.set(c.id, p);
    }

    const zones = {} as VerschattungContext['zones'];
    for (const zone of ['ost', 'sued', 'west'] as Zone[]) {
      const r = ZONE_AZIMUTH_RANGES[zone];
      zones[zone] = {
        inZone: sun.azimuthDeg > r.from && sun.azimuthDeg <= r.to,
        azimuthDeg: sun.azimuthDeg,
      };
    }

    return {
      now, sun, pvPowerW: pv, indoorTempC: temp, pvThresholdW,
      pvBelowHalfThresholdSinceMs: this.pvBelowHalfThresholdSinceMs,
      isSummerMode, coverPositions: positions, zones,
    };
  }

  async tick(): Promise<void> {
    const ctx = this.buildContext();
    const decisions = evaluateEgSonnenschutz(ctx, this.opts.config, this.tracker);

    for (const d of decisions) {
      this.recordDecision(d);

      if (d.action === 'close' && d.expectedPosition !== null) {
        this.tracker.markClosedByAuto(d.coverId, d.expectedPosition, d.reason);
        try {
          await this.opts.covers.setPosition(d.coverId, d.expectedPosition);
        } catch (e) {
          console.error('[verschattung] setPosition failed', d.coverId, (e as Error).message);
        }
      } else if (d.action === 'open') {
        this.tracker.markIdle(d.coverId, 'auto', d.reason);
        try {
          await this.opts.covers.setPosition(d.coverId, 100);
        } catch (e) {
          console.error('[verschattung] setPosition failed', d.coverId, (e as Error).message);
        }
      }
    }
    this.persist();
  }

  private recordDecision(d: Decision): void {
    const max = this.opts.decisionLogSize ?? DEFAULT_LOG_SIZE;
    this.decisionLog.unshift(d);
    if (this.decisionLog.length > max) this.decisionLog.length = max;
    for (const cb of this.decisionListeners) cb(d);
  }

  private persist(): void {
    savePersistedState(this.opts.stateFilePath, {
      covers: this.tracker.serialize(),
      pvBelowHalfThresholdSinceMs: this.pvBelowHalfThresholdSinceMs,
      savedAt: this.now().toISOString(),
    });
  }

  midnightReset(): void {
    for (const c of COVERS) {
      const e = this.tracker.getState(c.id);
      if (e.state === 'OVERRIDE') this.tracker.markIdle(c.id, 'reset', 'Mitternachts-Reset');
    }
    this.persist();
  }

  setManualPosition(coverId: string, position: number): Promise<void> {
    // Slider in unserer UI: explizit als User-Aktion markieren — Override sofort
    const e = this.tracker.getState(coverId);
    if (e.state === 'CLOSED_BY_AUTO') {
      this.tracker.observePosition(coverId, position + 100); // force drift > tolerance
    }
    return this.opts.covers.setPosition(coverId, position);
  }

  releaseOverride(coverId: string): void {
    this.tracker.markIdle(coverId, 'auto', '"Auto übernehmen" via UI');
    this.persist();
  }
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test engine
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verschattung/engine.ts \
        packages/api/src/__tests__/engine.test.ts
git commit -m "feat(verschattung): engine with tick loop, override tracker integration, decision log"
```

---

### Task 15: HA Cover Actuator Adapter

**Files:**
- Create: `packages/api/src/verschattung/adapters/ha-cover-actuator.ts`

- [ ] **Step 1: Datei anlegen**

```ts
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
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/api build && \
git add packages/api/src/verschattung/adapters/ha-cover-actuator.ts && \
git commit -m "feat(verschattung): HA cover actuator adapter"
```

---

### Task 16: HA Indoor-Temp Source Adapter

**Files:**
- Create: `packages/api/src/verschattung/adapters/ha-temp-source.ts`

- [ ] **Step 1: Datei anlegen**

```ts
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
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/api build && \
git add packages/api/src/verschattung/adapters/ha-temp-source.ts && \
git commit -m "feat(verschattung): HA indoor temp source adapter"
```

---

### Task 17: Victron PV Source Adapter

Adapter um den vorhandenen `mqtt-service.ts`. Der Adapter darf die MQTT-Client-Internals nicht kennen — nur das Public Interface (`getState()`, `on('stateChange', ...)`).

**Files:**
- Create: `packages/api/src/verschattung/adapters/victron-pv-source.ts`

- [ ] **Step 1: Datei anlegen**

```ts
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
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/api build && \
git add packages/api/src/verschattung/adapters/victron-pv-source.ts && \
git commit -m "feat(verschattung): Victron PV source adapter wrapping mqtt-service"
```

---

## Phase 6 — API Layer

### Task 18: OpenAPI-Schema für Verschattung-Endpoints

**Files:**
- Modify: `openapi/spec.yaml`

- [ ] **Step 1: Schema-Sektion ergänzen**

Append before the closing `components:` block. Find `components:` near the end of the file, then add the following routes ABOVE it (under the existing `paths:` section), and add the schemas inside `components.schemas`:

```yaml
  /api/verschattung/state:
    get:
      operationId: getVerschattungState
      summary: Current Verschattung state (cover positions + states + engine inputs)
      responses:
        '200':
          description: Snapshot
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VerschattungStateResponse'

  /api/verschattung/decisions:
    get:
      operationId: getVerschattungDecisions
      summary: Decision log (most recent first)
      responses:
        '200':
          description: Decision array
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/VerschattungDecision'

  /api/verschattung/config:
    get:
      operationId: getVerschattungConfig
      responses:
        '200':
          description: Config
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VerschattungConfig'
    put:
      operationId: putVerschattungConfig
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VerschattungConfig'
      responses:
        '200':
          description: Updated config
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VerschattungConfig'

  /api/verschattung/cover/{id}/position:
    put:
      operationId: putVerschattungCoverPosition
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                position:
                  type: number
              required: [position]
      responses:
        '204':
          description: Sent
  /api/verschattung/cover/{id}/auto:
    post:
      operationId: postVerschattungCoverAuto
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Override released
```

In `components.schemas`, add:

```yaml
    VerschattungStateResponse:
      type: object
      additionalProperties: false
      required: [covers, inputs]
      properties:
        covers:
          type: array
          items:
            $ref: '#/components/schemas/VerschattungCoverState'
        inputs:
          $ref: '#/components/schemas/VerschattungInputs'

    VerschattungCoverState:
      type: object
      additionalProperties: false
      required: [id, zone, floor, label, currentPosition, state, expectedPosition]
      properties:
        id: { type: string }
        zone: { type: string, enum: [ost, sued, west] }
        floor: { type: string, enum: [EG, OG] }
        label: { type: string }
        currentPosition: { type: number, nullable: true }
        state: { type: string, enum: [IDLE, CLOSED_BY_AUTO, OVERRIDE] }
        expectedPosition: { type: number, nullable: true }
        lastEvent:
          type: object
          nullable: true
          properties:
            ts: { type: string }
            source: { type: string, enum: [auto, user, reset] }
            fromPosition: { type: number, nullable: true }
            toPosition: { type: number, nullable: true }
            reason: { type: string, nullable: true }

    VerschattungInputs:
      type: object
      additionalProperties: false
      required: [sun, pvPowerW, pvThresholdW, indoorTempC, isSummerMode]
      properties:
        sun:
          type: object
          required: [azimuthDeg, elevationDeg]
          properties:
            azimuthDeg: { type: number }
            elevationDeg: { type: number }
        pvPowerW: { type: number, nullable: true }
        pvThresholdW: { type: number }
        indoorTempC: { type: number, nullable: true }
        isSummerMode: { type: boolean }

    VerschattungDecision:
      type: object
      additionalProperties: false
      required: [coverId, zone, action, reason, evaluatedConditions, appliedAt, resultingState]
      properties:
        coverId: { type: string }
        zone: { type: string, enum: [ost, sued, west] }
        action: { type: string, enum: [close, open, skip] }
        reason: { type: string }
        evaluatedConditions:
          type: array
          items:
            type: object
            required: [name, ok, detail]
            properties:
              name: { type: string }
              ok: { type: boolean }
              detail: { type: string }
        appliedAt: { type: string }
        resultingState: { type: string, enum: [IDLE, CLOSED_BY_AUTO, OVERRIDE] }
        expectedPosition: { type: number, nullable: true }

    VerschattungConfig:
      type: object
      additionalProperties: false
      required: [zones, pvThreshold, indoorTempThresholdC, hysteresisIndoorTempC, hysteresisPvFactor, hysteresisPvDurationMinutes, summerModeMonths]
      properties:
        zones:
          type: object
          required: [ost, sued, west]
          properties:
            ost:  { $ref: '#/components/schemas/VerschattungZoneTunables' }
            sued: { $ref: '#/components/schemas/VerschattungZoneTunables' }
            west: { $ref: '#/components/schemas/VerschattungZoneTunables' }
        pvThreshold:
          type: object
          required: [peakWp, factor, floorW]
          properties:
            peakWp: { type: number }
            factor: { type: number }
            floorW: { type: number }
        indoorTempThresholdC: { type: number }
        hysteresisIndoorTempC: { type: number }
        hysteresisPvFactor: { type: number }
        hysteresisPvDurationMinutes: { type: number }
        summerModeMonths:
          type: array
          items: { type: integer, minimum: 1, maximum: 12 }

    VerschattungZoneTunables:
      type: object
      required: [closePosition]
      properties:
        closePosition: { type: number, minimum: 0, maximum: 100 }
```

- [ ] **Step 2: Types regenerieren**

```bash
pnpm generate:types
```

- [ ] **Step 3: Build-Check**

```bash
pnpm --filter @energy-control/shared build && pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add openapi/spec.yaml packages/shared/src/api-types.ts
git commit -m "feat(api): openapi schema for verschattung endpoints + regenerated shared types"
```

---

### Task 19: Verschattung Routes

**Files:**
- Create: `packages/api/src/verschattung/routes.ts`
- Test: `packages/api/src/__tests__/verschattung-routes.test.ts`

- [ ] **Step 1: Test schreiben**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerVerschattungRoutes } from '../verschattung/routes.js';
import type { Engine } from '../verschattung/engine.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function makeStubEngine(): Engine {
  return {
    recentDecisions: () => [],
    trackerSnapshot: () => ({}),
    buildContext: () => ({
      now: new Date(),
      sun: { azimuthDeg: 100, elevationDeg: 20 },
      pvPowerW: 1000, indoorTempC: 22, pvThresholdW: 500,
      pvBelowHalfThresholdSinceMs: null, isSummerMode: true,
      coverPositions: new Map(), zones: {
        ost:  { inZone: false, azimuthDeg: 100 },
        sued: { inZone: false, azimuthDeg: 100 },
        west: { inZone: false, azimuthDeg: 100 },
      },
    }),
    setManualPosition: async () => {},
    releaseOverride: () => {},
  } as unknown as Engine;
}

describe('verschattung routes', () => {
  let app: FastifyInstance;
  let configPath: string;

  beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vroutes-'));
    configPath = path.join(dir, 'config.json');
    app = Fastify();
    registerVerschattungRoutes(app, { engine: makeStubEngine(), configPath });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('GET /api/verschattung/state returns snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/state' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('covers');
    expect(body).toHaveProperty('inputs');
  });

  it('GET /api/verschattung/decisions returns array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/decisions' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /api/verschattung/config returns defaults if missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/verschattung/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('PUT /api/verschattung/config persists', async () => {
    const updated = { ...DEFAULT_VERSCHATTUNG_CONFIG, indoorTempThresholdC: 25 };
    const res = await app.inject({
      method: 'PUT', url: '/api/verschattung/config',
      payload: updated, headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().indoorTempThresholdC).toBe(25);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).indoorTempThresholdC).toBe(25);
  });

  it('PUT /api/verschattung/cover/:id/position calls engine.setManualPosition', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/verschattung/cover/cover.galerie_rolladen/position',
      payload: { position: 50 }, headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('POST /api/verschattung/cover/:id/auto releases override', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/verschattung/cover/cover.galerie_rolladen/auto',
    });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Test fail**

```bash
pnpm --filter @energy-control/api test verschattung-routes
```
Expected: FAIL.

- [ ] **Step 3: Routes implementieren**

```ts
import type { FastifyInstance } from 'fastify';
import type { Engine } from './engine.js';
import { COVERS } from './covers.js';
import { loadVerschattungConfig, saveVerschattungConfig, type VerschattungConfig } from './config.js';

export interface VerschattungRouteOptions {
  engine: Engine;
  configPath: string;
}

export function registerVerschattungRoutes(app: FastifyInstance, opts: VerschattungRouteOptions): void {
  const { engine, configPath } = opts;

  app.get('/api/verschattung/state', async () => buildStateResponse(engine));
  app.get('/api/verschattung/decisions', async () => engine.recentDecisions());
  app.get('/api/verschattung/config', async () => loadVerschattungConfig(configPath));

  app.put('/api/verschattung/config', async (req) => {
    const body = req.body as VerschattungConfig;
    saveVerschattungConfig(configPath, body);
    return loadVerschattungConfig(configPath);
  });

  app.put('/api/verschattung/cover/:id/position', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { position } = req.body as { position: number };
    await engine.setManualPosition(id, position);
    reply.status(204).send();
  });

  app.post('/api/verschattung/cover/:id/auto', async (req, reply) => {
    const { id } = req.params as { id: string };
    engine.releaseOverride(id);
    reply.status(204).send();
  });
}

function buildStateResponse(engine: Engine) {
  const ctx = engine.buildContext();
  const tracker = engine.trackerSnapshot();
  return {
    covers: COVERS.map((c) => {
      const t = tracker[c.id] ?? { state: 'IDLE', expectedPosition: null, lastEvent: null };
      return {
        id: c.id, zone: c.zone, floor: c.floor, label: c.label,
        currentPosition: ctx.coverPositions.get(c.id) ?? null,
        state: t.state, expectedPosition: t.expectedPosition,
        lastEvent: t.lastEvent ?? null,
      };
    }),
    inputs: {
      sun: ctx.sun,
      pvPowerW: ctx.pvPowerW,
      pvThresholdW: ctx.pvThresholdW,
      indoorTempC: ctx.indoorTempC,
      isSummerMode: ctx.isSummerMode,
    },
  };
}
```

- [ ] **Step 4: Test pass**

```bash
pnpm --filter @energy-control/api test verschattung-routes
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verschattung/routes.ts \
        packages/api/src/__tests__/verschattung-routes.test.ts
git commit -m "feat(api): verschattung HTTP routes (state, decisions, config, cover control)"
```

---

### Task 20: Bootstrap in `index.ts`

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/server.ts` (engine + register routes + WS-payload erweitern)

- [ ] **Step 1: index.ts erweitern**

Insert imports near existing ones:
```ts
import { HaMqttClient } from './infra/ha/ha-mqtt-client.js';
import { HaMqttListener } from './infra/ha/ha-mqtt-listener.js';
import { HaMqttPublisher } from './infra/ha/ha-mqtt-publisher.js';
import { HaCoverActuator } from './verschattung/adapters/ha-cover-actuator.js';
import { HaTempSource } from './verschattung/adapters/ha-temp-source.js';
import { VictronPvSource } from './verschattung/adapters/victron-pv-source.js';
import { Engine as VerschattungEngine } from './verschattung/engine.js';
import { loadVerschattungConfig } from './verschattung/config.js';
import { loadPvSettings } from './pv-settings.js';
```

After `appState.startRegulation();`, insert:

```ts
  // --- Verschattung-Modul ---
  const verschattungConfigPath = resolve(dataDir, 'verschattung-config.json');
  const verschattungStatePath  = resolve(dataDir, 'verschattung-state.json');
  const pvSettingsPath = resolve(dataDir, 'pv-settings.json');

  const haClient = new HaMqttClient({
    url: config.HA_MQTT_URL,
    username: config.HA_MQTT_USER,
    password: config.HA_MQTT_PASSWORD,
  });
  await haClient.start();
  const haListener  = new HaMqttListener(haClient);
  haListener.start();
  const haPublisher = new HaMqttPublisher(haClient);

  // Indoor-Temp-Sensor: aktuell hardcoded auf den EG-Sensor aus der YAML.
  // Wenn das später konfigurierbar werden soll, in pv-settings o.ä. pflegen.
  const indoorTempEntityId = 'sensor.timmerflotte_temp_hmd_sensor_temperatur_3';

  const haCoverActuator = new HaCoverActuator(haListener, haPublisher);
  const haTempSource    = new HaTempSource(haListener, indoorTempEntityId);
  const victronPvSource = new VictronPvSource(appState.mqtt);

  const pvSettings = loadPvSettings(pvSettingsPath);
  const verschattungEngine = new VerschattungEngine({
    covers: haCoverActuator,
    pv: victronPvSource,
    temp: haTempSource,
    config: loadVerschattungConfig(verschattungConfigPath),
    latitude: pvSettings.latitude,
    longitude: pvSettings.longitude,
    stateFilePath: verschattungStatePath,
  });

  // Tick-Auslöser
  victronPvSource.observe(() => { void verschattungEngine.tick(); });
  haTempSource.observe(()    => { void verschattungEngine.tick(); });
  haCoverActuator.observePosition(() => { void verschattungEngine.tick(); });
  setInterval(() => { void verschattungEngine.tick(); }, 60_000);

  // Mitternachts-Reset
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 1) verschattungEngine.midnightReset();
  }, 60_000);
```

In the `buildServer` call, pass `verschattungEngine` and `verschattungConfigPath`:

```ts
  const server = buildServer({
    appState, inexogyService, gridHistoryService, batteryHistoryService,
    consumptionHistoryService, socHistoryService, pvHistoryService,
    nibePoller, wallboxPoller, pushService, dailySummaryService,
    verschattungEngine, verschattungConfigPath,
  });
```

In the `shutdown` handler add `await haClient.stop();` after `await server.close();`.

- [ ] **Step 2: server.ts erweitern**

Add imports:
```ts
import { registerVerschattungRoutes } from './verschattung/routes.js';
import type { Engine as VerschattungEngine } from './verschattung/engine.js';
```

In `buildServer`'s options interface (search for the `interface BuildServerOptions` or similar), add:
```ts
  verschattungEngine?: VerschattungEngine;
  verschattungConfigPath?: string;
```

After existing route registrations (search for `app.get('/api/health'`), insert:
```ts
  if (options.verschattungEngine && options.verschattungConfigPath) {
    registerVerschattungRoutes(app, {
      engine: options.verschattungEngine,
      configPath: options.verschattungConfigPath,
    });
  }
```

- [ ] **Step 3: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/index.ts packages/api/src/server.ts
git commit -m "feat(api): bootstrap verschattung engine + register routes"
```

---

### Task 21: WebSocket-Push für Verschattung-State

**Files:**
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Broadcast erweitern**

In `server.ts`, locate the `broadcast` function in the WebSocket section. Add to its payload (just before the closing `})` of the JSON.stringify):

```ts
        verschattung: options.verschattungEngine ? {
          state: buildVerschattungSnapshot(options.verschattungEngine),
        } : null,
```

Add helper function near the top of buildServer (or in a small inline closure):

```ts
function buildVerschattungSnapshot(engine: VerschattungEngine) {
  const ctx = engine.buildContext();
  const tracker = engine.trackerSnapshot();
  return {
    covers: Array.from(ctx.coverPositions.entries()).map(([id, pos]) => {
      const t = tracker[id] ?? { state: 'IDLE', expectedPosition: null, lastEvent: null };
      return { id, position: pos, state: t.state, expectedPosition: t.expectedPosition, lastEvent: t.lastEvent ?? null };
    }),
    inputs: {
      sun: ctx.sun, pvPowerW: ctx.pvPowerW, pvThresholdW: ctx.pvThresholdW,
      indoorTempC: ctx.indoorTempC, isSummerMode: ctx.isSummerMode,
    },
    recentDecisions: engine.recentDecisions().slice(0, 20),
  };
}
```

Also subscribe Engine-Decision-Events to trigger broadcast immediately:

In `buildServer`, after the verschattung route registration (Task 20), add:
```ts
  if (options.verschattungEngine) {
    options.verschattungEngine.onDecision(() => {
      // reuse existing broadcast cadence
      try { broadcast(); } catch { /* ignore */ }
    });
  }
```

- [ ] **Step 2: Build-Check**

```bash
pnpm --filter @energy-control/api build
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/server.ts
git commit -m "feat(api): WebSocket push for verschattung state + decisions"
```

---

## Phase 7 — Frontend

### Task 22: WebSocket-Hook für Verschattung

**Files:**
- Create: `packages/web/hooks/use-verschattung.ts`

- [ ] **Step 1: Hook anlegen**

```ts
'use client';
import { useEffect, useState } from 'react';
import type { components } from '@energy-control/shared';

export type VerschattungState = components['schemas']['VerschattungStateResponse'];
export type VerschattungDecision = components['schemas']['VerschattungDecision'];

export interface UseVerschattungResult {
  state: VerschattungState | null;
  decisions: VerschattungDecision[];
}

// Reuses the existing /ws WebSocket. Filters payload for verschattung sub-object.
export function useVerschattung(): UseVerschattungResult {
  const [state, setState] = useState<VerschattungState | null>(null);
  const [decisions, setDecisions] = useState<VerschattungDecision[]>([]);

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.verschattung) {
            // The WS payload uses a slightly different shape (covers carry only id+position+state).
            // For full state we still poll once on connect.
            setDecisions(msg.verschattung.recentDecisions ?? []);
          }
        } catch { /* ignore */ }
      };
    };
    const refresh = async () => {
      try {
        const r = await fetch('/api/verschattung/state');
        if (r.ok && alive) setState(await r.json());
      } catch { /* ignore */ }
      try {
        const r = await fetch('/api/verschattung/decisions');
        if (r.ok && alive) setDecisions(await r.json());
      } catch { /* ignore */ }
    };

    connect();
    refresh();
    const refreshInterval = setInterval(refresh, 30_000);  // light polling for full state
    return () => {
      alive = false;
      ws?.close();
      clearInterval(refreshInterval);
    };
  }, []);

  return { state, decisions };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/hooks/use-verschattung.ts
git commit -m "feat(web): use-verschattung WebSocket+REST hook"
```

---

### Task 23: SVG Floor-Plan EG (Skeleton)

Stylisierter SVG-Grundriss EG mit Außenwand, ein paar Innen-Andeutungen, Raumlabels. **Wichtig:** Cover-Rechtecke werden als Children über die `CoverShape`-Komponente in einer späteren Task hinzugefügt. Diese Task erstellt nur das statische Plan-Skelett.

**Files:**
- Create: `packages/web/app/verschattung/floor-plan-eg.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
import type { ReactNode } from 'react';

export interface FloorPlanProps {
  children?: ReactNode;
}

// viewBox: 0..1000 horizontal (Ost links, West rechts), 0..800 vertikal (Süd oben, Nord unten).
// Maße sind grobe Stilisierung der EG-Architektenplan-Geometrie und werden im
// Frontend-Refinement gemeinsam mit dem User kalibriert.
export function FloorPlanEg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] stroke-[3] fill-none';
  const interior = 'stroke-[var(--border)] stroke-1 fill-none';
  const label = 'fill-[var(--text-secondary)] text-[20px]';

  return (
    <svg viewBox="0 0 1000 800" className="w-full h-auto" role="img" aria-label="Grundriss Erdgeschoss">
      {/* Außenwand (vereinfachtes EG-Rechteck mit kleinen Vorsprüngen) */}
      <path
        d="M 80 80 L 920 80 L 920 720 L 80 720 Z"
        className={wall}
      />
      {/* einige Innenwände als grobe Andeutung */}
      <path d="M 80 280 L 460 280 L 460 80" className={interior} />
      <path d="M 460 280 L 460 480 L 80 480" className={interior} />
      <path d="M 460 480 L 460 720" className={interior} />
      <path d="M 460 280 L 920 280" className={interior} />
      <path d="M 760 280 L 760 720" className={interior} />

      {/* Raumlabels */}
      <text x="200" y="180" className={label}>Küche</text>
      <text x="600" y="180" className={label}>Essen</text>
      <text x="820" y="180" className={label}>Wohnen</text>
      <text x="200" y="380" className={label}>Diele</text>
      <text x="600" y="600" className={label}>Zimmer</text>
      <text x="200" y="600" className={label}>WC</text>

      {/* Himmelsrichtungs-Marker */}
      <text x="500" y="50" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">SÜD</text>
      <text x="500" y="780" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">NORD</text>
      <text x="40"  y="400" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">OST</text>
      <text x="970" y="400" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">WEST</text>

      {children}
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/floor-plan-eg.tsx
git commit -m "feat(web): SVG floor plan EG skeleton (rooms + walls + compass)"
```

---

### Task 24: SVG Floor-Plan OG (Skeleton)

**Files:**
- Create: `packages/web/app/verschattung/floor-plan-og.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
import type { ReactNode } from 'react';
import type { FloorPlanProps } from './floor-plan-eg.js';

export function FloorPlanOg({ children }: FloorPlanProps) {
  const wall = 'stroke-[var(--text-secondary)] stroke-[3] fill-none';
  const interior = 'stroke-[var(--border)] stroke-1 fill-none';
  const label = 'fill-[var(--text-secondary)] text-[20px]';

  return (
    <svg viewBox="0 0 1000 800" className="w-full h-auto" role="img" aria-label="Grundriss Obergeschoss">
      <path d="M 80 80 L 920 80 L 920 720 L 80 720 Z" className={wall} />
      {/* OG-Innenstruktur — symmetrische 4-Zimmer-Anordnung */}
      <path d="M 500 80 L 500 720" className={interior} />
      <path d="M 80 380 L 920 380" className={interior} />

      <text x="250"  y="220" className={label}>Zimmer 4</text>
      <text x="750"  y="220" className={label}>Zimmer 1</text>
      <text x="250"  y="540" className={label}>Zimmer 3</text>
      <text x="750"  y="540" className={label}>Zimmer 2</text>

      <text x="500" y="50"  textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">SÜD</text>
      <text x="500" y="780" textAnchor="middle" className="fill-[var(--text-secondary)] text-[14px]">NORD</text>

      {children}
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/floor-plan-og.tsx
git commit -m "feat(web): SVG floor plan OG skeleton"
```

---

### Task 25: Cover-Shape Component

**Files:**
- Create: `packages/web/app/verschattung/cover-shape.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

export interface CoverShapeProps {
  cover: CoverState;
  svg: { x: number; y: number; side: 'N' | 'S' | 'E' | 'W'; widthMm: number };
  onClick: () => void;
  selected?: boolean;
}

const COVER_LENGTH = 60;     // along the wall in viewBox units
const COVER_THICKNESS = 14;  // perpendicular to the wall

export function CoverShape({ cover, svg, onClick, selected }: CoverShapeProps) {
  // Rectangle dimensions depending on which side the cover sits on
  const isHorizontal = svg.side === 'N' || svg.side === 'S';
  const w = isHorizontal ? COVER_LENGTH : COVER_THICKNESS;
  const h = isHorizontal ? COVER_THICKNESS : COVER_LENGTH;
  const x = svg.x - w / 2;
  const y = svg.y - h / 2;

  const pos = cover.currentPosition ?? 0;        // 0=open, 100=closed
  const fillFraction = pos / 100;

  // Fill rectangle drops "from outside towards inside" of the wall.
  let fillX = x, fillY = y, fillW = w, fillH = h;
  if (isHorizontal) {
    fillH = h * fillFraction;
    if (svg.side === 'S') {
      // outside is bottom-of-viewBox? Our convention: Süd = top = y small.
      // For sued cover, fill grows downward from top (towards inside)
      fillY = y;
    } else {
      // Nord cover: inside is upward — fill grows upward
      fillY = y + (h - fillH);
    }
  } else {
    fillW = w * fillFraction;
    if (svg.side === 'E') {
      // East = left of viewBox; fill grows rightward
      fillX = x;
    } else {
      // West = right; fill grows leftward
      fillX = x + (w - fillW);
    }
  }

  return (
    <g onClick={onClick} className="cursor-pointer">
      <rect
        x={x} y={y} width={w} height={h}
        className={`fill-transparent stroke-[var(--accent)] stroke-[2] ${selected ? 'stroke-[3]' : ''}`}
      />
      {fillFraction > 0 && (
        <rect
          x={fillX} y={fillY} width={fillW} height={fillH}
          className="fill-[var(--accent)] opacity-80 pointer-events-none"
        />
      )}
      <title>{cover.label} — {pos}% {cover.state === 'OVERRIDE' ? '(Override)' : ''}</title>
    </g>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/cover-shape.tsx
git commit -m "feat(web): cover-shape SVG component (fill = position, side-aware orientation)"
```

---

### Task 26: Sun-Indicator Component

**Files:**
- Create: `packages/web/app/verschattung/sun-indicator.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';

export interface SunIndicatorProps {
  azimuthDeg: number;     // 0..360, 0=N, clockwise
  elevationDeg: number;   // -90..+90
}

// viewBox 0..1000 × 0..800. Sun travels on an ellipse outside the house outline.
// Top = SÜD = 180° azimuth; Right = WEST = 270°; etc.
const CX = 500, CY = 400, RX = 470, RY = 380;

export function SunIndicator({ azimuthDeg, elevationDeg }: SunIndicatorProps) {
  if (elevationDeg < 0) return null;  // sun below horizon — don't render

  // Azimuth → position on ellipse. South=180°→top, West=270°→right, North=0°/360°→bottom, East=90°→left.
  const rad = ((azimuthDeg - 180) * Math.PI) / 180;
  const x = CX + RX * Math.sin(rad);
  const y = CY - RY * Math.cos(rad);

  // Brightness scales with elevation (0..1)
  const intensity = Math.min(1, elevationDeg / 60);
  const r = 14 + 6 * intensity;
  const opacity = 0.5 + 0.5 * intensity;

  return (
    <g aria-label="Sonnenposition">
      <circle cx={x} cy={y} r={r} className="fill-yellow-300" style={{ opacity }} />
      <circle cx={x} cy={y} r={r * 1.6} className="fill-yellow-300" style={{ opacity: opacity * 0.3 }} />
      <title>Azimut {azimuthDeg.toFixed(0)}° / Elev {elevationDeg.toFixed(0)}°</title>
    </g>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/sun-indicator.tsx
git commit -m "feat(web): sun indicator on plan periphery (elevation→size, azimuth→ellipse)"
```

---

### Task 27: Cover-Detail-Panel Component

**Files:**
- Create: `packages/web/app/verschattung/cover-detail-panel.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import { useState, useEffect } from 'react';
import type { components } from '@energy-control/shared';

type CoverState = components['schemas']['VerschattungCoverState'];

export interface CoverDetailPanelProps {
  cover: CoverState | null;
  onClose: () => void;
  onSetPosition: (id: string, position: number) => Promise<void>;
  onReleaseOverride: (id: string) => Promise<void>;
}

export function CoverDetailPanel({ cover, onClose, onSetPosition, onReleaseOverride }: CoverDetailPanelProps) {
  const [draftPosition, setDraftPosition] = useState<number>(cover?.currentPosition ?? 100);

  useEffect(() => {
    if (cover?.currentPosition != null) setDraftPosition(cover.currentPosition);
  }, [cover?.id, cover?.currentPosition]);

  if (!cover) return null;

  const stateBadge =
    cover.state === 'OVERRIDE'        ? <span className="text-yellow-400">Override</span> :
    cover.state === 'CLOSED_BY_AUTO'  ? <span className="text-[var(--accent)]">Auto</span> :
                                        <span className="text-[var(--text-secondary)]">Idle</span>;

  return (
    <div className="md:static fixed inset-x-0 bottom-0 z-30 md:z-auto bg-[var(--bg-card)] border-t md:border md:rounded-xl border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">{cover.label}</h3>
          <p className="text-xs text-[var(--text-secondary)]">Zone: {cover.zone.toUpperCase()} · Status: {stateBadge}</p>
        </div>
        <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="schließen">×</button>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <input
            type="range" min={0} max={100} step={1}
            value={draftPosition}
            onChange={(e) => setDraftPosition(Number(e.target.value))}
            onMouseUp={() => onSetPosition(cover.id, draftPosition)}
            onTouchEnd={() => onSetPosition(cover.id, draftPosition)}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="tabular-nums w-12 text-right">{draftPosition}%</span>
        </div>
      </div>

      {cover.lastEvent && (
        <div className="text-xs text-[var(--text-secondary)] mb-3">
          <span className="text-[var(--text-primary)]">Letztes Event:</span>{' '}
          {new Date(cover.lastEvent.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} —{' '}
          {cover.lastEvent.source === 'auto' ? 'Automation' : cover.lastEvent.source === 'user' ? 'manuell' : 'Reset'}
          {cover.lastEvent.toPosition != null ? `: auf ${cover.lastEvent.toPosition}%` : ''}
          {cover.lastEvent.reason ? ` (${cover.lastEvent.reason})` : ''}
        </div>
      )}

      {cover.state === 'OVERRIDE' && (
        <button
          onClick={() => onReleaseOverride(cover.id)}
          className="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-card-hover)] hover:bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30"
        >
          Auf Auto setzen
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/cover-detail-panel.tsx
git commit -m "feat(web): cover detail panel with slider, last event, override release"
```

---

### Task 28: Manual Tab assembly

**Files:**
- Create: `packages/web/app/verschattung/manual-tab.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import { useState } from 'react';
import { FloorPlanEg } from './floor-plan-eg';
import { FloorPlanOg } from './floor-plan-og';
import { CoverShape } from './cover-shape';
import { SunIndicator } from './sun-indicator';
import { CoverDetailPanel } from './cover-detail-panel';
import { useVerschattung } from '../../hooks/use-verschattung';

// Cover SVG-Koordinaten — Source of truth ist Backend-COVERS, hier nur das
// Mapping id → svg-coord für die Web-Render-Schicht (Backend hat dieselben
// Werte; Duplikat akzeptiert für Web-Independence vom Server-Schema).
const SVG_COORDS: Record<string, { x: number; y: number; side: 'N'|'S'|'E'|'W'; widthMm: number }> = {
  'cover.eingang_rolladen':            { x: 100, y: 600, side: 'E', widthMm: 1000 },
  'cover.kuche_vorn_rolladen':         { x: 100, y: 200, side: 'E', widthMm: 1500 },
  'cover.kuche_garten_rolladen':       { x: 250, y:  50, side: 'N', widthMm: 1500 },
  'cover.galerie_rolladen':            { x: 500, y:  50, side: 'N', widthMm: 2700 },
  'cover.shellyplus2pm_cc7b5c0f3484':  { x: 700, y:  50, side: 'N', widthMm: 1100 },
  'cover.shellyplus2pm_e465b8f35e50':  { x: 850, y:  50, side: 'N', widthMm: 1100 },
  'cover.westen_gross_rolladen':       { x: 950, y: 400, side: 'W', widthMm: 2400 },
  'cover.west_klein_rolladen':         { x: 950, y: 250, side: 'W', widthMm: 1100 },
};

export function ManualTab() {
  const { state } = useVerschattung();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const setPosition = async (id: string, position: number) => {
    await fetch(`/api/verschattung/cover/${encodeURIComponent(id)}/position`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position }),
    });
  };
  const releaseOverride = async (id: string) => {
    await fetch(`/api/verschattung/cover/${encodeURIComponent(id)}/auto`, { method: 'POST' });
  };

  const selected = state?.covers.find((c) => c.id === selectedId) ?? null;
  const coversByFloor = (floor: 'EG' | 'OG') => state?.covers.filter((c) => c.floor === floor) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Erdgeschoss</h2>
        <FloorPlanEg>
          {state && <SunIndicator azimuthDeg={state.inputs.sun.azimuthDeg} elevationDeg={state.inputs.sun.elevationDeg} />}
          {coversByFloor('EG').map((c) => {
            const coord = SVG_COORDS[c.id];
            if (!coord) return null;
            return (
              <CoverShape key={c.id} cover={c} svg={coord}
                onClick={() => setSelectedId(c.id)}
                selected={c.id === selectedId} />
            );
          })}
        </FloorPlanEg>
      </div>

      <div>
        <h2 className="text-sm text-[var(--text-secondary)] mb-2">Obergeschoss</h2>
        <FloorPlanOg>
          {coversByFloor('OG').map((c) => {
            const coord = SVG_COORDS[c.id];
            if (!coord) return null;
            return (
              <CoverShape key={c.id} cover={c} svg={coord}
                onClick={() => setSelectedId(c.id)}
                selected={c.id === selectedId} />
            );
          })}
        </FloorPlanOg>
      </div>

      <CoverDetailPanel
        cover={selected}
        onClose={() => setSelectedId(null)}
        onSetPosition={setPosition}
        onReleaseOverride={releaseOverride}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/manual-tab.tsx
git commit -m "feat(web): manual tab with floor plans, cover taps, detail panel wiring"
```

---

### Task 29: Eingangswerte Component (Automation Tab top)

**Files:**
- Create: `packages/web/app/verschattung/eingangswerte.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import type { components } from '@energy-control/shared';

type Inputs = components['schemas']['VerschattungInputs'];

export function Eingangswerte({ inputs }: { inputs: Inputs }) {
  const pvOk = inputs.pvPowerW != null && inputs.pvPowerW > inputs.pvThresholdW;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
      <h3 className="text-sm font-semibold">Eingangswerte</h3>
      <Row label="☀ Sonne" value={`${inputs.sun.azimuthDeg.toFixed(0)}° / ${inputs.sun.elevationDeg.toFixed(0)}°`} />
      <Row
        label="⚡ PV-Leistung"
        value={inputs.pvPowerW != null ? `${(inputs.pvPowerW / 1000).toFixed(2)} kW` : '—'}
        sub={`Schwelle ${(inputs.pvThresholdW / 1000).toFixed(2)} kW`}
        ok={pvOk}
      />
      <Row
        label="🏠 Innentemp"
        value={inputs.indoorTempC != null ? `${inputs.indoorTempC.toFixed(1)} °C` : '—'}
      />
      <Row
        label="📅 Sommermodus"
        value={inputs.isSummerMode ? 'aktiv' : 'inaktiv'}
        ok={inputs.isSummerMode}
      />
    </div>
  );
}

function Row({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={ok === true ? 'text-[var(--accent)]' : ok === false ? 'text-yellow-400' : ''}>
        {value}{sub ? <span className="text-[var(--text-secondary)] text-xs ml-2">({sub})</span> : null}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/eingangswerte.tsx
git commit -m "feat(web): eingangswerte (engine inputs) component"
```

---

### Task 30: Decision-Log Component

**Files:**
- Create: `packages/web/app/verschattung/decision-log.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import { useState } from 'react';
import type { components } from '@energy-control/shared';

type Decision = components['schemas']['VerschattungDecision'];

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-secondary)]">
        Noch keine Entscheidungen geloggt.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]">
      <h3 className="text-sm font-semibold px-4 py-3">Decision-Log</h3>
      {decisions.map((d, i) => {
        const key = `${d.appliedAt}-${d.coverId}-${i}`;
        const open = expanded.has(key);
        const time = new Date(d.appliedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const actionColor =
          d.action === 'close' ? 'text-yellow-400' :
          d.action === 'open'  ? 'text-[var(--accent)]' :
                                  'text-[var(--text-secondary)]';
        return (
          <div key={key} className="px-4 py-2 text-sm">
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-start gap-3 text-left hover:bg-[var(--bg-card-hover)] -mx-4 px-4 py-1 cursor-pointer"
              aria-expanded={open}
            >
              <span className="text-xs text-[var(--text-secondary)] w-12 tabular-nums shrink-0">{time}</span>
              <span className="text-xs uppercase w-12 shrink-0">{d.zone}</span>
              <span className={`text-xs shrink-0 w-12 ${actionColor}`}>{d.action}</span>
              <span className="text-[var(--text-secondary)]">{d.reason}</span>
            </button>
            {open && (
              <ul className="mt-2 pl-24 space-y-1 text-xs">
                {d.evaluatedConditions.map((c, j) => (
                  <li key={j}>
                    <span className={c.ok ? 'text-[var(--accent)]' : 'text-yellow-400'}>{c.ok ? '☑' : '☐'}</span>{' '}
                    <span className="text-[var(--text-primary)]">{c.name}</span>{' '}
                    <span className="text-[var(--text-secondary)]">— {c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/decision-log.tsx
git commit -m "feat(web): decision-log component with expandable conditions"
```

---

### Task 31: Zone-Evaluation Component

Live-Übersicht aktueller Bewertung pro Zone. Aggregiert aus `state.covers` + letzten Decisions pro Zone.

**Files:**
- Create: `packages/web/app/verschattung/zone-evaluation.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import type { components } from '@energy-control/shared';
import { useState } from 'react';

type State = components['schemas']['VerschattungStateResponse'];

export function ZoneEvaluation({ state }: { state: State }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const zones: ('ost' | 'sued' | 'west')[] = ['ost', 'sued', 'west'];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] divide-y divide-[var(--border)]">
      <h3 className="text-sm font-semibold px-4 py-3">Zonen-Bewertung</h3>
      {zones.map((z) => {
        const inZone = state.covers.length > 0; // placeholder; refined below
        const covers = state.covers.filter((c) => c.zone === z);
        const closed = covers.filter((c) => c.state === 'CLOSED_BY_AUTO').length;
        const overrides = covers.filter((c) => c.state === 'OVERRIDE').length;
        return (
          <div key={z} className="px-4 py-2 text-sm">
            <button
              onClick={() => setOpen((s) => ({ ...s, [z]: !s[z] }))}
              className="w-full flex justify-between items-center hover:bg-[var(--bg-card-hover)] -mx-4 px-4 py-1 cursor-pointer"
              aria-expanded={!!open[z]}
            >
              <span className="font-medium uppercase">{z}</span>
              <span className="text-[var(--text-secondary)] text-xs">
                {closed}/{covers.length} zu{overrides > 0 ? `, ${overrides} Override` : ''}
              </span>
            </button>
            {open[z] && (
              <ul className="mt-2 pl-3 space-y-1 text-xs">
                {covers.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className="text-[var(--text-secondary)]">
                      {c.currentPosition != null ? `${c.currentPosition}%` : '—'} · {c.state}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/zone-evaluation.tsx
git commit -m "feat(web): zone evaluation card with per-cover detail expansion"
```

---

### Task 32: Settings-Section Component

UI-editierbare Tunables direkt im Verschattung-Tab (Footer-Sektion im Automation-Tab).

**Files:**
- Create: `packages/web/app/verschattung/settings-section.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { components } from '@energy-control/shared';

type Config = components['schemas']['VerschattungConfig'];

export function SettingsSection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/verschattung/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  if (!config) return null;

  const save = async (updated: Config) => {
    setConfig(updated);
    await fetch('/api/verschattung/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4 text-sm">
      <h3 className="text-sm font-semibold flex items-center justify-between">
        Tunables
        {saved && <span className="text-xs text-[var(--accent)]">gespeichert</span>}
      </h3>

      <NumberField label="Innentemp-Schließschwelle (°C)" value={config.indoorTempThresholdC}
        onCommit={(v) => save({ ...config, indoorTempThresholdC: v })} />
      <NumberField label="Innentemp-Hysterese (°C)" value={config.hysteresisIndoorTempC}
        onCommit={(v) => save({ ...config, hysteresisIndoorTempC: v })} />

      <NumberField label="PV peak Wp" value={config.pvThreshold.peakWp}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, peakWp: v } })} />
      <NumberField label="PV factor" step={0.05} value={config.pvThreshold.factor}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, factor: v } })} />
      <NumberField label="PV floor (W)" value={config.pvThreshold.floorW}
        onCommit={(v) => save({ ...config, pvThreshold: { ...config.pvThreshold, floorW: v } })} />

      <NumberField label="PV-Hysterese-Faktor" step={0.05} value={config.hysteresisPvFactor}
        onCommit={(v) => save({ ...config, hysteresisPvFactor: v })} />
      <NumberField label="PV-Hysterese-Dauer (Minuten)" value={config.hysteresisPvDurationMinutes}
        onCommit={(v) => save({ ...config, hysteresisPvDurationMinutes: v })} />

      <div>
        <label className="block text-[var(--text-secondary)] mb-1">Sommermodus-Monate</label>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const on = config.summerModeMonths.includes(m);
            return (
              <button key={m}
                onClick={() => save({
                  ...config,
                  summerModeMonths: on
                    ? config.summerModeMonths.filter((x) => x !== m)
                    : [...config.summerModeMonths, m].sort((a, b) => a - b),
                })}
                className={`px-2 py-1 rounded text-xs border ${on ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)]'}`}>
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {(['ost', 'sued', 'west'] as const).map((z) => (
        <NumberField key={z} label={`Zielposition ${z.toUpperCase()} (%)`} value={config.zones[z].closePosition}
          onCommit={(v) => save({ ...config, zones: { ...config.zones, [z]: { closePosition: v } } })} />
      ))}
    </div>
  );
}

function NumberField({ label, value, onCommit, step = 1 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <div className="flex justify-between items-center">
      <label className="text-[var(--text-secondary)]">{label}</label>
      <input type="number" step={step} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = Number(draft); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        className="w-24 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-right tabular-nums" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/settings-section.tsx
git commit -m "feat(web): settings section for tunables (auto-save on blur)"
```

---

### Task 33: Automation-Tab Assembly

**Files:**
- Create: `packages/web/app/verschattung/automation-tab.tsx`

- [ ] **Step 1: Datei anlegen**

```tsx
'use client';
import { useVerschattung } from '../../hooks/use-verschattung';
import { Eingangswerte } from './eingangswerte';
import { ZoneEvaluation } from './zone-evaluation';
import { DecisionLog } from './decision-log';
import { SettingsSection } from './settings-section';

export function AutomationTab() {
  const { state, decisions } = useVerschattung();

  if (!state) return <div className="text-[var(--text-secondary)]">Lade…</div>;

  return (
    <div className="space-y-4">
      <Eingangswerte inputs={state.inputs} />
      <ZoneEvaluation state={state} />
      <DecisionLog decisions={decisions} />
      <SettingsSection />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/verschattung/automation-tab.tsx
git commit -m "feat(web): automation tab assembly"
```

---

### Task 34: Verschattung-Page mit Tab-Switch

Den vorhandenen Stub durch das echte Tab-Layout ersetzen.

**Files:**
- Modify: `packages/web/app/verschattung/page.tsx`

- [ ] **Step 1: Stub ersetzen**

Replace the entire content with:

```tsx
'use client';
import { useState } from 'react';
import { Blinds } from 'lucide-react';
import { ManualTab } from './manual-tab';
import { AutomationTab } from './automation-tab';

export default function VerschattungPage() {
  const [tab, setTab] = useState<'manual' | 'automation'>('manual');

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Blinds size={28} className="text-[var(--accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Verschattung</h1>
        </div>
      </header>

      <div className="flex gap-2 mb-6 border-b border-[var(--border)]">
        <TabButton active={tab === 'manual'}      onClick={() => setTab('manual')}>Manuell</TabButton>
        <TabButton active={tab === 'automation'}  onClick={() => setTab('automation')}>Automation</TabButton>
      </div>

      {tab === 'manual'     ? <ManualTab />     : null}
      {tab === 'automation' ? <AutomationTab /> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
        active
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Build + Commit**

```bash
pnpm --filter @energy-control/web build && \
git add packages/web/app/verschattung/page.tsx && \
git commit -m "feat(web): verschattung page with manual/automation tab switch"
```

---

## Phase 8 — HA-side Konfiguration & End-to-End

### Task 35: HA-Konfigurations-Snippets dokumentieren

**Files:**
- Create: `docs/ha-config-snippets.md`

- [ ] **Step 1: Datei anlegen**

```markdown
# Home-Assistant-Side Konfiguration für Energy-Control-Verschattung

Damit das Verschattungs-Modul mit HA reden kann, sind zwei Eingriffe in der HA-Instanz nötig.

## 1. MQTT Statestream aktivieren

In `configuration.yaml` von HA folgenden Block sicherstellen:

\`\`\`yaml
mqtt_statestream:
  base_topic: homeassistant
  publish_attributes: true       # WICHTIG — sonst kommt 'current_position' nicht mit
  publish_timestamps: true
  include:
    domains:
      - sensor
      - cover
      - binary_sensor
\`\`\`

Nach Änderung: HA neustarten.

## 2. MQTT Service-Bridge-Automation

In den Automationen anlegen (Settings → Automations & Scenes → "+", dann „YAML-Modus"):

\`\`\`yaml
- alias: "Energy Control: MQTT Service Bridge"
  description: "Übersetzt Publishes auf energy_control/service/<domain>/<service> in HA-Service-Calls"
  trigger:
    platform: mqtt
    topic: "energy_control/service/+/+"
  action:
    service: "{{ trigger.topic.split('/')[2] }}.{{ trigger.topic.split('/')[3] }}"
    data: "{{ trigger.payload_json }}"
\`\`\`

## 3. MQTT-User für die Energy-Control-API

Wenn noch nicht vorhanden, in HA's MQTT-Broker-Konfig (Mosquitto-Add-on o.ä.) einen User mit Pub/Sub-Rechten anlegen:
- Username: z.B. `energy_control`
- Password: stark wählen
- ACL: subscribe `homeassistant/#`, `energy_control/#`, publish `energy_control/#`

Dann in der `.env` der Energy-Control-API hinterlegen:

\`\`\`
HA_MQTT_URL=mqtt://homeassistant.local:1883
HA_MQTT_USER=energy_control
HA_MQTT_PASSWORD=<Passwort>
\`\`\`

## 4. Verifikation

Nach Konfiguration:

\`\`\`bash
# Subscribe-Test (von einer beliebigen Maschine im Netz)
mosquitto_sub -h homeassistant.local -u energy_control -P <pw> -t 'homeassistant/cover/#' -v
\`\`\`

Eine Cover-Bewegung in HA sollte sofort Topic-Updates auslösen.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ha-config-snippets.md
git commit -m "docs: HA-side config snippets for verschattung integration"
```

---

### Task 36: End-to-End-Smoke-Test (manuell)

**Files:**
- (no source changes; checklist of manual verification steps)

- [ ] **Step 1: HA-Side prüfen**

```bash
mosquitto_sub -h homeassistant.local -u energy_control -P <pw> -t 'homeassistant/cover/#' -v
```
Expected: Cover-State-Updates kommen rein, sobald in HA ein Cover bewegt wird.

- [ ] **Step 2: API starten**

```bash
pnpm --filter @energy-control/api dev
```
Expected logs include `[mqtt]` (Victron) und `[ha-mqtt]` Connection-Logs (kein Error). Engine-Tick alle 60s sichtbar.

- [ ] **Step 3: Web-App öffnen**

```bash
pnpm --filter @energy-control/web dev
```
Open http://localhost:3000/verschattung. Tab-Switch zwischen Manuell und Automation funktioniert. Cover sind im EG/OG-Plan sichtbar mit Füllgrad.

- [ ] **Step 4: Manuelle Steuerung testen**

Cover im EG-Plan antippen → Detail-Panel erscheint mit Slider. Slider verschieben + loslassen → Cover fährt physisch (per HA bestätigt).

- [ ] **Step 5: Override testen**

Wenn die Engine ein Cover via Sonnenschutz schließt: in der HA-App den gleichen Cover hochfahren. Erwarten:
- Verschattung-UI zeigt State auf OVERRIDE.
- Engine-Tick fasst diesen Cover nicht mehr an.
- Andere Cover derselben Zone bleiben unter Auto-Steuerung.
- Im Detail-Panel erscheint Button „Auf Auto setzen", Klick → State zurück auf IDLE.

- [ ] **Step 6: Mitternachts-Reset testen**

Aufeinanderfolgende Tage beobachten oder Server-Zeit faken (z.B. `now`-Override im Engine-Constructor temporär einschalten). Erwarten: Override-States lösen sich um 00:01 auf, persistente State-Datei aktualisiert.

- [ ] **Step 7: Wenn alles passt — final commit / merge**

```bash
git status
# (sollte clean sein — alle Tasks committed)
git log --oneline -30
```

---

## Self-Review-Notiz

Spec-Coverage geprüft: alle Anforderungen aus `2026-05-05-verschattung-eg-sonnenschutz-design.md` abgedeckt — HA-MQTT Reads (Task 4) + Writes (Task 5), Sun lokal (Task 6), Per-Cover-Override symmetrisch (Task 11), Engine-Logik mit allen Bedingungen (Task 12), Boot-Reconciliation via persisted state (Tasks 13/14), Manual+Automation-Tabs (Tasks 28/33), Decision-Log + Eingangswerte (Tasks 29/30), Settings-Section (Task 32), HA-Side-Config (Task 35), End-to-End-Smoke (Task 36).

Placeholder-Scan: alle Tasks haben konkrete Pfade und Code; SVG-Koordinaten sind initial Placeholders mit dem Hinweis, dass sie in Frontend-Phase mit dem User kalibriert werden — das ist ein bewusster, dokumentierter Schritt, kein Plan-Defizit.

Typ-Konsistenz: `Zone = 'ost' | 'sued' | 'west'` durchgängig (auch in OpenAPI-Schema), `CoverState = 'IDLE' | 'CLOSED_BY_AUTO' | 'OVERRIDE'` durchgängig, `Decision`-Felder identisch in Backend und OpenAPI.
