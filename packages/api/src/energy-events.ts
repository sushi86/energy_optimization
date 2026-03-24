import { EventEmitter } from 'node:events';
import type { Forecast } from './vrm-service.js';
import type { ChargePlan } from './charge-plan.js';
import type { PriceEntry } from './server.js';

export interface MorningBriefingEvent {
  forecast: Forecast;
  chargePlan: ChargePlan;
  prices: PriceEntry[];
  currentSoc: number;
}

export interface ProductionEndedEvent {
  totalYieldKwh: number;
  feedInKwh: number;
  finalSoc: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
  forecastCorrectionFactor: number;
}

export interface TemperatureHighEvent {
  temperatureC: number;
}

interface EnergyEventMap {
  'pv:morning-briefing': [MorningBriefingEvent];
  'pv:production-ended': [ProductionEndedEvent];
  'mppt:temperature-high': [TemperatureHighEvent];
}

class EnergyEventEmitter extends EventEmitter {
  override emit<K extends keyof EnergyEventMap>(event: K, ...args: EnergyEventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof EnergyEventMap>(event: K, listener: (...args: EnergyEventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const energyEvents = new EnergyEventEmitter();
