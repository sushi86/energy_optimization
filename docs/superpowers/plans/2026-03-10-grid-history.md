# Grid Power Accumulator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accumulate per-phase grid power from MQTT into 15-minute slot averages, persist to daily JSON files, and expose via API for the charge plan chart.

**Architecture:** New `GridHistoryService` subscribes to MQTT state changes, accumulates samples per 15-min slot, persists to `data/grid-history/YYYY-MM-DD.json`. New `/api/grid/history` endpoint serves the data. Frontend switches from `/api/meter/history` to `/api/grid/history` for chart bars.

**Tech Stack:** TypeScript, Node.js fs, Fastify, React (Next.js)

---

## File Structure

- Create: `packages/api/src/grid-history-service.ts` — accumulator service
- Create: `packages/api/src/__tests__/grid-history-service.test.ts` — unit tests
- Modify: `packages/api/src/index.ts` — instantiate and wire up service
- Modify: `packages/api/src/server.ts` — add `/api/grid/history` endpoint
- Modify: `packages/web/app/page.tsx` — switch to `/api/grid/history`
- Modify: `docker-compose.yml` — add volume mount

---

## Chunk 1: Backend

### Task 1: GridHistoryService — core accumulator

**Files:**
- Create: `packages/api/src/grid-history-service.ts`
- Create: `packages/api/src/__tests__/grid-history-service.test.ts`

- [ ] **Step 1: Write tests for recording samples and computing slot averages**

```typescript
// packages/api/src/__tests__/grid-history-service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridHistoryService } from '../grid-history-service.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('GridHistoryService', () => {
  let tmpDir: string;
  let service: GridHistoryService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-history-test-'));
    service = new GridHistoryService(tmpDir);
  });

  afterEach(() => {
    service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records samples and computes slot average', () => {
    // Use injectSlot to avoid clock-boundary fragility
    service.injectSlot('10:00', { sum: -6000, count: 3 });

    const slots = service.getSlots();
    expect(slots['10:00']).toBeDefined();
    expect(slots['10:00'].avgPowerW).toBe(-2000);
    expect(slots['10:00'].samples).toBe(3);
    expect(slots['10:00'].energyWh).toBe(-500); // -2000 * 0.25
  });

  it('recordSample adds to current slot', () => {
    service.recordSample(-2000);
    const slots = service.getSlots();
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(1);
    expect(slots[keys[0]].avgPowerW).toBe(-2000);
    expect(slots[keys[0]].samples).toBe(1);
  });

  it('returns empty object when no samples recorded', () => {
    expect(service.getSlots()).toEqual({});
  });

  it('separates samples into different slots based on time', () => {
    // Record into current slot
    service.recordSample(-1000);

    // Manually inject a different slot to simulate time passing
    service.injectSlot('03:00', { sum: -6000, count: 2 });

    const slots = service.getSlots();
    expect(slots['03:00']).toBeDefined();
    expect(slots['03:00'].avgPowerW).toBe(-3000);
    expect(slots['03:00'].samples).toBe(2);
    expect(slots['03:00'].energyWh).toBe(-750);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx vitest run src/__tests__/grid-history-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GridHistoryService**

```typescript
// packages/api/src/grid-history-service.ts
import fs from 'node:fs';
import path from 'node:path';

export interface GridSlot {
  avgPowerW: number;
  energyWh: number;
  samples: number;
}

interface SlotAccumulator {
  sum: number;
  count: number;
}

