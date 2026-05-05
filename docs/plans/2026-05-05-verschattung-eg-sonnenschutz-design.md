# Verschattung — EG Sonnenschutz (Erste Automation)

**Status:** Design — Implementation noch offen
**Datum:** 2026-05-05
**Branch:** `feature/verschattung`

---

## Ziel

Die bestehende Home-Assistant-YAML-Automation für den EG-Sonnenschutz in dieser App
neu aufbauen — mit zwei Verbesserungen gegenüber dem Original:

1. **Volle Transparenz im Frontend.** Jede Engine-Aktion muss mit einer
   maschinenlesbaren *und* menschenlesbaren Begründung sichtbar sein. Es soll
   jederzeit klar sein, *warum* ein Rolladen jetzt so steht, wie er steht.
2. **Saubere Erweiterbarkeit.** Spätere Automationen (OG, Lüftung, Wärme) sollen
   ohne Eingriffe in den bestehenden Code andocken.

Out of scope für diese Spec:
- OG-Automationen (nur Visualisierung + manuelle Bedienung im OG)
- Forecast-Funktionalität („Süd schließt vsl. um 14:08")
- JSONL-Decision-Log auf Disk (in-memory Ring-Buffer reicht)
- Anwesenheitserkennung, Wetterdaten von extern, Wind-Schutz
- Per-Cover-Innentemp-Sensoren (ein Sensor fürs offene EG)

---

## Architektur

### Schichten

```
                     ┌────────────────────┐
Victron-MQTT ────────┤  infra/mqtt-       │ ─── EVENT BUS ──┐
                     │  victron.ts        │                 │
                     └────────────────────┘                 │
                                                            ▼
                     ┌────────────────────┐         ┌─────────────────┐
HA-MQTT ─────────────┤  infra/ha/         │ ──────► │  verschattung/  │
                     │  ha-mqtt-          │         │  Domain-Modul   │
                     │  listener.ts       │         │                 │
                     │  ha-mqtt-          │         │  importiert     │
                     │  publisher.ts      │ ◄────── │  KEIN solar/    │
                     └────────────────────┘         └─────────────────┘
```

**Regeln:**

1. **Domain-Module reden nicht miteinander.** `verschattung/` importiert nichts
   aus `solar/`. Wenn Daten aus dem Victron-System gebraucht werden, fließen sie
   über die gemeinsame Infrastruktur-Schicht — nicht über Domain-Code.
2. **Eine MQTT-Connection pro Broker.** `infra/mqtt-victron.ts` öffnet *eine*
   Verbindung zum Victron-Broker, parsed Topics zu typisierten Events, und
   verteilt diese intern an *alle* interessierten Konsumenten. Analog
   `infra/ha/`.
3. **Hexagonal Ports.** `verschattung/ports.ts` definiert Interfaces für die
   Capabilities, die das Modul *braucht* (`CoverActuator`, `IndoorTempSource`,
   `PvPowerSource`). Konkrete Adapter (`HaCoverActuator`, `VictronPvSource`,
   `HaTempSource`) werden im Bootstrap injiziert.

### Modul-Layout

```
packages/api/src/
├── infra/
│   ├── mqtt-victron.ts      # bestehender Code; Refactor zu typed EventEmitter
│   └── ha/
│       ├── ha-mqtt-client.ts        # neue Verbindung zu homeassistant.local:1883
│       ├── ha-mqtt-listener.ts      # Statestream-Subscribe (cover, sensor)
│       └── ha-mqtt-publisher.ts     # publish auf energy_control/service/...
│
├── verschattung/
│   ├── ports.ts                     # CoverActuator, IndoorTempSource, PvPowerSource
│   ├── sun.ts                       # lokale Sonnenposition via suncalc
│   ├── automations/
│   │   └── eg-sonnenschutz.ts       # tick(ctx) → Decision[]
│   ├── engine.ts                    # Tick-Loop, State-Machine, Decision-Log
│   ├── context.ts                   # Eingangs-Snapshot
│   ├── decision.ts                  # Output-Typ
│   ├── override-state.ts            # Per-Cover-State + Persistenz
│   ├── config.ts                    # Tunables-Load/Save
│   └── routes.ts                    # HTTP+WS-Endpoints
│
└── (Solar-Bestand unangetastet)

packages/shared/src/
└── verschattung-types.ts             # Cover, Zone, Decision, State (geteilt)

packages/web/app/verschattung/
├── page.tsx                          # Tab-Switch (Manuell / Automation)
├── manual-tab.tsx
├── automation-tab.tsx
├── floor-plan-eg.tsx                 # SVG, EG
├── floor-plan-og.tsx                 # SVG, OG
├── sun-indicator.tsx                 # Sonne am Plan-Rand
├── cover-shape.tsx                   # interaktives Cover-Rechteck
├── cover-detail-panel.tsx            # Bottom-Sheet (Mobile) / Side-Panel (Desktop)
└── decision-log.tsx                  # chronologische Liste im Automation-Tab
```

---

## Externes System: Home Assistant

### Anbindung: MQTT in beide Richtungen

**Reads** über `mqtt_statestream`:
- `homeassistant/cover/<id>/state` — auf/zu/öffnend/schließend
- `homeassistant/cover/<id>/current_position` — 0–100 (Pflicht: `publish_attributes: true`)
- `homeassistant/sensor/<id>/state` — Innentemperatur

**Writes** über eine 6-Zeilen Bridge-Automation in HA:
```yaml
- alias: "Energy Control: MQTT Service Bridge"
  trigger:
    platform: mqtt
    topic: "energy_control/service/+/+"
  action:
    service: "{{ trigger.topic.split('/')[2] }}.{{ trigger.topic.split('/')[3] }}"
    data: "{{ trigger.payload_json }}"
```

Die App publiziert z.B. auf `energy_control/service/cover/set_cover_position` mit
Payload `{ "entity_id": "cover.galerie_rolladen", "position": 20 }`. HA ruft den
Service auf. Eine Antwort wird *nicht* erwartet — der neue Zustand kommt
ohnehin über Statestream zurück.

### Voraussetzungen in HA (vor erstem Test prüfen)

1. `mqtt_statestream` ist aktiv und publisht `cover` *und* `sensor`-Domain mit
   `publish_attributes: true`.
2. Die Bridge-Automation oben ist eingerichtet.
3. MQTT-User mit Pub/Sub-Rechten existiert (Default: `mqtt_user`).
4. Energy-Control-API hat Zugriff auf `homeassistant.local:1883`.

---

## Domänenlogik: EG-Sonnenschutz

### Zonen

Drei Zonen, identisch zur YAML:

| Zone | Azimut-Range | Cover (Beispiele aus YAML)                                         |
|------|--------------|--------------------------------------------------------------------|
| Ost  | 70°–145°     | `cover.eingang_rolladen`, `cover.kuche_vorn_rolladen`              |
| Süd  | 110°–260°    | `cover.kuche_garten_rolladen`, `cover.galerie_rolladen`, 2× Shelly |
| West | 215°–290°    | `cover.westen_gross_rolladen`, `cover.west_klein_rolladen`         |

Konkrete Cover-IDs werden in `verschattung/config.ts` als Konstante hinterlegt
(strukturelle Konfig, nicht UI-editierbar — der User hilft beim Mapping).

### Schließ-Regel

Engine schließt ein Cover auf die *Schließ-Position* (Default 20 %, pro Zone
konfigurierbar) wenn **alle** folgenden Bedingungen gleichzeitig zutreffen:

1. **Sonne in Zone** — aktueller Sonnen-Azimut liegt im Zone-Range
2. **PV-Schwelle überschritten** — aktuelle PV-Leistung > dynamische Schwelle:
   ```
   schwelle_W = max(elevation/90 × peakWp × factor, floorW)
   default: peakWp = 4700, factor = 0.85, floorW = 300
   ```
3. **Innentemperatur ≥ Schwelle** — Default 22 °C, konfigurierbar
4. **Sommermodus aktiv** — aktueller Monat ∈ konfigurierte Monate
   (Default: April–Oktober)
5. **Cover ist nicht in OVERRIDE**

### Öffnen-Regel

Engine öffnet ein Cover auf 100 %, wenn dieses Cover gerade `CLOSED_BY_AUTO` ist
**und** *eines* der folgenden Ereignisse:

- Sonne hat Zone verlassen (Azimut out of range)
- PV-Leistung war ≥ 10 min unter 50 % der Schwelle (Hysterese gegen
  Wolken-Flackern)
- Innentemp ist unter (Schließschwelle − 1 °C) gefallen
- Sommermodus endet

### Override-Regel

Cover wechselt von `CLOSED_BY_AUTO` zu `OVERRIDE`, wenn der Cover-Position-Wert
über Statestream eine Position meldet, die in **beide Richtungen** mehr als 5 %
von der *expected position* abweicht — also sowohl wenn der User höher fährt
(typischer Override-Fall) als auch wenn er noch weiter zumacht als die Engine
geplant hatte. Das deckt App-Slider, HA-App, physische Schalter, Sprach-
assistenten und sonstige externe Eingriffe gleichermaßen ab.

Damit ein Cover überhaupt in OVERRIDE wechseln kann, muss es vorher in
`CLOSED_BY_AUTO` sein. Der Übergang nach `CLOSED_BY_AUTO` erfolgt erst, *nachdem*
das Statestream-Echo den Befehl bestätigt hat (siehe Race-Condition-Schutz im
Engine-Abschnitt). Damit zählt jede *spätere* Position-Abweichung sicher als
externer Eingriff, nicht als Echo des eigenen Befehls.

`OVERRIDE` löst sich auf, wenn:
- Sonne verlässt die Zone des Covers, ODER
- 00:01 Mitternacht erreicht ist, ODER
- der User im Detail-Panel des Covers explizit *„Auf Auto setzen"* klickt.

Beim Übergang `OVERRIDE → IDLE` wird **kein** Auto-Open-Befehl gesendet — die
User-Position bleibt respektiert. Erst beim nächsten Schließ-Trigger greift die
Engine wieder.

### Per-Cover-State-Machine

```
              ┌────── IDLE ──────┐
              │   (kein State)   │
              └────┬────────┬────┘
                   │        ▲
   Schließ-        │        │  ┌─ Sonne verlässt Zone
   Bedingungen     │        ├──┤  PV unter 50% × 10min
   erfüllt         │        │  ├─ Innentemp unter Schwelle−1°C
                   │        │  └─ Sommermodus endet
                   ▼        │
              ┌──────────────────┐
              │ CLOSED_BY_AUTO   │
              │ Engine besitzt   │
              │ Expected: 20%    │
              └────┬─────────────┘
                   │
   Cover-Position  │
   ≠ Expected      │
   (>5 %, beide    │
   Richtungen)     │
                   ▼
              ┌──────────────────┐
              │    OVERRIDE      │
              │ User-Position    │
              │ wird respektiert │
              └────┬─────────────┘
                   │
   ┌─ Sonne verlässt Zone
   ├─ Mitternacht
   ├─ "Auto übernehmen"-Click
   │
   └─► IDLE  (kein Auto-Open)
```

---

## Engine

### Tick-Auslöser

**Event-basiert** (primär):
- HA: Cover-Position-Änderung → Override-Check + Re-Evaluate dieser Zone
- HA: Innentemperatur-Änderung → Re-Evaluate alle Zonen
- Victron: PV-Leistung-Änderung → Re-Evaluate alle Zonen

**Periodisch:**
- Alle 60 s als Sicherheitsnetz (deckt Sonnenstand-Drift ab)

### Tick-Ablauf

1. `Context` aufbauen aus aktuellen Cache-Werten der Adapter:
   - `sun = suncalc(now, lat, lon)`
   - `pv = lastVictronEvent.pvPowerW`
   - `indoorTemp = lastHaSensorEvent.value`
   - `covers = lastHaStatestreamSnapshot`
2. Für jede registrierte Automation: `automation.evaluate(context)` → `Decision[]`
3. Pro `Decision`:
   - Wenn `action: 'close'` und Cover nicht bereits CLOSED_BY_AUTO: MQTT-Publish,
     State auf CLOSED_BY_AUTO setzen, expected position speichern
   - Wenn `action: 'open'` und Cover ist CLOSED_BY_AUTO: MQTT-Publish,
     State auf IDLE
   - Wenn `action: 'skip'`: nichts tun
4. Decision in Ring-Buffer schreiben (max. 200 Einträge)
5. Live-Update via WebSocket an alle verbundenen Web-Clients

### Sonnenposition

Lokal über `suncalc`-Lib berechnet. Inputs: Lat/Lon (aus `pv-settings.ts`,
read-only via Bootstrap übergeben), aktuelle UTC-Zeit. Outputs: Azimut, Elevation
in Grad. Genauigkeit ±0,1° — ausreichend bei 75°+ breiten Zonen.

### Race-Condition-Schutz

Beim Senden eines Schließ-Befehls wartet die Engine auf das Statestream-Echo
(neue Position erscheint im Cache), *bevor* sie den State auf `CLOSED_BY_AUTO`
setzt. Wenn das Echo nicht innerhalb von 10 Sekunden kommt, wird ein Warning
geloggt; State bleibt auf IDLE, nächster Tick wird's erneut versuchen.

---

## Datenmodell

### Decision (geteilter Typ)

```ts
interface Decision {
  coverId: string;
  zone: 'ost' | 'süd' | 'west';
  action: 'close' | 'open' | 'skip';
  reason: string;                          // Klartext, eine Zeile
  evaluatedConditions: {
    name: string;                          // z.B. "Sonne in Zone"
    ok: boolean;
    detail: string;                        // z.B. "Azimut 167° ∈ [110°, 260°]"
  }[];
  appliedAt: string;                       // ISO-Timestamp
  resultingState: 'IDLE' | 'CLOSED_BY_AUTO' | 'OVERRIDE';
  expectedPosition: number | null;
}
```

Eine `Decision` pro Cover pro Tick (auch `skip`-Decisions werden geloggt — wichtig
für Transparenz: man kann später nachvollziehen, warum *nichts* passiert ist).

### Konfiguration (UI-editierbar, persistent)

```ts
interface VerschattungConfig {
  zones: {
    ost: ZoneConfig;
    süd: ZoneConfig;
    west: ZoneConfig;
  };
  pvThreshold: { peakWp: number; factor: number; floorW: number; };
  indoorTempThresholdC: number;            // Default 22
  hysteresisIndoorTempC: number;           // Default 1
  hysteresisPvFactor: number;              // Default 0.5
  hysteresisPvDurationMinutes: number;     // Default 10
  summerModeMonths: number[];              // Default [4..10]
}
interface ZoneConfig {
  azimuthFrom: number;
  azimuthTo: number;
  closePosition: number;                   // Default 20
}
```

Persistiert in `data/verschattung-config.json`. UI-editierbar im Settings-Bereich
des Verschattung-Tabs.

### Cover-Mapping (strukturell, im Code)

```ts
interface CoverDef {
  id: string;                              // z.B. "cover.galerie_rolladen"
  zone: 'ost' | 'süd' | 'west';
  floor: 'EG' | 'OG';
  label: string;                           // UI-Anzeige
  svg: { x: number; y: number; side: 'N'|'S'|'E'|'W'; widthMm: number; };
}
```

Liste in `verschattung/config.ts` als Konstante.

### Cover-State (persistent)

```ts
interface CoverState {
  state: 'IDLE' | 'CLOSED_BY_AUTO' | 'OVERRIDE';
  expectedPosition: number | null;
  sinceTs: string;
  lastEvent: {
    ts: string;
    source: 'auto' | 'user' | 'reset';
    fromPosition: number | null;
    toPosition: number;
    reason: string | null;
  };
}
```

Persistiert in `data/verschattung-state.json`, geschrieben bei jedem Übergang
(atomic write).

### Boot-Reconciliation

Beim Hochfahren:
1. State-File laden.
2. HA-Statestream-Snapshot abwarten.
3. Pro Cover: Wenn aktuelle Position deutlich (>5 %) von `expectedPosition`
   abweicht, State auf OVERRIDE korrigieren — User hat zwischenzeitlich
   eingegriffen.
4. Wenn die persistente State-Datei nicht existiert, alle Cover starten als IDLE.

---

## Frontend

### Globale Anforderung: Transparenz

Jede Engine-Aktion erscheint im Decision-Log mit Begründung. Jeder Eingangswert
(Sonne, PV, Innentemp, Sommermodus) ist im Automation-Tab sichtbar. Jeder
konfigurierbare Tunable hat einen UI-Regler. Diese Regel überschreibt
UI-Schlichtheit-Wünsche bei Konflikten.

### Tab-Aufbau

Oben in der Verschattung-Seite ein zweistufiger Tab-Switch: **Manuell** /
**Automation**.

#### Tab „Manuell"

- SVG-Grundriss EG, darunter SVG-Grundriss OG (Mobile: gestapelt; Desktop:
  nebeneinander).
- Außenhülle, Innenwände, Raumbeschriftungen — stylisiert, dunkel-themed,
  passend zum Solar-Tab-Look.
- Cover als interaktive Rechtecke an den Außenwänden. Visualisierung der Position
  ausschließlich über Füllgrad: 0 % offen → leeres Rechteck (Outline),
  100 % zu → vollflächig Akzentfarbe, dazwischen proportional gefüllt.
- Sonne als Indikator am Plan-Rand: Position auf gedachter Kreisbahn um den
  Grundriss, Azimut → Position (oben=Süd), Elevation → Größe/Helligkeit.
- **Tap auf Cover** öffnet Detail-Panel:
  - Cover-Name, Zone
  - Slider 0–100 für direkte Steuerung (Slider-Release publiziert MQTT-Befehl)
  - Aktuelle Position + State (IDLE / Auto / Override)
  - **Letztes Event** — eine Zeile: `13:42 — Automation: auf 20 % (Süd-Sonnenschutz)`
  - Wenn OVERRIDE: Button *„Auf Auto setzen"*

Mobile: Bottom-Sheet, Halbhöhe. Desktop: Side-Panel rechts.

#### Tab „Automation"

Kein Plan-View, fokussiert auf Engine-Sicht.

- **Eingangswerte** (oben): Sonne (Azimut/Elevation), PV-Leistung + aktuelle
  Schwelle, Innentemp, Sommermodus-Flag. Live-Update via WebSocket.
- **Aktuelle Bewertung pro Zone**: pro Zone eine kollabierbare Karte mit
  Decision-Tree (alle Bedingungen mit aktuellen Werten + grün/rot).
  Aufklappen zeigt zusätzlich die Decisions der einzelnen Cover dieser Zone.
- **Decision-Log** (unten): chronologisch absteigend, max. 200 Einträge.
  Pro Eintrag: Zeitstempel, Zone, Cover, Action, einzeilige Reason. Aufklappen
  zeigt den vollen Decision-Tree, der zu dieser Aktion führte.

#### Settings-Sub-Sektion (UI-editierbare Tunables)

Erreichbar über die globale Einstellungen-Seite oder direkt im Automation-Tab als
Footer-Sektion. Felder:
- PV-Schwellen-Parameter (peakWp, factor, floorW)
- Innentemp-Schwelle + Hysterese
- PV-Hysterese (factor, dauerMinutes)
- Sommermodus-Monate (Multi-Select)
- Pro Zone: Schließ-Position (Slider 0–100)

Auto-Save bei Blur oder 500 ms Idle (gleicher Pattern wie Solar-Settings).

---

## API-Endpoints

```
GET  /api/verschattung/state           # Current Cover-States + Engine-Inputs (Snapshot)
GET  /api/verschattung/decisions       # Decision-Log (Ring-Buffer-Inhalt)
GET  /api/verschattung/config          # UI-editierbare Tunables
PUT  /api/verschattung/config          # Tunables speichern
PUT  /api/verschattung/cover/:id       # { position: number } — manuell setzen
POST /api/verschattung/cover/:id/auto  # OVERRIDE → IDLE setzen
```

WebSocket-Topic `verschattung` — pushed live `state` und neue `decision`-Events.

---

## Fehlerbehandlung

- **HA-MQTT-Verbindung tot:** Engine pausiert (loggt im Decision-Log einen
  `skip`-Eintrag pro Tick mit Reason „HA nicht erreichbar"). Reconnect mit
  Backoff (5 s / 10 s / 30 s / 60 s, dann konstant 60 s). Wenn
  Verbindung wieder steht, wird Statestream-Snapshot erneut eingelesen und
  Boot-Reconciliation läuft erneut.
- **Service-Call-Echo bleibt aus** (>10 s nach MQTT-Publish keine
  Statestream-Bestätigung): Warning loggen, State bleibt auf altem Wert,
  nächster Tick versucht erneut.
- **Sensor-Wert fehlt** (Innentemp `null`): Engine emittiert für betroffene
  Zonen `skip`-Decisions mit Reason „Innentemp nicht verfügbar".
- **Persistente State-Datei korrupt:** Engine startet mit allen Cover als IDLE,
  loggt Warning. Boot-Reconciliation arbeitet nur mit dem Statestream-Snapshot.
- **Config-Datei korrupt:** Engine fällt auf hardcoded Defaults zurück, loggt
  Warning, blockt UI-Save nicht.

---

## Testing

- **Unit:** `eg-sonnenschutz.evaluate(ctx)` mit synthetischen Context-Inputs.
  Matrix: alle 5 Bedingungen unabhängig variieren, Override-Zustände, Hysterese-
  Trigger, Sommermodus-Grenzen.
- **Unit:** `sun.ts` gegen bekannte NOAA-Referenzwerte (z.B. Sonnwende).
- **Unit:** Override-State-Machine-Übergänge, alle 6 möglichen Trigger.
- **Unit:** Boot-Reconciliation mit verschiedenen Persistenz/Realität-
  Kombinationen.
- **Integration:** HA-MQTT-Adapter gegen Mock-Broker; Bridge-Automation-Format
  validieren.

---

## Implementations-Reihenfolge (Hinweis für den Plan)

1. Infra: `infra/ha/` neu, `infra/mqtt-victron.ts` zu typed EventEmitter
   refactoren.
2. Domäne: `verschattung/sun.ts` + `ports.ts` + `context.ts` + `decision.ts`.
3. Domäne: `verschattung/automations/eg-sonnenschutz.ts` mit kompletter
   Unit-Test-Suite.
4. Domäne: `verschattung/engine.ts` + `override-state.ts` + Persistenz.
5. API-Layer: `verschattung/routes.ts` + WebSocket-Push.
6. Shared types in `packages/shared/src/verschattung-types.ts`.
7. Web: SVG-Grundrisse EG + OG (manuelle Arbeit, größtes Einzel-Stück).
8. Web: Manuell-Tab mit Detail-Panel.
9. Web: Automation-Tab mit Decision-Log + Eingangswerten + Per-Zone-Bewertung.
10. Web: Settings-Sub-Sektion für Tunables.
11. HA-Konfig: Statestream-Domains anpassen, Bridge-Automation einrichten.
12. End-to-End-Test mit echtem HA + echten Covers.

---

## Offene Punkte

Keine. Alle Design-Entscheidungen sind in den vorigen Abschnitten festgehalten.
Cover-IDs und SVG-Koordinaten werden während der Implementation gemeinsam mit dem
User ausgehändigt.
