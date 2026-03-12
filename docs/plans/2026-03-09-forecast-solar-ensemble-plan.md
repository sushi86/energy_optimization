# forecast.solar Ensemble Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add forecast.solar as second PV forecast provider with ensemble averaging, and add PV system settings with file persistence.

**Architecture:** New `PvSettings` persistence layer (JSON file), new `ForecastSolarService` that fetches from forecast.solar API, ensemble logic in `AppState.regulate()` that averages VRM + forecast.solar forecasts. Frontend gets a PV settings section and multi-curve forecast chart.

**Tech Stack:** TypeScript, Fastify, Node.js fs, React 19, Next.js 15, Tailwind CSS 4

---

### Task 1: PV Settings Persistence — Tests

**Files:**
- Create: `packages/api/src/__tests__/pv-settings.test.ts`
- Create: `packages/api/src/pv-settings.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PvSettings, loadPvSettings, savePvSettings } from '../pv-settings.js';

describe('PvSettings', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pv-settings-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when no file exists', () => {
    const settings = loadPvSettings(join(dir, 'settings.json'));
    expect(settings).toEqual({
      latitude: 51.22731665478406,
      longitude: 9.311660517083372,
      tiltDeg: 35,
      azimuthDeg: 2,
      kwp: 17.8,
    });
  });

  it('saves and loads settings', () => {
    const path = join(dir, 'settings.json');
    const custom: PvSettings = {
      latitude: 48.0,
      longitude: 11.0,
      tiltDeg: 30,
      azimuthDeg: -10,
      kwp: 10.0,
    };
    savePvSettings(path, custom);
    const loaded = loadPvSettings(path);
    expect(loaded).toEqual(custom);
  });

  it('ignores invalid JSON and returns defaults', () => {
    const path = join(dir, 'settings.json');
    require('fs').writeFileSync(path, 'not json');
    const settings = loadPvSettings(path);
    expect(settings.kwp).toBe(17.8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/pv-settings.test.ts`
Expected: FAIL — module `../pv-settings.js` not found

**Step 3: Write minimal implementation**

```typescript
// packages/api/src/pv-settings.ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface PvSettings {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
}

const DEFAULTS: PvSettings = {
  latitude: 51.22731665478406,
  longitude: 9.311660517083372,
  tiltDeg: 35,
  azimuthDeg: 2,
  kwp: 17.8,
};

export function loadPvSettings(filePath: string): PvSettings {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePvSettings(filePath: string, settings: PvSettings): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2));
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/pv-settings.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/api/src/pv-settings.ts packages/api/src/__tests__/pv-settings.test.ts
git commit -m "feat: add PV settings persistence with JSON file storage"
```

---

### Task 2: PV Settings API Endpoints

**Files:**
- Modify: `packages/api/src/server.ts`
- Modify: `packages/api/src/__tests__/api-endpoints.test.ts`

**Step 1: Write the failing test**

Add to `api-endpoints.test.ts`:

```typescript
describe('PV Settings', () => {
  it('GET /api/settings/pv-system returns default settings', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/pv-system' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kwp).toBe(17.8);
    expect(body.tiltDeg).toBe(35);
    expect(body.azimuthDeg).toBe(2);
    expect(body.latitude).toBeCloseTo(51.227, 2);
    expect(body.longitude).toBeCloseTo(9.311, 2);
  });

  it('PUT /api/settings/pv-system saves and returns updated settings', async () => {
    const updated = { latitude: 48.0, longitude: 11.0, tiltDeg: 30, azimuthDeg: -10, kwp: 10.0 };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/pv-system',
      payload: updated,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kwp).toBe(10.0);

    // Verify GET returns updated values
    const res2 = await app.inject({ method: 'GET', url: '/api/settings/pv-system' });
    expect(res2.json().kwp).toBe(10.0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/api-endpoints.test.ts`
Expected: FAIL — 404 on `/api/settings/pv-system`

