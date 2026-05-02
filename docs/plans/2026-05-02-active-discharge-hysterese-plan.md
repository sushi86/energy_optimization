# Active-Discharge Hysterese & transparente Regler-Karte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schwingen am SOC-Floor während aktiver Morgen-Entladung beseitigen (1 pp Hysterese: floor / holdTarget = floor + 1) und den Modus transparent in der Regler-Karte anzeigen.

**Architecture:** `charge-plan.ts` markiert Slots mit `dischargeState: 'active' | 'hold' | 'trickle' | null` und exportiert eine `activeDischarge`-Zusammenfassung im `ChargePlan`. `controller.ts` reicht den Modus über `ControllerDetails` an die UI. Die Regler-Karte (`web/app/page.tsx`) rendert ein Modus-Badge + Begründung + Plan-Endezeit.

**Tech Stack:** TypeScript, Vitest (api), Next.js/React (web), pnpm-workspace.

**Spec:** `docs/plans/2026-05-02-active-discharge-hysterese-design.md`

---

## File Map

- **Modify** `packages/api/src/charge-plan.ts` — Hysterese-Logik, neuer Slot-Zustand, `activeDischarge`-Summary auf `ChargePlan`.
- **Modify** `packages/api/src/controller.ts` — `dischargeState` aus Slot konsumieren, `ControllerDetails` erweitern.
- **Modify** `packages/web/app/page.tsx` — Modus-Badge + Begründung in Regler-Karte (~Zeile 1596).
- **Modify** `packages/api/src/__tests__/charge-plan.test.ts` — Hysterese-Tests.
- **Modify** `packages/api/src/__tests__/controller.test.ts` — Hold-Mode-Tests.

Hinweis: Tests werden mit `pnpm --filter @energy/api test -- --run` aus dem Repo-Root ausgeführt. Keine Watch-Mode-Läufe in CI/Plan-Schritten.

---

## Task 1: Slot-Type & Plan-Summary erweitern (Types only)

**Files:**
- Modify: `packages/api/src/charge-plan.ts:26-66`

- [ ] **Step 1: Slot-Type um `dischargeState` ergänzen**

In `packages/api/src/charge-plan.ts`, ersetze die `ChargePlanSlot`-Schnittstelle (Zeile 26–40) durch:

```typescript
export type DischargeState = 'active' | 'hold' | 'trickle';

export interface ChargePlanSlot {
  hour: number;
  minute: number;
  timestamp: string;
  chargePowerW: number;
  feedInPowerW: number;
  forecastW: number;
  estimatedSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
  clippingW: number;
  consumptionW: number;
  /** Day-ahead market price in EUR/MWh for this slot (null = no price data) */
  priceMwh: number | null;
  /** Set when this slot is part of an active-morning-discharge sequence. */
  dischargeState?: DischargeState;
}
```

- [ ] **Step 2: `ChargePlan` um `activeDischarge`-Summary ergänzen**

Innerhalb der `ChargePlan`-Schnittstelle (Zeile 42–66), unmittelbar vor dem `debug`-Feld, einfügen:

```typescript
  /** Summary of active morning discharge for this plan, if any. */
  activeDischarge: {
    floorPercent: number;
    holdTargetPercent: number;
    reason: string;
    endsAt: string | null;
  } | null;
```

- [ ] **Step 3: Build prüfen**

Run: `pnpm --filter @energy/api build`
Expected: Erfolg. (Type-only-Änderung, kein Logik-Impact yet — `activeDischarge` wird in Task 2 gesetzt.)

