# inexogy Smart Meter Integration

## Goal

Fetch historical 15-minute resolution meter readings (Bezug/Einspeisung) from an inexogy smart meter via REST API and expose them through a new API endpoint.

## Scope

- Read-only, on-demand historical data retrieval
- No real-time usage, no caching, no polling, no WebSocket integration
- Does not replace or interfere with existing Victron-based grid measurements

## API Details

**Base URL**: `https://api.inexogy.com/public/v1`
**Auth**: HTTP Basic Auth (email + password)

### Endpoints Used

- `GET /meters` — discover meter ID (once, then cached in memory)
- `GET /readings?meterId=<id>&from=<ms>&to=<ms>&resolution=fifteen_minutes&fields=energy,energyOut,power` — historical readings

### Value Scaling

- `power`: milliwatts → divide by 1000 → Watts
- `energy`: raw → divide by 10^10 → kWh (cumulative Bezug)
- `energyOut`: raw → divide by 10^10 → kWh (cumulative Einspeisung)

## Implementation

### Configuration (`config.ts`)

New optional environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `INEXOGY_EMAIL` | No | — | Account email |
| `INEXOGY_PASSWORD` | No | — | Account password |
| `INEXOGY_METER_ID` | No | auto-discover | Explicit meter ID |

Service is only instantiated when both email and password are set.

### Service (`inexogy-service.ts`)

Class `InexogyService`:

- Constructor takes `{ email, password, meterId? }`
- Lazy meter discovery: on first call, fetches `/meters`, picks first `ELECTRICITY` meter or uses configured ID
- `getReadings(from: Date, to: Date)` → fetches `/readings` with `resolution=fifteen_minutes`
- Returns normalized array: `{ time: Date, powerW: number, energyKwh: number, energyOutKwh: number }[]`
- Uses native `fetch` with Basic Auth header

### API Endpoint (`server.ts`)

`GET /api/meter/history?date=YYYY-MM-DD`

- Default: today (Europe/Berlin timezone)
- Calls `inexogyService.getReadings(startOfDay, endOfDay)`
- Returns 404 if inexogy is not configured

### Response Format

```json
{
  "date": "2026-03-10",
  "meterId": "abc123",
  "readings": [
    {
      "time": "2026-03-10T00:00:00+01:00",
      "powerW": 450,
      "energyKwh": 1234.56,
      "energyOutKwh": 789.01
    }
  ]
}
```

## Files Changed

- `packages/api/src/config.ts` — add 3 optional env vars
- `packages/api/src/inexogy-service.ts` — new file
- `packages/api/src/server.ts` — add endpoint, conditionally create service
- `packages/api/src/__tests__/inexogy-service.test.ts` — new file

## Out of Scope

- Frontend/dashboard display
- Real-time meter readings in regulation loop
- Persistent storage / database
- Caching of historical readings
