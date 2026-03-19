import { MqttService } from './mqtt-service.js';
import { VrmService } from './vrm-service.js';
import { Controller } from './controller.js';
import { ForecastSolarService } from './forecast-solar-service.js';
import { computeEnsembleForecast } from './ensemble-forecast.js';
import { computeChargePlan } from './charge-plan.js';
import { loadPvSettings, savePvSettings, type PvSettings } from './pv-settings.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'node:fs';
import type { PvTracker } from './pv-tracker.js';
import type { GridHistoryService } from './grid-history-service.js';

export interface AppStateOptions {
  mqttUrl: string;
  deviceId: string;
  vrmToken: string;
  vrmSiteId: string;
  batteryCapacityKwh: number;
  minSocPercent: number;
  targetSocPercent: number;
  maxAcPowerW: number;
  winterModeThresholdFactor: number;
  regulationIntervalMs: number;
  largeChangeThresholdW: number;
  deadbandW: number;
  priceOptimization: boolean;
  allowFeedInNegativePrice: boolean;
  feedInRateCentPerKwh: number;
  preferredMaxChargeW: number;
  forecastCorrectionOverride: number | null;
  consumptionDayW: number;
  consumptionNightW: number;
  multiplusRatedPowerW: number;
  /** Optional override for the data directory (used by tests for isolation) */
  dataDir?: string;
}

export class AppState {
  readonly mqtt: MqttService;
  readonly vrm: VrmService;
  readonly controller: Controller;
  readonly forecastSolar: ForecastSolarService;
  private config: AppStateOptions;
  private regulationTimer: ReturnType<typeof setInterval> | null = null;
  private forecastSolarTimer: ReturnType<typeof setInterval> | null = null;
  private pvSettingsPath: string;
  private configOverridesPath: string;
  private lastRegulationTime: Date = new Date();
  private lastRegulationDate: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  /** Samples of raw correction factors within each 15-min slot for averaging */
  private correctionSamples: Array<{ slotMs: number; factor: number }> = [];
  private pvTracker: PvTracker | null = null;
  private gridHistoryForTracker: GridHistoryService | null = null;
  private pvHistoryForTracker: GridHistoryService | null = null;

  private constructor(options: AppStateOptions) {
    this.config = { ...options };
    this.mqtt = new MqttService({
      url: options.mqttUrl,
      deviceId: options.deviceId,
      largeChangeThresholdW: options.largeChangeThresholdW,
    });
    this.vrm = new VrmService({
      token: options.vrmToken,
      siteId: options.vrmSiteId,
    });
    this.controller = new Controller({
      batteryCapacityKwh: options.batteryCapacityKwh,
      minSocPercent: options.minSocPercent,
      targetSocPercent: options.targetSocPercent,
      maxAcPowerW: options.maxAcPowerW,
      winterModeThresholdFactor: options.winterModeThresholdFactor,
      deadbandW: options.deadbandW,
      priceOptimization: options.priceOptimization ?? false,
      allowFeedInNegativePrice: options.allowFeedInNegativePrice ?? false,
    });
    const dataDir = options.dataDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../data');
    this.pvSettingsPath = resolve(dataDir, 'pv-settings.json');
    this.configOverridesPath = resolve(dataDir, 'config-overrides.json');

    // Apply persisted config overrides (from previous sessions)
    this.loadConfigOverrides();

    const pvSettings = loadPvSettings(this.pvSettingsPath);
    this.forecastSolar = new ForecastSolarService(pvSettings);
  }

  static async create(options: AppStateOptions): Promise<AppState> {
    const state = new AppState(options);
    await state.mqtt.start();

    state.mqtt.on('externalSetpointChange', (value: number) => {
      state.controller.handleExternalSetpointChange(value);
    });

    state.mqtt.on('largeChange', () => {
      void state.regulate();
    });

    return state;
  }

  startRegulation(): void {
    // Run immediately so the UI has a plan from the start
    void this.regulate();
    this.regulationTimer = setInterval(() => {
      void this.regulate();
    }, this.config.regulationIntervalMs);
    this.vrm.startAutoRefresh();
    // forecast.solar refresh every 30 minutes
    void this.forecastSolar.refresh();
    this.forecastSolarTimer = setInterval(() => {
      void this.forecastSolar.refresh();
    }, 30 * 60 * 1000);
  }

  getRegulationInfo(): { lastRegulationTime: Date; intervalMs: number } {
    return { lastRegulationTime: this.lastRegulationTime, intervalMs: this.config.regulationIntervalMs };
  }