Falls die Plan-Konstruktion am Ende von `computeChargePlan` jetzt fehlt-mecked: temporär `activeDischarge: null` an der `return { ... }`-Stelle (am Funktionsende von `computeChargePlan`) ergänzen, damit der Build durchläuft.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/charge-plan.ts
git commit -m "types: add dischargeState slot field and activeDischarge plan summary"
```

---

## Task 2: Hysterese-Konstante und holdTarget-Berechnung

**Files:**
- Modify: `packages/api/src/charge-plan.ts:177-186`
- Test: `packages/api/src/__tests__/charge-plan.test.ts`

Ziel: aus dem einzelnen `dischargeMinSoc` werden floor + holdTarget; `willActivelyDischarge` startet erst wenn SOC klar oberhalb des Halte-Bands ist.

- [ ] **Step 1: Failing test schreiben**

Am Ende der `describe('computeChargePlan', ...)`-Suite in `packages/api/src/__tests__/charge-plan.test.ts` einfügen:

```typescript
  describe('active morning discharge hysteresis', () => {
    function dischargeForecast(): Forecast {
      // ~10 kW PV für 8h → ~80 kWh Tag, weit > 16 kWh Bedarf → surplusRatio >> 2
      return makeForecast([10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000], 7);
    }

    it('does not start active discharge when SOC is at or just above floor (within hold band)', () => {
      const forecast = dischargeForecast();
      const config = makeConfig({
        currentSoc: 13, // floor 12, holdTarget 13 — start gate ist > 13
        targetSocPercent: 100,
        minSocPercent: 20,
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
      });

      const plan = computeChargePlan(forecast, makePrices(), config);

      const activeSlots = plan.slots.filter(s => s.dischargeState === 'active');
      expect(activeSlots).toHaveLength(0);
    });

    it('starts active discharge when SOC is clearly above hold band, stops at holdTarget', () => {
      const forecast = dischargeForecast();
      const config = makeConfig({
        currentSoc: 50,
        targetSocPercent: 100,
        minSocPercent: 20,
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
      });

      const plan = computeChargePlan(forecast, makePrices(), config);

      const activeSlots = plan.slots.filter(s => s.dischargeState === 'active');
      expect(activeSlots.length).toBeGreaterThan(0);
      // SOC darf nicht unter holdTarget (13) fallen während aktiver Entladung
      const minSoc = Math.min(...activeSlots.map(s => s.estimatedSoc));
      expect(minSoc).toBeGreaterThanOrEqual(13 - 0.5); // Rundungs-Toleranz
    });
  });
```

`ChargePlanConfig` in `charge-plan.ts` muss die Felder `activeMorningDischarge` und `activeMorningDischargeMinSocPercent` bereits als Teil von `config` führen — falls nicht, in der `makeConfig`-Default-Hilfsfunktion oben eintragen (Standard: `activeMorningDischarge: false`, `activeMorningDischargeMinSocPercent: 5`).

- [ ] **Step 2: Test laufen lassen, FAIL erwarten**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: FAIL — entweder weil `dischargeState` noch nirgends gesetzt wird, oder weil aktuelle Implementation auch bei SOC=13 entlädt.

- [ ] **Step 3: Hysterese-Konstanten und Gate**

In `charge-plan.ts`, ersetze Zeile 177–185:

```typescript
  // --- Active morning discharge: hysteresis band ---
  // floor   = configured minimum (hard lower bound during morning discharge window)
  // holdTarget = floor + HOLD_BUFFER_PCT (discharge stop and trickle-refill target)
  // 1 pp deadband prevents oscillation at the floor.
  const HOLD_BUFFER_PCT = 1;
  const dischargeFloorSoc = config.activeMorningDischargeMinSocPercent ?? 5;
  const dischargeHoldTargetSoc = dischargeFloorSoc + HOLD_BUFFER_PCT;
  const totalNetSurplusKwhPre = analysis.reduce((sum, s) => sum + Math.max(0, s.surplusW) * ih / 1000, 0);
  const preliminaryNeedKwh = Math.max(0, (targetSocPercent / 100 - currentSoc / 100) * batteryCapacityKwh);
  const willActivelyDischarge =
    (config.activeMorningDischarge ?? false)
    && currentSoc > dischargeHoldTargetSoc
    && preliminaryNeedKwh > 0
    && totalNetSurplusKwhPre / preliminaryNeedKwh >= 2;
  const effectiveStartSocForNeed = willActivelyDischarge ? dischargeFloorSoc : currentSoc;
  const batteryNeedKwh = Math.max(0, (targetSocPercent / 100 - effectiveStartSocForNeed / 100) * batteryCapacityKwh);
