import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads config with defaults', () => {
    process.env.VICTRON_VRM_TOKEN = 'test-token';
    process.env.VICTRON_VRM_SITE_ID = 'test-site';
    const config = loadConfig();
    expect(config.VICTRON_MQTT_URL).toBe('tcp://192.168.1.224:1883');
    expect(config.VICTRON_DEVICE_ID).toBe('c0619ab5450c');
    expect(config.BATTERY_CAPACITY_KWH).toBe(16);
    expect(config.MIN_SOC_PERCENT).toBe(20);
    expect(config.TARGET_SOC_PERCENT).toBe(100);
    expect(config.MAX_AC_POWER_W).toBe(12000);
    expect(config.WINTER_MODE_THRESHOLD_FACTOR).toBe(1.2);
    expect(config.REGULATION_INTERVAL_MS).toBe(20000);
    expect(config.LARGE_CHANGE_THRESHOLD_W).toBe(3000);
    expect(config.DEADBAND_W).toBe(50);
  });

  it('overrides defaults from env', () => {
    process.env.VICTRON_VRM_TOKEN = 'test-token';
    process.env.VICTRON_VRM_SITE_ID = 'test-site';
    process.env.BATTERY_CAPACITY_KWH = '20';
    process.env.MIN_SOC_PERCENT = '30';
    const config = loadConfig();
    expect(config.BATTERY_CAPACITY_KWH).toBe(20);
    expect(config.MIN_SOC_PERCENT).toBe(30);
  });

  it('throws on missing required fields', () => {
    delete process.env.VICTRON_VRM_TOKEN;
    delete process.env.VICTRON_VRM_SITE_ID;
    expect(() => loadConfig()).toThrow();
  });

  it('loads fine without optional nibe and wallbox fields', () => {
    process.env.VICTRON_VRM_TOKEN = 'test-token';
    process.env.VICTRON_VRM_SITE_ID = 'test-site';
    delete process.env.NIBE_URL;
    delete process.env.NIBE_USERNAME;
    delete process.env.NIBE_PASSWORD;
    delete process.env.WALLBOX_URL;
    const config = loadConfig();
    expect(config.NIBE_URL).toBeUndefined();
    expect(config.NIBE_USERNAME).toBeUndefined();
    expect(config.NIBE_PASSWORD).toBeUndefined();
    expect(config.WALLBOX_URL).toBeUndefined();
  });
});