**Step 3: Add endpoints to server.ts**

Add import at top of `server.ts`:
```typescript
import { loadPvSettings, savePvSettings, type PvSettings } from './pv-settings.js';
```

Add to `ServerOptions`:
```typescript
export interface ServerOptions {
  testing?: boolean;
  appState?: AppState;
  pvSettingsPath?: string;
}
```

Add endpoints before the `return app;` line:
```typescript
  const pvSettingsPath = options.pvSettingsPath ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/pv-settings.json');

  app.get('/api/settings/pv-system', async () => {
    return loadPvSettings(pvSettingsPath);
  });

  app.put('/api/settings/pv-system', async (request) => {
    const body = request.body as PvSettings;
    savePvSettings(pvSettingsPath, body);
    return loadPvSettings(pvSettingsPath);
  });
```

Update the test setup to pass a temp path for `pvSettingsPath`.

**Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/api-endpoints.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/__tests__/api-endpoints.test.ts
git commit -m "feat: add GET/PUT /api/settings/pv-system endpoints"
```

---

### Task 3: forecast.solar Service — Tests & Implementation

**Files:**
- Create: `packages/api/src/forecast-solar-service.ts`
- Create: `packages/api/src/__tests__/forecast-solar-service.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForecastSolarService } from '../forecast-solar-service.js';

describe('ForecastSolarService', () => {
  let service: ForecastSolarService;

  beforeEach(() => {
    service = new ForecastSolarService({
      latitude: 51.227,
      longitude: 9.312,
      tiltDeg: 35,
      azimuthDeg: 2,
      kwp: 17.8,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses forecast.solar API response into ForecastHour[]', async () => {
    const mockResponse = {
      result: {
        watts: {
          '2026-03-09 08:00:00': 2500,
          '2026-03-09 09:00:00': 5800,
          '2026-03-09 10:00:00': 9200,
        },
        watt_hours_day: { '2026-03-09': 45200 },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    await service.refresh();
    const forecast = service.getForecast();

    expect(forecast.hours).toHaveLength(3);
    expect(forecast.hours[0].powerW).toBe(2500);
    expect(forecast.hours[1].powerW).toBe(5800);
    expect(forecast.totalKwh).toBeCloseTo(45.2, 1);
  });

  it('returns empty forecast on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

    await service.refresh();
    const forecast = service.getForecast();

    expect(forecast.hours).toEqual([]);
    expect(forecast.totalKwh).toBe(0);
  });

  it('builds correct API URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: { watts: {}, watt_hours_day: {} } }),
    } as Response);

    await service.refresh();

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/estimate/17.8/35/2/51.227/9.312');
  });

  it('can update configuration', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: { watts: {}, watt_hours_day: {} } }),
    } as Response);

    service.updateConfig({ latitude: 48.0, longitude: 11.0, tiltDeg: 30, azimuthDeg: -10, kwp: 10.0 });
    await service.refresh();

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/estimate/10/30/-10/48/11');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/forecast-solar-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/api/src/forecast-solar-service.ts
import type { ForecastHour, Forecast } from './vrm-service.js';

export interface ForecastSolarConfig {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
}

export class ForecastSolarService {
  private config: ForecastSolarConfig;
  private forecast: Forecast = { hours: [], totalKwh: 0 };

  constructor(config: ForecastSolarConfig) {
    this.config = { ...config };
  }

  updateConfig(config: ForecastSolarConfig): void {
    this.config = { ...config };
  }

