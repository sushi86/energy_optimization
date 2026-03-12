import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPvSettings, savePvSettings, type PvSettings } from '../pv-settings.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('pv-settings', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-settings-test-'));
    filePath = path.join(tmpDir, 'pv-settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no file exists', () => {
    const settings = loadPvSettings(filePath);
    expect(settings).toEqual({
      latitude: 51.22731665478406,
      longitude: 9.311660517083372,
      tiltDeg: 35,
      azimuthDeg: 2,
      kwp: 17.8,
      vrmForecastEnabled: true,
      forecastSolarEnabled: true,
    });
  });

  it('saves and loads settings round-trip', () => {
    const custom: PvSettings = {
      latitude: 48.0,
      longitude: 11.0,
      tiltDeg: 30,
      azimuthDeg: 180,
      kwp: 10.5,
      vrmForecastEnabled: false,
      forecastSolarEnabled: true,
    };
    savePvSettings(filePath, custom);
    const loaded = loadPvSettings(filePath);
    expect(loaded).toEqual(custom);
  });

  it('returns defaults on invalid JSON', () => {
    fs.writeFileSync(filePath, 'not valid json {{{');
    const settings = loadPvSettings(filePath);
    expect(settings).toEqual({
      latitude: 51.22731665478406,
      longitude: 9.311660517083372,
      tiltDeg: 35,
      azimuthDeg: 2,
      kwp: 17.8,
      vrmForecastEnabled: true,
      forecastSolarEnabled: true,
    });
  });

  it('creates directories if needed when saving', () => {
    const nestedPath = path.join(tmpDir, 'a', 'b', 'pv-settings.json');
    const custom: PvSettings = {
      latitude: 48.0,
      longitude: 11.0,
      tiltDeg: 30,
      azimuthDeg: 180,
      kwp: 10.5,
      vrmForecastEnabled: true,
      forecastSolarEnabled: false,
    };
    savePvSettings(nestedPath, custom);
    const loaded = loadPvSettings(nestedPath);
    expect(loaded).toEqual(custom);
  });

  it('merges defaults for missing fields in existing file', () => {
    // Simulate old settings file without provider toggles
    fs.writeFileSync(filePath, JSON.stringify({
      latitude: 48.0,
      longitude: 11.0,
      tiltDeg: 30,
      azimuthDeg: 180,
      kwp: 10.5,
    }));
    const loaded = loadPvSettings(filePath);
    expect(loaded.vrmForecastEnabled).toBe(true);
    expect(loaded.forecastSolarEnabled).toBe(true);
    expect(loaded.latitude).toBe(48.0);
  });
});
