import { describe, it, expect } from 'vitest';
import { Controller, type ControllerDeps } from '../controller.js';
import type { SystemState } from '../mqtt-service.js';
import type { Forecast } from '../vrm-service.js';
import type { ChargePlan } from '../charge-plan.js';

function makeState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    pvPower: 8000,
    consumptionPower: 1000,
    gridPower: 0,
    batteryPower: 0,
    batterySoc: 50,
    gridSetpoint: 0,
    timestamp: new Date(),
    ...overrides,
  };
}

function makeForecast(totalKwh: number, hours: { timestamp: Date; powerW: number }[] = [], intervalHours = 1): Forecast {
  return {
    hours,
    totalKwh,
    intervalHours,
  };
}

function makeController(overrides: Partial<ControllerDeps> = {}): Controller {
  return new Controller({
    batteryCapacityKwh: 16,
    minSocPercent: 20,
    targetSocPercent: 100,
    maxAcPowerW: 12000,
    winterModeThresholdFactor: 1.2,
    deadbandW: 50,
    priceOptimization: false,
    allowFeedInNegativePrice: false,
    ...overrides,
  });
}

describe('Controller', () => {
  describe('mode management', () => {
    it('starts in auto mode', () => {
      const ctrl = makeController();
      expect(ctrl.getMode()).toBe('auto');
    });

    it('can switch to manual mode', () => {
      const ctrl = makeController();
      ctrl.setMode('manual');
      expect(ctrl.getMode()).toBe('manual');
    });

    it('switches to manual on external setpoint change', () => {
      const ctrl = makeController();
      ctrl.handleExternalSetpointChange(-3000);
      expect(ctrl.getMode()).toBe('manual');
    });
  });

  describe('winter mode', () => {
    it('activates winter mode when forecast below threshold', () => {
      const ctrl = makeController();
      // 16 kWh * 1.2 = 19.2 kWh threshold, forecast is 15 kWh
      const result = ctrl.computeSetpoint(makeState(), makeForecast(15), 10);
      expect(result.mode).toBe('winter');
      expect(result.setpointW).toBe(0);
    });

    it('does not activate winter mode when forecast above threshold', () => {
      const ctrl = makeController();
      const result = ctrl.computeSetpoint(makeState(), makeForecast(25), 20);
      expect(result.mode).toBe('auto');
    });
  });

  describe('manual mode precedence', () => {
    it('manual mode takes precedence over winter mode on low-forecast days', () => {
      const ctrl = makeController();
      ctrl.setMode('manual');
      ctrl.applySetpoint(-3000);
      // Forecast 15 kWh is below winter threshold (16 * 1.2 = 19.2 kWh)
      const result = ctrl.computeSetpoint(makeState(), makeForecast(15), 10);
      expect(result.mode).toBe('manual');
      expect(result.setpointW).toBe(-3000);
      expect(result.reason).toBe('Manual mode active');
    });
  });

  describe('setpoint calculation', () => {
    it('returns 0 setpoint when SOC below minimum', () => {
      const ctrl = makeController();
      const state = makeState({ batterySoc: 15 }); // below 20%
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
      expect(result.reason).toContain('SOC');
    });

    it('returns 0 setpoint when PV production is below consumption', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 500, consumptionPower: 1000 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
    });

    it('feeds in surplus when battery will be full by end of day', () => {
      const ctrl = makeController();
      // SOC 50% -> need 8 kWh to fill. Remaining forecast 25 kWh. Lots of surplus.
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      // Setpoint should be negative (feed-in)
      expect(result.setpointW).toBeLessThan(0);
    });

    it('charges battery when insufficient forecast for full charge', () => {
      const ctrl = makeController();
      // SOC 20% -> need 12.8 kWh. Remaining forecast only 15 kWh. Tight.
      const state = makeState({ pvPower: 3000, consumptionPower: 1000, batterySoc: 20 });
      const result = ctrl.computeSetpoint(state, makeForecast(20), 15);
      // Should prioritize battery charging
      expect(result.setpointW).toBeGreaterThanOrEqual(0);
    });
  });

  describe('deadband', () => {
    it('does not change setpoint for small differences', () => {
      const ctrl = makeController({ deadbandW: 1500 });
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const result1 = ctrl.computeSetpoint(state, makeForecast(30), 25);
      ctrl.applySetpoint(result1.setpointW);

      // Small change in consumption
      const state2 = makeState({ pvPower: 8000, consumptionPower: 1500, batterySoc: 50 });
      const result2 = ctrl.computeSetpoint(state2, makeForecast(30), 25);
      expect(result2.setpointW).toBe(result1.setpointW);
      expect(result2.reason).toContain('deadband');
    });
  });

  describe('getLastResult', () => {
    it('returns null before any computation', () => {
      const ctrl = makeController();
      expect(ctrl.getLastResult()).toBeNull();
    });

    it('stores the last computed result', () => {
      const ctrl = makeController();
      const result = ctrl.computeSetpoint(makeState(), makeForecast(30), 25);
      expect(ctrl.getLastResult()).toEqual(result);
    });
  });

  describe('safety', () => {
    it('falls back to 0 when no MQTT data available', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 0, consumptionPower: 0, batterySoc: 0 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
    });
  });

  describe('price data passthrough', () => {
    it('accepts optional price data without error', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const prices = [
        { timestamp: Math.floor(Date.now() / 1000), price: 85 },
        { timestamp: Math.floor(Date.now() / 1000) + 3600, price: 120 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25, prices);
      expect(result.details).not.toBeNull();
    });

    it('works without price data (backwards compatible)', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.details).not.toBeNull();
    });
  });

  describe('forecast clipping analysis', () => {
    // Helper: create future forecast hours with given power values
    function makeFutureHours(powers: number[]): { timestamp: Date; powerW: number }[] {
      const now = new Date();
      return powers.map((powerW, i) => ({
        timestamp: new Date(now.getTime() + (i + 1) * 3600_000),
        powerW,
      }));
    }

    it('detects forced charge from clipping hours', () => {
      const ctrl = makeController(); // maxAcPowerW = 12000
      // Threshold = 12000 * 0.92 = 11040W
      // Two hours above threshold: 13000W and 12500W
      const hours = makeFutureHours([5000, 13000, 12500, 8000, 3000]);
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const forecast = makeForecast(30, hours);
      const result = ctrl.computeSetpoint(state, forecast, 25);

      expect(result.details).not.toBeNull();
      expect(result.details!.clippingHours).toBe(2);
      // forcedChargeKwh = (13000 - 11040) + (12500 - 11040) = 1960 + 1460 = 3420 Wh = 3.42 kWh
      expect(result.details!.forcedChargeKwh).toBeCloseTo(3.42, 1);
    });

    it('returns zero voluntary charge when clipping covers battery need', () => {
      const ctrl = makeController(); // maxAcPowerW = 12000, batteryCapacity = 16 kWh
      // SOC 90% -> need 1.6 kWh. Clipping well above that.
      // Threshold = 11040W. Hours at 14000W: forced = (14000-11040)*3 = 8880Wh = 8.88 kWh
      const hours = makeFutureHours([14000, 14000, 14000, 5000]);
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 90 });
      const forecast = makeForecast(30, hours);
      const result = ctrl.computeSetpoint(state, forecast, 25);

      expect(result.details).not.toBeNull();
      expect(result.details!.voluntaryChargeKwh).toBe(0);
      expect(result.details!.strategy).toContain('Clipping-Stunden');
    });

    it('calculates voluntary charge as remainder when clipping is partial', () => {
      const ctrl = makeController(); // batteryCapacity = 16 kWh
      // SOC 50% -> need 8 kWh. Clipping provides ~3.42 kWh (from above).
      // voluntaryChargeKwh = 8 - 3.42 = 4.58 kWh
      const hours = makeFutureHours([5000, 13000, 12500, 8000, 3000]);
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const forecast = makeForecast(30, hours);
      const result = ctrl.computeSetpoint(state, forecast, 25);

      expect(result.details).not.toBeNull();
      const batteryNeedKwh = (1.0 - 0.5) * 16; // 8 kWh
      const expectedVoluntary = batteryNeedKwh - result.details!.forcedChargeKwh;
      expect(result.details!.voluntaryChargeKwh).toBeCloseTo(expectedVoluntary, 1);
      expect(result.details!.strategy).toContain('freiwillig');
    });
  });

  describe('early clipping override', () => {
    it('activates when clipping before peak with high SOC', () => {
      const ctrl = makeController(); // maxAcPowerW = 12000, threshold = 11040
      const now = new Date();
      // Peak is 2 hours from now, current hour is before peak
      const hours = [
        { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 11000 },
        { timestamp: new Date(now.getTime() + 2 * 3600_000), powerW: 13000 }, // peak
        { timestamp: new Date(now.getTime() + 3 * 3600_000), powerW: 10000 },
        { timestamp: new Date(now.getTime() + 4 * 3600_000), powerW: 5000 },
      ];
      // PV already at 12200W (above 11040 threshold), SOC at 70%
      const state = makeState({ pvPower: 12200, consumptionPower: 1000, batterySoc: 70 });
      const forecast = makeForecast(50, hours);
      const result = ctrl.computeSetpoint(state, forecast, 30);

      expect(result.details).not.toBeNull();
      expect(result.details!.earlyClippingOverride).toBe(true);
      expect(result.details!.voluntaryChargeKwh).toBe(0);
      expect(result.details!.strategy).toContain('Früh-Clipping');
    });

    it('does not activate when SOC is too low', () => {
      const ctrl = makeController();
      const now = new Date();
      const hours = [
        { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 11000 },
        { timestamp: new Date(now.getTime() + 2 * 3600_000), powerW: 13000 }, // peak
      ];
      // PV clipping but SOC only 40%
      const state = makeState({ pvPower: 12200, consumptionPower: 1000, batterySoc: 40 });
      const forecast = makeForecast(50, hours);
      const result = ctrl.computeSetpoint(state, forecast, 30);

      expect(result.details).not.toBeNull();
      expect(result.details!.earlyClippingOverride).toBe(false);
    });

    it('does not activate after the peak hour', () => {
      const ctrl = makeController();
      const now = new Date();
      // Peak is in the past (1 hour ago)
      const hours = [
        { timestamp: new Date(now.getTime() - 1 * 3600_000), powerW: 13000 }, // peak (past)
        { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 10000 },
        { timestamp: new Date(now.getTime() + 2 * 3600_000), powerW: 5000 },
      ];
      const state = makeState({ pvPower: 12200, consumptionPower: 1000, batterySoc: 70 });
      const forecast = makeForecast(50, hours);
      const result = ctrl.computeSetpoint(state, forecast, 30);

      expect(result.details).not.toBeNull();
      expect(result.details!.earlyClippingOverride).toBe(false);
    });
  });

  describe('battery full with high PV', () => {
    it('limits charge to 2kW when SOC >= 99 and surplus > 5kW', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 10000, consumptionPower: 1000, batterySoc: 99 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);

      expect(result.details).not.toBeNull();
      expect(result.details!.desiredChargePowerW).toBe(2000);
      // Feed-in should be surplus - 2000 = 7000W
      expect(result.details!.feedInW).toBe(7000);
      expect(result.setpointW).toBeLessThan(0); // negative = feed-in
      expect(result.details!.strategy).toContain('Erhaltungsladung');
    });

    it('self-regulates when SOC >= 99 and surplus <= 5kW', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 4000, consumptionPower: 1000, batterySoc: 99 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);

      expect(result.setpointW).toBe(0);
      expect(result.details!.desiredChargePowerW).toBe(0);
      expect(result.details!.goal).toContain('Anlage regelt selbst');
    });

    it('self-regulates at 100% SOC even with high PV', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 10000, consumptionPower: 1000, batterySoc: 100 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);

      expect(result.setpointW).toBe(0);
      expect(result.details!.desiredChargePowerW).toBe(0);
      expect(result.details!.goal).toContain('Anlage regelt selbst');
    });
  });

  describe('clipping risk bypasses price optimization', () => {
    it('does not reduce feed-in when currently clipping even at low price', () => {
      const ctrl = makeController({ priceOptimization: true }); // maxAcPowerW = 12000
      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);
      const forecastHours = [
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 8000 },
      ];
      // PV 13400W > maxAcPowerW 12000 → isClippingRisk = true
      const state = makeState({ pvPower: 13400, consumptionPower: 1300, batterySoc: 50 });
      // Low price → factor 0.5 would normally halve feed-in
      const lowPrices = [
        { timestamp: nowSec, price: 20 },
        { timestamp: nowSec + 3600, price: 150 },
        { timestamp: nowSec + 7200, price: 150 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, lowPrices);

      expect(result.details).not.toBeNull();
      expect(result.details!.isClippingRisk).toBe(true);
      // Price optimization should be reported but NOT applied to reduce feed-in
      // Setpoint should still be significantly negative (high feed-in)
      expect(result.setpointW).toBeLessThan(-2000);
    });
  });

  describe('price optimization — schedule-based', () => {
    it('maximizes feed-in during expensive hours (feed-in hour)', () => {
      const ctrl = makeController({ priceOptimization: true });

      const now = new Date();
      now.setMinutes(0, 0, 0);
      const nowSec = Math.floor(now.getTime() / 1000);
      // 5 future hours of production — plenty of surplus
      const forecastHours = [
        { timestamp: new Date(now.getTime()), powerW: 5000 }, // current hour (expensive)
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 }, // cheap
        { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 8000 }, // cheap
        { timestamp: new Date(now.getTime() + 4 * 3600000), powerW: 4000 },
        { timestamp: new Date(now.getTime() + 5 * 3600000), powerW: 3000 },
      ];
      const state = makeState({ pvPower: 5000, consumptionPower: 1000, batterySoc: 50 });

      // Current hour is most expensive — should be a feed-in hour
      const prices = [
        { timestamp: nowSec, price: 200 },       // NOW: expensive
        { timestamp: nowSec + 3600, price: 100 },
        { timestamp: nowSec + 7200, price: 50 },  // cheap
        { timestamp: nowSec + 10800, price: 50 }, // cheap
        { timestamp: nowSec + 14400, price: 80 },
        { timestamp: nowSec + 18000, price: 80 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(50, forecastHours), 36, prices);

      expect(result.details).not.toBeNull();
      expect(result.details!.priceOptimization).toBeDefined();
      expect(result.details!.priceOptimization!.mode).toBe('feed-in');
      // No voluntary charging during feed-in hour
      expect(result.details!.voluntaryChargeKwh).toBe(0);
      expect(result.details!.desiredChargePowerW).toBe(0);
      // Should feed in everything (negative setpoint)
      expect(result.setpointW).toBeLessThan(0);
    });

    it('charges during cheap hours (charge hour)', () => {
      const ctrl = makeController({ priceOptimization: true });

      const now = new Date();
      now.setMinutes(0, 0, 0);
      const nowSec = Math.floor(now.getTime() / 1000);
      const forecastHours = [
        { timestamp: new Date(now.getTime()), powerW: 8000 }, // current hour (cheap)
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 4000 },
        { timestamp: new Date(now.getTime() + 4 * 3600000), powerW: 3000 },
      ];
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });

      // Current hour is cheapest
      const prices = [
        { timestamp: nowSec, price: 30 },        // NOW: cheap → charge hour
        { timestamp: nowSec + 3600, price: 150 },
        { timestamp: nowSec + 7200, price: 150 },
        { timestamp: nowSec + 10800, price: 80 },
        { timestamp: nowSec + 14400, price: 80 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(50, forecastHours), 31, prices);

      expect(result.details).not.toBeNull();
      expect(result.details!.priceOptimization).toBeDefined();
      expect(result.details!.priceOptimization!.mode).toBe('charge');
      // Should be charging the battery
      expect(result.details!.desiredChargePowerW).toBeGreaterThan(0);
    });

    it('stops feed-in during negative prices and charges everything', () => {
      const ctrl = makeController({ priceOptimization: true });

      const now = new Date();
      now.setMinutes(0, 0, 0);
      const nowSec = Math.floor(now.getTime() / 1000);
      const forecastHours = [
        { timestamp: new Date(now.getTime()), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
      ];
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const prices = [
        { timestamp: nowSec, price: -10 },
        { timestamp: nowSec + 3600, price: 80 },
        { timestamp: nowSec + 7200, price: 80 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 24, prices);

      expect(result.setpointW).toBe(0);
      expect(result.details!.priceOptimization).toBeDefined();
      expect(result.details!.priceOptimization!.mode).toBe('negative');
      // Should charge everything at negative price
      expect(result.details!.desiredChargePowerW).toBe(7000); // surplus = 8000-1000
    });

    it('does nothing when priceOptimization is disabled', () => {
      const ctrl = makeController(); // priceOptimization defaults to false

      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);
      const forecastHours = [
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
      ];
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const prices = [
        { timestamp: nowSec, price: -10 },
        { timestamp: nowSec + 3600, price: 80 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 16, prices);

      // Should NOT have priceOptimization in details (feature disabled)
      expect(result.details!.priceOptimization).toBeUndefined();
    });

    it('still picks negative price as charge hour when allowFeedInNegativePrice is true', () => {
      const ctrl = makeController({ priceOptimization: true, allowFeedInNegativePrice: true });

      const now = new Date();
      now.setMinutes(0, 0, 0);
      const nowSec = Math.floor(now.getTime() / 1000);
      const forecastHours = [
        { timestamp: new Date(now.getTime()), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 },
      ];
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      // Negative price now, positive later — negative is cheapest
      const prices = [
        { timestamp: nowSec, price: -10 },
        { timestamp: nowSec + 3600, price: 200 },
        { timestamp: nowSec + 7200, price: 200 },
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 24, prices);

      expect(result.details).not.toBeNull();
      expect(result.details!.priceOptimization).toBeDefined();
      // Current slot is cheapest → should still be a charge hour
      expect(result.details!.priceOptimization!.mode).toBe('charge');
      expect(result.details!.desiredChargePowerW).toBeGreaterThan(0);
    });

    it('picks cheapest hours for charging regardless of position', () => {
      const ctrl = makeController({ priceOptimization: true });

      const now = new Date();
      now.setMinutes(0, 0, 0);
      const nowSec = Math.floor(now.getTime() / 1000);
      // Current hour is cheap, later hours are expensive
      const forecastHours = [
        { timestamp: new Date(now.getTime()), powerW: 8000 },       // current: cheap
        { timestamp: new Date(now.getTime() + 1 * 3600000), powerW: 8000 }, // expensive
        { timestamp: new Date(now.getTime() + 2 * 3600000), powerW: 8000 }, // expensive
        { timestamp: new Date(now.getTime() + 3 * 3600000), powerW: 5000 }, // last hour, expensive
      ];
      // SOC 50% → need 8 kWh, plenty of forecast
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const prices = [
        { timestamp: nowSec, price: 30 },         // cheap → charge hour
        { timestamp: nowSec + 3600, price: 200 },  // expensive → feed-in
        { timestamp: nowSec + 7200, price: 200 },  // expensive → feed-in
        { timestamp: nowSec + 10800, price: 200 }, // expensive → feed-in (even last hour)
      ];
      const result = ctrl.computeSetpoint(state, makeForecast(50, forecastHours), 29, prices);

      expect(result.details).not.toBeNull();
      // Current hour is cheapest → charge hour
      expect(result.details!.priceOptimization!.mode).toBe('charge');
      expect(result.details!.desiredChargePowerW).toBeGreaterThan(0);
    });
  });

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
        forecastCorrectionFactor: 1,
        negativeStreak6hActive: false,
        negativeStreak6hDeductionCent: 0,
        debug: { batteryNeedKwh: 0, totalClippingKwh: 0, voluntaryNeedKwh: 0, totalNetSurplusKwh: 0, surplusRatio: Infinity, tightForecast: false, priceOptCandidateCount: 0 },
      };
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25, [], plan);
      expect(result.details).not.toBeNull();
    });

    it('uses plan slot chargePowerW and feedInPowerW when plan is provided', () => {
      const ctrl = makeController();
      const now = new Date();
      const slotTime = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
      // SOC 90% → only 1.6 kWh needed, plan net surplus easily exceeds 1.5x threshold
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 90 });
      const forecastHours = [
        { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 8000 },
        { timestamp: new Date(now.getTime() + 2 * 3600_000), powerW: 8000 },
      ];

      // Build plan with enough slots so net surplus > 1.5x battery need
      // SOC 90% → 1.6 kWh needed, each slot yields 7000*0.25/1000=1.75 kWh, 2 slots = 3.5 kWh
      const slot2Time = new Date(slotTime.getTime() + 900_000);
      const plan: ChargePlan = {
        slots: [
          {
            hour: slotTime.getHours(),
            minute: slotTime.getMinutes(),
            timestamp: slotTime.toISOString(),
            chargePowerW: 2000,
            feedInPowerW: 5000,
            forecastW: 8000,
            estimatedSoc: 92,
            revenueFixedCent: 0,
            revenueMarketCent: 0,
            clippingW: 0,
            consumptionW: 300,
            priceMwh: null,
          },
          {
            hour: slot2Time.getHours(),
            minute: slot2Time.getMinutes(),
            timestamp: slot2Time.toISOString(),
            chargePowerW: 1000,
            feedInPowerW: 6000,
            forecastW: 8000,
            estimatedSoc: 94,
            revenueFixedCent: 0,
            revenueMarketCent: 0,
            clippingW: 0,
            consumptionW: 300,
            priceMwh: null,
          },
        ],
        intervalMinutes: 15,
        totalFeedInKwh: 5,
        totalRevenueFixedCent: 35,
        totalRevenueMarketCent: 25,
        feedInRateCentPerKwh: 7,
        estimatedFullHour: null,
        currentSoc: 90,
        forecastCorrectionFactor: 1,
        negativeStreak6hActive: false,
        negativeStreak6hDeductionCent: 0,
        debug: { batteryNeedKwh: 0, totalClippingKwh: 0, voluntaryNeedKwh: 0, totalNetSurplusKwh: 0, surplusRatio: Infinity, tightForecast: false, priceOptCandidateCount: 0 },
      };

      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
      expect(result.details).not.toBeNull();
      expect(result.setpointW).toBeLessThan(0);
      expect(result.details!.strategy).toContain('Ladeplan');
    });

    it('scales plan values proportionally to actual surplus', () => {
      const ctrl = makeController();
      const now = new Date();
      const slotTime = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
      // SOC 90% → only 1.6 kWh needed, plan net surplus easily exceeds 1.5x threshold
      const state = makeState({ pvPower: 4500, consumptionPower: 1000, batterySoc: 90 });
      const forecastHours = [
        { timestamp: new Date(now.getTime() + 1 * 3600_000), powerW: 8000 },
      ];

      const slot2Time = new Date(slotTime.getTime() + 900_000);
      const plan: ChargePlan = {
        slots: [
          {
            hour: slotTime.getHours(),
            minute: slotTime.getMinutes(),
            timestamp: slotTime.toISOString(),
            chargePowerW: 2000,
            feedInPowerW: 5000,
            forecastW: 8000,
            estimatedSoc: 92,
            revenueFixedCent: 0,
            revenueMarketCent: 0,
            clippingW: 0,
            consumptionW: 300,
            priceMwh: null,
          },
          {
            hour: slot2Time.getHours(),
            minute: slot2Time.getMinutes(),
            timestamp: slot2Time.toISOString(),
            chargePowerW: 1000,
            feedInPowerW: 6000,
            forecastW: 8000,
            estimatedSoc: 94,
            revenueFixedCent: 0,
            revenueMarketCent: 0,
            clippingW: 0,
            consumptionW: 300,
            priceMwh: null,
          },
        ],
        intervalMinutes: 15,
        totalFeedInKwh: 5,
        totalRevenueFixedCent: 35,
        totalRevenueMarketCent: 25,
        feedInRateCentPerKwh: 7,
        estimatedFullHour: null,
        currentSoc: 90,
        forecastCorrectionFactor: 1,
        negativeStreak6hActive: false,
        negativeStreak6hDeductionCent: 0,
        debug: { batteryNeedKwh: 0, totalClippingKwh: 0, voluntaryNeedKwh: 0, totalNetSurplusKwh: 0, surplusRatio: Infinity, tightForecast: false, priceOptCandidateCount: 0 },
      };

      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
      expect(result.details).not.toBeNull();
      // Actual surplus = 3500W, plan surplus = 7000W
      // Charging is protected: min(planCharge=2000, surplus=3500) = 2000
      // Feed-in gets the rest: 3500 - 2000 = 1500
      expect(result.details!.desiredChargePowerW).toBe(2000);
      expect(result.details!.feedInW).toBe(1500);
    });

    it('falls back to own logic when plan has no matching slot', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const forecastHours = [
        { timestamp: new Date(Date.now() + 1 * 3600_000), powerW: 8000 },
      ];

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
          clippingW: 0,
          consumptionW: 300,
        }],
        intervalMinutes: 15,
        totalFeedInKwh: 5,
        totalRevenueFixedCent: 35,
        totalRevenueMarketCent: 25,
        feedInRateCentPerKwh: 7,
        estimatedFullHour: null,
        currentSoc: 50,
        forecastCorrectionFactor: 1,
        negativeStreak6hActive: false,
        negativeStreak6hDeductionCent: 0,
        debug: { batteryNeedKwh: 0, totalClippingKwh: 0, voluntaryNeedKwh: 0, totalNetSurplusKwh: 0, surplusRatio: Infinity, tightForecast: false, priceOptCandidateCount: 0 },
      };

      const result = ctrl.computeSetpoint(state, makeForecast(30, forecastHours), 25, [], plan);
      expect(result.details).not.toBeNull();
      expect(result.details!.strategy).not.toContain('Ladeplan');
    });
  });
});
