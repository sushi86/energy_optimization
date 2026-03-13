import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AppState } from './app-state.js';
import type { WebSocket } from 'ws';
import { loadPvSettings, savePvSettings, type PvSettings } from './pv-settings.js';
import { computeEnsembleForecast } from './ensemble-forecast.js';
import { computeChargePlan } from './charge-plan.js';
import type { InexogyService } from './inexogy-service.js';
import type { GridHistoryService } from './grid-history-service.js';
import type { NibePoller } from './nibe-poller.js';
import type { WallboxPoller } from './wallbox-poller.js';

export interface ServerOptions {
  testing?: boolean;
  appState?: AppState;
  pvSettingsPath?: string;
  inexogyService?: InexogyService;
  gridHistoryService?: GridHistoryService;
  batteryHistoryService?: GridHistoryService;
  consumptionHistoryService?: GridHistoryService;
  socHistoryService?: GridHistoryService;
  nibePoller?: NibePoller;
  wallboxPoller?: WallboxPoller;
}

export interface PriceEntry {
  timestamp: number;
  price: number | null;
}

interface PriceCache {
  date: string;
  entries: PriceEntry[];
  fetchedAt: number;
}

let priceCache: PriceCache | null = null;

// MPPT temperature cache (polled every 60s)
let mpptTemperatureC: number | null = null;

async function fetchMpptTemperature(): Promise<void> {
  try {
    const res = await fetch('http://192.168.1.176/rpc/Temperature.GetStatus?id=101');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mpptTemperatureC = data.tC ?? null;
  } catch (e) {
    console.error('[mppt-temp] fetch error:', (e as Error).message);
  }
}