```

Anschließend im Rest der Datei `dischargeMinSoc` durch `dischargeFloorSoc` ersetzen — **ausser** in der active-discharge-Schleife, die in den nächsten Tasks umgebaut wird.

Konkret zu finden:
- Zeile 314 (`activeDischargeEnabled`-Bedingung): `currentSoc > dischargeMinSoc` → `currentSoc > dischargeHoldTargetSoc`.
- Zeile 318 (`socSim <= dischargeMinSoc break`): bleibt vorerst, wird in Task 3 angefasst.
- Zeile 330: bleibt vorerst, wird in Task 3 angefasst.
- Zeile 361: bleibt vorerst, wird in Task 3 angefasst.

- [ ] **Step 4: Test laufen lassen, FAIL erwarten (anderer Grund)**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: Erster Test (SOC=13) sollte jetzt PASS sein (Gate verhindert Start). Zweiter Test (SOC=50) noch FAIL, weil Loop noch bei `dischargeFloorSoc` stoppt → SOC fällt unter 13.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/charge-plan.ts packages/api/src/__tests__/charge-plan.test.ts
git commit -m "feat(charge-plan): add holdTarget hysteresis gate for active discharge start"
```

---

## Task 3: Active-discharge-Loop stoppt am holdTarget

**Files:**
- Modify: `packages/api/src/charge-plan.ts:315-337`

- [ ] **Step 1: Loop-Stop und SOC-Cap auf holdTarget umstellen**

In der active-morning-discharge-Schleife (aktuell Zeile 315–337), ersetzen:

```typescript
  // --- Active morning discharge (optional) ---
  // When enabled and the day's surplus comfortably exceeds battery need, drain into
  // the grid in the earliest surplus slots so more clipping later fits in the battery.
  // Discharge stops at holdTarget (floor + 1 pp), not floor — leaving a deadband.
  const activeDischargeEnabled = willActivelyDischarge && !tightForecast;
  if (activeDischargeEnabled && currentSoc > dischargeHoldTargetSoc) {
    let socSim = currentSoc;
    for (let i = 0; i < analysis.length; i++) {
      if (socSim <= dischargeHoldTargetSoc) break;
      const s = analysis[i];
      if (s.surplusW <= 0) continue;
      if (s.clippingW > 0) break;
      const isNegPrice = s.price != null && s.price <= 0 && !config.allowFeedInNegativePrice;
      if (isNegPrice) continue;
      const headroomW = Math.max(0, maxAcPowerW - s.surplusW);
      if (headroomW <= 0) break;
      // Cap by holdTarget (not floor) — preserves 1 pp deadband.
      const maxKwhFromSoc = ((socSim - dischargeHoldTargetSoc) / 100) * batteryCapacityKwh;
      const maxKwhThisSlot = Math.min(headroomW * ih / 1000, maxKwhFromSoc);
      if (maxKwhThisSlot <= 0.01) break;
      const dischargeW = maxKwhThisSlot / ih * 1000;
      voluntaryChargeW[i] = -dischargeW;
      socSim -= (maxKwhThisSlot / batteryCapacityKwh) * 100;
    }
  }
```

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: Beide Hysterese-Tests aus Task 2 bestehen jetzt. Bestehende Tests dürfen nicht regredieren.