  async refresh(): Promise<void> {
    try {
      const { kwp, tiltDeg, azimuthDeg, latitude, longitude } = this.config;
      const url = `https://api.forecast.solar/estimate/${kwp}/${tiltDeg}/${azimuthDeg}/${latitude}/${longitude}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`forecast.solar HTTP ${res.status}`);

      const data = await res.json();
      const watts = data.result?.watts ?? {};
      const wattHoursDay = data.result?.watt_hours_day ?? {};

      const hours: ForecastHour[] = [];
      for (const [dateStr, powerW] of Object.entries(watts)) {
        hours.push({ timestamp: new Date(dateStr.replace(' ', 'T') + '+01:00'), powerW: powerW as number });
      }
      hours.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Total kWh from watt_hours_day (sum of all days returned)
      let totalWh = 0;
      for (const wh of Object.values(wattHoursDay)) {
        totalWh += wh as number;
      }

      this.forecast = { hours, totalKwh: totalWh / 1000 };
    } catch (err) {
      console.error('[forecast.solar] Refresh error:', (err as Error).message);
    }
  }

  getForecast(): Forecast {
    return this.forecast;
  }

  hasData(): boolean {
    return this.forecast.hours.length > 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/forecast-solar-service.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/api/src/forecast-solar-service.ts packages/api/src/__tests__/forecast-solar-service.test.ts
git commit -m "feat: add forecast.solar service with API client"
```

---

### Task 4: Ensemble Logic — Tests & Implementation

**Files:**
- Create: `packages/api/src/__tests__/ensemble-forecast.test.ts`
- Create: `packages/api/src/ensemble-forecast.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { computeEnsembleForecast } from '../ensemble-forecast.js';
import type { Forecast } from '../vrm-service.js';

describe('computeEnsembleForecast', () => {
  const ts = (hour: number) => new Date(2026, 2, 9, hour, 0, 0);

  it('averages two forecasts with matching hours', () => {
    const vrm: Forecast = {
      hours: [
        { timestamp: ts(8), powerW: 2000 },
        { timestamp: ts(9), powerW: 6000 },
      ],
      totalKwh: 8,
    };
    const solar: Forecast = {
      hours: [
        { timestamp: ts(8), powerW: 3000 },
        { timestamp: ts(9), powerW: 4000 },
      ],
      totalKwh: 7,
    };

    const result = computeEnsembleForecast(vrm, solar);
    expect(result.hours[0].powerW).toBe(2500);
    expect(result.hours[1].powerW).toBe(5000);
    expect(result.totalKwh).toBe(7.5);
  });

  it('returns VRM forecast when solar is empty', () => {
    const vrm: Forecast = {
      hours: [{ timestamp: ts(8), powerW: 2000 }],
      totalKwh: 2,
    };
    const solar: Forecast = { hours: [], totalKwh: 0 };

    const result = computeEnsembleForecast(vrm, solar);
    expect(result.hours[0].powerW).toBe(2000);
    expect(result.totalKwh).toBe(2);
  });

  it('returns solar forecast when VRM is empty', () => {
    const vrm: Forecast = { hours: [], totalKwh: 0 };
    const solar: Forecast = {
      hours: [{ timestamp: ts(8), powerW: 3000 }],
      totalKwh: 3,
    };

    const result = computeEnsembleForecast(vrm, solar);
    expect(result.hours[0].powerW).toBe(3000);
    expect(result.totalKwh).toBe(3);
  });

  it('handles mismatched hours by matching on hour-of-day', () => {
    const vrm: Forecast = {
      hours: [
        { timestamp: ts(8), powerW: 2000 },
        { timestamp: ts(9), powerW: 6000 },
        { timestamp: ts(10), powerW: 8000 },
      ],
      totalKwh: 16,
    };
    const solar: Forecast = {
      hours: [
        { timestamp: ts(9), powerW: 4000 },
        { timestamp: ts(10), powerW: 6000 },
      ],
      totalKwh: 10,
    };

    const result = computeEnsembleForecast(vrm, solar);
    // Hour 8: only VRM → 2000
    expect(result.hours.find(h => h.timestamp.getHours() === 8)?.powerW).toBe(2000);
    // Hour 9: average → 5000
    expect(result.hours.find(h => h.timestamp.getHours() === 9)?.powerW).toBe(5000);
    // Hour 10: average → 7000
    expect(result.hours.find(h => h.timestamp.getHours() === 10)?.powerW).toBe(7000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/ensemble-forecast.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/api/src/ensemble-forecast.ts
import type { Forecast, ForecastHour } from './vrm-service.js';

export function computeEnsembleForecast(vrm: Forecast, solar: Forecast): Forecast {
  if (solar.hours.length === 0) return vrm;
  if (vrm.hours.length === 0) return solar;

  // Build lookup by hour-of-day for solar forecast
  const solarByHour = new Map<number, number>();
  for (const h of solar.hours) {
    solarByHour.set(h.timestamp.getHours(), h.powerW);
  }

  // Build lookup by hour-of-day for VRM forecast
  const vrmByHour = new Map<number, { timestamp: Date; powerW: number }>();
  for (const h of vrm.hours) {
    vrmByHour.set(h.timestamp.getHours(), { timestamp: h.timestamp, powerW: h.powerW });
  }

  // Collect all hours from both sources
  const allHours = new Set<number>();
  for (const h of vrm.hours) allHours.add(h.timestamp.getHours());
  for (const h of solar.hours) allHours.add(h.timestamp.getHours());

  const hours: ForecastHour[] = [];
  let totalW = 0;

  for (const hour of [...allHours].sort((a, b) => a - b)) {
    const vrmEntry = vrmByHour.get(hour);
    const solarW = solarByHour.get(hour);

    let powerW: number;
    if (vrmEntry && solarW != null) {
      powerW = Math.round((vrmEntry.powerW + solarW) / 2);
    } else if (vrmEntry) {
      powerW = vrmEntry.powerW;
    } else {
      powerW = solarW!;
    }

    // Use VRM timestamp if available (keeps timezone consistency), otherwise create one
    const timestamp = vrmEntry?.timestamp ?? solar.hours.find(h => h.timestamp.getHours() === hour)!.timestamp;
    hours.push({ timestamp, powerW });
    totalW += powerW;
  }

  return { hours, totalKwh: totalW / 1000 };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/ensemble-forecast.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/api/src/ensemble-forecast.ts packages/api/src/__tests__/ensemble-forecast.test.ts
git commit -m "feat: add ensemble forecast averaging logic"
```

---

### Task 5: Wire Ensemble into AppState & Server

**Files:**
- Modify: `packages/api/src/app-state.ts`
- Modify: `packages/api/src/server.ts`
- Modify: `packages/api/src/index.ts`

**Step 1: Update AppState**

Add to `app-state.ts`:

```typescript
import { ForecastSolarService } from './forecast-solar-service.js';
import { computeEnsembleForecast } from './ensemble-forecast.js';
import { loadPvSettings, type PvSettings } from './pv-settings.js';
```

Add `forecastSolar` as a property:
```typescript
readonly forecastSolar: ForecastSolarService;
```

In constructor, after VRM init:
```typescript
const pvSettings = loadPvSettings(resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/pv-settings.json'));
this.forecastSolar = new ForecastSolarService(pvSettings);
```

In `startRegulation()`, add forecast.solar refresh alongside VRM:
```typescript
startRegulation(): void {
  void this.regulate();
  this.regulationTimer = setInterval(() => {
    void this.regulate();
  }, this.config.regulationIntervalMs);
  this.vrm.startAutoRefresh();

  // forecast.solar refresh every 30 minutes
  void this.forecastSolar.refresh();
  this.forecastSolarTimer = setInterval(() => {
    void this.forecastSolar.refresh();
  }, 30 * 60 * 1000);
}
```

In `regulate()`, compute ensemble:
```typescript
const vrmForecast = this.vrm.getForecast();
const solarForecast = this.forecastSolar.getForecast();
const forecast = computeEnsembleForecast(vrmForecast, solarForecast);
const remainingKwh = this.vrm.getRemainingForecastKwh(); // Keep VRM for remaining calc for now
```

Add method to update forecast.solar config:
```typescript
updatePvSettings(settings: PvSettings): void {
  this.forecastSolar.updateConfig(settings);
  void this.forecastSolar.refresh();
}
```

**Step 2: Update server.ts forecast endpoint**

Modify `/api/forecast` to include individual source data:
```typescript
app.get('/api/forecast', async () => {
  if (!state) throw new Error('AppState not initialized');
  const vrmForecast = state.vrm.getForecast();
  const solarForecast = state.forecastSolar.getForecast();
  const ensemble = computeEnsembleForecast(vrmForecast, solarForecast);
  const actual = state.vrm.getActualYield();
  const config = state.getConfig();

  const mapHours = (hours: ForecastHour[]) => hours.map((h) => ({
    timestamp: h.timestamp.toISOString(),
    powerW: h.powerW,
  }));

  return {
    hours: mapHours(ensemble.hours),
    vrm: mapHours(vrmForecast.hours),
    solar: mapHours(solarForecast.hours),
    actual: mapHours(actual),
    totalKwh: ensemble.totalKwh,
    winterModeActive: state.vrm.isWinterMode(
      config.batteryCapacityKwh,
      config.winterModeThresholdFactor,
    ),
  };
});
```

Also update PUT pv-system endpoint to call `state.updatePvSettings()`:
```typescript
app.put('/api/settings/pv-system', async (request) => {
  const body = request.body as PvSettings;
  savePvSettings(pvSettingsPath, body);
  if (state) state.updatePvSettings(body);
  return loadPvSettings(pvSettingsPath);
});
```

**Step 3: Update index.ts**

After `await Promise.all([...])`, add:
```typescript
await appState.forecastSolar.refresh();
```

**Step 4: Run all tests**

Run: `cd packages/api && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/app-state.ts packages/api/src/server.ts packages/api/src/index.ts
git commit -m "feat: wire ensemble forecast into regulation and API"
```

---

### Task 6: Frontend — PV Settings Section

**Files:**
- Modify: `packages/web/app/settings/page.tsx`

**Step 1: Add PV settings state and fetch**

Add after existing state declarations:
```typescript
interface PvSystemSettings {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
}

const [pvSettings, setPvSettings] = useState<PvSystemSettings | null>(null);
```

In `useEffect`, add fetch:
```typescript
fetch('/api/settings/pv-system')
  .then((r) => r.json())
  .then((data) => setPvSettings(data))
  .catch(() => {});
```

**Step 2: Add PV settings card**

Add after the Price Optimization toggle section:
```tsx
{/* PV-Anlage */}
{pvSettings && (
  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
    <p className="text-sm font-medium text-[var(--text-primary)] mb-4">PV-Anlage</p>
    <div className="space-y-3">
      {[
        { key: 'kwp', label: 'Leistung (kWp)', step: 0.1 },
        { key: 'tiltDeg', label: 'Neigung (°)', step: 1 },
        { key: 'azimuthDeg', label: 'Azimut (°)', step: 1 },
        { key: 'latitude', label: 'Breitengrad', step: 0.0001 },
        { key: 'longitude', label: 'Längengrad', step: 0.0001 },
      ].map(({ key, label, step }) => (
        <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
          <label className="text-sm text-[var(--text-secondary)] sm:w-48 shrink-0">{label}</label>
          <input
            type="number"
            step={step}
            value={pvSettings[key as keyof PvSystemSettings]}
            onChange={(e) => setPvSettings({ ...pvSettings, [key]: Number(e.target.value) })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
      ))}
    </div>
    <button
      onClick={async () => {
        setSaving(true);
        try {
          const res = await fetch('/api/settings/pv-system', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pvSettings),
          });
          if (res.ok) showMessage('PV-Einstellungen gespeichert');
          else showMessage('Fehler beim Speichern');
        } catch {
          showMessage('Fehler beim Speichern');
        }
        setSaving(false);
      }}
      disabled={saving}
      className="mt-4 px-6 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50"
    >
      {saving ? 'Speichern...' : 'Speichern'}
    </button>
  </div>
)}
```

**Step 3: Verify in browser**

Run dev server and check settings page shows PV section with 5 fields + save button.

**Step 4: Commit**

```bash
git add packages/web/app/settings/page.tsx
git commit -m "feat: add PV system settings section to frontend"
```

---

### Task 7: Frontend — Multi-Curve Forecast Chart

**Files:**
- Modify: `packages/web/app/page.tsx`

**Step 1: Update state and fetch**

Add state for individual forecasts:
```typescript
const [vrmForecast, setVrmForecast] = useState<ForecastHour[]>([]);
const [solarForecast, setSolarForecast] = useState<ForecastHour[]>([]);
```

Update fetchForecast to capture individual sources:
```typescript
const fetchForecast = () => {
  fetch('/api/forecast')
    .then((r) => r.json())
    .then((data) => {
      if (data?.hours) {
        setForecast(data.hours);
        if (Array.isArray(data.actual)) setActual(data.actual);
        if (Array.isArray(data.vrm)) setVrmForecast(data.vrm);
        if (Array.isArray(data.solar)) setSolarForecast(data.solar);
      }
    })
    .catch(() => {});
};
```

**Step 2: Update ForecastChart to accept multi-source data**

Update the component signature:
```typescript
function ForecastChart({
  data,
  actual,
  vrm,
  solar,
}: {
  data: ForecastHour[];
  actual: ForecastHour[];
  vrm?: ForecastHour[];
  solar?: ForecastHour[];
})
```

Keep the existing bar chart for ensemble (solid) and actual (amber). Add thin line indicators for VRM and solar sources on hover. In the tooltip, show all values:
```tsx
{isHovered && (
  <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-0.5 z-10">
    {actualW != null && <><span className="text-amber-400">{formatEnergy(actualW)}</span>{' / '}</>}
    <span className="text-[var(--accent)]">{formatEnergy(d.powerW)}</span>
    {vrmW != null && solarW != null && (
      <span className="text-[var(--text-secondary)]"> ({formatEnergy(vrmW)} | {formatEnergy(solarW)})</span>
    )}
  </div>
)}
```

**Step 3: Pass new props to ForecastChart**

```tsx
<ForecastChart data={forecast} actual={actual} vrm={vrmForecast} solar={solarForecast} />
```

**Step 4: Verify in browser**

Dev server should show forecast chart with tooltip showing VRM + solar individual values on hover.

**Step 5: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: show ensemble forecast with VRM and solar sources in chart"
```

---

### Task 8: Update WebSocket Types

**Files:**
- Modify: `packages/web/hooks/use-websocket.ts`

**Step 1: No test needed (type-only change)**

Add `forecastSolar` status if desired in WebSocket payload — but since forecast only refreshes every 30min, this is optional. The main change is ensuring the frontend types match the new API response.

No action needed here if forecast data is fetched via REST (which it already is). Skip this task unless the WebSocket payload needs updating.

**Step 2: Commit (if changes made)**

```bash
git add packages/web/hooks/use-websocket.ts
git commit -m "feat: update WebSocket types for ensemble forecast"
```

---

### Task 9: Final Integration Test

**Step 1: Run all backend tests**

Run: `cd packages/api && npx vitest run`
Expected: All tests PASS

**Step 2: Verify no TypeScript errors**

Run: `cd packages/api && npx tsc --noEmit`
Run: `cd packages/web && npx tsc --noEmit`

**Step 3: Manual verification**

- Start dev server
- Check dashboard forecast chart works
- Check settings page shows PV-Anlage section
- Save PV settings, verify they persist after page reload

**Step 4: Final commit if any fixes needed**

```bash
git commit -m "fix: address integration issues"
```
