import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });
import { loadConfig } from './config.js';
import { AppState } from './app-state.js';
import { buildServer } from './server.js';
import { InexogyService } from './inexogy-service.js';
import { GridHistoryService } from './grid-history-service.js';
import { NibePoller } from './nibe-poller.js';
import { WallboxPoller } from './wallbox-poller.js';
import { initVapid } from './vapid.js';
import { PushService } from './push-service.js';
import { PvTracker } from './pv-tracker.js';
import { NotificationService } from './notification-service.js';
import { DailySummaryService } from './daily-summary-service.js';
import { HaMqttClient } from './infra/ha/ha-mqtt-client.js';
import { HaMqttListener } from './infra/ha/ha-mqtt-listener.js';
import { HaMqttPublisher } from './infra/ha/ha-mqtt-publisher.js';
import { HaCoverActuator } from './verschattung/adapters/ha-cover-actuator.js';
import { HaTempSource } from './verschattung/adapters/ha-temp-source.js';
import { VictronPvSource } from './verschattung/adapters/victron-pv-source.js';
import { Engine as VerschattungEngine } from './verschattung/engine.js';
import { loadVerschattungConfig } from './verschattung/config.js';
import { RoomSensorRegistry } from './verschattung/room-sensors.js';
import { loadPvSettings } from './pv-settings.js';

