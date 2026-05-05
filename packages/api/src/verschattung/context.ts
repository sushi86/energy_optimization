import type { Zone } from './covers.js';
import type { SunPosition } from './sun.js';

export interface ZoneContext {
  inZone: boolean;          // azimut ∈ zone-range
  azimuthDeg: number;
}

export interface VerschattungContext {
  now: Date;
  sun: SunPosition;
  pvPowerW: number | null;
  indoorTempC: number | null;
  pvThresholdW: number;
  pvBelowHalfThresholdSinceMs: number | null; // null wenn aktuell über Schwelle
  isSummerMode: boolean;
  coverPositions: Map<string, number>;        // entityId → 0..100
  zones: Record<Zone, ZoneContext>;
}
