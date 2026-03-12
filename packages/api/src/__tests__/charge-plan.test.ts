import { describe, it, expect } from 'vitest';
import { computeChargePlan, type ChargePlanConfig } from '../charge-plan.js';
import type { Forecast, ForecastHour } from '../vrm-service.js';
import type { PriceEntry } from '../controller.js';

function makeConfig(overrides: Partial<ChargePlanConfig> = {}): ChargePlanConfig {
  return {
    currentSoc: 50,
    batteryCapacityKwh: 16,
    targetSocPercent: 100,
    minSocPercent: 20,
    maxAcPowerW: 12000,
    feedInRateCentPerKwh: 7,
    consumptionDayW: 1000,
    consumptionNightW: 1000,
    priceOptimization: false,
    allowFeedInNegativePrice: false,
    preferredMaxChargeW: 5000,
    ...overrides,
  };
}

/** Use tomorrow as base date so all test slots are always in the future. */
function futureBase(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Create 15-min forecast slots. Each power entry generates 4 slots (one per hour). */
function makeForecastSlots(powers: number[], startHour = 8): ForecastHour[] {
  const base = futureBase();
  const slots: ForecastHour[] = [];
  for (let i = 0; i < powers.length; i++) {
    for (let q = 0; q < 4; q++) {
      slots.push({
        timestamp: new Date(base.getTime() + (startHour + i) * 3600_000 + q * 900_000),
        powerW: powers[i],
      });
    }
  }
  return slots;
}

function makeForecast(powers: number[], startHour = 8): Forecast {
  const slots = makeForecastSlots(powers, startHour);
  const totalKwh = slots.reduce((sum, s) => sum + s.powerW * 0.25, 0) / 1000;
  return { hours: slots, totalKwh, intervalHours: 0.25 };
}

function makePrices(startHour = 0, count = 24, priceEurMwh = 50): PriceEntry[] {
  const base = futureBase();
  // Generate 15-min price entries
  return Array.from({ length: count * 4 }, (_, i) => ({
    timestamp: Math.floor((base.getTime() + (startHour * 3600_000) + i * 900_000) / 1000),
    price: priceEurMwh,
  }));
}

describe('computeChargePlan', () => {
  it('returns 15-min slots from 15-min forecast', () => {
    const forecast = makeForecast([3000, 5000, 7000, 5000, 3000]);
    const prices = makePrices();
    const config = makeConfig();

    const plan = computeChargePlan(forecast, prices, config);

    expect(plan.intervalMinutes).toBe(15);
    expect(plan.slots).toHaveLength(5 * 4); // 5 hours * 4 slots
    // Each group of 4 slots shares the same forecast power
    expect(plan.slots[0].forecastW).toBe(3000);
    expect(plan.slots[3].forecastW).toBe(3000);
    expect(plan.slots[4].forecastW).toBe(5000);
  });

  it('calculates total feed-in kWh', () => {
    const forecast = makeForecast([8000, 8000, 8000, 8000, 8000]);
    const prices = makePrices();
    const config = makeConfig({ currentSoc: 95, targetSocPercent: 100 });

    const plan = computeChargePlan(forecast, prices, config);

    expect(plan.totalFeedInKwh).toBeGreaterThan(0);
    expect(plan.totalFeedInKwh).toBeGreaterThan(20);
  });

  it('calculates revenue with fixed rate', () => {
    const forecast = makeForecast([8000, 8000, 8000, 8000, 8000]);
    const prices = makePrices();
    const config = makeConfig({ currentSoc: 95, targetSocPercent: 100, feedInRateCentPerKwh: 7 });

    const plan = computeChargePlan(forecast, prices, config);

    expect(plan.totalRevenueFixedCent).toBeCloseTo(plan.totalFeedInKwh * 7, 1);
    expect(plan.feedInRateCentPerKwh).toBe(7);
  });

  it('calculates revenue with market prices', () => {
    const forecast = makeForecast([8000, 8000, 8000]);
    const prices = makePrices(0, 24, 50); // 50 EUR/MWh = 5 ct/kWh
    const config = makeConfig({ currentSoc: 95, targetSocPercent: 100 });

    const plan = computeChargePlan(forecast, prices, config);

    expect(plan.totalRevenueMarketCent).toBeCloseTo(plan.totalFeedInKwh * 5, 1);
  });

  it('tracks SOC progression (should increase during production hours)', () => {
    const forecast = makeForecast([5000, 5000, 5000, 5000]);
    const prices = makePrices();
    const config = makeConfig({ currentSoc: 50 });

    const plan = computeChargePlan(forecast, prices, config);

    const socs = plan.slots.map(s => s.estimatedSoc);
    expect(socs[0]).toBeGreaterThanOrEqual(50);
    expect(socs[socs.length - 1]).toBeGreaterThan(50);
  });

  it('detects when battery reaches target SOC (estimatedFullHour)', () => {
    const forecast = makeForecast([10000, 10000, 10000, 10000, 10000]);
    const prices = makePrices();
    const config = makeConfig({ currentSoc: 90, targetSocPercent: 100, batteryCapacityKwh: 16 });

    const plan = computeChargePlan(forecast, prices, config);

    expect(plan.estimatedFullHour).not.toBeNull();
    expect(plan.estimatedFullHour).toBeGreaterThanOrEqual(0);
    expect(plan.estimatedFullHour).toBeLessThanOrEqual(23);
  });

  it('prioritizes charging when forecast is tight', () => {
    const forecast = makeForecast([3200, 3200, 3200, 3200, 3200]);
    const prices = makePrices();
    const config = makeConfig({ currentSoc: 50, targetSocPercent: 100, batteryCapacityKwh: 16 });

    const plan = computeChargePlan(forecast, prices, config);
    const totalForecastSurplusKwh = (3200 - 1000) * 5 / 1000;

    expect(plan.totalFeedInKwh).toBeLessThan(4);
    expect(plan.totalFeedInKwh).toBeLessThan(totalForecastSurplusKwh * 0.4);
  });

  it('uses 15-min price granularity for market revenue', () => {
    const forecast = makeForecast([8000, 8000]); // 2 hours starting at hour 8
    const base = futureBase();
    base.setHours(base.getHours() + 8); // hour 8 tomorrow
    // Different prices per 15-min slot within each hour
    const prices: PriceEntry[] = [
      // Hour 8: 40, 50, 60, 70 EUR/MWh
      { timestamp: Math.floor(base.getTime() / 1000), price: 40 },
      { timestamp: Math.floor(base.getTime() / 1000) + 900, price: 50 },
      { timestamp: Math.floor(base.getTime() / 1000) + 1800, price: 60 },
      { timestamp: Math.floor(base.getTime() / 1000) + 2700, price: 70 },
      // Hour 9: 80, 90, 100, 110 EUR/MWh
      { timestamp: Math.floor(base.getTime() / 1000) + 3600, price: 80 },
      { timestamp: Math.floor(base.getTime() / 1000) + 4500, price: 90 },
      { timestamp: Math.floor(base.getTime() / 1000) + 5400, price: 100 },
      { timestamp: Math.floor(base.getTime() / 1000) + 6300, price: 110 },
    ];
    const config = makeConfig({ currentSoc: 99, targetSocPercent: 100 });

    const plan = computeChargePlan(forecast, prices, config);

    // First 4 slots = hour 8, next 4 = hour 9
    const hour8Slots = plan.slots.slice(0, 4);
    const hour9Slots = plan.slots.slice(4, 8);
    expect(hour8Slots).toHaveLength(4);
    expect(hour9Slots).toHaveLength(4);

    // Hour 9 has higher prices, so if both feed in equally, hour 9 should have higher revenue
    const hour8Revenue = hour8Slots.reduce((s, h) => s + h.revenueMarketCent, 0);
    const hour9Revenue = hour9Slots.reduce((s, h) => s + h.revenueMarketCent, 0);
    if (hour8Revenue > 0 && hour9Revenue > 0) {
      expect(hour9Revenue).toBeGreaterThan(hour8Revenue);
    }
  });

  it('price optimization shifts charging to cheap slots and feed-in to expensive', () => {
    // 10 hours of production, 20kWh battery need
    const powers = Array(10).fill(6000);
    const forecast = makeForecast(powers, 6);
    const base = futureBase();
    base.setHours(base.getHours() + 6); // hour 6 tomorrow
    // 2 expensive hours, 6 cheap hours, 2 medium hours
    const pricePerHour = [200, 200, 20, 20, 20, 20, 20, 20, 100, 100];
    const prices: PriceEntry[] = [];
    for (let h = 0; h < 10; h++) {
      for (let q = 0; q < 4; q++) {
        prices.push({
          timestamp: Math.floor(base.getTime() / 1000) + h * 3600 + q * 900,
          price: pricePerHour[h],
        });
      }
    }
    const config = makeConfig({
      currentSoc: 0,
      targetSocPercent: 100,
      batteryCapacityKwh: 20,  // need 20 kWh, surplus = 50 kWh, ratio = 2.5
      priceOptimization: true,
    });

    const plan = computeChargePlan(forecast, prices, config);

    // Expensive slots (first 8, hours 6-7) should be feed-in hours
    const expensiveSlots = plan.slots.slice(0, 8);
    const expensiveChargeTotal = expensiveSlots.reduce((s, h) => s + h.chargePowerW, 0);
    const expensiveFeedInTotal = expensiveSlots.reduce((s, h) => s + h.feedInPowerW, 0);

    // Expensive hours should mostly feed in, not charge
    expect(expensiveFeedInTotal).toBeGreaterThan(expensiveChargeTotal);
  });

  it('charges at cheapest slots regardless of allowFeedInNegativePrice flag', () => {
    // Setup: 6 hours of production, negative prices in first 2 hours, positive in rest
    const powers = Array(6).fill(6000);
    const forecast = makeForecast(powers, 8);
    const base = futureBase();
    base.setHours(base.getHours() + 8);
    // Hours 8-9: negative prices (-50 EUR/MWh), Hours 10-13: positive (100 EUR/MWh)
    const pricePerHour = [-50, -50, 100, 100, 100, 100];
    const prices: PriceEntry[] = [];
    for (let h = 0; h < 6; h++) {
      for (let q = 0; q < 4; q++) {
        prices.push({
          timestamp: Math.floor(base.getTime() / 1000) + h * 3600 + q * 900,
          price: pricePerHour[h],
        });
      }
    }

    // With allowFeedInNegativePrice = false (default behavior)
    const planDefault = computeChargePlan(forecast, prices, makeConfig({
      currentSoc: 50,
      targetSocPercent: 100,
      batteryCapacityKwh: 16,
      priceOptimization: true,
      allowFeedInNegativePrice: false,
    }));

    // With allowFeedInNegativePrice = true
    const planWithFlag = computeChargePlan(forecast, prices, makeConfig({
      currentSoc: 50,
      targetSocPercent: 100,
      batteryCapacityKwh: 16,
      priceOptimization: true,
      allowFeedInNegativePrice: true,
    }));

    // In both cases, negative-price slots (first 8 slots) should charge heavily
    const negSlotsDefault = planDefault.slots.slice(0, 8);
    const negSlotsWithFlag = planWithFlag.slots.slice(0, 8);

    const negChargeDefault = negSlotsDefault.reduce((s, h) => s + h.chargePowerW, 0);
    const negChargeWithFlag = negSlotsWithFlag.reduce((s, h) => s + h.chargePowerW, 0);

    // Both should charge in the cheap (negative) slots
    expect(negChargeDefault).toBeGreaterThan(0);
    expect(negChargeWithFlag).toBeGreaterThan(0);

    // The expensive slots should prefer feed-in over charging in both cases
    const expSlotsDefault = planDefault.slots.slice(8);
    const expSlotsWithFlag = planWithFlag.slots.slice(8);

    const expFeedInDefault = expSlotsDefault.reduce((s, h) => s + h.feedInPowerW, 0);
    const expFeedInWithFlag = expSlotsWithFlag.reduce((s, h) => s + h.feedInPowerW, 0);
    const expChargeDefault = expSlotsDefault.reduce((s, h) => s + h.chargePowerW, 0);
    const expChargeWithFlag = expSlotsWithFlag.reduce((s, h) => s + h.chargePowerW, 0);

    expect(expFeedInDefault).toBeGreaterThan(expChargeDefault);
    expect(expFeedInWithFlag).toBeGreaterThan(expChargeWithFlag);
  });

  it('allowFeedInNegativePrice only controls feed-in, not charge planning', () => {
    // Setup: all negative prices, ample surplus
    const powers = Array(4).fill(8000);
    const forecast = makeForecast(powers, 10);
    const base = futureBase();
    base.setHours(base.getHours() + 10);
    const prices: PriceEntry[] = [];
    for (let h = 0; h < 4; h++) {
      for (let q = 0; q < 4; q++) {
        prices.push({
          timestamp: Math.floor(base.getTime() / 1000) + h * 3600 + q * 900,
          price: -20,
        });
      }
    }

    const configBase = {
      currentSoc: 80,
      targetSocPercent: 100,
      batteryCapacityKwh: 16,
      priceOptimization: true,
    };

    const planNoFeedIn = computeChargePlan(forecast, prices, makeConfig({
      ...configBase,
      allowFeedInNegativePrice: false,
    }));

    const planAllowFeedIn = computeChargePlan(forecast, prices, makeConfig({
      ...configBase,
      allowFeedInNegativePrice: true,
    }));

    // With flag=false: no feed-in at all (negative price blocks feed-in)
    const totalFeedInNoFlag = planNoFeedIn.slots.reduce((s, h) => s + h.feedInPowerW, 0);
    expect(totalFeedInNoFlag).toBe(0);

    // With flag=true: feed-in is allowed at negative prices
    const totalFeedInWithFlag = planAllowFeedIn.slots.reduce((s, h) => s + h.feedInPowerW, 0);
    expect(totalFeedInWithFlag).toBeGreaterThan(0);

    // Both should still charge the battery to target
    const lastSocNoFlag = planNoFeedIn.slots[planNoFeedIn.slots.length - 1].estimatedSoc;
    const lastSocWithFlag = planAllowFeedIn.slots[planAllowFeedIn.slots.length - 1].estimatedSoc;
    expect(lastSocNoFlag).toBe(100);
    expect(lastSocWithFlag).toBe(100);
  });

  it('charges to minSoc before feeding in when SOC is below safety minimum', () => {
    const forecast = makeForecast([5000, 5000, 5000, 5000], 7);
    const prices = makePrices(0, 24, 150); // expensive prices
    const config = makeConfig({
      currentSoc: 4,
      minSocPercent: 20,
      targetSocPercent: 100,
      batteryCapacityKwh: 16,
      priceOptimization: true,
    });

    const plan = computeChargePlan(forecast, prices, config);

    // First slots should charge (not feed in) to reach minSoc
    const firstSlot = plan.slots[0];
    expect(firstSlot.chargePowerW).toBeGreaterThan(0);
    // SOC should rise from 4% toward 20% in early slots
    expect(firstSlot.estimatedSoc).toBeGreaterThan(4);

    // Should not show SoC=20 with chargePower=0 (the old bug)
    const belowMinSlots = plan.slots.filter(s => s.estimatedSoc < 20);
    for (const s of belowMinSlots) {
      expect(s.chargePowerW).toBeGreaterThan(0);
    }
  });
});
