import { energyEvents, type MorningBriefingEvent, type ProductionEndedEvent } from './energy-events.js';
import type { Forecast } from './vrm-service.js';
import type { ChargePlan } from './charge-plan.js';
import type { PriceEntry } from './server.js';
import type { GridHistoryService } from './grid-history-service.js';

const PV_THRESHOLD_W = 50;
const SLOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const EVENING_DELAY_MS = 15 * 60 * 1000; // 15 minutes below threshold
const EARLIEST_EVENING_HOUR = 14; // Don't trigger evening event before 14:00

export interface PvCheckContext {
  pvPowerW: number;
  batterySoc: number;
  forecast: Forecast;
  chargePlan: ChargePlan | null;
  prices: PriceEntry[];
  gridHistoryService?: GridHistoryService;
  pvHistoryService?: GridHistoryService;
  feedInRateCentPerKwh: number;
}

export class PvTracker {
  private productionSlotCount = 0;
  private lastSlotMs = 0;
  private belowThresholdSince: number | null = null;
  private morningSent = false;
  private eveningSent = false;
  private currentDate: string;
  private hadProductionToday = false;

  constructor() {
    this.currentDate = this.todayStr();
  }

  check(ctx: PvCheckContext): void {
    this.resetIfNewDay();

    const now = Date.now();
    const pvAboveThreshold = ctx.pvPowerW > PV_THRESHOLD_W;

    // Track that we had production today (for evening event eligibility)
    if (pvAboveThreshold) {
      this.hadProductionToday = true;
    }

    // --- Morning detection: count 15-min slots with PV production ---
    if (pvAboveThreshold && !this.morningSent) {
      const currentSlotMs = Math.floor(now / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
      if (currentSlotMs > this.lastSlotMs) {
        this.productionSlotCount++;
        this.lastSlotMs = currentSlotMs;
      }

      if (this.productionSlotCount >= 4) {
        this.morningSent = true;
        if (ctx.chargePlan) {
          const event: MorningBriefingEvent = {
            forecast: ctx.forecast,
            chargePlan: ctx.chargePlan,
            prices: ctx.prices,
            currentSoc: ctx.batterySoc,
          };
          console.log('[pv-tracker] Morning briefing triggered');
          energyEvents.emit('pv:morning-briefing', event);
        }
      }
    }

    // --- Evening detection: PV below threshold for >15min after 14:00 ---
    if (!this.eveningSent && this.hadProductionToday) {
      const berlinHour = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        hour12: false,
      });
      const hour = parseInt(berlinHour);

      if (!pvAboveThreshold && hour >= EARLIEST_EVENING_HOUR) {
        if (this.belowThresholdSince === null) {
          this.belowThresholdSince = now;
        } else if (now - this.belowThresholdSince >= EVENING_DELAY_MS) {
          this.eveningSent = true;
          this.emitProductionEnded(ctx);
        }
      } else if (pvAboveThreshold) {
        // Reset timer if PV comes back above threshold
        this.belowThresholdSince = null;
      }
    }
  }

  private emitProductionEnded(ctx: PvCheckContext): void {
    // Calculate actual PV yield from PV history
    let totalYieldKwh = 0;
    if (ctx.pvHistoryService) {
      const slots = ctx.pvHistoryService.getSlots();
      for (const slot of Object.values(slots)) {
        if (slot.avgPowerW > 0) {
          totalYieldKwh += Math.abs(slot.energyWh) / 1000;
        }
      }
    }

    // Calculate actual feed-in from grid history (negative power = export)
    let feedInKwh = 0;
    const gridSlots = ctx.gridHistoryService?.getSlots() ?? {};
    for (const slot of Object.values(gridSlots)) {
      if (slot.avgPowerW < 0) {
        feedInKwh += Math.abs(slot.energyWh) / 1000;
      }
    }

    // Actual revenue from historical feed-in
    // Fixed revenue: total actual feed-in × fixed rate
    const revenueFixedCent = feedInKwh * ctx.feedInRateCentPerKwh;

    // Market revenue: match grid history slots to hourly prices
    let revenueMarketCent = 0;
    if (ctx.prices.length > 0) {
      // Build today's date in Europe/Berlin for slot→timestamp conversion
      const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
      for (const [slotKey, slot] of Object.entries(gridSlots)) {
        if (slot.avgPowerW >= 0) continue; // only feed-in (negative grid)
        const slotFeedInKwh = Math.abs(slot.energyWh) / 1000;
        // Convert slot key (HH:MM) to unix timestamp for price lookup
        const slotDate = new Date(`${todayParts}T${slotKey}:00`);
        const slotTimestampSec = Math.floor(slotDate.getTime() / 1000);
        // Find matching price (last entry whose timestamp <= slot time)
        let slotPrice: number | null = null;
        for (let i = ctx.prices.length - 1; i >= 0; i--) {
          if (ctx.prices[i].timestamp <= slotTimestampSec) {
            slotPrice = ctx.prices[i].price;
            break;
          }
        }
        if (slotPrice != null) {
          // price is in EUR/MWh → divide by 10 to get cent/kWh
          revenueMarketCent += slotFeedInKwh * (slotPrice / 10);
        }
      }
    }

    const event: ProductionEndedEvent = {
      totalYieldKwh: Math.round(totalYieldKwh * 100) / 100,
      feedInKwh: Math.round(feedInKwh * 100) / 100,
      finalSoc: ctx.batterySoc,
      revenueFixedCent: Math.round(revenueFixedCent * 100) / 100,
      revenueMarketCent: Math.round(revenueMarketCent * 100) / 100,
      forecastCorrectionFactor: ctx.chargePlan?.forecastCorrectionFactor ?? 1,
    };

    console.log('[pv-tracker] Production ended — sending summary (actual values)');
    energyEvents.emit('pv:production-ended', event);
  }

  private resetIfNewDay(): void {
    const today = this.todayStr();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.productionSlotCount = 0;
      this.lastSlotMs = 0;
      this.belowThresholdSince = null;
      this.morningSent = false;
      this.eveningSent = false;
      this.hadProductionToday = false;
      console.log('[pv-tracker] New day — reset');
    }
  }

  private todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  }
}