function slotKey(): string {
  // Use Europe/Berlin timezone to match todayDateStr()
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = parts.find(p => p.type === 'hour')!.value;
  const rawM = parseInt(parts.find(p => p.type === 'minute')!.value);
  const m = (Math.floor(rawM / 15) * 15).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function todayDateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

export class GridHistoryService {
  private dataDir: string;
  private accumulators: Record<string, SlotAccumulator> = {};
  private currentDate: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.currentDate = todayDateStr();
    this.load();
    // Persist every 60 seconds
    this.saveTimer = setInterval(() => this.save(), 60_000);
  }

  recordSample(gridPowerW: number): void {
    const now = todayDateStr();
    if (now !== this.currentDate) {
      this.save();
      this.accumulators = {};
      this.currentDate = now;
    }

    const key = slotKey();
    if (!this.accumulators[key]) {
      this.accumulators[key] = { sum: 0, count: 0 };
    }
    this.accumulators[key].sum += gridPowerW;
    this.accumulators[key].count += 1;
  }

  /** For testing: inject raw accumulator data for a slot */
  injectSlot(key: string, acc: { sum: number; count: number }): void {
    this.accumulators[key] = acc;
  }

  getSlots(date?: string): Record<string, GridSlot> {
    const targetDate = date ?? todayDateStr();

    // If requesting a different date, load from file
    if (targetDate !== this.currentDate) {
      return this.loadFromFile(targetDate);
    }

    const result: Record<string, GridSlot> = {};
    for (const [key, acc] of Object.entries(this.accumulators)) {
      if (acc.count === 0) continue;
      const avg = Math.round(acc.sum / acc.count);
      result[key] = {
        avgPowerW: avg,
        energyWh: Math.round(avg * 0.25),
        samples: acc.count,
      };
    }
    return result;
  }

  private filePath(date: string): string {
    return path.join(this.dataDir, `${date}.json`);
  }

  private load(): void {
    try {
      const content = fs.readFileSync(this.filePath(this.currentDate), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, SlotAccumulator> };
      if (data.accumulators) {
        this.accumulators = data.accumulators;
        console.log(`[grid-history] Loaded ${Object.keys(this.accumulators).length} slots for ${this.currentDate}`);
      }
    } catch {
      // No file yet — start fresh
    }
  }

  private loadFromFile(date: string): Record<string, GridSlot> {
    try {
      const content = fs.readFileSync(this.filePath(date), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, SlotAccumulator> };
      const result: Record<string, GridSlot> = {};
      if (data.accumulators) {
        for (const [key, acc] of Object.entries(data.accumulators)) {
          if (acc.count === 0) continue;
          const avg = Math.round(acc.sum / acc.count);
          result[key] = { avgPowerW: avg, energyWh: Math.round(avg * 0.25), samples: acc.count };
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  save(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const data = { date: this.currentDate, accumulators: this.accumulators };
      fs.writeFileSync(this.filePath(this.currentDate), JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.error('[grid-history] Failed to save:', err);
    }
  }

  stop(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.save();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/grid-history-service.test.ts`
Expected: PASS

- [ ] **Step 5: Write persistence tests**

Add to the existing test file:

```typescript
describe('persistence', () => {
  it('saves and loads accumulators from file', () => {
    service.recordSample(-2000);
    service.recordSample(-4000);
    service.save();

    // Create new service from same dir — should restore
    const service2 = new GridHistoryService(tmpDir);
    const slots = service2.getSlots();
    const now = new Date();
    const key = `${now.getHours().toString().padStart(2, '0')}:${(Math.floor(now.getMinutes() / 15) * 15).toString().padStart(2, '0')}`;

    expect(slots[key]).toBeDefined();
    expect(slots[key].avgPowerW).toBe(-3000);
    expect(slots[key].samples).toBe(2);
    service2.stop();
  });

  it('returns empty for non-existent historical date', () => {
    const slots = service.getSlots('2020-01-01');
    expect(slots).toEqual({});
  });
});
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/grid-history-service.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/grid-history-service.ts packages/api/src/__tests__/grid-history-service.test.ts
git commit -m "feat: add GridHistoryService for accumulating grid power"
```

---

### Task 2: API endpoint and wiring

**Files:**
- Modify: `packages/api/src/server.ts` — add `/api/grid/history` endpoint, accept GridHistoryService in ServerOptions
- Modify: `packages/api/src/index.ts` — instantiate GridHistoryService, wire to MQTT, pass to server

- [ ] **Step 1: Add GridHistoryService to server**

In `packages/api/src/server.ts`, add to imports:

```typescript
import type { GridHistoryService } from './grid-history-service.js';
```

Add to `ServerOptions` interface:

```typescript
gridHistoryService?: GridHistoryService;
```

Extract at top of `buildServer`:

```typescript
const gridHistoryService = options.gridHistoryService;
```

Add endpoint after the existing `/api/meter/history` endpoint:

```typescript
app.get('/api/grid/history', async (request) => {
  if (!gridHistoryService) {
    return { date: '', slots: [] };
  }
  const query = request.query as { date?: string };
  const tz = 'Europe/Berlin';
  const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const slotsObj = gridHistoryService.getSlots(dateStr);
  const slots = Object.entries(slotsObj)
    .map(([time, slot]) => ({ time, ...slot }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { date: dateStr, slots };
});
```

- [ ] **Step 2: Wire up in index.ts**

In `packages/api/src/index.ts`, add import:

```typescript
import { GridHistoryService } from './grid-history-service.js';
```

After `appState.startRegulation()` (around line 37), add:

```typescript
const dataDir = resolve(__dirname, '../../../data');
const gridHistoryService = new GridHistoryService(resolve(dataDir, 'grid-history'));

// Record grid power on every MQTT state change
appState.mqtt.on('stateChange', () => {
  const s = appState.mqtt.getState();
  gridHistoryService.recordSample(s.gridPower);
});
```

Update the `buildServer` call:

```typescript
const server = buildServer({ appState, inexogyService, gridHistoryService });
```

Add to shutdown handler (before `process.exit(0)`):

```typescript
gridHistoryService.stop();
```

- [ ] **Step 3: Run all backend tests**

Run: `cd packages/api && npx vitest run`
Expected: All grid-history tests pass. Pre-existing MQTT tests may fail due to sandbox restrictions (unrelated).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/index.ts
git commit -m "feat: add /api/grid/history endpoint and wire up service"
```

---

### Task 3: Docker volume

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add volume mount**

```yaml
services:
  energy-control-api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    network_mode: host
    env_file: .env
    environment:
      - TZ=Europe/Berlin
    restart: unless-stopped
    volumes:
      - energy-data:/app/data

  energy-control-web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    network_mode: host
    environment:
      - TZ=Europe/Berlin
    depends_on:
      - energy-control-api
    restart: unless-stopped

volumes:
  energy-data:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Docker volume for persistent data directory"
```

---

## Chunk 2: Frontend

### Task 4: Switch frontend to grid history endpoint

**Files:**
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Add GridSlot interface and update state**

Replace the `MeterReading` interface (lines 17-22) with:

```typescript
interface GridHistorySlot {
  time: string;
  avgPowerW: number;
  energyWh: number;
  samples: number;
}
```

Replace `meterReadings` state (around line 760):

```typescript
const [gridHistory, setGridHistory] = useState<GridHistorySlot[]>([]);
```

- [ ] **Step 2: Update fetch calls**

Replace `fetchMeterHistory` in the useEffect (lines 834-841):

```typescript
const fetchGridHistory = () => {
  fetch('/api/grid/history')
    .then((r) => r.json())
    .then((data) => {
      if (Array.isArray(data?.slots)) setGridHistory(data.slots);
    })
    .catch(() => {});
};
```

Update all call sites:
- Initial call: `fetchGridHistory();` (was `fetchMeterHistory();`)
- Interval: `const meterInterval = setInterval(fetchGridHistory, 5 * 60 * 1000);`
- `handleRefresh` (lines 875-878): replace with:

```typescript
fetch('/api/grid/history')
  .then((r) => r.json())
  .then((data) => { if (Array.isArray(data?.slots)) setGridHistory(data.slots); })
  .catch(() => {});
```

- [ ] **Step 3: Update actualFeedIn computation**

Replace the `useMemo` block (lines 892-906) with:

```typescript
const actualFeedIn = useMemo(() => {
  const map = new Map<string, { feedInW: number; feedInKwh: number }>();
  for (const slot of gridHistory) {
    // Negative avgPowerW = feed-in, positive = consumption
    const feedInW = Math.max(0, -slot.avgPowerW);
    const feedInKwh = Math.max(0, -slot.energyWh) / 1000;
    if (feedInW > 0) {
      map.set(slot.time, { feedInW, feedInKwh });
    }
  }
  return map;
}, [gridHistory]);
```

- [ ] **Step 4: Verify build compiles**

Run: `cd packages/web && npx next build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: switch chart to grid history for actual feed-in bars"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run backend tests**

Run: `cd packages/api && npx vitest run`

- [ ] **Step 2: Run frontend build**

Run: `cd packages/web && npx next build`

- [ ] **Step 3: Final commit if any cleanup needed**
