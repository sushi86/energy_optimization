# Actual Feed-In in Charge Plan Chart — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show actual feed-in from inexogy smart meter in the charge plan chart — replacing planned bars for past slots, displaying actual totals + revenue in the header.

**Architecture:** Frontend-only changes. Fetch `/api/meter/history` for today's readings, compute per-slot feed-in deltas from cumulative `energyOutKwh`, compute actual revenue using existing price data. No backend changes needed.

**Tech Stack:** React (Next.js), TypeScript, existing WebSocket + REST data

---

## File Structure

- Modify: `packages/web/app/page.tsx` — add meter history fetch, update `ChargePlanChart` component
- No new files needed

## Data Flow

The inexogy API returns cumulative `energyOutKwh` per 15-min reading. To get per-slot feed-in:
1. Fetch `/api/meter/history?date=YYYY-MM-DD` → array of readings with `time`, `energyOutKwh`
2. Compute delta: `slot[i].feedInKwh = readings[i+1].energyOutKwh - readings[i].energyOutKwh`
3. Convert to power: `feedInW = (feedInKwh / 0.25) * 1000`
4. Map to TIME_GRID by extracting `HH:MM` from reading timestamp
5. Revenue: `eegCent = feedInKwh * feedInRateCentPerKwh`, `börseCent = feedInKwh * (priceEurMwh / 10)` (prices are EUR/MWh, divide by 10 for ct/kWh)

---

## Chunk 1: Implementation

### Task 1: Add meter history fetch

**Files:**
- Modify: `packages/web/app/page.tsx` (around line 686, state declarations + line 731, useEffect)

- [ ] **Step 1: Add MeterReading interface and state**

After the `PriceEntry` interface (line 15), add:

```typescript
interface MeterReading {
  time: string;
  powerW: number;
  energyKwh: number;
  energyOutKwh: number;
}
```

In the `Dashboard` component (around line 686), add state:

```typescript
const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
```

- [ ] **Step 2: Add fetch logic**

In the `useEffect` that fetches forecast and prices (line 731), add a `fetchMeterHistory` function:

```typescript
const fetchMeterHistory = () => {
  fetch('/api/meter/history')
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      if (data?.readings) setMeterReadings(data.readings);
    })
    .catch(() => {});
};
```

Call it alongside the others, and set up a 5-minute interval:

```typescript
fetchMeterHistory();
const meterInterval = setInterval(fetchMeterHistory, 5 * 60 * 1000);
```

Update the cleanup: `return () => { clearInterval(forecastInterval); clearInterval(priceInterval); clearInterval(meterInterval); };`

Also add meter history re-fetch in `handleRefresh` (line 765):

