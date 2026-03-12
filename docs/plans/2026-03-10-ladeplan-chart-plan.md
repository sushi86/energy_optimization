# Ladeplan-Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display a charge plan chart showing hourly charge/feed-in distribution, SOC progression, and daily revenue estimates (fixed EEG vs. market price).

**Architecture:** New `computeChargePlan()` function in the backend simulates the controller logic per forecast hour to produce a plan. The plan is sent via WebSocket alongside existing data. A new `ChargePlanChart` component renders the plan at the bottom of the dashboard. A new `feedInRateCentPerKwh` config field stores the fixed feed-in rate.

**Tech Stack:** TypeScript, Fastify, WebSocket, React, Tailwind CSS

---

### Task 1: Add `feedInRateCentPerKwh` config field

**Files:**
- Modify: `packages/api/src/app-state.ts:11-25` (AppStateOptions interface)
- Modify: `packages/api/src/app-state.ts:177-184` (saveConfigOverrides persistable fields)
- Modify: `packages/api/src/server.ts:172-186` (GET /api/config response)
- Modify: `packages/api/src/server.ts:188-203` (PUT /api/config response)

**Step 1: Add `feedInRateCentPerKwh` to `AppStateOptions`**

In `packages/api/src/app-state.ts`, add to the `AppStateOptions` interface:

```typescript
feedInRateCentPerKwh: number;
```

**Step 2: Set default in `src/index.ts` or wherever options are constructed**

Find where `AppStateOptions` is constructed and add default `feedInRateCentPerKwh: 7`.

Check `packages/api/src/index.ts` for the construction site.

**Step 3: Add to persistable config in `saveConfigOverrides`**

In `packages/api/src/app-state.ts:177-184`, add `feedInRateCentPerKwh` to the `persistable` object.

**Step 4: Add to GET/PUT /api/config**

In `packages/api/src/server.ts`, add `feedInRateCentPerKwh` to the config GET response (line ~184) and PUT response (line ~200).

**Step 5: Run tests**

Run: `cd packages/api && npx vitest run`
Expected: All existing tests pass (no breakage).

**Step 6: Commit**

```bash
git add packages/api/src/app-state.ts packages/api/src/server.ts packages/api/src/index.ts
git commit -m "feat: add feedInRateCentPerKwh config field (default 7)"
```

---

### Task 2: Add feed-in rate setting to frontend settings page

**Files:**
- Modify: `packages/web/app/settings/page.tsx:182-215` (after price optimization toggle)

**Step 1: Add feed-in rate input field**

After the price optimization toggle section (around line 215), add a new settings card:

```tsx
{/* Feed-in Rate */}
<div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-[var(--text-primary)]">Einspeisevergütung</p>
      <p className="text-xs text-[var(--text-secondary)] mt-1">
        Feste Vergütung für die Ertragsberechnung im Ladeplan.
      </p>
    </div>
    <div className="flex items-center gap-2">
      <input
        type="number"
        step={0.1}
        value={config?.feedInRateCentPerKwh ?? 7}
        onChange={(e) => updateConfigField('feedInRateCentPerKwh', e.target.value)}
        className="w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--accent)]"
      />
      <span className="text-sm text-[var(--text-secondary)]">ct/kWh</span>
    </div>
  </div>
</div>
```

This field is part of the existing config object, so saving works automatically via the existing "Konfiguration" save button. But since it's a boolean-free numeric field, it will also appear in the dynamic config form below. To avoid duplication, we should either:
- Filter it out of the dynamic form, or
- Only show it in the dedicated card above.

Best approach: Add `feedInRateCentPerKwh` to the filter in the dynamic config form so it doesn't show twice. The dynamic form already filters `typeof value === 'boolean'` — add `key === 'feedInRateCentPerKwh'` to that filter.

**Step 2: Verify**

Open the settings page and confirm the feed-in rate field appears and saves correctly.

**Step 3: Commit**

```bash
git add packages/web/app/settings/page.tsx
git commit -m "feat: add feed-in rate setting to settings page"
```

---

### Task 3: Create `computeChargePlan()` function

