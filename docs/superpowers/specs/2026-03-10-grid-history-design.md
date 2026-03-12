# Grid Power Akkumulator — Design Spec

## Goal

Accumulate per-phase grid power from MQTT into 15-minute slot averages, persist to JSON files, and expose via API. This provides accurate, self-collected grid history data for the charge plan chart, independent of the inexogy smart meter integration.

## Architecture

A new `GridHistoryService` collects grid power samples from MQTT events, computes 15-minute averages, and persists them to daily JSON files in `data/grid-history/`. The frontend consumes this via a new `/api/grid/history` endpoint.

## Components

### GridHistoryService (`grid-history-service.ts`)

- Listens to MQTT `stateChange` events
- On each event: records current grid power (sum of L1+L2+L3 phases from MqttService)
- Tracks per 15-min slot: running sum of power samples + sample count
- On slot transition (every 15 min): computes average, writes to file
- On startup: loads today's file to restore accumulated data

### Data Format

File path: `data/grid-history/YYYY-MM-DD.json`

```json
{
  "date": "2026-03-10",
  "slots": {
    "09:00": { "avgPowerW": -2450, "energyWh": -612.5, "samples": 1800 },
    "09:15": { "avgPowerW": -3100, "energyWh": -775.0, "samples": 1800 }
  }
}
```

- `avgPowerW`: Average grid power for the slot (negative = feed-in, positive = consumption)
- `energyWh`: `avgPowerW * 0.25` (energy per 15-min slot in Wh)
- `samples`: Number of measurement points (for quality control)

### API Endpoint

`GET /api/grid/history?date=YYYY-MM-DD`

Returns slot data as array for frontend consumption:

```json
{
  "date": "2026-03-10",
  "slots": [
    { "time": "09:00", "avgPowerW": -2450, "energyWh": -612.5, "samples": 1800 },
    { "time": "09:15", "avgPowerW": -3100, "energyWh": -775.0, "samples": 1800 }
  ]
}
```

### Frontend Integration

The frontend fetches `/api/grid/history` instead of `/api/meter/history` for the charge plan chart bars. The inexogy integration remains available separately via `/api/meter/history`.

For the chart:
- Feed-in power per slot: `Math.max(0, -avgPowerW)` (negative grid power = feed-in)
- Feed-in energy per slot: `Math.max(0, -energyWh) / 1000` (convert Wh to kWh)

### Docker Volume

Add volume mount to `docker-compose.yml`:

```yaml
services:
  energy-control-api:
    volumes:
      - energy-data:/app/data

volumes:
  energy-data:
```

This also fixes persistence for existing `pv-settings.json` and `config-overrides.json`.

## Out of Scope

- Cleanup of old daily files (files are tiny, keep indefinitely for now)
- Time series database (planned for later)
- Replacing inexogy integration (both coexist)