  async regulate(): Promise<void> {
    this.lastRegulationTime = new Date();

    // Reset manual forecast correction override at midnight
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    if (todayStr !== this.lastRegulationDate) {
      this.lastRegulationDate = todayStr;
      if (this.config.forecastCorrectionOverride != null) {
        console.log('[regulate] New day — resetting forecast correction override to auto');
        this.config.forecastCorrectionOverride = null;
        this.correctionSamples = [];
        this.saveConfigOverrides();
      }
    }

    const systemState = this.mqtt.getState();
    const pvSettings = loadPvSettings(this.pvSettingsPath);
    const emptyForecast = { hours: [], totalKwh: 0, intervalHours: 1 };
    const vrmForecast = pvSettings.vrmForecastEnabled ? this.vrm.getForecast() : emptyForecast;
    const solarForecast = pvSettings.forecastSolarEnabled ? this.forecastSolar.getForecast() : emptyForecast;
    const forecast = computeEnsembleForecast(vrmForecast, solarForecast);
    const remainingKwh = this.vrm.getRemainingForecastKwh();
    // Fetch prices (optional — don't block regulation if it fails)
    let prices: Array<{ timestamp: number; price: number | null }> = [];
    try {
      const { fetchPrices, setLastPriceError } = await import('./server.js');
      prices = await fetchPrices();
      setLastPriceError(null);
    } catch (e) {
      try {
        const { setLastPriceError } = await import('./server.js');
        setLastPriceError((e as Error).message);
      } catch { /* ignore */ }
    }

    // --- Auto correction factor averaging over 15-min slot ---
    // When in auto mode, compute the instantaneous factor, accumulate samples
    // within the current 15-min slot, and pass the average to the charge plan.
    let averagedCorrectionOverride = this.config.forecastCorrectionOverride;
    if (this.config.forecastCorrectionOverride == null && systemState.pvPower != null && forecast.hours.length > 0) {
      const ih = forecast.intervalHours;
      const nowMs = Date.now();
      const intervalMs = ih * 3600 * 1000;
      const currentSlotMs = Math.floor(nowMs / intervalMs) * intervalMs;
      const futureHours = forecast.hours.filter(h => h.timestamp.getTime() >= currentSlotMs);
      if (futureHours.length > 0) {
        const currentForecastW = futureHours[0].powerW;
        const peakForecastW = Math.max(...futureHours.map(h => h.powerW));
        const relevantPowerW = Math.max(currentForecastW, systemState.pvPower);
        const isStableProduction = relevantPowerW > 500 && relevantPowerW >= peakForecastW * 0.5;
        if (isStableProduction) {
          const rawFactor = Math.min(2, Math.max(0.1, systemState.pvPower / currentForecastW));
          // Add sample and discard samples from previous slots
          this.correctionSamples = this.correctionSamples.filter(s => s.slotMs === currentSlotMs);
          this.correctionSamples.push({ slotMs: currentSlotMs, factor: rawFactor });
          // Pass the averaged factor (null → auto logic in charge-plan will be skipped via override)
          const avg = this.correctionSamples.reduce((sum, s) => sum + s.factor, 0) / this.correctionSamples.length;
          averagedCorrectionOverride = Math.round(avg * 100) / 100;
        }
      }
    }

    let chargePlan = null;
    try {
      chargePlan = computeChargePlan(forecast, prices, {
        currentSoc: systemState.batterySoc,
        batteryCapacityKwh: this.config.batteryCapacityKwh,
        targetSocPercent: this.config.targetSocPercent,
        minSocPercent: this.config.minSocPercent,
        maxAcPowerW: this.config.maxAcPowerW,
        feedInRateCentPerKwh: this.config.feedInRateCentPerKwh,
        consumptionDayW: this.config.consumptionDayW,
        consumptionNightW: this.config.consumptionNightW,
        priceOptimization: this.config.priceOptimization,
        allowFeedInNegativePrice: this.config.allowFeedInNegativePrice,
        preferredMaxChargeW: this.config.preferredMaxChargeW,
        actualPvPowerW: systemState.pvPower,
        forecastCorrectionOverride: averagedCorrectionOverride,
      });
    } catch { /* plan is optional */ }

    // Apply forecast correction factor to remaining kWh so it matches the corrected PV forecast
    const correctionFactor = chargePlan?.forecastCorrectionFactor ?? 1;
    const correctedRemainingKwh = remainingKwh * correctionFactor;

    const result = this.controller.computeSetpoint(systemState, forecast, correctedRemainingKwh, prices, chargePlan ?? undefined);

    // Check PV tracker for notification events
    if (this.pvTracker) {
      try {
        this.pvTracker.check({
          pvPowerW: systemState.pvPower,
          batterySoc: systemState.batterySoc,
          forecast,
          chargePlan,
          prices,
          gridHistoryService: this.gridHistoryForTracker ?? undefined,
          pvHistoryService: this.pvHistoryForTracker ?? undefined,
          feedInRateCentPerKwh: this.config.feedInRateCentPerKwh,
        });
      } catch (e) {
        console.error('[pv-tracker] check error:', (e as Error).message);
      }
    }

    if (result.mode === 'manual') return;

    const prev = this.controller.getLastResult();
    this.controller.applySetpoint(result.setpointW);

    if (result.mode === 'winter') {
      if (!prev || prev.mode !== 'winter') {
        console.log(`[regulate] Winter mode active — ${result.reason}`);
      }
    } else {
      if (!prev || prev.setpointW !== result.setpointW) {
        console.log(`[regulate] Setpoint: ${result.setpointW}W | PV: ${systemState.pvPower}W | Consumption: ${systemState.consumptionPower}W | SOC: ${systemState.batterySoc}% | ${result.reason}`);
      }
      await this.mqtt.setGridSetpoint(result.setpointW);
    }
  }

