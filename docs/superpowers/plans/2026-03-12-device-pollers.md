# Heat Pump & Wallbox Power Display Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display current Nibe heat pump and Tesla wallbox power consumption in the Verbrauch card, with icons in the top-right corner (like MPPT temperature in the Netz card).

**Architecture:** Two independent poller modules (`nibe-poller.ts`, `wallbox-poller.ts`) fetch power data on intervals. The server passes their values into WebSocket broadcasts. The frontend reads them from the status object and renders them in the Verbrauch card.

**Tech Stack:** Node.js fetch, Vitest, React/Lucide icons

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/api/src/nibe-poller.ts` | Poll Nibe heat pump for current power consumption |
| Create | `packages/api/src/wallbox-poller.ts` | Poll Tesla wallbox for current charging power |
| Create | `packages/api/src/__tests__/nibe-poller.test.ts` | Tests for nibe-poller |
| Create | `packages/api/src/__tests__/wallbox-poller.test.ts` | Tests for wallbox-poller |
| Modify | `packages/api/src/config.ts` | Add NIBE_* and WALLBOX_* env vars (optional) |
| Modify | `packages/api/src/__tests__/config.test.ts` | Test new optional config fields |
| Modify | `packages/api/src/server.ts` | Accept pollers, include values in WS broadcast |
| Modify | `packages/api/src/index.ts` | Create pollers and pass to server |
| Modify | `packages/web/hooks/use-websocket.ts` | Add fields to SystemStatus type |
| Modify | `packages/web/app/page.tsx` | Render WP/WB values in Verbrauch card |
| Modify | `.env` | Add NIBE_* and WALLBOX_* values |
| Modify | `.env.example` | Add empty NIBE_* and WALLBOX_* placeholders |

---

## Chunk 1: Backend Pollers

### Task 1: Nibe Poller

**Files:**
- Create: `packages/api/src/nibe-poller.ts`
- Create: `packages/api/src/__tests__/nibe-poller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/__tests__/nibe-poller.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NibePoller } from '../nibe-poller.js';

describe('NibePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns null before first successful poll', () => {
    const poller = new NibePoller({
      url: 'https://192.168.1.101:8443',
      username: 'admin',
      password: 'pass',
    });
    expect(poller.getPowerW()).toBe(null);
    poller.stop();
  });

  it('parses current_power_consumption from Nibe API response', async () => {
    // variableId 43141 = current_power_consumption, divisor 100, value in kWh
    const mockResponse = {
      '43141': {
        title: 'Current Power Consumption',
        metadata: { variableId: 43141, divisor: 100, unit: 'kWh' },
        value: { type: 'number', isOk: true, variableId: 43141, integerValue: 150, stringValue: '1.50' },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const poller = new NibePoller({
      url: 'https://192.168.1.101:8443',
      username: 'admin',
      password: 'pass',
    });
    await poller.poll();

    // 150 / 100 = 1.5 kW = 1500 W
    expect(poller.getPowerW()).toBe(1500);
    poller.stop();
  });

  it('returns null for invalid sensor value -32768', async () => {
    const mockResponse = {
      '43141': {
        title: 'Current Power Consumption',
        metadata: { variableId: 43141, divisor: 100, unit: 'kWh' },
        value: { type: 'number', isOk: true, variableId: 43141, integerValue: -32768, stringValue: '' },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const poller = new NibePoller({
      url: 'https://192.168.1.101:8443',
      username: 'admin',
      password: 'pass',
    });
    await poller.poll();
    expect(poller.getPowerW()).toBe(null);
    poller.stop();
  });

  it('keeps last value on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          '43141': {
            title: '', metadata: { variableId: 43141, divisor: 100, unit: 'kWh' },
            value: { type: 'number', isOk: true, variableId: 43141, integerValue: 200, stringValue: '' },
          },
        }),
      })
      .mockRejectedValueOnce(new Error('network error')),
    );

    const poller = new NibePoller({
      url: 'https://192.168.1.101:8443',
      username: 'admin',
      password: 'pass',
    });
    await poller.poll();
    expect(poller.getPowerW()).toBe(2000);

    await poller.poll();
    expect(poller.getPowerW()).toBe(2000); // retains last value
    poller.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/nibe-poller.test.ts`
Expected: FAIL — cannot find `../nibe-poller.js`

- [ ] **Step 3: Write nibe-poller implementation**

```ts
// packages/api/src/nibe-poller.ts
const POLL_INTERVAL = 60_000;
const VARIABLE_ID_POWER = 43141;
const POWER_DIVISOR = 100;

