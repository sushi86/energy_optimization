# Charge Plan as Controller Guide — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the controller use the pre-computed charge plan's 15-min slots as targets for real-time setpoint decisions, replacing the controller's own separate charge/feed-in calculation.

**Architecture:** The charge plan is computed once per regulation cycle in `app-state.ts` and passed to `controller.computeSetpoint()`. The controller looks up the current 15-min slot, uses its `chargePowerW`/`feedInPowerW` as targets, scales them proportionally to actual PV surplus, and applies safety overrides. This eliminates the duplicate `getChargeSchedule()` logic and makes the 15-min price-optimized plan the single source of truth.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add ChargePlan parameter to controller

**Files:**
- Modify: `packages/api/src/controller.ts` — add optional `ChargePlan` parameter to `computeSetpoint()`
- Modify: `packages/api/src/app-state.ts` — compute charge plan in `regulate()` and pass to controller

**Step 1: Write failing test — controller accepts ChargePlan**

Add to `packages/api/src/__tests__/controller.test.ts`:

```typescript
import { computeChargePlan, type ChargePlan } from '../charge-plan.js';

// In a new describe block:
describe('charge plan guided mode', () => {
  it('accepts an optional ChargePlan without error', () => {
    const ctrl = makeController();
    const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
    const plan: ChargePlan = {
      slots: [],
      intervalMinutes: 15,
      totalFeedInKwh: 0,
      totalRevenueFixedCent: 0,
      totalRevenueMarketCent: 0,
      feedInRateCentPerKwh: 7,
      estimatedFullHour: null,
      currentSoc: 50,
    };
    const result = ctrl.computeSetpoint(state, makeForecast(30), 25, [], plan);
    expect(result.details).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts --reporter=verbose`
Expected: Type error — `computeSetpoint` doesn't accept 5th argument

**Step 3: Add ChargePlan parameter to computeSetpoint**

In `packages/api/src/controller.ts`, change the public method signature:

```typescript
import type { ChargePlan } from './charge-plan.js';

// Change computeSetpoint:
computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices?: PriceEntry[], chargePlan?: ChargePlan): SetpointResult {
  const result = this._computeSetpoint(state, forecast, remainingForecastKwh, prices ?? [], chargePlan ?? null);
  this.lastResult = result;
  return result;
}

// Change _computeSetpoint signature:
private _computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number, prices: PriceEntry[], chargePlan: ChargePlan | null): SetpointResult {
```

No behavior change yet — just pass through.

**Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts --reporter=verbose`
Expected: All tests PASS

**Step 5: Compute ChargePlan in regulate() and pass to controller**

In `packages/api/src/app-state.ts`, modify `regulate()`:

```typescript
import { computeChargePlan } from './charge-plan.js';

// Inside regulate(), after fetching prices, before computeSetpoint:
let chargePlan = null;
try {
  chargePlan = computeChargePlan(forecast, prices, {
    currentSoc: systemState.batterySoc,
    batteryCapacityKwh: this.config.batteryCapacityKwh,
    targetSocPercent: this.config.targetSocPercent,
    minSocPercent: this.config.minSocPercent,
    maxAcPowerW: this.config.maxAcPowerW,
    feedInRateCentPerKwh: this.config.feedInRateCentPerKwh,
    consumptionW: systemState.consumptionPower,
    priceOptimization: this.config.priceOptimization,
    preferredMaxChargeW: this.config.preferredMaxChargeW,
  });
} catch { /* plan is optional */ }

const result = this.controller.computeSetpoint(systemState, forecast, remainingKwh, prices, chargePlan ?? undefined);
```

**Step 6: Run all tests**

Run: `cd packages/api && npx vitest run --reporter=verbose`
Expected: All tests PASS (no behavior change yet)

**Step 7: Commit**

```
feat: pass ChargePlan to controller.computeSetpoint()
```

---

### Task 2: Controller uses plan slot for charge/feed-in decisions

**Files:**
- Modify: `packages/api/src/controller.ts` — replace manual calculation with plan lookup
- Modify: `packages/api/src/__tests__/controller.test.ts` — add tests for plan-guided behavior

**Step 1: Write failing test — controller follows plan slot**

Add to the `charge plan guided mode` describe block in `packages/api/src/__tests__/controller.test.ts`:

```typescript
it('uses plan slot chargePowerW and feedInPowerW when plan is provided', () => {
  const ctrl = makeController();
  const now = new Date();
  const slotTime = new Date(Math.floor(now.getTime() / 900_000) * 900_000); // floor to 15min
  const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
  const forecastHours = [
    { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 8000 },
    { timestamp: new Date(now.getTime() + 2 * 3600_000), powerW: 8000 },
  ];

  const plan: ChargePlan = {
    slots: [{
      hour: slotTime.getHours(),
      minute: slotTime.getMinutes(),
      timestamp: slotTime.toISOString(),
      chargePowerW: 2000,
      feedInPowerW: 5000,
      forecastW: 8000,
      estimatedSoc: 55,
      revenueFixedCent: 0,
      revenueMarketCent: 0,
    }],
    intervalMinutes: 15,
    totalFeedInKwh: 5,
    totalRevenueFixedCent: 35,
    totalRevenueMarketCent: 25,
    feedInRateCentPerKwh: 7,
    estimatedFullHour: null,
    currentSoc: 50,
  };

  const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
  expect(result.details).not.toBeNull();
  // Should use plan's feed-in target (scaled to actual surplus)
  expect(result.setpointW).toBeLessThan(0); // feeding in
  expect(result.details!.strategy).toContain('Ladeplan');
});

