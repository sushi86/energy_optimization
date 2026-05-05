import fs from 'node:fs';
import path from 'node:path';
import type { Zone } from './covers.js';

export interface ZoneTunables {
  closePosition: number; // 0..100, default 20
}

export interface VerschattungConfig {
  zones: Record<Zone, ZoneTunables>;
  pvThreshold: { peakWp: number; factor: number; floorW: number };
  indoorTempThresholdC: number;
  hysteresisIndoorTempC: number;
  hysteresisPvFactor: number;          // 0..1, e.g. 0.5 = 50% der Schwelle
  hysteresisPvDurationMinutes: number;
  summerModeMonths: number[];          // 1..12
}

export const DEFAULT_VERSCHATTUNG_CONFIG: VerschattungConfig = {
  zones: {
    ost:  { closePosition: 20 },
    sued: { closePosition: 20 },
    west: { closePosition: 20 },
  },
  pvThreshold: { peakWp: 4700, factor: 0.85, floorW: 300 },
  indoorTempThresholdC: 22,
  hysteresisIndoorTempC: 1,
  hysteresisPvFactor: 0.5,
  hysteresisPvDurationMinutes: 10,
  summerModeMonths: [4, 5, 6, 7, 8, 9, 10],
};

export function loadVerschattungConfig(filePath: string): VerschattungConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<VerschattungConfig>;
    return {
      ...DEFAULT_VERSCHATTUNG_CONFIG,
      ...parsed,
      zones: { ...DEFAULT_VERSCHATTUNG_CONFIG.zones, ...(parsed.zones ?? {}) },
      pvThreshold: { ...DEFAULT_VERSCHATTUNG_CONFIG.pvThreshold, ...(parsed.pvThreshold ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_VERSCHATTUNG_CONFIG);
  }
}

export function saveVerschattungConfig(filePath: string, config: VerschattungConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