export interface NibePollerConfig {
  url: string;
  username: string;
  password: string;
}

export class NibePoller {
  private powerW: number | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly config: NibePollerConfig;
  private readonly authHeader: string;

  constructor(config: NibePollerConfig) {
    this.config = config;
    this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  start(): void {
    console.log('[nibe] Starting heat pump poller');
    void this.poll();
    this.interval = setInterval(() => void this.poll(), POLL_INTERVAL);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getPowerW(): number | null {
    return this.powerW;
  }

  async poll(): Promise<void> {
    try {
      const res = await fetch(`${this.config.url}/api/v1/devices/0/points`, {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: Record<string, { value: { integerValue: number } }> = await res.json();
      const point = data[String(VARIABLE_ID_POWER)];
      if (!point) return;

      const raw = point.value.integerValue;
      if (raw === -32768) {
        this.powerW = null;
        return;
      }

      // Nibe reports in kWh with divisor 100: raw/100 = kW, * 1000 = W
      this.powerW = Math.round((raw / POWER_DIVISOR) * 1000);
    } catch (e) {
      console.error('[nibe] Poll error:', (e as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/nibe-poller.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/nibe-poller.ts packages/api/src/__tests__/nibe-poller.test.ts
git commit -m "feat: add nibe heat pump poller for current power consumption"
```

---

### Task 2: Wallbox Poller

**Files:**
- Create: `packages/api/src/wallbox-poller.ts`
- Create: `packages/api/src/__tests__/wallbox-poller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/__tests__/wallbox-poller.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WallboxPoller } from '../wallbox-poller.js';

describe('WallboxPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns null before first successful poll', () => {
    const poller = new WallboxPoller({ url: 'http://192.168.1.137' });
    expect(poller.getPowerW()).toBe(null);
    poller.stop();
  });

  it('computes power from current * voltage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vehicle_connected: true,
        contactor_closed: true,
        vehicle_current_a: 16,
        grid_v: 230,
        session_energy_wh: 5000,
      }),
    }));

    const poller = new WallboxPoller({ url: 'http://192.168.1.137' });
    await poller.poll();

    // 16A * 230V = 3680W
    expect(poller.getPowerW()).toBe(3680);
    expect(poller.isCharging()).toBe(true);
    poller.stop();
  });

  it('reports 0W when not charging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vehicle_connected: true,
        contactor_closed: false,
        vehicle_current_a: 0,
        grid_v: 230,
        session_energy_wh: 0,
      }),
    }));

    const poller = new WallboxPoller({ url: 'http://192.168.1.137' });
    await poller.poll();

    expect(poller.getPowerW()).toBe(0);
    expect(poller.isCharging()).toBe(false);
    poller.stop();
  });

  it('keeps last value on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          vehicle_connected: true, contactor_closed: true,
          vehicle_current_a: 10, grid_v: 230, session_energy_wh: 0,
        }),
      })
      .mockRejectedValueOnce(new Error('timeout')),
    );

    const poller = new WallboxPoller({ url: 'http://192.168.1.137' });
    await poller.poll();
    expect(poller.getPowerW()).toBe(2300);

    await poller.poll();
    expect(poller.getPowerW()).toBe(2300); // retains last value
    poller.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/wallbox-poller.test.ts`
Expected: FAIL — cannot find `../wallbox-poller.js`

- [ ] **Step 3: Write wallbox-poller implementation**

```ts
// packages/api/src/wallbox-poller.ts
const POLL_INTERVAL = 30_000;

