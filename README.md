<p align="center">
  <img src="packages/web/app/icon.svg" width="80" height="80" alt="Energy Control logo">
</p>

<h1 align="center">Energy Control</h1>

<p align="center">
  Smart battery and solar management for Victron Energy systems.<br>
  Real-time grid regulation, price-optimized charging, PV forecast ensemble,<br>
  and live monitoring of Nibe heat pump and Tesla wallbox.
</p>

<p align="center">
  <img src="docs/images/victron-logo.png" height="40" alt="Victron Energy">
  &nbsp;&nbsp;
  <img src="docs/images/nibe-logo.jpg" height="40" alt="Nibe">
  &nbsp;&nbsp;
  <img src="docs/images/tesla-logo.png" height="40" alt="Tesla">
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
- **Device monitoring** — live power consumption from Nibe heat pump and Tesla Wall Connector, displayed in the dashboard
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
│         │─ Nibe API ─ Tesla Wallbox API     │
└─────────┼────────────────────────────────────┘
          │
    ┌─────▼─────┐  ┌───────────┐  ┌───────────┐
    │  Victron   │  │   Nibe    │  │  Tesla    │
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
| `WALLBOX_URL` | no | Tesla Wall Connector URL (e.g. `http://192.168.x.x`) |
| `MPPT_TEMPERATURE_URL` | no | Shelly temperature sensor endpoint |
| `DEPLOY_SERVER` | no | SSH target for `deploy.sh` |

Runtime parameters (battery capacity, SoC limits, deadband, charge power, etc.) can be adjusted live through the settings UI or the REST API.

## Optional Integrations

### EM2GO Wallbox (Modbus TCP)

Manual control of an EM2GO Home 11kW wallbox via Modbus TCP.

Environment variables (all optional — omitting `WALLBOX_HOST` disables the integration):

| Variable | Default | Description |
|---|---|---|
| `WALLBOX_HOST` | — | IP address of the wallbox |
| `WALLBOX_PORT` | `502` | Modbus TCP port |
| `WALLBOX_UNIT_ID` | `255` | Modbus unit/slave ID |
| `WALLBOX_POLL_INTERVAL_MS` | `5000` | Status polling interval |

**⚠️ Only one Modbus TCP connection is supported by the wallbox at a time.** If you use
[evcc](https://evcc.io) to control the same wallbox, you must stop evcc (or remove the
wallbox from its config) before starting this service — running both simultaneously will
cause connection failures or inconsistent state.

The register map (`packages/api/src/wallbox/types.ts`) was derived from evcc's open-source
`charger/em2go.go` driver and verified against a live EM2GO Home 11kW unit. Older Home
firmware (< 1.3) needs an additional current-rounding workaround on enable/phase-switch
that is not implemented here (see the `TODO` in `types.ts`).

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

Currently, Energy Control is built exclusively for **Victron Energy** systems. Future integrations are planned:

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/evcc-logo.png" height="36" alt="EVCC"><br>
      <strong>EVCC</strong><br>
      <sub>EV charging integration — coordinate battery and wallbox to charge your car from excess solar at the best price.</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/hass-logo.png" height="36" alt="Home Assistant"><br>
      <strong>Home Assistant</strong><br>
      <sub>Expose sensors, controls, and charge plans as HA entities for automation and multi-system dashboards.</sub>
    </td>
  </tr>
</table>

## License

Private project. All rights reserved.