```typescript
fetch('/api/meter/history')
  .then((r) => r.ok ? r.json() : null)
  .then((data) => { if (data?.readings) setMeterReadings(data.readings); })
  .catch(() => {});
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/web && npx next build 2>&1 | head -20` or just check for TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: fetch meter history for actual feed-in display"
```

---

### Task 2: Compute actual feed-in map and pass to chart

**Files:**
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Build actualFeedIn map from meter readings**

Before the `ChargePlanChart` usage (around line 1066), compute a map of slot key → actual feed-in watts + kWh. Add this as a `useMemo` in the Dashboard component:

```typescript
const actualFeedIn = useMemo(() => {
  const map = new Map<string, { feedInW: number; feedInKwh: number }>();
  if (meterReadings.length < 2) return map;

  for (let i = 0; i < meterReadings.length - 1; i++) {
    const r = meterReadings[i];
    const next = meterReadings[i + 1];
    const deltaKwh = Math.max(0, next.energyOutKwh - r.energyOutKwh);
    const avgW = Math.round((deltaKwh / 0.25) * 1000);
    const d = new Date(r.time);
    const key = `${d.getHours().toString().padStart(2, '0')}:${(Math.floor(d.getMinutes() / 15) * 15).toString().padStart(2, '0')}`;
    map.set(key, { feedInW: avgW, feedInKwh: deltaKwh });
  }
  return map;
}, [meterReadings]);
```

- [ ] **Step 2: Update ChargePlanChart props**

Change the component signature to accept the new data:

```typescript
function ChargePlanChart({ plan, hoveredSlot, setHoveredSlot, actualFeedIn, prices }: {
  plan: ChargePlan;
  hoveredSlot: number | null;
  setHoveredSlot: (i: number | null) => void;
  actualFeedIn: Map<string, { feedInW: number; feedInKwh: number }>;
  prices: PriceEntry[];
}) {
```

Update the call site (line 1068):

```tsx
<ChargePlanChart
  plan={status.chargePlan}
  hoveredSlot={hoveredSlot}
  setHoveredSlot={setHoveredSlot}
  actualFeedIn={actualFeedIn}
  prices={prices}
/>
```

- [ ] **Step 3: Verify it compiles**

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: compute actual feed-in map from meter readings"
```

---

### Task 3: Update chart header with actual totals + revenue

**Files:**
- Modify: `packages/web/app/page.tsx` (ChargePlanChart header, lines 464-480)

- [ ] **Step 1: Add `findPriceForSlot` helper**

Add this helper function above `ChargePlanChart` (prices are in EUR/MWh, divide by 10 for ct/kWh):

```typescript
function findPriceForSlot(prices: PriceEntry[], hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const ts = Math.floor(d.getTime() / 1000);
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].timestamp <= ts && prices[i].price != null) return prices[i].price! / 10;
  }
  return 0;
}
```

- [ ] **Step 2: Compute actual totals inside ChargePlanChart**

At the top of `ChargePlanChart`, compute actual totals:

```typescript
// Actual feed-in totals from meter readings
const actualTotalKwh = Array.from(actualFeedIn.values()).reduce((sum, v) => sum + v.feedInKwh, 0);
const hasActual = actualFeedIn.size > 0;

// Actual revenue from real feed-in
let actualRevenueFixedCent = 0;
let actualRevenueMarketCent = 0;
if (hasActual) {
  for (const [key, val] of actualFeedIn) {
    actualRevenueFixedCent += val.feedInKwh * plan.feedInRateCentPerKwh;
    const [hStr, mStr] = key.split(':');
    actualRevenueMarketCent += val.feedInKwh * findPriceForSlot(prices, parseInt(hStr), parseInt(mStr));
  }
}
```

- [ ] **Step 3: Replace header with two-row layout**

Replace the header div (lines 465-480) with:

```tsx
<div className="flex flex-col gap-1 mb-4">
  {hasActual && (
    <div className="flex items-baseline justify-between">
      <div className="flex items-baseline gap-3">
        <p className="text-sm text-[var(--text-secondary)]">Einspeisung</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {actualTotalKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
        </p>
      </div>
      <div className="flex items-baseline gap-3 text-sm">
        <span className="text-[var(--text-secondary)]">
          EEG: <span className="font-medium text-[var(--text-primary)]">{(actualRevenueFixedCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
        </span>
        <span className="text-[var(--text-secondary)]">
          Börse: <span className="font-medium text-[var(--text-primary)]">{(actualRevenueMarketCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
        </span>
      </div>
    </div>
  )}
  <div className="flex items-baseline justify-between">
    <div className="flex items-baseline gap-3">
      <p className="text-sm text-[var(--text-secondary)]">Forecast</p>
      <p className="text-sm font-medium text-[var(--text-primary)]">
        {plan.totalFeedInKwh.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh
      </p>
    </div>
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-[var(--text-secondary)]">
        EEG: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueFixedCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
      </span>
      <span className="text-[var(--text-secondary)]">
        Börse: <span className="font-medium text-[var(--text-primary)]">{(plan.totalRevenueMarketCent / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&euro;</span>
      </span>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Verify it compiles**

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: show actual feed-in totals and revenue in chart header"
```

---

### Task 4: Replace past slot bars with actual feed-in values

**Files:**
- Modify: `packages/web/app/page.tsx` (ChargePlanChart bar rendering, lines 529-596)

- [ ] **Step 1: Use actual values for past slots**

In the `TIME_GRID.map` loop (line 531), after getting the planned values, override feed-in for past slots when actual data is available:

```typescript
{TIME_GRID.map((slot, i) => {
  const h = slotByKey.get(slot.key);
  const chargeW = h?.chargePowerW ?? 0;
  const isPast = slot.key < currentSlotKey();
  const actual = actualFeedIn.get(slot.key);

  // For past slots: use actual feed-in if available
  const feedInW = (isPast && actual) ? actual.feedInW : (h?.feedInPowerW ?? 0);

  const chargePct = (chargeW / maxPower) * 100;
  const feedInPct = (feedInW / maxPower) * 100;
  // ... rest stays the same
```

This replaces the existing line `const feedInW = h?.feedInPowerW ?? 0;` with the conditional logic.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: replace past slot bars with actual feed-in from meter"
```

---

### Task 5: Update tooltip for past slots with actual data

**Files:**
- Modify: `packages/web/app/page.tsx` (tooltip section, lines 550-563)

- [ ] **Step 1: Update tooltip to show "(Ist)" for actual values**

Replace the tooltip (lines 550-563) with this version that uses `findPriceForSlot` (already added in Task 3) and shows "(Ist)" for actual data:

```tsx
{isHovered && (chargeW > 0 || feedInW > 0) && (
  <div className="absolute -top-14 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium bg-[var(--bg-card)] border border-[var(--border)] rounded px-1.5 py-1 z-20">
    <span className="text-[var(--text-secondary)]">{slot.key}</span>
    {chargeW > 0 && <>
      {' · '}
      <span className="text-blue-400">Laden: {formatPower(chargeW)}</span>
    </>}
    {feedInW > 0 && <>
      {' · '}
      <span className="text-green-400">Einsp.: {formatPower(feedInW)}{isPast && actual ? ' (Ist)' : ''}</span>
    </>}
    {h && <>
      {' · '}
      <span className="text-[#10EFD8]">SOC: {h.estimatedSoc}%</span>
    </>}
    <br />
    <span className="text-[var(--text-secondary)]">
      EEG: {(isPast && actual
        ? actual.feedInKwh * plan.feedInRateCentPerKwh
        : h?.revenueFixedCent ?? 0
      ).toFixed(1)}ct
      {' · '}Börse: {(isPast && actual
        ? actual.feedInKwh * findPriceForSlot(prices, slot.hour, slot.minute)
        : h?.revenueMarketCent ?? 0
      ).toFixed(1)}ct
    </span>
  </div>
)}
```

- [ ] **Step 2: Verify it compiles and looks correct**

Run: `cd packages/web && npx next build 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: show actual revenue in tooltip for past slots"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full build**

Run: `cd packages/web && npx next build`

- [ ] **Step 2: Run tests**

Run: `cd packages/api && npx vitest run`

- [ ] **Step 3: Final commit if any cleanup needed**