  setPvTracker(tracker: PvTracker, gridHistory: GridHistoryService, pvHistory?: GridHistoryService): void {
    this.pvTracker = tracker;
    this.gridHistoryForTracker = gridHistory;
    this.pvHistoryForTracker = pvHistory ?? null;
  }

  getConfig(): AppStateOptions {
    return { ...this.config };
  }

  updateConfig(updates: Partial<AppStateOptions>): AppStateOptions {
    if ('forecastCorrectionOverride' in updates) {
      this.correctionSamples = [];
    }
    Object.assign(this.config, updates);
    this.controller.updateConfig({
      batteryCapacityKwh: this.config.batteryCapacityKwh,
      minSocPercent: this.config.minSocPercent,
      targetSocPercent: this.config.targetSocPercent,
      maxAcPowerW: this.config.maxAcPowerW,
      winterModeThresholdFactor: this.config.winterModeThresholdFactor,
      deadbandW: this.config.deadbandW,
      priceOptimization: this.config.priceOptimization ?? false,
      allowFeedInNegativePrice: this.config.allowFeedInNegativePrice ?? false,
    });
    this.saveConfigOverrides();
    return { ...this.config };
  }

  private loadConfigOverrides(): void {
    try {
      const content = fs.readFileSync(this.configOverridesPath, 'utf-8');
      const overrides = JSON.parse(content) as Partial<AppStateOptions>;
      Object.assign(this.config, overrides);
      this.controller.updateConfig({
        batteryCapacityKwh: this.config.batteryCapacityKwh,
        minSocPercent: this.config.minSocPercent,
        targetSocPercent: this.config.targetSocPercent,
        maxAcPowerW: this.config.maxAcPowerW,
        winterModeThresholdFactor: this.config.winterModeThresholdFactor,
        deadbandW: this.config.deadbandW,
        priceOptimization: this.config.priceOptimization ?? false,
        allowFeedInNegativePrice: this.config.allowFeedInNegativePrice ?? false,
      });
      console.log('[config] Loaded overrides from disk:', Object.keys(overrides).join(', '));
    } catch {
      // No overrides file yet — use defaults
    }
  }

  private saveConfigOverrides(): void {
    // Only persist settings that can be changed at runtime (not connection strings etc.)
    const persistable: Partial<AppStateOptions> = {
      batteryCapacityKwh: this.config.batteryCapacityKwh,
      minSocPercent: this.config.minSocPercent,
      targetSocPercent: this.config.targetSocPercent,
      maxAcPowerW: this.config.maxAcPowerW,
      winterModeThresholdFactor: this.config.winterModeThresholdFactor,
      deadbandW: this.config.deadbandW,
      priceOptimization: this.config.priceOptimization,
      allowFeedInNegativePrice: this.config.allowFeedInNegativePrice,
      feedInRateCentPerKwh: this.config.feedInRateCentPerKwh,
      preferredMaxChargeW: this.config.preferredMaxChargeW,
      forecastCorrectionOverride: this.config.forecastCorrectionOverride,
      consumptionDayW: this.config.consumptionDayW,
      consumptionNightW: this.config.consumptionNightW,
      multiplusRatedPowerW: this.config.multiplusRatedPowerW,
    };
    try {
      const dir = dirname(this.configOverridesPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configOverridesPath, JSON.stringify(persistable, null, 2), 'utf-8');
    } catch (err) {
      console.error('[config] Failed to save overrides:', err);
    }
  }

  updatePvSettings(settings: PvSettings): void {
    savePvSettings(this.pvSettingsPath, settings);
    this.forecastSolar.updateConfig(settings);
    void this.forecastSolar.refresh();
  }

  async stop(): Promise<void> {
    if (this.regulationTimer) clearInterval(this.regulationTimer);
    if (this.forecastSolarTimer) clearInterval(this.forecastSolarTimer);
    this.vrm.stop();
    await this.mqtt.stop();
  }
}