async function main() {
  const config = loadConfig();

  console.log('[energy-control] Starting...');

  const appState = await AppState.create({
    mqttUrl: config.VICTRON_MQTT_URL,
    deviceId: config.VICTRON_DEVICE_ID,
    vrmToken: config.VICTRON_VRM_TOKEN,
    vrmSiteId: config.VICTRON_VRM_SITE_ID,
    batteryCapacityKwh: config.BATTERY_CAPACITY_KWH,
    minSocPercent: config.MIN_SOC_PERCENT,
    targetSocPercent: config.TARGET_SOC_PERCENT,
    maxAcPowerW: config.MAX_AC_POWER_W,
    winterModeThresholdFactor: config.WINTER_MODE_THRESHOLD_FACTOR,
    regulationIntervalMs: config.REGULATION_INTERVAL_MS,
    largeChangeThresholdW: config.LARGE_CHANGE_THRESHOLD_W,
    deadbandW: config.DEADBAND_W,
    priceOptimization: config.PRICE_OPTIMIZATION,
    allowFeedInNegativePrice: config.ALLOW_FEED_IN_NEGATIVE_PRICE,
    feedInRateCentPerKwh: config.FEED_IN_RATE_CENT_PER_KWH,
    preferredMaxChargeW: config.PREFERRED_MAX_CHARGE_W,
    activeMorningDischarge: config.ACTIVE_MORNING_DISCHARGE,
    activeMorningDischargeMinSocPercent: config.ACTIVE_MORNING_DISCHARGE_MIN_SOC_PERCENT,
    forecastCorrectionOverride: null,
    consumptionDayW: 500,
    consumptionNightW: 350,
    multiplusRatedPowerW: 4000,
  });

  await Promise.all([appState.vrm.refreshForecast(), appState.vrm.refreshActualYield()]);
  await appState.forecastSolar.refresh();
  appState.startRegulation();

  const dataDir = resolve(__dirname, '../../../data');
  const gridHistoryService = new GridHistoryService(resolve(dataDir, 'grid-history'));
  const batteryHistoryService = new GridHistoryService(resolve(dataDir, 'battery-history'));
  const consumptionHistoryService = new GridHistoryService(resolve(dataDir, 'consumption-history'));
  const pvHistoryService = new GridHistoryService(resolve(dataDir, 'pv-history'));
  const socHistoryService = new GridHistoryService(resolve(dataDir, 'soc-history'), 'snapshot');

  // Record power values on every MQTT state change
  appState.mqtt.on('stateChange', () => {
    const s = appState.mqtt.getState();
    gridHistoryService.recordSample(s.gridPower);
    batteryHistoryService.recordSample(s.batteryPower);
    consumptionHistoryService.recordSample(s.consumptionPower);
    pvHistoryService.recordSample(s.pvPower);
    socHistoryService.recordSample(s.batterySoc);
  });

  let inexogyService: InexogyService | undefined;
  if (config.INEXOGY_EMAIL && config.INEXOGY_PASSWORD) {
    inexogyService = new InexogyService({
      email: config.INEXOGY_EMAIL,
      password: config.INEXOGY_PASSWORD,
      meterId: config.INEXOGY_METER_ID,
    });
    console.log('[energy-control] inexogy smart meter enabled');
  }

  let nibePoller: NibePoller | undefined;
  if (config.NIBE_URL && config.NIBE_USERNAME && config.NIBE_PASSWORD) {
    nibePoller = new NibePoller({
      url: config.NIBE_URL,
      username: config.NIBE_USERNAME,
      password: config.NIBE_PASSWORD,
    });
    nibePoller.start();
    console.log('[energy-control] nibe heat pump poller enabled');
  }

  let wallboxPoller: WallboxPoller | undefined;
  if (config.WALLBOX_URL) {
    wallboxPoller = new WallboxPoller({ url: config.WALLBOX_URL });
    wallboxPoller.start();
    console.log('[energy-control] tesla wallbox poller enabled');
  }

  // --- Push notifications ---
  initVapid(dataDir);
  const pushService = new PushService(dataDir);
  const pvTracker = new PvTracker();
  new NotificationService(pushService);
  const dailySummaryService = new DailySummaryService(resolve(dataDir, 'daily-summary'));
  appState.setPvTracker(pvTracker, gridHistoryService, pvHistoryService);

  // --- Verschattung-Modul ---
  const verschattungConfigPath = resolve(dataDir, 'verschattung-config.json');
  const verschattungStatePath  = resolve(dataDir, 'verschattung-state.json');
  const pvSettingsPathV = resolve(dataDir, 'pv-settings.json');

  const haClient = new HaMqttClient({
    url: config.HA_MQTT_URL,
    username: config.HA_MQTT_USER,
    password: config.HA_MQTT_PASSWORD,
  });
  void haClient.start();
  const haListener  = new HaMqttListener(haClient);
  haListener.start();
  const haPublisher = new HaMqttPublisher(haClient);

  // Indoor-Temp-Sensor: hardcoded EG-Sensor aus der YAML.
  const indoorTempEntityId = 'sensor.timmerflotte_temp_hmd_sensor_temperatur_3';

  const haCoverActuator = new HaCoverActuator(haListener, haPublisher);
  const haTempSource    = new HaTempSource(haListener, indoorTempEntityId);
  const victronPvSource = new VictronPvSource(appState.mqtt);
  const roomSensors     = new RoomSensorRegistry(haListener);

  const pvSettingsV = loadPvSettings(pvSettingsPathV);
  const verschattungEngine = new VerschattungEngine({
    covers: haCoverActuator,
    pv: victronPvSource,
    temp: haTempSource,
    config: loadVerschattungConfig(verschattungConfigPath),
    latitude: pvSettingsV.latitude,
    longitude: pvSettingsV.longitude,
    stateFilePath: verschattungStatePath,
  });

  // Tick-Auslöser
  victronPvSource.observe(() => { void verschattungEngine.tick(); });
  haTempSource.observe(()    => { void verschattungEngine.tick(); });
  haCoverActuator.observePosition(() => { void verschattungEngine.tick(); });
  setInterval(() => { void verschattungEngine.tick(); }, 60_000);

  // Mitternachts-Reset
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 1) verschattungEngine.midnightReset();
  }, 60_000);

  const server = buildServer({
    appState, inexogyService, gridHistoryService, batteryHistoryService,
    consumptionHistoryService, socHistoryService, pvHistoryService,
    nibePoller, wallboxPoller, pushService, dailySummaryService,
    verschattungEngine, verschattungConfigPath,
    roomSensors,
  });
  await server.listen({ port: 3001, host: '0.0.0.0' });

  console.log('[energy-control] Server running on http://0.0.0.0:3001');

  const shutdown = async () => {
    console.log('[energy-control] Shutting down...');
    await server.close();
    await haClient.stop();
    await appState.stop();
    gridHistoryService.stop();
    batteryHistoryService.stop();
    consumptionHistoryService.stop();
    pvHistoryService.stop();
    socHistoryService.stop();
    nibePoller?.stop();
    wallboxPoller?.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[energy-control] Fatal error:', err);
  process.exit(1);
});