Falls bestehende Tests, die `activeMorningDischargeMinSocPercent: 5` mit currentSoc nahe 5 nutzen, jetzt brechen — Werte in Test-Configs auf z.B. `activeMorningDischargeMinSocPercent: 5, currentSoc: 50` lassen oder anpassen.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/charge-plan.ts
git commit -m "feat(charge-plan): cap active discharge at holdTarget instead of floor"
```

---

## Task 4: Forward-Sim — Hold- und Trickle-Pfad + Slot-Markierung

**Files:**
- Modify: `packages/api/src/charge-plan.ts:347-446`
- Test: `packages/api/src/__tests__/charge-plan.test.ts`

- [ ] **Step 1: Tests für hold und trickle**

In der `describe('active morning discharge hysteresis', ...)`-Suite hinzufügen:

```typescript
    it('emits hold slots (chargeW=0, full feed-in) when SOC is in deadband during discharge window', () => {
      const forecast = dischargeForecast();
      const config = makeConfig({
        currentSoc: 13.5, // mitten im Halte-Band (12..13) — knapp drüber
        targetSocPercent: 100,
        minSocPercent: 20,
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
      });

      const plan = computeChargePlan(forecast, makePrices(), config);

      // Erwartung: SOC 13.5 ist innerhalb (12..13.5], aber holdTarget=13 → Gate `currentSoc > 13`
      // ist gerade so erfüllt → minimaler Discharge auf 13, danach hold-Slots in der Discharge-Window.
      // Akzeptiert: irgendein hold-Slot vor Late-Charging.
      const holdSlots = plan.slots.filter(s => s.dischargeState === 'hold');
      expect(holdSlots.length).toBeGreaterThan(0);
      for (const s of holdSlots) {
        expect(s.chargePowerW).toBe(0);
        expect(s.feedInPowerW).toBeGreaterThan(0);
      }
    });

    it('emits trickle slots (capped charge from surplus) when SOC drops below floor during discharge window', () => {
      const forecast = dischargeForecast();
      const config = makeConfig({
        currentSoc: 11, // unter floor=12, im aktiven Discharge-Fenster
        targetSocPercent: 100,
        minSocPercent: 20,
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
        preferredMaxChargeW: 5000,
      });

      const plan = computeChargePlan(forecast, makePrices(), config);

      const trickleSlots = plan.slots.filter(s => s.dischargeState === 'trickle');
      expect(trickleSlots.length).toBeGreaterThan(0);
      for (const s of trickleSlots) {
        expect(s.chargePowerW).toBeGreaterThan(0);
        expect(s.chargePowerW).toBeLessThanOrEqual(5000);
      }
      // Nach dem Trickle-Refill darf SOC nicht über holdTarget hinaus weitergeladen werden, solange noch im Discharge-Fenster
      const reachedHold = plan.slots.find(s => s.estimatedSoc >= 13);
      expect(reachedHold).toBeDefined();
    });