it('scales plan values proportionally to actual surplus', () => {
  const ctrl = makeController();
  const now = new Date();
  const slotTime = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
  // Actual PV is only half of forecast
  const state = makeState({ pvPower: 4500, consumptionPower: 1000, batterySoc: 50 });
  const forecastHours = [
    { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 8000 },
  ];

  const plan: ChargePlan = {
    slots: [{
      hour: slotTime.getHours(),
      minute: slotTime.getMinutes(),
      timestamp: slotTime.toISOString(),
      chargePowerW: 2000,  // plan assumes 7000W surplus
      feedInPowerW: 5000,
      forecastW: 8000,
      estimatedSoc: 55,
      revenueFixedCent: 0,
      revenueMarketCent: 0,
    }],
    intervalMinutes: 15,
    totalFeedInKwh: 5,
    totalRevenueFixedCent: 35,
    totalRevenueMarketCent: 25,
    feedInRateCentPerKwh: 7,
    estimatedFullHour: null,
    currentSoc: 50,
  };

  const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
  expect(result.details).not.toBeNull();
  // Actual surplus = 3500W, plan surplus = 7000W, ratio = 0.5
  // Scaled chargeW ≈ 1000W, scaled feedInW ≈ 2500W
  expect(result.details!.desiredChargePowerW).toBeLessThan(2000);
  expect(result.details!.feedInW).toBeLessThan(5000);
});

