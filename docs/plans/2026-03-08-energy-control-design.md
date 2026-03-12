# Energy Control — Design Document

## Problem

PV-Anlage mit 17,8 kWp DC-Leistung, aber nur 12 kW AC-Kapazität (3x Victron Multiplus, 4 kW/Phase). Standardverhalten: Akku erst vollladen, dann einspeisen. Bei starker Sonne wird der Akku mittags voll und die überschüssige DC-Leistung (>12 kW) geht verloren.

Ziel: Intelligente Steuerung des Grid-Setpoints, sodass bei prognostiziert gutem Sonnentag schon morgens eingespeist wird. Der Akku soll langsam über den Tag geladen werden und erst zum Ende der PV-Produktion voll sein.

## Rahmenbedingungen

| Parameter | Wert | Konfigurierbar |
|---|---|---|
| PV-Peak | 17,8 kWp | Ja |
| Max AC-Leistung | 12 kW | Ja |
| Akkukapazität | 16 kWh | Ja |
| Min SOC | 20% | Ja |
| Ziel-SOC | 100% | Ja |
| Einspeisevergütung | 7 ct/kWh (fix) | — |
| Strompreis-Optimierung | Nicht im Scope (später) | — |

## Architektur

### Tech Stack

Gleicher Stack wie energy_monitor:
- **Runtime:** Node.js 22, TypeScript (strict)
- **Monorepo:** pnpm Workspaces
- **Backend:** REST API (Express oder Fastify) + WebSocket
- **Frontend:** Next.js 15, React 19, Tailwind CSS
- **API-Dokumentation:** OpenAPI 3.1 (Contract-First)
- **Testing:** Vitest, Integration Tests mit gemocktem MQTT/VRM

### Packages

```
energy_control/
├── packages/
│   ├── api/          # Backend: REST API + WebSocket + Regler
│   ├── web/          # Frontend: Next.js Dashboard
│   └── shared/       # Generierte Types aus OpenAPI
├── openapi/
│   └── spec.yaml     # OpenAPI 3.1 Spezifikation
├── docs/plans/       # Design & Pläne
└── docker-compose.yml
```

### Contract-First Workflow

1. OpenAPI Spec in `openapi/spec.yaml` ändern
2. Review der Spec-Änderungen
3. Types generieren (`shared` Package)
4. Tests schreiben (TDD)
5. Endpoint implementieren

## Datenquellen

### MQTT (Victron) — Realtime

Broker: `tcp://192.168.1.224:1883`, Device-ID: `c0619ab5450c`

**Lesen (Prefix `N/{deviceId}/`):**
- `system/0/Dc/Pv/Power` — PV-Leistung (W)
- `system/0/Ac/Consumption/L1|L2|L3/Power` — Verbrauch pro Phase (W)
- `system/0/Ac/Grid/L1|L2|L3/Power` — Grid pro Phase (W, negativ=Einspeisung)
- `system/0/Dc/Battery/Power` — Batterie-Leistung (W, positiv=Laden)
- `system/0/Dc/Battery/Soc` — State of Charge (%)

**Schreiben & Lesen:**
- `N/{deviceId}/settings/0/Settings/CGwacs/AcPowerSetPoint` — Grid-Setpoint (W)
- Wird auch subscribed um externe Änderungen zu erkennen (z.B. über Victron App)

**Externe Setpoint-Erkennung:**
Wenn sich der Grid-Setpoint ändert ohne dass unsere App ihn gesetzt hat (z.B. manuell über die Victron App), wechselt der Regler automatisch in den **Manual-Modus**. Damit werden manuelle Eingriffe nicht sofort vom Regler überschrieben. Der Benutzer muss explizit zurück in den Auto-Modus wechseln.

**Keepalive:** Periodisch `R/{deviceId}/keepalive` publishen.

### VRM REST API — Forecast

- **Endpoint:** `GET https://vrmapi.victronenergy.com/v2/installations/{siteId}/stats`
- **Parameter:** `type=forecast&interval=hours&start={unix}&end={unix}`
- **Auth:** `X-Authorization: Token {VRM_TOKEN}`
- **Abrufintervall:** Periodisch (z.B. alle 30 Min), beim Start, in-memory Cache

## Kernlogik: Grid-Setpoint-Regler

### Modi

| Modus | Verhalten |
|---|---|
| **Auto** | Regler berechnet und setzt Grid-Setpoint automatisch |
| **Manual** | Benutzer setzt Grid-Setpoint manuell über API/Dashboard |
| **Winter** | Regler inaktiv, Victron-Standardverhalten (Akku laden, dann einspeisen) |

### Wintermodus (automatisch)

Aktiviert sich automatisch wenn: **Forecast Tagesproduktion < Akkukapazität × 1.2**

Bei 16 kWh Akku = Schwelle bei 19,2 kWh. Wenn weniger erwartet wird, lohnt sich die Steuerung nicht. Schwelle ist konfigurierbar.

### Algorithmus

**Alle 1 Minute (normaler Zyklus):**

