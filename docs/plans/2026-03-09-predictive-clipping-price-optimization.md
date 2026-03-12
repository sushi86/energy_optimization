# Vorausschauende Zwangsladung + Preisgewichtete Einspeisung

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Batterie-Ladung durch vorausschauende Clipping-Analyse optimieren und Einspeisung nach Strompreis gewichten.

**Architecture:** Phase 1 analysiert den Forecast vorausschauend und berechnet, wieviel Energie zwangsweise durch Clipping-Stunden geladen wird. Der verbleibende Rest (`voluntaryChargeKwh`) wird über den Tag verteilt. Phase 2 gewichtet die freiwillige Ladung/Einspeisung nach Börsenpreis. Phase 3 macht beides im Frontend transparent.

**Tech Stack:** TypeScript, Vitest, Next.js/React, Fastify WebSocket

---

### Task 1: Forecast-Analyse — Forced Charge Berechnung (Controller)

**Files:**
- Modify: `packages/api/src/controller.ts:1-13` (ControllerDeps + ControllerDetails)
- Modify: `packages/api/src/controller.ts:80-265` (_computeSetpoint + neue Methode)
- Test: `packages/api/src/__tests__/controller.test.ts`

**Step 1: Failing test für `analyzeForecastClipping`**

In `packages/api/src/__tests__/controller.test.ts`, bestehende Helper erweitern und neue Tests hinzufügen:

```typescript
// Bestehende makeForecast-Funktion ERSETZEN durch:
function makeForecast(totalKwh: number, hours?: Array<{ timestamp: Date; powerW: number }>): Forecast {
  return {
    hours: hours ?? [],
    totalKwh,
  };
}

// Neuen describe-Block am Ende hinzufügen:
describe('predictive clipping analysis', () => {
  it('detects forced charge from clipping hours', () => {
    const now = new Date();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    // Forecast: 3 hours, one exceeds AC limit (11kW threshold = maxAcPowerW * 0.92)
    const hours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
      { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 13000 }, // 13000 - 11040 = 1960W forced
      { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 14000 }, // 14000 - 11040 = 2960W forced
    ];
    const forecast = makeForecast(35, hours);
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    const result = ctrl.computeSetpoint(state, forecast, 35);

    // Details should now include clipping analysis fields
    expect(result.details).not.toBeNull();
    expect(result.details!.forcedChargeKwh).toBeGreaterThan(0);
    expect(result.details!.clippingHours).toBe(2);
  });

  it('returns zero voluntary charge when clipping covers battery need', () => {
    const now = new Date();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    // SOC 90% -> need ~1.6 kWh. Clipping hours produce way more than that.
    const hours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 14000 },
      { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 15000 },
      { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 14000 },
    ];
    const forecast = makeForecast(43, hours);
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 90 });
    const result = ctrl.computeSetpoint(state, forecast, 43);

    expect(result.details).not.toBeNull();
    expect(result.details!.voluntaryChargeKwh).toBeLessThanOrEqual(0);
    // When clipping covers all charging, feed-in should be maximized
    expect(result.setpointW).toBeLessThan(0);
  });

  it('calculates voluntary charge as remainder when clipping is partial', () => {
    const now = new Date();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    // SOC 50% -> need 8 kWh. Only 1 clipping hour -> ~3 kWh forced
    const hours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
      { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 14000 }, // ~2.96 kWh forced
      { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 6000 },
    ];
    const forecast = makeForecast(28, hours);
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    const result = ctrl.computeSetpoint(state, forecast, 28);

    expect(result.details).not.toBeNull();
    expect(result.details!.forcedChargeKwh).toBeGreaterThan(0);
    expect(result.details!.voluntaryChargeKwh).toBeGreaterThan(0);
    // Voluntary should be batteryNeed minus forced
    const expected = result.details!.batteryNeedKwh - result.details!.forcedChargeKwh;
    expect(result.details!.voluntaryChargeKwh).toBeCloseTo(expected, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: FAIL — `forcedChargeKwh` property does not exist on ControllerDetails

**Step 3: Implement predictive clipping analysis**

In `packages/api/src/controller.ts`:

1. Erweitere `ControllerDetails` Interface (Zeile 15-26):

```typescript
export interface ControllerDetails {
  currentSurplusW: number;
  desiredChargePowerW: number;
  feedInW: number;
  batteryNeedKwh: number;
  remainingHours: number;
  remainingForecastKwh: number;
  isClippingRisk: boolean;
  batterySoc: number;
  targetSocPercent: number;
  goal: string;
  // Predictive clipping fields
  forcedChargeKwh: number;
  voluntaryChargeKwh: number;
  clippingHours: number;
  strategy: string;
}
```

2. Füge neue private Methode `analyzeForecastClipping` zur Controller-Klasse hinzu (nach `getRemainingProductionHours`):

```typescript
private analyzeForecastClipping(forecast: Forecast, now: Date): { forcedChargeKwh: number; clippingHours: number } {
  const clippingThresholdW = this.config.maxAcPowerW * 0.92; // ~11kW safety margin
  let forcedChargeWh = 0;
  let clippingHours = 0;

  for (const hour of forecast.hours) {
    if (hour.timestamp < now) continue;
    if (hour.powerW > clippingThresholdW) {
      forcedChargeWh += (hour.powerW - clippingThresholdW);
      clippingHours++;
    }
  }

  return { forcedChargeKwh: forcedChargeWh / 1000, clippingHours };
}
```

3. Integriere in `_computeSetpoint` — ersetze den Block ab Zeile 169 (nach surplusRatio-Check, vor dem Hauptladungs-Block). Der neue Ablauf:

```typescript
// Determine remaining production hours from forecast
const now = new Date();
const remainingHours = this.getRemainingProductionHours(forecast, now);

