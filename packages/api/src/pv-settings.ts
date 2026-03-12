import fs from 'node:fs';
import path from 'node:path';

export interface PvSettings {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
  vrmForecastEnabled: boolean;
  forecastSolarEnabled: boolean;
}

const DEFAULT_PV_SETTINGS: PvSettings = {
  latitude: 51.22731665478406,
  longitude: 9.311660517083372,
  tiltDeg: 35,
  azimuthDeg: 2,
  kwp: 17.8,
  vrmForecastEnabled: true,
  forecastSolarEnabled: true,
};

export function loadPvSettings(filePath: string): PvSettings {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<PvSettings>;
    return { ...DEFAULT_PV_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_PV_SETTINGS };
  }
}

export function savePvSettings(filePath: string, settings: PvSettings): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}