1. Aktuelle Werte lesen (SOC, PV-Leistung, Verbrauch, Grid)
2. Forecast für verbleibenden Tag abrufen (aus Cache)
3. Berechnen: Verbleibende Energie bis Sonnenuntergang
4. Berechnen: Benötigte Energie um Akku von aktuellem SOC auf Ziel-SOC zu laden
5. Differenz = Überschuss der eingespeist werden kann
6. Grid-Setpoint berechnen: Aktueller Verbrauch + gewünschte Ladeleistung - PV-Leistung
7. Sicherheits-Checks anwenden

**Sofortige Reaktion (Event-basiert):**
- Bei Änderungen > konfigurierbare Schwelle (default: 3 kW) → sofort neu berechnen
- Beispiel: Auto beginnt zu laden → Verbrauch springt um 11 kW

**Deadband/Hysterese:**
- Änderungen < 1-2 kW werden im nächsten regulären Zyklus behandelt
- Verhindert ständiges Nachjustieren bei kleinen Schwankungen

### Sicherheitsregeln

1. **SOC > Min-SOC (20%):** Unter Minimum kein Einspeisen, Setpoint auf 0 (Standardverhalten)
2. **PV-Produktion vorhanden:** Nur einspeisen wenn PV > Eigenverbrauch
3. **Akku-Schutz:** Setpoint nie so setzen, dass Akku bei aktuellem Verbrauch entladen würde
4. **Fallback:** Bei MQTT-Verbindungsverlust oder fehlenden Daten → Setpoint auf 0 (sicherer Zustand)

## REST API

### Endpoints

```
GET    /api/status          Aktueller Systemzustand (live Werte + Regler-Status)
GET    /api/forecast         Heutiger Solar-Forecast (stündlich)
GET    /api/config           Aktuelle Konfiguration
PUT    /api/config           Konfiguration ändern
GET    /api/controller/state Regler-Zustand (Modus, letzter Setpoint, nächste Berechnung)
POST   /api/controller/mode  Modus wechseln (auto/manual/winter)
PUT    /api/controller/setpoint  Manueller Setpoint Override (nur im Manual-Modus)
GET    /api/health           Health Check
```

### WebSocket

`/ws` — Realtime-Updates:
- Aktuelle PV/Grid/Akku/Verbrauch-Werte (durchgeschleift von MQTT)
- Regler-Entscheidungen (Setpoint-Änderungen mit Begründung)
- Modus-Wechsel

## Frontend

### Design

- **Theme:** Dark Mode
- **Akzentfarbe:** #10EFD8
- **Stil:** Modern, minimal
- **Realtime:** WebSocket-Verbindung, live Werte von MQTT durchgeschleift

### Screens

**Dashboard (Hauptseite):**
- Aktuelle Werte: PV-Leistung, Verbrauch, Grid, Akku SOC — live animiert
- Regler-Status: Modus (Auto/Manual/Winter), aktueller Setpoint
- Forecast-Chart: Erwartete vs. tatsächliche Produktion über den Tag
- SOC-Verlauf: Geplanter vs. tatsächlicher Akkustand

**Einstellungen:**
- Konfigurations-Parameter (Akkukapazität, Min-SOC, Ziel-SOC, etc.)
- Modus-Umschaltung
- Manueller Setpoint-Slider (nur im Manual-Modus)

## Testing-Strategie

### Gemockte Schnittstellen

Nur zwei externe Abhängigkeiten, beide mockbar:
1. **MQTT Broker** — In-Memory MQTT Broker (z.B. aedes) für Tests
2. **VRM REST API** — HTTP Mock (z.B. msw oder nock)

### Test-Kategorien

1. **Regler-Algorithmus (Unit Tests):**
   - Sonniger Tag, Akku wird voll → Setpoint berechnen
   - Bewölkter Tag → Wintermodus aktivieren
   - Auto lädt → sofortige Reaktion
   - SOC unter Minimum → Einspeisung stoppen
   - Wolke → Setpoint anpassen, nicht aus Akku einspeisen

2. **API Integration Tests:**
   - Jeden Endpoint testen mit gemocktem MQTT State
   - WebSocket-Verbindung und Updates

3. **MQTT Integration Tests:**
   - Korrekte Topic-Subscriptions
   - Setpoint wird geschrieben
   - Keepalive funktioniert
   - Reconnect nach Verbindungsverlust

## Konfiguration

Umgebungsvariablen:
```
# Victron MQTT
VICTRON_MQTT_URL=tcp://192.168.1.224:1883
VICTRON_DEVICE_ID=c0619ab5450c

# Victron VRM
VICTRON_VRM_TOKEN=<token>
VICTRON_VRM_SITE_ID=<site-id>

# Regler Defaults (überschreibbar via API)
BATTERY_CAPACITY_KWH=16
MIN_SOC_PERCENT=20
TARGET_SOC_PERCENT=100
MAX_AC_POWER_W=12000
WINTER_MODE_THRESHOLD_FACTOR=1.2
REGULATION_INTERVAL_MS=60000
LARGE_CHANGE_THRESHOLD_W=3000
DEADBAND_W=1500
```
