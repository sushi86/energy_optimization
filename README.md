<p align="center">
  <img src="packages/web/app/icon.svg" width="80" height="80" alt="Energy Control logo">
</p>

<h1 align="center">Energy Control</h1>

<p align="center">
  Smart battery and solar management for Victron Energy systems.<br>
  Real-time grid regulation, price-optimized charging, PV forecast ensemble,<br>
  and live monitoring of Nibe heat pump and EM2GO wallbox.
</p>

<p align="center">
  <img src="docs/images/victron-logo.png" height="40" alt="Victron Energy">
  &nbsp;&nbsp;
  <img src="docs/images/nibe-logo.jpg" height="40" alt="Nibe">
</p>

---

<p align="center">
  <img src="docs/images/screenshot-dashboard.png" width="700" alt="Dashboard — real-time power overview and controller status">
</p>

<p align="center">
  <img src="docs/images/screenshot-charts.png" width="700" alt="Charts — PV forecast, spot prices, and charge plan">
</p>

## What it does

Energy Control connects to a Victron system via MQTT and VRM, monitors solar production, battery state, and grid power in real time, and automatically adjusts the battery inverter setpoint to optimize self-consumption and feed-in revenue.

**Key features:**

- **Grid regulation** — closed-loop control that keeps grid exchange within a configurable deadband, reacting to surplus/deficit in real time
- **Price-optimized charging** — uses EPEX day-ahead spot prices to shift battery charging to the cheapest hours and feed-in to the most profitable ones
- **Charge planning** — generates hourly charge/feed-in schedules based on PV forecast, battery state, consumption profiles, and market prices
- **PV forecast ensemble** — combines VRM forecast and [forecast.solar](https://forecast.solar) with automatic correction factors for more accurate predictions
- **Smart meter integration** — optional Inexogy smart meter support for precise grid measurements
- **Device monitoring** — live power consumption from Nibe heat pump, displayed in the dashboard
- **Wallbox control** — Modbus TCP control of an EM2GO Home 11kW wallbox: manual start/stop/current/phases, plus a PV-surplus mode that auto-starts/stops charging, switches 1↔3 phases, and caps combined house+wallbox load under the inverter's AC limit
- **Push notifications** — Web Push alerts for morning briefings, daily summaries, mode changes, and wallbox events (charging started/stopped, phase switches, plug/unplug)
- **Live dashboard** — real-time web UI with power flows, charge plan visualization, price charts, and grid history

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Docker Host                 │
│                                              │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │   API :3002   │◄────►│   Web UI :3001   │  │
│  │   (Fastify)   │      │   (Next.js)      │  │
│  └──────┬───────┘      └──────────────────┘  │
│         │                                    │
│   MQTT ─┤─ VRM API ─ forecast.solar         │
│         │─ EPEX prices ─ Inexogy API        │
│         │─ Nibe API ─ EM2GO Modbus TCP      │
└─────────┼────────────────────────────────────┘
          │
    ┌─────▼─────┐  ┌───────────┐  ┌───────────┐
    │  Victron   │  │   Nibe    │  │  EM2GO    │
    │  GX / MQTT │  │ Heat Pump │  │  Wallbox  │
    └───────────┘  └───────────┘  └───────────┘
```

**Monorepo structure:**

| Package | Description |
|---------|-------------|
| `packages/api` | Fastify backend — MQTT client, controller, VRM/forecast services, charge planner |
| `packages/web` | Next.js frontend — real-time dashboard and settings UI |
| `packages/shared` | Shared TypeScript types |

## Getting started

### Prerequisites

- Node.js 22+
- pnpm
- A Victron system with MQTT enabled (Cerbo GX / Venus OS)
- A VRM account with API token

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your device IPs, VRM token, etc.

# Run in development mode
pnpm dev
```

The API starts on port **3002**, the web UI on port **3001**.

### Docker

```bash
# Build and deploy (see deploy.sh)
docker build -t energy-control .
docker run --network host --env-file .env energy-control
```

## Configuration

All configuration lives in `.env`. See [`.env.example`](.env.example) for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `VICTRON_MQTT_URL` | yes | MQTT broker URL (e.g. `tcp://192.168.x.x:1883`) |
| `VICTRON_DEVICE_ID` | yes | Victron device portal ID |
| `VICTRON_VRM_TOKEN` | yes | VRM API bearer token |
| `VICTRON_VRM_SITE_ID` | yes | VRM installation ID |
| `INEXOGY_EMAIL` | no | Inexogy smart meter login |
| `INEXOGY_PASSWORD` | no | Inexogy smart meter password |
| `NIBE_URL` | no | Nibe heat pump API URL (e.g. `https://192.168.x.x:8443`) |
| `NIBE_USERNAME` | no | Nibe heat pump API username |
| `NIBE_PASSWORD` | no | Nibe heat pump API password |
| `MPPT_TEMPERATURE_URL` | no | Shelly temperature sensor endpoint |
| `DEPLOY_SERVER` | no | SSH target for `deploy.sh` |
| `WALLBOX_HOST` | no | IP address of the EM2GO wallbox (see [Optional Integrations](#optional-integrations)) |
| `VAPID_SUBJECT` | no | Contact URI for Web Push (see [Optional Integrations](#optional-integrations)) |

Runtime parameters (battery capacity, SoC limits, deadband, charge power, etc.) can be adjusted live through the settings UI or the REST API.

## Optional Integrations

### EM2GO Wallbox (Modbus TCP)

Control of an EM2GO Home 11kW wallbox via Modbus TCP, in three modes (switchable from the
dashboard): **Off**, **Manual** (direct start/stop/current/phase control), and **PV**
(automatic surplus-based charging).

Environment variables (all optional — omitting `WALLBOX_HOST` disables the integration):

| Variable | Default | Description |
|---|---|---|
| `WALLBOX_HOST` | — | IP address of the wallbox |
| `WALLBOX_PORT` | `502` | Modbus TCP port |
| `WALLBOX_UNIT_ID` | `255` | Modbus unit/slave ID |
| `WALLBOX_POLL_INTERVAL_MS` | `5000` | Status polling interval |
| `WALLBOX_PV_TOLERANCE_MINUTES` | `2` | How long surplus/deficit must persist before PV mode starts, stops, or switches phases |

**PV mode:** starts charging (1 or 3 phases, whichever the surplus supports) once PV
surplus stays above the minimum for `WALLBOX_PV_TOLERANCE_MINUTES`, adjusts the charging
current live to track surplus, and stops after the same tolerance once surplus drops too
low. Combined house + wallbox load is capped below `MAX_AC_POWER_W` minus a configurable
reserve (`wallboxAcReserveW`, settings UI) so PV charging never overloads the inverter's AC
output. If the vehicle refuses to actually start charging (e.g. already full) for 3
consecutive attempts, PV mode stops auto-retrying and shows "Ladung abgelehnt, Auto voll?"
with a manual retry button, rather than repeatedly re-triggering the vehicle's charge
controller.

**⚠️ Only one Modbus TCP connection is supported by the wallbox at a time.** If you use
[evcc](https://evcc.io) to control the same wallbox, you must stop evcc (or remove the
wallbox from its config) before starting this service — running both simultaneously will
cause connection failures or inconsistent state.

The register map (`packages/api/src/wallbox/types.ts`) was derived from evcc's open-source
`charger/em2go.go` driver and verified against a live EM2GO Home 11kW unit. Older Home
firmware (< 1.3) needs an additional current-rounding workaround on enable/phase-switch
that is not implemented here (see the `TODO` in `types.ts`).

### Push Notifications (Web Push)

Browser push notifications for key events (morning PV briefing, daily production summary,
mode switches, wallbox charging/plug events). VAPID keys are generated automatically on
first start and persisted in the data directory — no setup required beyond subscribing from
the dashboard.

| Variable | Default | Description |
|---|---|---|
| `VAPID_SUBJECT` | `mailto:energy@example.com` | Contact URI sent with push requests (set to a real `mailto:` address per the Web Push spec) |

## Controller modes

| Mode | Behavior |
|------|----------|
| **Auto** | Closed-loop regulation based on forecast, prices, and battery state |
| **Manual** | Fixed grid setpoint — useful for testing or override |
| **Winter** | More aggressive charging with configurable threshold factor |

## API

The API exposes WebSocket for real-time updates and REST endpoints for configuration:

- `GET /status` — current system state, controller details, charge plan
- `GET /config` / `PUT /config` — runtime configuration
- `POST /controller/mode` — switch controller mode
- `GET /prices` — EPEX spot prices
- `GET /grid-history` — historical grid power data

## Tests

```bash
pnpm test
```

## Roadmap

Currently, Energy Control is built exclusively for **Victron Energy** systems. PV-surplus EV
charging is now built in natively (see [Wallbox](#em2go-wallbox-modbus-tcp) above) rather than
via evcc. Future integrations are planned:

<table>
  <tr>
    <td align="center" width="100%">
      <img src="docs/images/hass-logo.png" height="36" alt="Home Assistant"><br>
      <strong>Home Assistant</strong><br>
      <sub>Expose sensors, controls, and charge plans as HA entities for automation and multi-system dashboards.</sub>
    </td>
  </tr>
</table>

## License

Private project. All rights reserved.