```

- [ ] **Step 2: Tests laufen, FAIL erwarten**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: FAIL — `dischargeState === 'hold'` und `'trickle'` werden noch nirgends gesetzt.

- [ ] **Step 3: Forward-Sim umbauen**

In `charge-plan.ts`, in der Forward-Simulations-Schleife (aktuell Zeile 347–446), ersetze den Block ab `let chargeW: number; let feedInW: number;` (Zeile 353) bis zum `slots.push({...})` (Zeile 432) durch:

```typescript
    let chargeW: number;
    let feedInW: number;
    let slotState: DischargeState | undefined;

    const isActiveDischargeSlot = activeDischargeEnabled && voluntaryChargeW[i] < 0 && s.surplusW > 0;
    const inDischargeWindow = activeDischargeEnabled && s.clippingW <= 0;
    const inHoldBand = soc >= dischargeFloorSoc && soc <= dischargeHoldTargetSoc;
    const belowFloor = soc < dischargeFloorSoc;

    if (isActiveDischargeSlot) {
      // Active morning discharge: feed PV surplus + battery power to grid.
      const maxKwhFromSoc = Math.max(0, ((soc - dischargeHoldTargetSoc) / 100) * batteryCapacityKwh);
      const requestedDischargeKwh = Math.abs(voluntaryChargeW[i]) * ih / 1000;
      const actualDischargeKwh = Math.min(requestedDischargeKwh, maxKwhFromSoc);
      chargeW = -(actualDischargeKwh / ih * 1000);
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
      slotState = 'active';
    } else if (inDischargeWindow && belowFloor && s.surplusW > 0 && !isNegativePrice) {
      // Trickle refill: SOC dropped below floor — refill from surplus, capped at
      // preferredMaxChargeW, only up to holdTarget. No grid pull.
      const refillKwh = ((dischargeHoldTargetSoc - soc) / 100) * batteryCapacityKwh;
      const refillW = Math.min(s.surplusW, preferredMaxChargeW, refillKwh / ih * 1000);
      chargeW = Math.max(0, refillW);
      feedInW = Math.max(0, s.surplusW - chargeW);
      slotState = 'trickle';
    } else if (inDischargeWindow && inHoldBand && s.surplusW > 0) {
      // Hold mode: SOC inside deadband — battery rests, all surplus to feed-in.
      chargeW = 0;
      feedInW = isNegativePrice ? 0 : s.surplusW;
      slotState = 'hold';
    } else if (s.surplusW < 0) {
      // Deficit: drain battery, but not below minSocPercent.
      if (soc <= config.minSocPercent) {
        chargeW = 0;
      } else {
        const maxDischargeKwh = ((soc - config.minSocPercent) / 100) * batteryCapacityKwh;
        const deficitKwh = Math.abs(s.surplusW) * ih / 1000;
        const actualDischargeKwh = Math.min(maxDischargeKwh, deficitKwh);
        chargeW = -(actualDischargeKwh / ih * 1000);
      }
      feedInW = 0;
    } else if (soc < config.minSocPercent && !activeDischargeEnabled) {
      // Safety: SOC below minimum — charge from surplus before feeding in.
      const safetyNeedKwh = ((config.minSocPercent - soc) / 100) * batteryCapacityKwh;
      const safetyChargeW = Math.min(s.surplusW, safetyNeedKwh / ih * 1000);
      chargeW = safetyChargeW;
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
    } else if (soc >= targetSocPercent) {
      chargeW = s.clippingW;
      feedInW = isNegativePrice ? 0 : Math.max(0, s.surplusW - chargeW);
    } else if (isNegativePrice) {
      chargeW = s.surplusW;
      feedInW = 0;
    } else {
      chargeW = s.clippingW + voluntaryChargeW[i];
      chargeW = Math.min(chargeW, s.surplusW);
      feedInW = Math.max(0, s.surplusW - chargeW);
    }
```

Direkt vor `slots.push({...})` ergänzen (im Slot-Objekt das `dischargeState`-Feld setzen):

```typescript
    slots.push({
      hour,
      minute,
      timestamp: s.timestamp.toISOString(),
      chargePowerW: Math.round(chargeW),
      feedInPowerW: Math.round(feedInW),
      forecastW: s.forecastW,
      estimatedSoc: Math.round(soc * 10) / 10,
      revenueFixedCent: Math.round(revenueFixedCent * 100) / 100,
      revenueMarketCent: Math.round(revenueMarketCent * 100) / 100,
      clippingW: Math.round(s.clippingW),
      consumptionW: Math.round(s.consumptionW),
      priceMwh: s.price,
      ...(slotState ? { dischargeState: slotState } : {}),
    });
```

(Den ursprünglichen `slots.push({...})`-Block ersetzen — alle anderen Felder bleiben gleich.)

- [ ] **Step 4: Tests laufen, PASS erwarten**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: alle Tests bestehen, einschließlich der neuen hold/trickle-Tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/charge-plan.ts packages/api/src/__tests__/charge-plan.test.ts
git commit -m "feat(charge-plan): hold and trickle slots with deadband at active-discharge floor"
```

---

## Task 5: ChargePlan.activeDischarge-Summary füllen

**Files:**
- Modify: `packages/api/src/charge-plan.ts` (return-Block am Funktionsende)
- Test: `packages/api/src/__tests__/charge-plan.test.ts`

- [ ] **Step 1: Failing test schreiben**

In derselben Suite hinzufügen:

```typescript
    it('exposes activeDischarge summary on the plan', () => {
      const forecast = dischargeForecast();
      const config = makeConfig({
        currentSoc: 50,
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
      });

      const plan = computeChargePlan(forecast, makePrices(), config);

      expect(plan.activeDischarge).not.toBeNull();
      expect(plan.activeDischarge!.floorPercent).toBe(12);
      expect(plan.activeDischarge!.holdTargetPercent).toBe(13);
      expect(plan.activeDischarge!.reason).toMatch(/Prognose/);
      expect(plan.activeDischarge!.endsAt).not.toBeNull();
    });

    it('activeDischarge is null when feature disabled', () => {
      const forecast = dischargeForecast();
      const plan = computeChargePlan(forecast, makePrices(), makeConfig({ activeMorningDischarge: false }));
      expect(plan.activeDischarge).toBeNull();
    });
```

- [ ] **Step 2: Test laufen, FAIL erwarten**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: FAIL — `activeDischarge` ist heute `null` (aus Task 1) bzw. fehlt.

- [ ] **Step 3: Summary aufbauen**

Vor dem `return { ... }`-Block am Funktionsende von `computeChargePlan` (in der Nähe wo `slots`, `totalFeedInKwh` etc. bereits berechnet sind):

```typescript
  const lastActiveSlot = [...slots].reverse().find(s => s.dischargeState === 'active');
  const activeDischarge = activeDischargeEnabled
    ? {
        floorPercent: dischargeFloorSoc,
        holdTargetPercent: dischargeHoldTargetSoc,
        reason: `Prognose ${surplusRatio.toFixed(1)}× Bedarf — Platz für mittäglichen Clipping schaffen`,
        endsAt: lastActiveSlot ? lastActiveSlot.timestamp : null,
      }
    : null;
```

Im `return { ... }`-Objekt das vorherige `activeDischarge: null` (aus Task 1 als Build-Fix) durch `activeDischarge,` ersetzen.

- [ ] **Step 4: Test laufen, PASS erwarten**

Run: `pnpm --filter @energy/api test -- --run charge-plan`
Expected: alle Tests bestehen.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/charge-plan.ts packages/api/src/__tests__/charge-plan.test.ts
git commit -m "feat(charge-plan): expose activeDischarge summary (band, reason, endsAt)"
```

---

## Task 6: ControllerDetails-Felder + Hold-Mode

**Files:**
- Modify: `packages/api/src/controller.ts:32-55, 140-150, 260-340`
- Test: `packages/api/src/__tests__/controller.test.ts`

- [ ] **Step 1: Failing test schreiben**

In `packages/api/src/__tests__/controller.test.ts` eine neue `describe`-Suite oder am Ende einer passenden bestehenden anhängen:

```typescript
  describe('active discharge hold mode', () => {
    it('uses chargeW=0 and full feed-in when current slot is in hold state', () => {
      const controller = new Controller(makeControllerDeps({
        activeMorningDischarge: true,
        activeMorningDischargeMinSocPercent: 12,
      }));

      const now = new Date();
      const plan: ChargePlan = makePlanWithSlot({
        timestamp: now.toISOString(),
        chargePowerW: 0,
        feedInPowerW: 4000,
        dischargeState: 'hold',
      }, { floorPercent: 12, holdTargetPercent: 13, reason: 'test', endsAt: null });

      const result = controller.computeSetpoint({
        state: makeState({ batterySoc: 12.5, pvPower: 5000, consumptionPower: 1000 }),
        forecast: bigForecast(),
        chargePlan: plan,
        prices: [],
        now,
      });

      expect(result.details?.dischargeMode).toBe('hold');
      expect(result.details?.dischargeBand).toEqual({ floor: 12, holdTarget: 13 });
      expect(result.details?.desiredChargePowerW).toBe(0);
      expect(result.details?.feedInW).toBeGreaterThan(0);
    });
  });
```

(Hilfsfunktionen `makeControllerDeps`, `makePlanWithSlot`, `makeState`, `bigForecast` ggf. an bestehende Test-Helpers in der Datei anlehnen — Pattern siehe vorhandene Controller-Tests.)

- [ ] **Step 2: Test laufen, FAIL erwarten**

Run: `pnpm --filter @energy/api test -- --run controller`
Expected: FAIL — `dischargeMode` existiert noch nicht.

- [ ] **Step 3: `ControllerDetails` erweitern**

In `controller.ts:32-55`, im `ControllerDetails`-Interface ergänzen (nach dem `priceOptimization`-Block):

```typescript
  dischargeMode?: 'active' | 'hold' | 'trickle';
  dischargeBand?: { floor: number; holdTarget: number };
  dischargeReason?: string;
  dischargePlanEndsAt?: string;