// Predictive clipping analysis
const clippingAnalysis = this.analyzeForecastClipping(forecast, now);
const voluntaryChargeKwh = Math.max(0, batteryNeedKwh - clippingAnalysis.forcedChargeKwh);

// Reserve: finish charging 1h early to account for forecast inaccuracy
const effectiveHours = Math.max(0.5, remainingHours - 1);

// Use voluntaryChargeKwh instead of batteryNeedKwh for spread calculation
const spreadChargePowerW = effectiveHours > 0 ? (voluntaryChargeKwh / effectiveHours) * 1000 : 0;
```

4. Passe proportionalChargeW an — verwende `voluntaryChargeKwh`:

```typescript
const proportionalChargeW = remainingForecastKwh > 0
  ? (voluntaryChargeKwh / remainingForecastKwh) * currentSurplusW
  : currentSurplusW;
```

5. Generiere `strategy`-Text und fülle die neuen Details-Felder in allen `details`-Objekten:

```typescript
const strategy = clippingAnalysis.clippingHours > 0
  ? voluntaryChargeKwh <= 0
    ? `Volle Einspeisung morgens — Batterie wird durch ${clippingAnalysis.clippingHours} Clipping-Stunden gefüllt (${clippingAnalysis.forcedChargeKwh.toFixed(1)} kWh)`
    : `${clippingAnalysis.forcedChargeKwh.toFixed(1)} kWh durch Clipping gesichert, ${voluntaryChargeKwh.toFixed(1)} kWh freiwillig über ${effectiveHours.toFixed(1)}h verteilt`
  : `Kein Clipping erwartet — ${batteryNeedKwh.toFixed(1)} kWh gleichmäßig über ${effectiveHours.toFixed(1)}h laden`;
