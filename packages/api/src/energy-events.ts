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

export interface SwitchedToManualEvent {
  trigger: 'external' | 'api';
  setpointW: number | null;
}

export interface ManualDischargeEvent {
  batterySoc: number;
  batteryPowerW: number;
}

export interface AutoRestoredEvent {
  batterySoc: number;
}

export interface WallboxChargingStartedEvent {
  phases: 1 | 3;
  currentA: number;
  surplusW: number;
  capped: boolean;
}

export interface WallboxChargingStoppedEvent {
  surplusW: number;
  capped: boolean;
}

export interface WallboxPhasesSwitchedEvent {
  from: 1 | 3;
  to: 1 | 3;
  currentA: number;
  surplusW: number;
  capped: boolean;
}

interface EnergyEventMap {
  'pv:morning-briefing': [MorningBriefingEvent];
  'pv:production-ended': [ProductionEndedEvent];
  'mppt:temperature-high': [TemperatureHighEvent];
  'controller:switched-to-manual': [SwitchedToManualEvent];
  'controller:manual-discharge': [ManualDischargeEvent];
  'controller:auto-restored': [AutoRestoredEvent];
  'wallbox:charging-started': [WallboxChargingStartedEvent];
  'wallbox:charging-stopped': [WallboxChargingStoppedEvent];
  'wallbox:phases-switched': [WallboxPhasesSwitchedEvent];
  'wallbox:vehicle-plugged': [];
  'wallbox:vehicle-unplugged': [];
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