```

- [ ] **Step 4: Hold-Mode-Pfad und Detail-Felder im Plan-Branch**

In `controller.ts`, im `if (chargePlan)`-Plan-Branch (ab Zeile 261, der `currentSlot`-Block):

a) Direkt nach `const currentSlot = plannedSlot;` ergänzen:

```typescript
        const dischargeState = currentSlot.dischargeState; // 'active' | 'hold' | 'trickle' | undefined
        const isHoldSlot = dischargeState === 'hold';
        const isTrickleSlot = dischargeState === 'trickle';
```

b) Den bestehenden `if/else` für `desiredChargePowerW` / `feedInW` (Zeile 270–279) ersetzen durch:

```typescript
        let desiredChargePowerW: number;
        let feedInW: number;

        if (currentSurplusW <= 0) {
          desiredChargePowerW = 0;
          feedInW = 0;
        } else if (isActiveDischargeSlot) {
          desiredChargePowerW = currentSlot.chargePowerW; // negative
          feedInW = Math.min(this.config.maxAcPowerW, currentSurplusW - desiredChargePowerW);
        } else if (isHoldSlot) {
          desiredChargePowerW = 0;
          feedInW = Math.min(this.config.maxAcPowerW, currentSurplusW);
        } else {
          // Trickle reuses normal path: planned chargePowerW is the cap.
          desiredChargePowerW = Math.min(currentSlot.chargePowerW, currentSurplusW);
          feedInW = Math.max(0, currentSurplusW - desiredChargePowerW);
        }
```

c) Im `details: ControllerDetails = { ... }`-Block (Zeile 295) am Ende vor der schließenden `}` ergänzen:

```typescript
          ...(dischargeState ? { dischargeMode: dischargeState } : {}),
          ...(chargePlan.activeDischarge ? {
            dischargeBand: {
              floor: chargePlan.activeDischarge.floorPercent,
              holdTarget: chargePlan.activeDischarge.holdTargetPercent,
            },
            dischargeReason: chargePlan.activeDischarge.reason,
            ...(chargePlan.activeDischarge.endsAt ? { dischargePlanEndsAt: chargePlan.activeDischarge.endsAt } : {}),
          } : {}),
```

d) Strategy-Text im Hold-Modus klarstellen — direkt nach der bestehenden `const strategy = ...`-Zeile (Zeile 293):

```typescript
        const dischargeStrategyOverride =
          isHoldSlot ? `Halten ${chargePlan.activeDischarge?.floorPercent ?? '?'}–${chargePlan.activeDischarge?.holdTargetPercent ?? '?'}% — Akku ruht (Setpoint 0 W)` :
          isTrickleSlot ? `Sanftes Auffüllen auf ${chargePlan.activeDischarge?.holdTargetPercent ?? '?'}% (max ${fmtW(currentSlot.chargePowerW)} aus PV)` :
          dischargeState === 'active' ? `Aktiv entladen — Ziel: Halten bei ${chargePlan.activeDischarge?.holdTargetPercent ?? '?'}%` :
          null;
        const finalStrategy = dischargeStrategyOverride ?? strategy;
```

…und im `details`-Objekt `strategy: dischargeStrategyOverride ?? strategy` setzen (statt nur `strategy`).

- [ ] **Step 5: Tests laufen**

Run: `pnpm --filter @energy/api test -- --run controller`
Expected: alle Tests bestehen, einschließlich der neuen Hold-Mode-Tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat(controller): hold-mode setpoint=0, expose dischargeMode/band/reason in details"
```

---

## Task 7: Regler-Karte zeigt Modus-Badge + Begründung

**Files:**
- Modify: `packages/web/app/page.tsx:1596-1636`

- [ ] **Step 1: Modus-Badge oberhalb der Strategy-Zeile**