it('falls back to own logic when plan has no matching slot', () => {
  const ctrl = makeController();
  const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
  const forecastHours = [
    { timestamp: new Date(Date.now() + 1 * 3600_000), powerW: 8000 },
  ];

  // Plan with slots for a completely different time
  const plan: ChargePlan = {
    slots: [{
      hour: 23,
      minute: 45,
      timestamp: '2099-01-01T23:45:00.000Z',
      chargePowerW: 2000,
      feedInPowerW: 5000,
      forecastW: 8000,
      estimatedSoc: 55,
      revenueFixedCent: 0,
      revenueMarketCent: 0,
    }],
    intervalMinutes: 15,
    totalFeedInKwh: 5,
    totalRevenueFixedCent: 35,
    totalRevenueMarketCent: 25,
    feedInRateCentPerKwh: 7,
    estimatedFullHour: null,
    currentSoc: 50,
  };

  const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
  // Should still work (fallback to own logic)
  expect(result.details).not.toBeNull();
  expect(result.details!.strategy).not.toContain('Ladeplan');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts --reporter=verbose`
Expected: FAIL — strategy doesn't contain 'Ladeplan'

**Step 3: Implement plan-guided logic in controller**

In `packages/api/src/controller.ts`, in `_computeSetpoint()`, after the safety checks (battery full, SOC < min, PV < consumption, tight forecast) and before the existing charge calculation block (around line 227), add the plan lookup:

```typescript
// --- Plan-guided charge/feed-in decision ---
if (chargePlan) {
  const currentSlot = this.findCurrentPlanSlot(chargePlan);
  if (currentSlot) {
    const plannedSurplusW = currentSlot.forecastW - state.consumptionPower;
    const ratio = plannedSurplusW > 0 ? Math.max(0, currentSurplusW / plannedSurplusW) : 1;

    let desiredChargePowerW = Math.round(currentSlot.chargePowerW * ratio);
    let feedInW = Math.round(currentSlot.feedInPowerW * ratio);

    // Clamp to actual surplus
    const total = desiredChargePowerW + feedInW;
    if (total > currentSurplusW && total > 0) {
      const scale = currentSurplusW / total;
      desiredChargePowerW = Math.round(desiredChargePowerW * scale);
      feedInW = Math.round(feedInW * scale);
    }

    // Safety: anti-clipping takes priority
    const antiClipChargeW = Math.max(0, state.pvPower - this.config.maxAcPowerW);
    if (antiClipChargeW > desiredChargePowerW) {
      const extra = antiClipChargeW - desiredChargePowerW;
      desiredChargePowerW = antiClipChargeW;
      feedInW = Math.max(0, feedInW - extra);
    }

    const setpoint = feedInW > 0 ? -feedInW : 0;

    const strategy = `Ladeplan: ${Math.round(desiredChargePowerW)}W laden, ${Math.round(feedInW)}W einspeisen (Plan: ${currentSlot.chargePowerW}W/${currentSlot.feedInPowerW}W, Faktor ${ratio.toFixed(2)})`;

    const details: ControllerDetails = {
      currentSurplusW: Math.round(currentSurplusW),
      desiredChargePowerW: Math.round(desiredChargePowerW),
      feedInW: Math.round(feedInW),
      batteryNeedKwh: Math.round(batteryNeedKwh * 10) / 10,
      remainingHours: this.getRemainingProductionHours(forecast, now),
      remainingForecastKwh,
      isClippingRisk: state.pvPower > this.config.maxAcPowerW,
      earlyClippingOverride: false,
      batterySoc: Math.round(state.batterySoc),
      targetSocPercent,
      goal: `Ladeplan folgen — ${currentSlot.timestamp.slice(11, 16)}: ${Math.round(desiredChargePowerW)}W laden, ${Math.round(feedInW)}W einspeisen`,
      forcedChargeKwh: 0,
      voluntaryChargeKwh: 0,
      clippingHours: 0,
      strategy,
    };

    // Battery discharge correction (same as existing logic)
    let correctedSetpoint = setpoint;
    const batteryDischargingWhileShouldCharge = batteryNeedKwh > 0 && state.batteryPower < -100;
    if (batteryDischargingWhileShouldCharge) {
      const correction = Math.abs(state.batteryPower) + desiredChargePowerW;
      correctedSetpoint = setpoint + correction;
      correctedSetpoint = Math.min(correctedSetpoint, 0);
      details.goal = `KORREKTUR: Batterie entlädt mit ${Math.abs(state.batteryPower)}W statt ${Math.round(desiredChargePowerW)}W zu laden — Einspeisung reduzieren`;
    }

    // Deadband
    if (!batteryDischargingWhileShouldCharge && this.lastAppliedSetpoint !== null) {
      const diff = Math.abs(correctedSetpoint - this.lastAppliedSetpoint);
      if (diff < this.config.deadbandW) {
        return {
          setpointW: this.lastAppliedSetpoint,
          mode: 'auto',
          reason: `Im deadband (${diff.toFixed(0)}W < ${this.config.deadbandW}W), Sollwert beibehalten`,
          details,
        };
      }
    }

    return {
      setpointW: roundTo50(correctedSetpoint),
      mode: 'auto',
      reason: `Ladeplan: Einspeisung ${Math.abs(roundTo50(correctedSetpoint))}W, Ladung ${Math.round(desiredChargePowerW)}W`,
      details,
    };
  }
}

// --- Fallback: existing logic (when no plan or no matching slot) ---
```

Add the helper method to the Controller class:

```typescript
private findCurrentPlanSlot(plan: ChargePlan): ChargePlanSlot | null {
  const now = new Date();
  const nowMs = now.getTime();
  const slotMs = plan.intervalMinutes * 60 * 1000; // 900_000 for 15min
  const currentSlotStart = Math.floor(nowMs / slotMs) * slotMs;

  for (const slot of plan.slots) {
    const slotStart = new Date(slot.timestamp).getTime();
    if (Math.abs(slotStart - currentSlotStart) < slotMs) {
      return slot;
    }
  }
  return null;
}
```

Note: Import `ChargePlanSlot` from charge-plan.ts:
```typescript
import type { ChargePlan, ChargePlanSlot } from './charge-plan.js';
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts --reporter=verbose`
Expected: All tests PASS

**Step 5: Run all tests to check for regressions**

Run: `cd packages/api && npx vitest run --reporter=verbose`
Expected: All tests PASS

**Step 6: Commit**

```
feat: controller follows charge plan for charge/feed-in decisions
```

---

### Task 3: Update existing controller tests for plan compatibility

Some existing tests explicitly check strategies/behaviors that may now behave differently when a plan is passed. We need to verify they still work (they should, since they don't pass a plan and the fallback logic is unchanged).

**Step 1: Run all existing tests without changes**

Run: `cd packages/api && npx vitest run --reporter=verbose`
Expected: All tests PASS (existing tests don't pass a ChargePlan, so fallback logic runs)

**Step 2: Commit if needed**

If any test needed adjustment, commit:
```
test: update controller tests for charge plan integration
```

---

### Task 4: Remove getChargeSchedule (dead code cleanup)

**Files:**
- Modify: `packages/api/src/controller.ts` — remove `getChargeSchedule()` method and its usage in fallback path

**Important:** Only do this if the plan-guided path handles all price optimization cases. The fallback path (no plan) still uses `getChargeSchedule()`. Since the plan is computed from `computeChargePlan()` which already includes price optimization via `buildPriceSchedule()`, the plan-guided path covers this.

However, the fallback path is still needed for when the plan computation fails. So **keep `getChargeSchedule()` for now** — it serves as the fallback. This task is a NO-OP.

**Step 1: Verify fallback still works**

Run: `cd packages/api && npx vitest run src/__tests__/controller.test.ts --reporter=verbose`
Expected: All existing price optimization tests still PASS

---

### Task 5: Verify end-to-end integration

**Step 1: Build the project**

Run: `cd packages/api && npx tsc --noEmit`
Expected: No type errors

**Step 2: Run full test suite**

Run: `cd packages/api && npx vitest run --reporter=verbose`
Expected: All tests PASS

**Step 3: Commit final state**

```
chore: verify charge plan integration end-to-end
```