export interface WallboxPollerConfig {
  url: string;
}

interface VitalsResponse {
  contactor_closed: boolean;
  vehicle_connected: boolean;
  vehicle_current_a: number;
  grid_v: number;
  session_energy_wh: number;
}

export class WallboxPoller {
  private powerW: number | null = null;
  private charging = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly config: WallboxPollerConfig;

  constructor(config: WallboxPollerConfig) {
    this.config = config;
  }

  start(): void {
    console.log('[wallbox] Starting wallbox poller');
    void this.poll();
    this.interval = setInterval(() => void this.poll(), POLL_INTERVAL);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getPowerW(): number | null {
    return this.powerW;
  }

  isCharging(): boolean {
    return this.charging;
  }

  async poll(): Promise<void> {
    try {
      const res = await fetch(`${this.config.url}/api/1/vitals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const vitals: VitalsResponse = await res.json();
      this.charging = vitals.contactor_closed;
      this.powerW = Math.round(vitals.vehicle_current_a * vitals.grid_v);
    } catch (e) {
      console.error('[wallbox] Poll error:', (e as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/wallbox-poller.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/wallbox-poller.ts packages/api/src/__tests__/wallbox-poller.test.ts
git commit -m "feat: add tesla wallbox poller for charging power"
```

---

## Chunk 2: Config, Server Integration & Frontend

### Task 3: Config & .env

**Files:**
- Modify: `packages/api/src/config.ts`
- Modify: `packages/api/src/__tests__/config.test.ts`
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: Add optional config fields**

In `packages/api/src/config.ts`, add to the `configSchema` object before the closing `});`:

```ts
  NIBE_URL: z.string().optional(),
  NIBE_USERNAME: z.string().optional(),
  NIBE_PASSWORD: z.string().optional(),
  WALLBOX_URL: z.string().optional(),
```

- [ ] **Step 2: Add config test**

In `packages/api/src/__tests__/config.test.ts`, add a test that config loads successfully with and without the new optional fields (verify existing tests still pass).

- [ ] **Step 3: Add values to .env**

Append to `.env`:

```env
# Nibe Heat Pump
NIBE_URL=https://192.168.1.101:8443
NIBE_USERNAME=admin
NIBE_PASSWORD=adminpasswort

# Tesla Wallbox
WALLBOX_URL=http://192.168.1.137
```

- [ ] **Step 4: Add empty placeholders to .env.example**

Append to `.env.example`:

```env
# Nibe Heat Pump (optional)
NIBE_URL=
NIBE_USERNAME=
NIBE_PASSWORD=

# Tesla Wallbox (optional)
WALLBOX_URL=
```

- [ ] **Step 5: Run config tests**

Run: `cd packages/api && npx vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/config.ts packages/api/src/__tests__/config.test.ts .env.example
git commit -m "feat: add optional nibe and wallbox config fields"
```

Note: Do NOT commit `.env` (contains secrets, should be in `.gitignore`).

---

### Task 4: Server Integration

**Files:**
- Modify: `packages/api/src/server.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add poller types to ServerOptions in server.ts**

Add imports and extend `ServerOptions`:

```ts
import type { NibePoller } from './nibe-poller.js';
import type { WallboxPoller } from './wallbox-poller.js';

export interface ServerOptions {
  // ... existing fields ...
  nibePoller?: NibePoller;
  wallboxPoller?: WallboxPoller;
}
```

- [ ] **Step 2: Include poller values in WS broadcast payload**

In `buildServer()`, extract pollers from options:

```ts
const nibePoller = options.nibePoller;
const wallboxPoller = options.wallboxPoller;
```

In the `broadcast()` function, add to the `JSON.stringify` payload object (after `mpptTemperatureC`):

```ts
heatPumpPowerW: nibePoller?.getPowerW() ?? null,
wallboxPowerW: wallboxPoller?.getPowerW() ?? null,
```

- [ ] **Step 3: Create and wire pollers in index.ts**

In `packages/api/src/index.ts`, after the `inexogyService` block and before `buildServer`:

```ts
import { NibePoller } from './nibe-poller.js';
import { WallboxPoller } from './wallbox-poller.js';

// ... inside main(), before buildServer():

let nibePoller: NibePoller | undefined;
if (config.NIBE_URL && config.NIBE_USERNAME && config.NIBE_PASSWORD) {
  nibePoller = new NibePoller({
    url: config.NIBE_URL,
    username: config.NIBE_USERNAME,
    password: config.NIBE_PASSWORD,
  });
  nibePoller.start();
  console.log('[energy-control] nibe heat pump poller enabled');
}

let wallboxPoller: WallboxPoller | undefined;
if (config.WALLBOX_URL) {
  wallboxPoller = new WallboxPoller({ url: config.WALLBOX_URL });
  wallboxPoller.start();
  console.log('[energy-control] tesla wallbox poller enabled');
}
```

Pass to `buildServer`:

```ts
const server = buildServer({ appState, inexogyService, gridHistoryService, batteryHistoryService, consumptionHistoryService, nibePoller, wallboxPoller });
```

Add to `shutdown()`:

```ts
nibePoller?.stop();
wallboxPoller?.stop();
```

- [ ] **Step 4: Run existing server/websocket tests**

Run: `cd packages/api && npx vitest run src/__tests__/server.test.ts src/__tests__/websocket.test.ts`
Expected: PASS (no breaking changes — new fields are optional)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/index.ts
git commit -m "feat: integrate nibe and wallbox pollers into server and WS broadcast"
```

---

### Task 5: Frontend Display

**Files:**
- Modify: `packages/web/hooks/use-websocket.ts`
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Add fields to SystemStatus type**

In `packages/web/hooks/use-websocket.ts`, add to `SystemStatus` interface:

```ts
heatPumpPowerW?: number | null;
wallboxPowerW?: number | null;
```

- [ ] **Step 2: Extract values in page.tsx**

Near the line `const mpptTemperatureC = status?.mpptTemperatureC ?? null;`, add:

```ts
const heatPumpPowerW = status?.heatPumpPowerW ?? null;
const wallboxPowerW = status?.wallboxPowerW ?? null;
```

- [ ] **Step 3: Add lucide-react icon imports**

Add `AirVent` and `BatteryCharging` to the existing lucide-react import in `page.tsx`.

- [ ] **Step 4: Update Verbrauch card**

Replace the Consumption card block:

```tsx
{/* Consumption */}
<div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
  <div className="flex justify-between items-start mb-1">
    <p className="text-sm text-[var(--text-secondary)]">Verbrauch</p>
    <div className="flex flex-col items-end gap-0.5">
      {heatPumpPowerW !== null && (
        <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1" title="Wärmepumpe">
          <AirVent size={12} />
          {formatPower(heatPumpPowerW)}
        </p>
      )}
      {wallboxPowerW !== null && wallboxPowerW > 0 && (
        <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1" title="Wallbox">
          <BatteryCharging size={12} />
          {formatPower(wallboxPowerW)}
        </p>
      )}
    </div>
  </div>
  <p className="text-3xl font-bold">{formatPower(consumption)}</p>
</div>
```

Note: Wallbox only shown when `> 0` (not charging = hidden), heat pump always shown when available.

- [ ] **Step 5: Verify build**

Run: `cd packages/web && npx next build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/web/hooks/use-websocket.ts packages/web/app/page.tsx
git commit -m "feat: display heat pump and wallbox power in Verbrauch card"
```
