# Daily Summary Persistence & History Page

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist daily energy billing data (EEG vs Börse revenue + feed-in volume) as JSON files and display them on a new `/history` page with a monthly bar chart.

**Architecture:** On `pv:production-ended` event, write a daily summary JSON to `/app/data/daily-summary/YYYY-MM-DD.json`. Two new API endpoints serve individual and all summaries. A new Next.js page at `/history` renders a bar chart (custom SVG, matching existing chart patterns) with month navigation.

**Tech Stack:** Node.js fs (API), Next.js App Router + Tailwind CSS + custom SVG chart (Web)

---

## File Structure

- **Create:** `packages/api/src/daily-summary-service.ts` — listens to `pv:production-ended`, writes JSON files
- **Create:** `packages/api/src/__tests__/daily-summary-service.test.ts` — unit tests
- **Modify:** `packages/api/src/index.ts:98-99` — instantiate DailySummaryService
- **Modify:** `packages/api/src/server.ts` — add two API endpoints
- **Modify:** `packages/api/src/__tests__/server.test.ts` — API endpoint tests
- **Create:** `packages/web/app/history/page.tsx` — history page with bar chart

---

## Chunk 1: Backend — DailySummaryService + API

### Task 1: DailySummaryService

**Files:**
- Create: `packages/api/src/daily-summary-service.ts`
- Create: `packages/api/src/__tests__/daily-summary-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/__tests__/daily-summary-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DailySummaryService } from '../daily-summary-service.js';
import { energyEvents } from '../energy-events.js';

describe('DailySummaryService', () => {
  const testDir = path.join(import.meta.dirname, '../../test-data-daily-summary');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('writes daily summary on production-ended event', () => {
    new DailySummaryService(testDir);

    energyEvents.emit('pv:production-ended', {
      totalYieldKwh: 28.4,
      feedInKwh: 12.3,
      revenueFixedCent: 984,
      revenueMarketCent: 1107,
      finalSoc: 85,
      forecastCorrectionFactor: 0.92,
    });

    // Should have written today's file
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const filePath = path.join(testDir, `${today}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data).toEqual({
      date: today,
      totalYieldKwh: 28.4,
      feedInKwh: 12.3,
      revenueFixedCent: 984,
      revenueMarketCent: 1107,
    });
  });

  it('getSummary returns null for missing date', () => {
    const service = new DailySummaryService(testDir);
    expect(service.getSummary('2020-01-01')).toBeNull();
  });

  it('getAllSummaries returns all saved summaries sorted by date', () => {
    const service = new DailySummaryService(testDir);

    // Write two summary files directly
    const s1 = { date: '2026-03-13', totalYieldKwh: 10, feedInKwh: 5, revenueFixedCent: 400, revenueMarketCent: 450 };
    const s2 = { date: '2026-03-14', totalYieldKwh: 20, feedInKwh: 8, revenueFixedCent: 640, revenueMarketCent: 720 };
    fs.writeFileSync(path.join(testDir, '2026-03-14.json'), JSON.stringify(s2));
    fs.writeFileSync(path.join(testDir, '2026-03-13.json'), JSON.stringify(s1));

    const all = service.getAllSummaries();
    expect(all).toHaveLength(2);
    expect(all[0].date).toBe('2026-03-13');
    expect(all[1].date).toBe('2026-03-14');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/daily-summary-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write DailySummaryService implementation**

```typescript
// packages/api/src/daily-summary-service.ts
import fs from 'node:fs';
import path from 'node:path';
import { energyEvents, type ProductionEndedEvent } from './energy-events.js';

export interface DailySummary {
  date: string;
  totalYieldKwh: number;
  feedInKwh: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

export class DailySummaryService {
  constructor(private dataDir: string) {
    energyEvents.on('pv:production-ended', (event) => this.handleProductionEnded(event));
    console.log('[daily-summary] Service started');
  }

  private handleProductionEnded(event: ProductionEndedEvent): void {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const summary: DailySummary = {
      date: today,
      totalYieldKwh: event.totalYieldKwh,
      feedInKwh: event.feedInKwh,
      revenueFixedCent: event.revenueFixedCent,
      revenueMarketCent: event.revenueMarketCent,
    };

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dataDir, `${today}.json`),
      JSON.stringify(summary),
      'utf-8',
    );
    console.log(`[daily-summary] Saved summary for ${today}`);
  }

  getSummary(date: string): DailySummary | null {
    try {
      const content = fs.readFileSync(path.join(this.dataDir, `${date}.json`), 'utf-8');
      return JSON.parse(content) as DailySummary;
    } catch {
      return null;
    }
  }

  getAllSummaries(): DailySummary[] {
    try {
      const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json')).sort();
      return files.map(f => {
        const content = fs.readFileSync(path.join(this.dataDir, f), 'utf-8');
        return JSON.parse(content) as DailySummary;
      });
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/daily-summary-service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/daily-summary-service.ts packages/api/src/__tests__/daily-summary-service.test.ts
git commit -m "feat: add DailySummaryService for persisting daily billing data"
```

### Task 2: Wire up DailySummaryService in index.ts

**Files:**
- Modify: `packages/api/src/index.ts:98-99`

- [ ] **Step 1: Add import and instantiation**

Add import at top:
```typescript
import { DailySummaryService } from './daily-summary-service.js';
```

After `new NotificationService(pushService)` (line 99), add:
```typescript
new DailySummaryService(resolve(dataDir, 'daily-summary'));
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat: wire up DailySummaryService on startup"
```

### Task 3: API endpoints

**Files:**
- Modify: `packages/api/src/server.ts` — add `dailySummaryService` to ServerOptions, add two GET endpoints
- Modify: `packages/api/src/__tests__/server.test.ts` — test the endpoints

- [ ] **Step 1: Add DailySummaryService to ServerOptions**

In `server.ts`, add to the `ServerOptions` interface:
```typescript
dailySummaryService?: DailySummaryService;
```

Add import:
```typescript
import type { DailySummaryService } from './daily-summary-service.js';
```

Destructure in `buildServer`:
```typescript
const dailySummaryService = options.dailySummaryService;
```

- [ ] **Step 2: Add API endpoints**

Before the proxy registration (line 657), add:

```typescript
app.get('/api/daily-summary', async (request) => {
  if (!dailySummaryService) return { summaries: [] };
  const query = request.query as { month?: string };
  const all = dailySummaryService.getAllSummaries();
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    return { summaries: all.filter(s => s.date.startsWith(query.month!)) };
  }
  return { summaries: all };
});

app.get('/api/daily-summary/:date', async (request) => {
  if (!dailySummaryService) return { summary: null };
  const { date } = request.params as { date: string };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { summary: null };
  return { summary: dailySummaryService.getSummary(date) };
});
```

- [ ] **Step 3: Pass dailySummaryService in index.ts**

In `index.ts`, change the `DailySummaryService` instantiation to capture the instance:
```typescript
const dailySummaryService = new DailySummaryService(resolve(dataDir, 'daily-summary'));
```

Pass it to `buildServer`:
```typescript
const server = buildServer({ appState, inexogyService, gridHistoryService, batteryHistoryService, consumptionHistoryService, socHistoryService, pvHistoryService, nibePoller, wallboxPoller, pushService, dailySummaryService });
```

- [ ] **Step 4: Write API tests**

Add to `server.test.ts`:

```typescript
describe('daily-summary endpoints', () => {
  it('GET /api/daily-summary returns all summaries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/daily-summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('summaries');
    expect(Array.isArray(body.summaries)).toBe(true);
  });

  it('GET /api/daily-summary?month=2026-03 filters by month', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/daily-summary?month=2026-03' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/daily-summary/:date returns single summary or null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/daily-summary/2020-01-01' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.summary).toBeNull();
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/api && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/index.ts packages/api/src/__tests__/server.test.ts
git commit -m "feat: add daily-summary API endpoints"
```

---

## Chunk 2: Frontend — /history Page

### Task 4: History page with monthly bar chart

**Files:**
- Create: `packages/web/app/history/page.tsx`

The chart follows the existing pattern from `page.tsx`: custom SVG/div-based bars with Tailwind, no external chart library.

- [ ] **Step 1: Create the history page**

```tsx
// packages/web/app/history/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DailySummary {
  date: string;
  totalYieldKwh: number;
  feedInKwh: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${monthNames[parseInt(m) - 1]} ${year}`;
}

function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(year, m, 0).getDate();
}