**Files:**
- Create: `packages/api/src/charge-plan.ts`
- Test: `packages/api/src/__tests__/charge-plan.test.ts`

**Step 1: Write the failing test**

Create `packages/api/src/__tests__/charge-plan.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeChargePlan, type ChargePlanConfig } from '../charge-plan.js';
import type { Forecast } from '../vrm-service.js';
import type { PriceEntry } from '../controller.js';

function makeForecastHours(powers: number[]): Forecast {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hours = powers.map((powerW, i) => ({
    timestamp: new Date(now.getTime() + i * 3600_000),
    powerW,
  }));
  return { hours, totalKwh: powers.reduce((s, p) => s + p, 0) / 1000 };
}

function makeConfig(overrides: Partial<ChargePlanConfig> = {}): ChargePlanConfig {
  return {
    currentSoc: 50,
    batteryCapacityKwh: 16,
    targetSocPercent: 100,
    minSocPercent: 20,
    maxAcPowerW: 12000,
    feedInRateCentPerKwh: 7,
    consumptionW: 1000,
    priceOptimization: false,
    ...overrides,
  };
}

describe('computeChargePlan', () => {
  it('returns hourly entries for each forecast hour', () => {
    const forecast = makeForecastHours([0, 0, 5000, 8000, 10000, 8000, 5000, 0, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig());
    expect(plan.hours.length).toBe(forecast.hours.length);
  });

  it('calculates total feed-in kWh', () => {
    const forecast = makeForecastHours([0, 5000, 10000, 5000, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig({ currentSoc: 90 }));
    expect(plan.totalFeedInKwh).toBeGreaterThan(0);
  });

  it('calculates revenue with fixed rate', () => {
    const forecast = makeForecastHours([0, 5000, 10000, 5000, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig({ currentSoc: 90, feedInRateCentPerKwh: 7 }));
    // Revenue = totalFeedInKwh * 7 ct
    expect(plan.totalRevenueFixedCent).toBeCloseTo(plan.totalFeedInKwh * 7, 0);
  });

  it('calculates revenue with market prices', () => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const nowSec = Math.floor(now.getTime() / 1000);
    const forecast = makeForecastHours([0, 5000, 10000, 5000, 0]);
    const prices: PriceEntry[] = [
      { timestamp: nowSec, price: 50 },
      { timestamp: nowSec + 3600, price: 100 },
      { timestamp: nowSec + 7200, price: 150 },
      { timestamp: nowSec + 10800, price: 100 },
      { timestamp: nowSec + 14400, price: 50 },
    ];
    const plan = computeChargePlan(forecast, prices, makeConfig({ currentSoc: 90 }));
    expect(plan.totalRevenueMarketCent).toBeGreaterThan(0);
  });

  it('tracks SOC progression through the day', () => {
    const forecast = makeForecastHours([0, 5000, 10000, 8000, 5000, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig({ currentSoc: 30 }));
    // SOC should increase over hours with production
    const socValues = plan.hours.map(h => h.estimatedSoc);
    // First hour (no production) should stay same
    expect(socValues[0]).toBeCloseTo(30, 0);
    // Later hours should be higher
    expect(socValues[socValues.length - 1]).toBeGreaterThan(30);
  });

  it('detects when battery reaches 100%', () => {
    // Small battery need, lots of production
    const forecast = makeForecastHours([0, 8000, 10000, 10000, 8000, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig({ currentSoc: 80 }));
    expect(plan.estimatedFullHour).not.toBeNull();
  });

  it('prioritizes charging when forecast is tight', () => {
    // SOC 20% -> need 12.8 kWh, but only ~15 kWh forecast
    const forecast = makeForecastHours([0, 5000, 5000, 5000, 0]);
    const plan = computeChargePlan(forecast, [], makeConfig({ currentSoc: 20 }));
    // Should have very little feed-in
    expect(plan.totalFeedInKwh).toBeLessThan(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/charge-plan.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `computeChargePlan()`**

Create `packages/api/src/charge-plan.ts`:

```typescript
import type { Forecast } from './vrm-service.js';
import type { PriceEntry } from './controller.js';