```

6. Alle `details`-Objekte in _computeSetpoint müssen die neuen Felder bekommen. Für die Early-Return-Fälle (SOC voll, tight forecast, etc.) setze defaults:

```typescript
forcedChargeKwh: 0,
voluntaryChargeKwh: 0,
clippingHours: 0,
strategy: '',
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat: add predictive clipping analysis to controller"
```

---

### Task 2: Frontend ControllerDetails-Typen aktualisieren

**Files:**
- Modify: `packages/web/hooks/use-websocket.ts:4-15`

**Step 1: Erweitere ControllerDetails Interface**

In `packages/web/hooks/use-websocket.ts`, das `ControllerDetails` Interface erweitern:

```typescript
export interface ControllerDetails {
  currentSurplusW: number;
  desiredChargePowerW: number;
  feedInW: number;
  batteryNeedKwh: number;
  remainingHours: number;
  remainingForecastKwh: number;
  isClippingRisk: boolean;
  batterySoc: number;
  targetSocPercent: number;
  goal: string;
  forcedChargeKwh: number;
  voluntaryChargeKwh: number;
  clippingHours: number;
  strategy: string;
}
```

**Step 2: Commit**

```bash
git add packages/web/hooks/use-websocket.ts
git commit -m "feat: extend ControllerDetails type with clipping fields"
```

---

### Task 3: Dashboard — Strategie-Anzeige

**Files:**
- Modify: `packages/web/app/page.tsx:599-617` (Controller Details Section)

**Step 1: Erweitere die Controller-Details-Anzeige**

Im Dashboard (`packages/web/app/page.tsx`), den Block `{controller.details && (` ersetzen (ca. Zeile 599-617):

```tsx
{controller.details && (
  <div className="mt-3 space-y-2">
    {/* Strategy summary — only show when available */}
    {controller.details.strategy && (
      <p className="text-sm font-medium text-[var(--accent)]">
        {controller.details.strategy}
      </p>
    )}
    {/* Fallback to goal when no strategy */}
    {!controller.details.strategy && (
      <p className="text-sm font-medium text-[var(--accent)]">
        {controller.details.goal}
      </p>
    )}
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--text-secondary)]">
      <span>Überschuss: {formatPower(controller.details.currentSurplusW)}</span>
      <span>Soll-Ladung: {formatPower(controller.details.desiredChargePowerW)}</span>
      <span>Soll-Einspeisung: {formatPower(controller.details.feedInW)}</span>
      <span>Ist-Batterie: {formatPower(batteryPower)}</span>
      <span>Batterie: {controller.details.batterySoc}% → {controller.details.targetSocPercent}%</span>
      <span>Bedarf: {controller.details.batteryNeedKwh.toFixed(1)} kWh in {controller.details.remainingHours.toFixed(1)}h</span>
      <span>Prognose Rest: {controller.details.remainingForecastKwh.toFixed(1)} kWh</span>
      {controller.details.clippingHours > 0 && (
        <span className="text-yellow-400">
          Clipping: {controller.details.clippingHours}h → {controller.details.forcedChargeKwh.toFixed(1)} kWh gesichert
        </span>
      )}
      {controller.details.voluntaryChargeKwh > 0 && (
        <span>Freiwillig: {controller.details.voluntaryChargeKwh.toFixed(1)} kWh</span>
      )}
      {controller.details.isClippingRisk && (
        <span className="text-yellow-400">Clipping-Risiko aktiv</span>
      )}
    </div>
  </div>
)}
```

**Step 2: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat: show clipping strategy and details in dashboard"
```

---

### Task 4: Preisdaten im Controller verfügbar machen

**Files:**
- Modify: `packages/api/src/controller.ts:80` (computeSetpoint Signatur)
- Modify: `packages/api/src/app-state.ts:77-98` (regulate Methode)
- Modify: `packages/api/src/server.ts:24-46` (fetchPrices exportierbar machen)
- Test: `packages/api/src/__tests__/controller.test.ts`

**Step 1: Failing test — computeSetpoint akzeptiert Preisdaten**

In `packages/api/src/__tests__/controller.test.ts`:

```typescript
describe('price data passthrough', () => {
  it('accepts optional price data', () => {
    const ctrl = makeController();
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    const prices = [
      { timestamp: Math.floor(Date.now() / 1000), price: 85 },
      { timestamp: Math.floor(Date.now() / 1000) + 3600, price: 120 },
    ];
    // Should not throw
    const result = ctrl.computeSetpoint(state, makeForecast(30), 25, prices);
    expect(result.details).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: FAIL — computeSetpoint takes only 3 arguments

**Step 3: Implementierung**

1. In `packages/api/src/controller.ts`, definiere PriceEntry-Typ und erweitere Signatur:

```typescript
// Nach den imports, vor ControllerMode:
export interface PriceEntry {
  timestamp: number;  // unix seconds
  price: number | null;
}
```

Ändere `computeSetpoint` und `_computeSetpoint` Signaturen:

```typescript
computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices?: PriceEntry[]): SetpointResult {
  const result = this._computeSetpoint(state, forecast, remainingForecastKwh, prices ?? []);
  ...
}