function getCurrentMonth(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
}

function prevMonth(month: string): string {
  const d = new Date(`${month}-15`);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const d = new Date(`${month}-15`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export default function HistoryPage() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/daily-summary?month=${month}`)
      .then(r => r.json())
      .then(data => setSummaries(data.summaries ?? []))
      .catch(() => setSummaries([]))
      .finally(() => setLoading(false));
  }, [month]);

  const isCurrentMonth = month === getCurrentMonth();
  const days = daysInMonth(month);

  // Build a map of date -> summary for the month
  const byDate = new Map(summaries.map(s => [s.date, s]));

  // Find max revenue for scaling
  const maxRevenue = Math.max(
    ...summaries.map(s => Math.max(s.revenueFixedCent, s.revenueMarketCent)),
    1, // prevent 0
  );

  // Monthly totals
  const totalFixed = summaries.reduce((s, d) => s + d.revenueFixedCent, 0);
  const totalMarket = summaries.reduce((s, d) => s + d.revenueMarketCent, 0);
  const totalFeedIn = summaries.reduce((s, d) => s + d.feedInKwh, 0);
  const totalYield = summaries.reduce((s, d) => s + d.totalYieldKwh, 0);

  return (
    <main className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Ertrags-Historie</h1>
        <div className="w-16" />
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="px-3 py-1.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-sm"
        >
          ←
        </button>
        <span className="text-base font-medium">{formatMonth(month)}</span>
        <button
          onClick={() => setMonth(nextMonth(month))}
          disabled={isCurrentMonth}
          className="px-3 py-1.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-sm disabled:opacity-30"
        >
          →
        </button>
      </div>

      {/* Monthly totals */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Einspeisung</div>
          <div className="text-lg font-semibold">{totalFeedIn.toFixed(1)} kWh</div>
          <div className="text-xs text-[var(--text-secondary)]">von {totalYield.toFixed(1)} kWh Ertrag</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Vergütung</div>
          <div className="text-lg font-semibold">{((totalFixed + totalMarket) / 100).toFixed(2)} €</div>
          <div className="text-xs text-[var(--text-secondary)]">
            <span className="text-amber-400">EEG {(totalFixed / 100).toFixed(2)}€</span>
            {' · '}
            <span className="text-emerald-400">Börse {(totalMarket / 100).toFixed(2)}€</span>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="flex items-center gap-4 mb-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> EEG
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" /> Börse
          </span>
        </div>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-[var(--text-secondary)] text-sm">Laden...</div>
        ) : summaries.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-[var(--text-secondary)] text-sm">Keine Daten für {formatMonth(month)}</div>
        ) : (
          <div className="flex items-end gap-px" style={{ height: '160px' }}>
            {Array.from({ length: days }, (_, i) => {
              const day = (i + 1).toString().padStart(2, '0');
              const date = `${month}-${day}`;
              const summary = byDate.get(date);
              const fixedPct = summary ? (summary.revenueFixedCent / maxRevenue) * 100 : 0;
              const marketPct = summary ? (summary.revenueMarketCent / maxRevenue) * 100 : 0;

              return (
                <div key={date} className="flex-1 min-w-0 flex flex-col items-center gap-0 h-full justify-end group relative">
                  {/* Tooltip */}
                  {summary && (
                    <div className="absolute -top-16 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap text-[10px] bg-[var(--bg-card)] border border-[var(--border)] rounded px-2 py-1 z-10">
                      <div className="font-medium">{day}.{month.split('-')[1]}.</div>
                      <div>Einspeisung: {summary.feedInKwh.toFixed(1)} kWh</div>
                      <div className="text-amber-400">EEG: {(summary.revenueFixedCent / 100).toFixed(2)}€</div>
                      <div className="text-emerald-400">Börse: {(summary.revenueMarketCent / 100).toFixed(2)}€</div>
                    </div>
                  )}
                  {/* Stacked bars */}
                  <div className="w-full flex flex-col justify-end" style={{ height: '90%' }}>
                    <div className="w-full bg-emerald-400 rounded-t-sm" style={{ height: `${marketPct}%`, minHeight: marketPct > 0 ? '1px' : 0 }} />
                    <div className="w-full bg-amber-400" style={{ height: `${fixedPct}%`, minHeight: fixedPct > 0 ? '1px' : 0 }} />
                  </div>
                  {/* Day label */}
                  {(i + 1) % 5 === 1 && (
                    <span className="text-[8px] text-[var(--text-secondary)] mt-0.5">{i + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `cd packages/web && npx next build`
Expected: Build succeeds (page compiles without errors)

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/history/page.tsx
git commit -m "feat: add /history page with monthly EEG vs Börse bar chart"
```

### Task 5: Add navigation link from dashboard

**Files:**
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Add link to history page**

Find an appropriate place in the dashboard header/nav area and add:
```tsx
<Link href="/history" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
  Historie
</Link>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: add navigation link to history page from dashboard"
```