In `packages/web/app/page.tsx`, im Block `{controller.details && (` (ab Zeile 1596), direkt **vor** der `<p className="text-sm font-medium text-[var(--accent)]">`-Zeile (Zeile 1599) einfügen:

```tsx
                {controller.details.dischargeMode && controller.details.dischargeBand && (
                  <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm">
                    <div className="font-medium text-[var(--accent)]">
                      {controller.details.dischargeMode === 'active' && (
                        <>Aktiv entladen → Halten {controller.details.dischargeBand.floor}–{controller.details.dischargeBand.holdTarget}%</>
                      )}
                      {controller.details.dischargeMode === 'hold' && (
                        <>Halten {controller.details.dischargeBand.floor}–{controller.details.dischargeBand.holdTarget}% — Akku ruht (Setpoint 0 W)</>
                      )}
                      {controller.details.dischargeMode === 'trickle' && (
                        <>Sanft auffüllen auf {controller.details.dischargeBand.holdTarget}% (PV-Überschuss)</>
                      )}
                    </div>
                    {controller.details.dischargeReason && (
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {controller.details.dischargeReason}
                      </div>
                    )}
                    {controller.details.dischargePlanEndsAt && controller.details.dischargeMode === 'active' && (
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        Entladung bis {new Date(controller.details.dischargePlanEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, danach Late-Charging
                      </div>
                    )}
                  </div>
                )}
```

- [ ] **Step 2: Build prüfen**

Run: `pnpm --filter @energy/web build` (oder `pnpm --filter @energy/web typecheck`, falls vorhanden)
Expected: Erfolg.

Falls die `controller.details`-Type im Web-Package separat liegt (z.B. in einem shared package): die neuen Felder müssen dort ebenfalls eingetragen werden. Ggf. `packages/shared/src/*.ts` prüfen und Typ ergänzen, dann erneut builden.

- [ ] **Step 3: Manueller Sanity-Check (UI)**

Dev-Server starten:
```bash
pnpm --filter @energy/web dev
```
Browser öffnen, prüfen dass die Regler-Karte rendert wie heute, wenn keine aktive Entladung läuft. (Mit echtem aktiv-discharge-Zustand kann nur live geprüft werden — UI-Logik ist rein konditional.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/page.tsx packages/shared/src/*.ts 2>/dev/null || git add packages/web/app/page.tsx
git commit -m "feat(web): show active-discharge mode badge and reason in regler card"
```

---

## Task 8: Vollständiger Test-Lauf + Build

**Files:** keine

- [ ] **Step 1: Alle Tests**

Run: `pnpm --filter @energy/api test -- --run`
Expected: alles grün.

- [ ] **Step 2: Builds**

Run: `pnpm --filter @energy/api build && pnpm --filter @energy/web build`
Expected: keine TS-Fehler.

- [ ] **Step 3 (optional): Smoke-Test gegen live Daten**

Falls Staging/Dev-Setup verfügbar: API starten, einen `chargePlan`-Lauf mit `activeMorningDischarge: true` und `activeMorningDischargeMinSocPercent: 12` triggern und prüfen, dass:
- Plan-Slots `dischargeState` enthalten
- `chargePlan.activeDischarge` gesetzt ist
- Regler-Karte das Modus-Badge zeigt

---

## Self-Review Checklist (vor Übergabe)

- [ ] Spec-Coverage: Floor/holdTarget — Task 2; Loop-Stop — Task 3; hold/trickle — Task 4; Plan-Summary — Task 5; ControllerDetails — Task 6; UI — Task 7. ✓
- [ ] Keine Platzhalter: alle Steps haben konkreten Code/Befehl. ✓
- [ ] Type-Konsistenz: `dischargeState` (Slot) vs `dischargeMode` (Details) bewusst unterschiedlich benannt — Slot trägt rohen Zustand, Details exponieren ihn als UI-Modus.
- [ ] DRY/YAGNI: keine Konfig für Pufferzone, kein eigener Refill-Powerlimit, keine Multi-Tag-Hysterese.