private _computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices: PriceEntry[]): SetpointResult {
```

2. In `packages/api/src/server.ts`, mache `fetchPrices` exportierbar:

```typescript
export async function fetchPrices(): Promise<PriceEntry[]> {
```

3. In `packages/api/src/app-state.ts`, leite Preise an den Controller weiter:

```typescript
// In regulate():
import { fetchPrices } from './server.js';

async regulate(): Promise<void> {
  this.lastRegulationTime = new Date();
  const systemState = this.mqtt.getState();
  const forecast = this.vrm.getForecast();
  const remainingKwh = this.vrm.getRemainingForecastKwh();

  let prices: Array<{ timestamp: number; price: number | null }> = [];
  try {
    prices = await fetchPrices();
  } catch { /* ignore — price optimization is optional */ }

  const result = this.controller.computeSetpoint(systemState, forecast, remainingKwh, prices);
  // ... rest bleibt gleich
}
```

**Step 4: Run tests**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/server.ts packages/api/src/app-state.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat: pass price data through to controller"
```

---

### Task 5: Preisoptimierung im Controller

**Files:**
- Modify: `packages/api/src/controller.ts` (ControllerDeps, _computeSetpoint)
- Modify: `packages/api/src/config.ts` (neuer Config-Wert)
- Modify: `packages/api/src/app-state.ts` (Config durchreichen)
- Test: `packages/api/src/__tests__/controller.test.ts`

**Step 1: Failing tests für Preisgewichtung**

In `packages/api/src/__tests__/controller.test.ts`:

```typescript
describe('price optimization', () => {
  function makeNow(): Date {
    return new Date();
  }

  function makeHourlyPrices(now: Date, pricesEurMwh: number[]): Array<{ timestamp: number; price: number }> {
    const baseTs = Math.floor(now.getTime() / 1000);
    return pricesEurMwh.map((p, i) => ({
      timestamp: baseTs + i * 3600,
      price: p,
    }));
  }

  it('increases feed-in during high-price hours', () => {
    const now = makeNow();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    ctrl.updateConfig({ priceOptimization: true } as any);

    const forecastHours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
      { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
      { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 8000 },
    ];
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });

    // High price = current hour much above average
    const highPrices = makeHourlyPrices(now, [150, 50, 50]);
    const resultHigh = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 24, highPrices);

    // Low price = current hour much below average
    const lowPrices = makeHourlyPrices(now, [20, 150, 150]);
    // Need fresh controller to reset deadband
    const ctrl2 = makeController({ maxAcPowerW: 12000 });
    ctrl2.updateConfig({ priceOptimization: true } as any);
    const resultLow = ctrl2.computeSetpoint(state, makeForecast(30, forecastHours), 24, lowPrices);

    // High price should feed in more (more negative setpoint)
    expect(resultHigh.setpointW).toBeLessThan(resultLow.setpointW);
  });

  it('stops feed-in during negative prices', () => {
    const now = makeNow();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    ctrl.updateConfig({ priceOptimization: true } as any);

    const forecastHours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
      { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
    ];
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    // Negative price for current hour
    const prices = makeHourlyPrices(now, [-10, 80]);
    const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 16, prices);

    // Should not feed in during negative prices
    expect(result.setpointW).toBe(0);
    expect(result.details!.priceOptimization).toBeDefined();
    expect(result.details!.priceOptimization!.active).toBe(true);
  });

  it('does nothing when priceOptimization is disabled', () => {
    const now = makeNow();
    const ctrl = makeController({ maxAcPowerW: 12000 });
    // priceOptimization defaults to false

    const forecastHours = [
      { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
    ];
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    const prices = makeHourlyPrices(now, [-10, 80]);
    const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 16, prices);

    // Should still feed in even though price is negative (feature disabled)
    expect(result.details!.priceOptimization).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: FAIL

**Step 3: Implementierung**

1. In `packages/api/src/config.ts`, neuen Config-Wert:

```typescript
PRICE_OPTIMIZATION: z.coerce.boolean().default(false),
```

2. In `packages/api/src/controller.ts`, erweitere `ControllerDeps`:

```typescript
export interface ControllerDeps {
  batteryCapacityKwh: number;
  minSocPercent: number;
  targetSocPercent: number;
  maxAcPowerW: number;
  winterModeThresholdFactor: number;
  deadbandW: number;
  priceOptimization: boolean;
}
```

3. Erweitere `ControllerDetails` um Preis-Info:

```typescript
priceOptimization?: {
  active: boolean;
  currentPriceEurMwh: number | null;
  avgPriceEurMwh: number;
  factor: number;  // 0.5 = half feed-in, 1.5 = 50% more feed-in
  reason: string;
};
```

4. Neue private Methode `getPriceFactor`:

```typescript
private getPriceFactor(prices: PriceEntry[]): { factor: number; currentPrice: number | null; avgPrice: number; reason: string } | null {
  if (!this.config.priceOptimization || prices.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let currentPrice: number | null = null;

  for (let i = 0; i < prices.length; i++) {
    const start = prices[i].timestamp;
    const end = i + 1 < prices.length ? prices[i + 1].timestamp : start + 3600;
    if (nowSec >= start && nowSec < end) {
      currentPrice = prices[i].price;
      break;
    }
  }

  if (currentPrice == null) return null;

  // Calculate average of today's remaining prices
  const futurePrices = prices
    .filter(p => p.timestamp >= nowSec && p.price != null)
    .map(p => p.price!);

  if (futurePrices.length === 0) return null;
  const avgPrice = futurePrices.reduce((a, b) => a + b, 0) / futurePrices.length;

  // Negative price: stop feed-in entirely
  if (currentPrice < 0) {
    return { factor: 0, currentPrice, avgPrice, reason: `Negativpreis (${(currentPrice / 10).toFixed(1)} ct/kWh) — keine Einspeisung` };
  }

  // Price relative to average
  if (avgPrice <= 0) {
    return { factor: 1, currentPrice, avgPrice, reason: 'Durchschnittspreis ≤ 0' };
  }

  const ratio = currentPrice / avgPrice;
  // Clamp factor between 0.5 and 1.5
  const factor = Math.max(0.5, Math.min(1.5, ratio));

  let reason: string;
  if (factor > 1.1) {
    reason = `Hoher Preis (${(currentPrice / 10).toFixed(1)} ct vs Ø ${(avgPrice / 10).toFixed(1)} ct) — mehr einspeisen`;
  } else if (factor < 0.9) {
    reason = `Niedriger Preis (${(currentPrice / 10).toFixed(1)} ct vs Ø ${(avgPrice / 10).toFixed(1)} ct) — mehr laden`;
  } else {
    reason = `Normaler Preis (${(currentPrice / 10).toFixed(1)} ct vs Ø ${(avgPrice / 10).toFixed(1)} ct)`;
  }

  return { factor, currentPrice, avgPrice, reason };
}
```

5. In `_computeSetpoint`, nach der Feed-In-Berechnung und vor der Battery-Discharge-Correction, die Preisgewichtung einfügen:

```typescript
// Price optimization: adjust feed-in based on current price
const priceInfo = this.getPriceFactor(prices);
let pricedFeedIn = feedIn;
if (priceInfo) {
  if (priceInfo.factor === 0) {
    // Negative price: no feed-in, charge battery instead
    pricedFeedIn = 0;
  } else {
    pricedFeedIn = feedIn * priceInfo.factor;
    // Don't exceed available surplus
    pricedFeedIn = Math.min(pricedFeedIn, maxFeedIn);
  }
}
const finalFeedIn = priceInfo ? pricedFeedIn : feedIn;
const setpoint = finalFeedIn > 0 ? -finalFeedIn : 0;
```

6. Im details-Objekt:

```typescript
...(priceInfo ? {
  priceOptimization: {
    active: true,
    currentPriceEurMwh: priceInfo.currentPrice,
    avgPriceEurMwh: priceInfo.avgPrice,
    factor: priceInfo.factor,
    reason: priceInfo.reason,
  },
} : {}),
```

7. In `packages/api/src/app-state.ts`, `priceOptimization` Config durchreichen:

In `constructor` und `updateConfig`, `priceOptimization` zum Controller-Config hinzufügen.

8. In `packages/api/src/server.ts`, Config-Endpunkte um `priceOptimization` erweitern (GET + PUT).

**Step 4: Run tests**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/config.ts packages/api/src/app-state.ts packages/api/src/server.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat: add price-weighted feed-in optimization"
```

---

### Task 6: Settings — Preisoptimierung Toggle

**Files:**
- Modify: `packages/web/app/settings/page.tsx`

**Step 1: Toggle für Preisoptimierung**

In `packages/web/app/settings/page.tsx`, nach dem manuellen Sollwert-Block (Zeile 148) und vor dem Config-Form-Block, einen neuen Toggle-Block einfügen:

```tsx
{/* Price Optimization Toggle */}
<div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 mb-6">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium text-[var(--text-primary)]">Preisoptimierte Einspeisung</p>
      <p className="text-xs text-[var(--text-secondary)] mt-1">
        Verschiebt Einspeisung in Stunden mit hohen Börsenpreisen.
        Bei Negativpreisen wird nicht eingespeist.
      </p>
    </div>
    <button
      onClick={() => {
        const newConfig = { ...config, priceOptimization: !config?.priceOptimization };
        setConfig(newConfig);
        // Save immediately
        fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newConfig),
        }).then(() => showMessage('Preisoptimierung ' + (newConfig.priceOptimization ? 'aktiviert' : 'deaktiviert')))
          .catch(() => showMessage('Fehler beim Speichern'));
      }}
      className={`relative w-12 h-6 rounded-full transition-colors ${
        config?.priceOptimization
          ? 'bg-[var(--accent)]'
          : 'bg-[var(--border)]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          config?.priceOptimization ? 'translate-x-6' : ''
        }`}
      />
    </button>
  </div>
</div>
```

**Step 2: `priceOptimization` aus der generischen Config-Liste ausschließen**

Im Config-Form-Block die `Object.entries(config).map(...)` Schleife filtern:

```typescript
{Object.entries(config).map(([key, value]) => {
  if (typeof value === 'object' || typeof value === 'boolean') return null;
  // ... rest bleibt gleich
```

**Step 3: Commit**

```bash
git add packages/web/app/settings/page.tsx
git commit -m "feat: add price optimization toggle to settings"
```

---

### Task 7: Dashboard — Preis-Info im Regler-Bereich

**Files:**
- Modify: `packages/web/hooks/use-websocket.ts` (ControllerDetails erweitern)
- Modify: `packages/web/app/page.tsx` (Preis-Info anzeigen)

**Step 1: ControllerDetails um priceOptimization erweitern**

In `packages/web/hooks/use-websocket.ts`, zum Interface hinzufügen:

```typescript
priceOptimization?: {
  active: boolean;
  currentPriceEurMwh: number | null;
  avgPriceEurMwh: number;
  factor: number;
  reason: string;
};
```

**Step 2: Dashboard-Anzeige**

In `packages/web/app/page.tsx`, im Controller-Details-Block nach den clipping-Infos:

```tsx
{controller.details.priceOptimization?.active && (
  <span className={controller.details.priceOptimization.factor === 0 ? 'text-red-400' : controller.details.priceOptimization.factor > 1.1 ? 'text-green-400' : 'text-[var(--text-secondary)]'}>
    {controller.details.priceOptimization.reason}
    {controller.details.priceOptimization.factor > 0 && controller.details.priceOptimization.factor !== 1 && (
      <> (×{controller.details.priceOptimization.factor.toFixed(1)})</>
    )}
  </span>
)}
```

**Step 3: Commit**

```bash
git add packages/web/hooks/use-websocket.ts packages/web/app/page.tsx
git commit -m "feat: show price optimization status in dashboard"
```

---

### Task 8: Alle Tests laufen lassen + manueller Smoketest

**Step 1: Alle API-Tests**

Run: `cd packages/api && npx vitest run`
Expected: ALL PASS

**Step 2: TypeScript-Check beider Packages**

Run: `cd packages/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: No errors

**Step 3: Dev-Server starten und UI prüfen**

Run: `pnpm dev` (oder `docker compose up`)

Prüfe:
- Dashboard zeigt Strategy-Text wenn Clipping-Stunden im Forecast
- Controller-Details zeigen `forcedChargeKwh`, `voluntaryChargeKwh`, `clippingHours`
- Settings-Seite hat Toggle für "Preisoptimierte Einspeisung"
- Toggle ändert Config (prüfe mit GET /api/config)
- Bei aktivierter Preisoptimierung zeigt Dashboard den Preisfaktor

**Step 4: Final Commit**

```bash
git add -A
git commit -m "feat: predictive clipping + price optimization complete"
```