export async function fetchPrices(): Promise<PriceEntry[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Cache for 15 minutes
  if (priceCache && priceCache.date === today && Date.now() - priceCache.fetchedAt < 15 * 60 * 1000) {
    return priceCache.entries;
  }

  const res = await fetch(`https://api.energy-charts.info/price?bzn=DE-LU`);
  if (!res.ok) throw new Error(`Energy Charts API HTTP ${res.status}`);

  const data = await res.json();
  const entries: PriceEntry[] = [];
  const timestamps: number[] = data.unix_seconds ?? [];
  const prices: (number | null)[] = data.price ?? [];

  for (let i = 0; i < timestamps.length; i++) {
    entries.push({ timestamp: timestamps[i], price: prices[i] ?? null });
  }

  priceCache = { date: today, entries, fetchedAt: Date.now() };
  return entries;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: !options.testing });
  const state = options.appState;
  const inexogyService = options.inexogyService;
  const gridHistoryService = options.gridHistoryService;
  const batteryHistoryService = options.batteryHistoryService;
  const consumptionHistoryService = options.consumptionHistoryService;
  const socHistoryService = options.socHistoryService;
  const nibePoller = options.nibePoller;
  const wallboxPoller = options.wallboxPoller;
  const pvSettingsPath = options.pvSettingsPath ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/pv-settings.json');

  // WebSocket support
  const wsClients = new Set<WebSocket>();

  void app.register(websocket);

  app.after(() => {
    app.get('/ws', { websocket: true }, (socket) => {
      wsClients.add(socket);
      socket.on('close', () => {
        wsClients.delete(socket);
      });
    });
  });

  // Start MPPT temperature polling (every 60s)
  void fetchMpptTemperature();
  setInterval(() => void fetchMpptTemperature(), 60_000);

  // Throttled broadcast on MQTT state changes
  if (state) {
    let lastBroadcast = 0;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const broadcast = () => {
      const s = state.mqtt.getState();
      const config = state.getConfig();

      let chargePlanData: ReturnType<typeof computeChargePlan> | null = null;
      try {
        const vrmForecast = state.vrm.getForecast();
        const solarForecast = state.forecastSolar.getForecast();
        const ensemble = computeEnsembleForecast(vrmForecast, solarForecast);
        const cachedPrices = priceCache?.entries ?? [];
        chargePlanData = computeChargePlan(ensemble, cachedPrices, {
          currentSoc: s.batterySoc,
          batteryCapacityKwh: config.batteryCapacityKwh,
          targetSocPercent: config.targetSocPercent,
          minSocPercent: config.minSocPercent,
          maxAcPowerW: config.maxAcPowerW,
          feedInRateCentPerKwh: config.feedInRateCentPerKwh,
          consumptionDayW: config.consumptionDayW,
          consumptionNightW: config.consumptionNightW,
          priceOptimization: config.priceOptimization,
          allowFeedInNegativePrice: config.allowFeedInNegativePrice,
          preferredMaxChargeW: config.preferredMaxChargeW,
          actualPvPowerW: s.pvPower,
          forecastCorrectionOverride: config.forecastCorrectionOverride,
        });
      } catch (e) {
        console.error('[ws] chargePlan error:', (e as Error).message);
      }

      const payload = JSON.stringify({
        pv: { power: s.pvPower },
        grid: { power: s.gridPower, setpoint: s.gridSetpoint },
        battery: { power: s.batteryPower, soc: s.batterySoc },
        consumption: { power: s.consumptionPower },
        controller: {
          mode: state.controller.getMode(),
          activeSetpoint: s.gridSetpoint,
          reason: state.controller.getLastResult()?.reason ?? null,
          details: state.controller.getLastResult()?.details ?? null,
        },
        batteryCapacityKwh: config.batteryCapacityKwh,
        priceOptimizationEnabled: config.priceOptimization,
        allowFeedInNegativePrice: config.allowFeedInNegativePrice,
        forecastCorrectionOverride: config.forecastCorrectionOverride,
        regulation: {
          lastTime: state.getRegulationInfo().lastRegulationTime.toISOString(),
          intervalMs: state.getRegulationInfo().intervalMs,
        },
        chargePlan: chargePlanData,
        mpptTemperatureC,
        heatPumpPowerW: nibePoller?.getPowerW() ?? null,
        wallboxPowerW: wallboxPoller?.getPowerW() ?? null,
        timestamp: s.timestamp.toISOString(),
      });

      for (const client of wsClients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
      lastBroadcast = Date.now();
    };

    state.mqtt.on('stateChange', () => {
      const now = Date.now();
      const elapsed = now - lastBroadcast;

      if (elapsed >= 500) {
        if (pendingTimeout) {
          clearTimeout(pendingTimeout);
          pendingTimeout = null;
        }
        broadcast();
      } else if (!pendingTimeout) {
        pendingTimeout = setTimeout(() => {
          pendingTimeout = null;
          broadcast();
        }, 500 - elapsed);
      }
    });
  }

  app.get('/api/health', async () => {
    return { status: 'ok' as const };
  });

  app.get('/api/status', async () => {
    if (!state) throw new Error('AppState not initialized');
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: {
        mode: state.controller.getMode(),
        activeSetpoint: s.gridSetpoint,
      },
      timestamp: s.timestamp.toISOString(),
    };
  });

  app.get('/api/forecast', async () => {
    if (!state) throw new Error('AppState not initialized');
    const pvS = loadPvSettings(pvSettingsPath);
    const emptyForecast = { hours: [], totalKwh: 0, intervalHours: 1 };
    const vrmForecast = pvS.vrmForecastEnabled ? state.vrm.getForecast() : emptyForecast;
    const solarForecast = pvS.forecastSolarEnabled ? state.forecastSolar.getForecast() : emptyForecast;
    const ensemble = computeEnsembleForecast(vrmForecast, solarForecast);
    const actual = state.vrm.getActualYield();
    const config = state.getConfig();

    const mapHours = (hours: { timestamp: Date; powerW: number }[]) => hours.map((h) => ({
      timestamp: h.timestamp.toISOString(),
      powerW: h.powerW,
    }));


    return {
      hours: mapHours(ensemble.hours),
      vrm: mapHours(vrmForecast.hours),
      solar: mapHours(solarForecast.hours),
      actual: mapHours(actual),
      totalKwh: ensemble.totalKwh,
      winterModeActive: state.vrm.isWinterMode(
        config.batteryCapacityKwh,
        config.winterModeThresholdFactor,
      ),
    };
  });

  app.get('/api/config', async () => {
    if (!state) throw new Error('AppState not initialized');
    const c = state.getConfig();
    return {
      batteryCapacityKwh: c.batteryCapacityKwh,
      minSocPercent: c.minSocPercent,
      targetSocPercent: c.targetSocPercent,
      maxAcPowerW: c.maxAcPowerW,
      winterModeThresholdFactor: c.winterModeThresholdFactor,
      regulationIntervalMs: c.regulationIntervalMs,
      largeChangeThresholdW: c.largeChangeThresholdW,
      deadbandW: c.deadbandW,
      priceOptimization: c.priceOptimization,
      allowFeedInNegativePrice: c.allowFeedInNegativePrice,
      feedInRateCentPerKwh: c.feedInRateCentPerKwh,
      forecastCorrectionOverride: c.forecastCorrectionOverride,
    };
  });

  app.put('/api/config', async (request) => {
    if (!state) throw new Error('AppState not initialized');
    const body = request.body as Record<string, number>;
    const updated = state.updateConfig(body);
    return {
      batteryCapacityKwh: updated.batteryCapacityKwh,
      minSocPercent: updated.minSocPercent,
      targetSocPercent: updated.targetSocPercent,
      maxAcPowerW: updated.maxAcPowerW,
      winterModeThresholdFactor: updated.winterModeThresholdFactor,
      regulationIntervalMs: updated.regulationIntervalMs,
      largeChangeThresholdW: updated.largeChangeThresholdW,
      deadbandW: updated.deadbandW,
      priceOptimization: updated.priceOptimization,
      allowFeedInNegativePrice: updated.allowFeedInNegativePrice,
      feedInRateCentPerKwh: updated.feedInRateCentPerKwh,
      forecastCorrectionOverride: updated.forecastCorrectionOverride,
    };
  });

  app.post('/api/controller/mode', async (request) => {
    if (!state) throw new Error('AppState not initialized');
    const { mode } = request.body as { mode: 'auto' | 'manual' | 'winter' };
    state.controller.setMode(mode);
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: { mode: state.controller.getMode(), activeSetpoint: s.gridSetpoint, reason: state.controller.getLastResult()?.reason ?? null },
      timestamp: s.timestamp.toISOString(),
    };
  });

  app.put('/api/controller/setpoint', async (request, reply) => {
    if (!state) throw new Error('AppState not initialized');
    if (state.controller.getMode() !== 'manual') {
      return reply.code(409).send({ error: 'Not in manual mode' });
    }
    const { setpointW } = request.body as { setpointW: number };
    await state.mqtt.setGridSetpoint(setpointW);
    state.controller.applySetpoint(setpointW);
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: { mode: state.controller.getMode(), activeSetpoint: setpointW, reason: state.controller.getLastResult()?.reason ?? null },
      timestamp: s.timestamp.toISOString(),
    };
  });

  app.get('/api/settings/pv-system', async () => {
    return loadPvSettings(pvSettingsPath);
  });

  app.put('/api/settings/pv-system', async (request) => {
    const body = request.body as PvSettings;
    savePvSettings(pvSettingsPath, body);
    if (state) {
      state.forecastSolar.updateConfig(body);
      void state.forecastSolar.refresh();
    }
    return loadPvSettings(pvSettingsPath);
  });

  app.get('/api/meter/history', async (request, reply) => {
    if (!inexogyService) {
      return reply.code(404).send({ error: 'inexogy not configured' });
    }
    const query = request.query as { date?: string };
    const tz = 'Europe/Berlin';
    const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });

    // Determine UTC offset for the given date in Europe/Berlin
    const testDate = new Date(`${dateStr}T12:00:00Z`);
    const berlinMs = new Date(testDate.toLocaleString('en-US', { timeZone: tz })).getTime();
    const offsetMs = berlinMs - testDate.getTime();
    const offsetHours = offsetMs / 3_600_000;
    const offsetStr = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`;

    const dayStart = new Date(`${dateStr}T00:00:00${offsetStr}`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    try {
      const readings = await inexogyService.getReadings(dayStart, dayEnd);
      return {
        date: dateStr,
        meterId: inexogyService.getMeterId() ?? 'unknown',
        readings: readings.map((r) => ({
          time: r.time.toISOString(),
          powerW: r.powerW,
          energyKwh: r.energyKwh,
          energyOutKwh: r.energyOutKwh,
        })),
      };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/grid/history', async (request) => {
    if (!gridHistoryService) {
      return { date: '', slots: [] };
    }
    const query = request.query as { date?: string };
    const tz = 'Europe/Berlin';
    const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { date: '', slots: [] };
    }
    const slotsObj = gridHistoryService.getSlots(dateStr);
    const slots = Object.entries(slotsObj)
      .map(([time, slot]) => ({ time, ...slot }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { date: dateStr, slots };
  });

  app.get('/api/battery/history', async (request) => {
    if (!batteryHistoryService) {
      return { date: '', slots: [] };
    }
    const query = request.query as { date?: string };
    const tz = 'Europe/Berlin';
    const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { date: '', slots: [] };
    }
    const slotsObj = batteryHistoryService.getSlots(dateStr);
    const slots = Object.entries(slotsObj)
      .map(([time, slot]) => ({ time, ...slot }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { date: dateStr, slots };
  });

  app.get('/api/consumption/history', async (request) => {
    if (!consumptionHistoryService) {
      return { date: '', slots: [] };
    }
    const query = request.query as { date?: string };
    const tz = 'Europe/Berlin';
    const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { date: '', slots: [] };
    }
    const slotsObj = consumptionHistoryService.getSlots(dateStr);
    const slots = Object.entries(slotsObj)
      .map(([time, slot]) => ({ time, ...slot }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { date: dateStr, slots };
  });

  app.get('/api/soc/history', async (request) => {
    if (!socHistoryService) {
      return { date: '', slots: [] };
    }
    const query = request.query as { date?: string };
    const tz = 'Europe/Berlin';
    const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { date: '', slots: [] };
    }
    const slotsObj = socHistoryService.getSlots(dateStr);
    const slots = Object.entries(slotsObj)
      .map(([time, slot]) => ({ time, avgSoc: slot.avgPowerW, samples: slot.samples }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { date: dateStr, slots };
  });

  app.get('/api/prices', async (_request, reply) => {
    try {
      const entries = await fetchPrices();
      return { entries };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  return app;
}