export interface ChargePlanConfig {
  currentSoc: number;
  batteryCapacityKwh: number;
  targetSocPercent: number;
  minSocPercent: number;
  maxAcPowerW: number;
  feedInRateCentPerKwh: number;
  consumptionW: number;
  priceOptimization: boolean;
}

export interface ChargePlanHour {
  hour: number;
  timestamp: string;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

export interface ChargePlan {
  hours: ChargePlanHour[];
  totalFeedInKwh: number;
  totalRevenueFixedCent: number;
  totalRevenueMarketCent: number;
  feedInRateCentPerKwh: number;
  estimatedFullHour: number | null;
}

export function computeChargePlan(
  forecast: Forecast,
  prices: PriceEntry[],
  config: ChargePlanConfig,
): ChargePlan {
  const {
    currentSoc,
    batteryCapacityKwh,
    targetSocPercent,
    maxAcPowerW,
    feedInRateCentPerKwh,
    consumptionW,
  } = config;

  let soc = currentSoc;
  const hours: ChargePlanHour[] = [];
  let totalFeedInKwh = 0;
  let totalRevenueFixedCent = 0;
  let totalRevenueMarketCent = 0;
  let estimatedFullHour: number | null = null;

  // Calculate total remaining battery need and remaining forecast
  const batteryNeedKwh = Math.max(0, (targetSocPercent / 100 - soc / 100) * batteryCapacityKwh);
  const totalForecastKwh = forecast.hours.reduce((sum, h) => sum + h.powerW, 0) / 1000;
  const surplusRatio = batteryNeedKwh > 0 ? totalForecastKwh / batteryNeedKwh : Infinity;
  const isTightForecast = surplusRatio < 1.5;

  // Calculate how much must come from clipping
  const clippingThreshold = maxAcPowerW * 0.92;
  let forcedChargeKwh = 0;
  for (const h of forecast.hours) {
    if (h.powerW > clippingThreshold) {
      forcedChargeKwh += (h.powerW - clippingThreshold) / 1000;
    }
  }
  const voluntaryChargeKwh = Math.max(0, batteryNeedKwh - forcedChargeKwh);

  // Count productive hours for spreading voluntary charge
  const productiveHours = forecast.hours.filter(h => h.powerW > 100).length;
  const effectiveHours = Math.max(1, productiveHours - 1); // reserve 1h safety
  const spreadChargePowerW = productiveHours > 0 ? (voluntaryChargeKwh / effectiveHours) * 1000 : 0;

  for (const fh of forecast.hours) {
    const hourTimestamp = fh.timestamp;
    const hourNum = hourTimestamp.getHours();
    const pvPower = fh.powerW;
    const surplus = Math.max(0, pvPower - consumptionW);

    let chargePowerW = 0;
    let feedInPowerW = 0;

    if (surplus <= 0 || soc >= targetSocPercent) {
      // No surplus or battery full — no charging, no feed-in from PV surplus
      chargePowerW = 0;
      feedInPowerW = pvPower > consumptionW ? surplus : 0;
      if (soc >= targetSocPercent) {
        feedInPowerW = surplus;
      }
    } else if (isTightForecast && soc < targetSocPercent) {
      // Tight forecast: charge everything
      chargePowerW = surplus;
      feedInPowerW = 0;
    } else {
      // Normal operation: split between charging and feed-in
      const antiClipChargeW = Math.max(0, pvPower - maxAcPowerW);
      const proportionalChargeW = totalForecastKwh > 0
        ? (voluntaryChargeKwh / totalForecastKwh) * surplus
        : 0;
      const desiredCharge = Math.max(antiClipChargeW, spreadChargePowerW, proportionalChargeW);

      if (soc >= targetSocPercent) {
        chargePowerW = antiClipChargeW; // only anti-clip if battery full
        feedInPowerW = surplus - chargePowerW;
      } else {
        chargePowerW = Math.min(desiredCharge, surplus * 0.8);
        chargePowerW = Math.max(chargePowerW, antiClipChargeW);
        if (surplus > 500) chargePowerW = Math.max(chargePowerW, 500);
        chargePowerW = Math.min(chargePowerW, surplus);
        feedInPowerW = Math.max(0, surplus - chargePowerW);
      }
    }

    // Update SOC
    const chargeKwh = chargePowerW / 1000; // 1 hour per slot
    const newSoc = Math.min(targetSocPercent, soc + (chargeKwh / batteryCapacityKwh) * 100);

    if (estimatedFullHour === null && newSoc >= targetSocPercent) {
      estimatedFullHour = hourNum;
    }

    soc = newSoc;

    // Revenue calculation
    const feedInKwh = feedInPowerW / 1000;
    totalFeedInKwh += feedInKwh;
    const fixedRevenue = feedInKwh * feedInRateCentPerKwh;
    totalRevenueFixedCent += fixedRevenue;

    // Market revenue: find price for this hour
    const hourSec = Math.floor(hourTimestamp.getTime() / 1000);
    let marketPriceEurMwh: number | null = null;
    for (let i = 0; i < prices.length; i++) {
      const start = prices[i].timestamp;
      const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 3600;
      if (hourSec >= start && hourSec < end) {
        marketPriceEurMwh = prices[i].price;
        break;
      }
    }
    // €/MWh -> ct/kWh: divide by 10
    const marketRevenue = marketPriceEurMwh != null ? feedInKwh * (marketPriceEurMwh / 10) : 0;
    totalRevenueMarketCent += marketRevenue;

    hours.push({
      hour: hourNum,
      timestamp: hourTimestamp.toISOString(),
      chargePowerW: Math.round(chargePowerW),
      feedInPowerW: Math.round(feedInPowerW),
      forecastW: pvPower,
      estimatedSoc: Math.round(newSoc * 10) / 10,
      revenueFixedCent: Math.round(fixedRevenue * 100) / 100,
      revenueMarketCent: Math.round(marketRevenue * 100) / 100,
    });
  }

  return {
    hours,
    totalFeedInKwh: Math.round(totalFeedInKwh * 10) / 10,
    totalRevenueFixedCent: Math.round(totalRevenueFixedCent * 100) / 100,
    totalRevenueMarketCent: Math.round(totalRevenueMarketCent * 100) / 100,
    feedInRateCentPerKwh,
    estimatedFullHour,
  };
}
```

**Step 4: Run tests**

Run: `cd packages/api && npx vitest run src/__tests__/charge-plan.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/api/src/charge-plan.ts packages/api/src/__tests__/charge-plan.test.ts
git commit -m "feat: add computeChargePlan() for hourly charge/feed-in simulation"
```

---

### Task 4: Integrate charge plan into WebSocket broadcast

**Files:**
- Modify: `packages/api/src/server.ts:73-104` (broadcast function)
- Modify: `packages/web/hooks/use-websocket.ts:30-40` (SystemStatus interface)

**Step 1: Import and compute charge plan in broadcast**

In `packages/api/src/server.ts`, import:

```typescript
import { computeChargePlan } from './charge-plan.js';
```

In the `broadcast()` function (line 77), after building the existing payload, compute the charge plan:

```typescript
const broadcast = () => {
  const s = state.mqtt.getState();
  const vrmForecast = state.vrm.getForecast();
  const solarForecast = state.forecastSolar.getForecast();
  const ensemble = computeEnsembleForecast(vrmForecast, solarForecast);
  const config = state.getConfig();

  // Compute charge plan
  let chargePlanData = null;
  try {
    // Use cached prices if available
    const cachedPrices = priceCache?.entries ?? [];
    chargePlanData = computeChargePlan(ensemble, cachedPrices, {
      currentSoc: s.batterySoc,
      batteryCapacityKwh: config.batteryCapacityKwh,
      targetSocPercent: config.targetSocPercent,
      minSocPercent: config.minSocPercent,
      maxAcPowerW: config.maxAcPowerW,
      feedInRateCentPerKwh: config.feedInRateCentPerKwh,
      consumptionW: s.consumptionPower,
      priceOptimization: config.priceOptimization,
    });
  } catch { /* charge plan is optional */ }

  const payload = JSON.stringify({
    // ...existing fields...
    chargePlan: chargePlanData,
  });
  // ...rest of broadcast
};
```

**Step 2: Add `chargePlan` to `SystemStatus` in frontend**

In `packages/web/hooks/use-websocket.ts`, add the charge plan types and field:

```typescript
export interface ChargePlanHour {
  hour: number;
  timestamp: string;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

export interface ChargePlan {
  hours: ChargePlanHour[];
  totalFeedInKwh: number;
  totalRevenueFixedCent: number;
  totalRevenueMarketCent: number;
  feedInRateCentPerKwh: number;
  estimatedFullHour: number | null;
}
```

Add to `SystemStatus`:

```typescript
chargePlan?: ChargePlan | null;
```

**Step 3: Run tests**

Run: `cd packages/api && npx vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add packages/api/src/server.ts packages/web/hooks/use-websocket.ts
git commit -m "feat: include charge plan in WebSocket broadcast"
```

---

### Task 5: Create ChargePlanChart frontend component

**Files:**
- Modify: `packages/web/app/page.tsx` (add ChargePlanChart component and render it)

**Step 1: Add ChargePlanChart component**

Add a new component in `packages/web/app/page.tsx` (before the `Dashboard` component). Import `ChargePlan` and `ChargePlanHour` from the websocket hook.

```tsx
function ChargePlanChart({ plan }: { plan: ChargePlan }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Find max power for scaling
  const maxPower = Math.max(
    ...plan.hours.map(h => Math.max(h.chargePowerW, h.feedInPowerW)),
    1,
  );

  // Grid lines for power axis (left)
  const maxKw = maxPower / 1000;
  const step = maxKw <= 3 ? 0.5 : maxKw <= 6 ? 1 : maxKw <= 15 ? 2 : 5;
  const gridLines: { kw: number; bottomPct: number }[] = [];
  for (let kw = step; kw < maxKw; kw += step) {
    gridLines.push({ kw, bottomPct: (kw / maxKw) * 100 });
  }

  return (
    <div>
      {/* Header with daily revenue summary */}
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <p className="text-sm text-[var(--text-secondary)]">Ladeplan</p>
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {plan.totalFeedInKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
          </p>
        </div>
        <div className="flex items-baseline gap-3 text-sm">
          <span className="text-[var(--text-secondary)]">
            EEG: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueFixedCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€</span>
          </span>
          <span className="text-[var(--text-secondary)]">
            Börse: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueMarketCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€</span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height: '128px' }}>
        {/* Power grid lines */}
        {gridLines.map((line, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 pointer-events-none z-0"
            style={{ bottom: `${line.bottomPct}%` }}
          >
            <div className="w-full" style={{ borderTop: '1px dashed var(--text-secondary)', opacity: 0.2 }} />
            <span className="absolute left-0 -top-3 text-[9px] text-[var(--text-secondary)] opacity-60">
              {line.kw % 1 === 0 ? line.kw.toFixed(0) : line.kw.toFixed(1)} kW
            </span>
          </div>
        ))}

        {/* SOC line overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="#10EFD8"
            strokeWidth="2"
            strokeLinejoin="round"
            points={plan.hours.map((h, i) => {
              const x = ((i + 0.5) / plan.hours.length) * 100;
              const y = 100 - h.estimatedSoc;
              return `${x}%,${y}%`;
            }).join(' ')}
          />
          {/* 100% marker */}
          {plan.estimatedFullHour != null && (() => {
            const idx = plan.hours.findIndex(h => h.hour === plan.estimatedFullHour);
            if (idx < 0) return null;
            const x = ((idx + 0.5) / plan.hours.length) * 100;
            return (
              <circle cx={`${x}%`} cy="0%" r="4" fill="#10EFD8" />
            );
          })()}
        </svg>

        {/* SOC axis labels (right side) */}
        {[25, 50, 75, 100].map(soc => (
          <div
            key={soc}
            className="absolute right-0 pointer-events-none z-0"
            style={{ bottom: `${soc}%` }}
          >
            <span className="absolute right-0 -top-2 text-[9px] text-[#10EFD8] opacity-50">
              {soc}%
            </span>
          </div>
        ))}

        {/* Bars */}
        <div className="flex items-end gap-1 h-full" onMouseLeave={() => setHoveredIndex(null)}>
          {plan.hours.map((h, i) => {
            const chargePct = (h.chargePowerW / maxPower) * 100;
            const feedInPct = (h.feedInPowerW / maxPower) * 100;
            const totalPct = chargePct + feedInPct;
            const isHovered = hoveredIndex === i;
            const dimmed = hoveredIndex !== null && !isHovered;

            return (
              <div
                key={h.timestamp}
                className="flex flex-col items-center flex-1 min-w-0 relative h-full"
                onMouseEnter={() => setHoveredIndex(i)}
              >
                {isHovered && (h.chargePowerW > 0 || h.feedInPowerW > 0) && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-0.5 z-20">
                    <span className="text-blue-400">{formatPower(h.chargePowerW)}</span>
                    {' / '}
                    <span className="text-green-400">{formatPower(h.feedInPowerW)}</span>
                    {' · '}
                    <span className="text-[#10EFD8]">{h.estimatedSoc}%</span>
                    <br />
                    <span className="text-[var(--text-secondary)]">
                      {h.revenueFixedCent.toFixed(1)}ct | {h.revenueMarketCent.toFixed(1)}ct
                    </span>
                  </div>
                )}
                <div className="w-full flex items-end justify-center h-full">
                  <div className="relative w-full max-w-[24px]" style={{ height: `${totalPct}%` }}>
                    {/* Feed-in bar (green, bottom) */}
                    {h.feedInPowerW > 0 && (
                      <div
                        className="absolute bottom-0 w-full rounded-t transition-opacity"
                        style={{
                          height: totalPct > 0 ? `${(feedInPct / totalPct) * 100}%` : '0%',
                          backgroundColor: '#22c55e',
                          opacity: dimmed ? 0.2 : 0.8,
                          minHeight: '2px',
                        }}
                      />
                    )}
                    {/* Charge bar (blue, top) */}
                    {h.chargePowerW > 0 && (
                      <div
                        className="absolute w-full rounded-t transition-opacity"
                        style={{
                          bottom: totalPct > 0 ? `${(feedInPct / totalPct) * 100}%` : '0%',
                          height: totalPct > 0 ? `${(chargePct / totalPct) * 100}%` : '0%',
                          backgroundColor: '#3b82f6',
                          opacity: dimmed ? 0.2 : 0.8,
                          minHeight: '2px',
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hour labels */}
      <div className="flex gap-1 mt-1">
        {plan.hours.map((h) => {
          const showLabel = h.hour % 2 === 0;
          return (
            <div key={h.timestamp} className="flex-1 min-w-0 text-center">
              {showLabel && <span className="text-[10px] text-[var(--text-secondary)]">{h.hour.toString().padStart(2, '0')}</span>}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#3b82f6]" /> Laden</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#22c55e]" /> Einspeisung</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#10EFD8]" style={{ width: '6px', height: '6px' }} /> SOC</span>
      </div>
    </div>
  );
}
```

**Step 2: Render the chart at the bottom of the Dashboard**

In the Dashboard component's return JSX, after the Price Chart section (line ~837), add:

```tsx
{/* Charge Plan Chart */}
{status?.chargePlan && status.chargePlan.hours.length > 0 && (
  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mt-4">
    <ChargePlanChart plan={status.chargePlan} />
  </div>
)}
```

**Step 3: Update imports**

Make sure `ChargePlan` and `ChargePlanHour` are imported from the websocket hook at the top of `page.tsx`:

```tsx
import { useWebSocket, type SystemStatus, type ControllerDetails, type ChargePlan } from '../hooks/use-websocket';
```

**Step 4: Verify visually**

Start the dev server and confirm the chart renders correctly on the dashboard.

**Step 5: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: add ChargePlanChart component to dashboard"
```

---

### Task 6: Run all tests and verify

**Step 1: Run all backend tests**

Run: `cd packages/api && npx vitest run`
Expected: All tests pass.

**Step 2: Build frontend**

Run: `cd packages/web && npx next build`
Expected: Build succeeds without errors.

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues from final verification"
```
