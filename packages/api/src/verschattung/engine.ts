import { computeSunPosition } from './sun.js';
import { evaluateEgSonnenschutz } from './automations/eg-sonnenschutz.js';
import { OverrideStateTracker } from './override-state.js';
import { ZONE_AZIMUTH_RANGES, COVERS, type Zone } from './covers.js';
import { loadPersistedState, savePersistedState } from './persistence.js';
import type { VerschattungConfig } from './config.js';
import type { VerschattungContext } from './context.js';
import type { Decision } from './decision.js';
import type { CoverActuator, IndoorTempSource, PvPowerSource } from './ports.js';

export interface EngineOptions {
  covers: CoverActuator;
  pv: PvPowerSource;
  temp: IndoorTempSource;
  config: VerschattungConfig;
  latitude: number;
  longitude: number;
  stateFilePath: string;
  now?: () => Date;
  decisionLogSize?: number;
}

const DEFAULT_LOG_SIZE = 200;

export class Engine {
  private tracker = new OverrideStateTracker();
  private decisionLog: Decision[] = [];
  private pvBelowHalfThresholdSinceMs: number | null = null;
  private decisionListeners = new Set<(d: Decision) => void>();
  private now: () => Date;

  constructor(private opts: EngineOptions) {
    this.now = opts.now ?? (() => new Date());
    const persisted = loadPersistedState(opts.stateFilePath);
    this.tracker.restore(persisted.covers);
    this.pvBelowHalfThresholdSinceMs = persisted.pvBelowHalfThresholdSinceMs;

    opts.covers.observePosition((id, pos) => {
      this.tracker.observePosition(id, pos);
      this.persist();
    });
  }

  onDecision(cb: (d: Decision) => void): void { this.decisionListeners.add(cb); }
  recentDecisions(): Decision[] { return [...this.decisionLog]; }
  trackerSnapshot() { return this.tracker.serialize(); }

  buildContext(): VerschattungContext {
    const now = this.now();
    const sun = computeSunPosition(now, this.opts.latitude, this.opts.longitude);
    const pv = this.opts.pv.current();
    const temp = this.opts.temp.current();
    const cfg = this.opts.config;

    const elevationFactor = Math.max(0, sun.elevationDeg) / 90;
    const pvThresholdW = Math.max(
      elevationFactor * cfg.pvThreshold.peakWp * cfg.pvThreshold.factor,
      cfg.pvThreshold.floorW,
    );

    const halfThreshold = pvThresholdW * cfg.hysteresisPvFactor;
    if (pv !== null && pv < halfThreshold) {
      if (this.pvBelowHalfThresholdSinceMs === null) {
        this.pvBelowHalfThresholdSinceMs = now.getTime();
      }
    } else {
      this.pvBelowHalfThresholdSinceMs = null;
    }

    const month = now.getUTCMonth() + 1;
    const isSummerMode = cfg.summerModeMonths.includes(month);

    const positions = new Map<string, number>();
    for (const c of COVERS) {
      const p = this.opts.covers.current(c.id);
      if (p !== null) positions.set(c.id, p);
    }

    const zones = {} as VerschattungContext['zones'];
    for (const zone of ['ost', 'sued', 'west'] as Zone[]) {
      const r = ZONE_AZIMUTH_RANGES[zone];
      zones[zone] = {
        inZone: sun.azimuthDeg > r.from && sun.azimuthDeg <= r.to,
        azimuthDeg: sun.azimuthDeg,
      };
    }

    return {
      now, sun, pvPowerW: pv, indoorTempC: temp, pvThresholdW,
      pvBelowHalfThresholdSinceMs: this.pvBelowHalfThresholdSinceMs,
      isSummerMode, coverPositions: positions, zones,
    };
  }

  async tick(): Promise<void> {
    const ctx = this.buildContext();
    const decisions = evaluateEgSonnenschutz(ctx, this.opts.config, this.tracker);

    for (const d of decisions) {
      this.recordDecision(d);

      if (d.action === 'close' && d.expectedPosition !== null) {
        this.tracker.markClosedByAuto(d.coverId, d.expectedPosition, d.reason);
        try {
          await this.opts.covers.setPosition(d.coverId, d.expectedPosition);
        } catch (e) {
          console.error('[verschattung] setPosition failed', d.coverId, (e as Error).message);
        }
      } else if (d.action === 'open') {
        this.tracker.markIdle(d.coverId, 'auto', d.reason);
        try {
          await this.opts.covers.setPosition(d.coverId, 100);
        } catch (e) {
          console.error('[verschattung] setPosition failed', d.coverId, (e as Error).message);
        }
      }
    }
    this.persist();
  }

  private recordDecision(d: Decision): void {
    const max = this.opts.decisionLogSize ?? DEFAULT_LOG_SIZE;
    this.decisionLog.unshift(d);
    if (this.decisionLog.length > max) this.decisionLog.length = max;
    for (const cb of this.decisionListeners) cb(d);
  }

  private persist(): void {
    savePersistedState(this.opts.stateFilePath, {
      covers: this.tracker.serialize(),
      pvBelowHalfThresholdSinceMs: this.pvBelowHalfThresholdSinceMs,
      savedAt: this.now().toISOString(),
    });
  }

  midnightReset(): void {
    for (const c of COVERS) {
      const e = this.tracker.getState(c.id);
      if (e.state === 'OVERRIDE') this.tracker.markIdle(c.id, 'reset', 'Mitternachts-Reset');
    }
    this.persist();
  }

  setManualPosition(coverId: string, position: number): Promise<void> {
    const e = this.tracker.getState(coverId);
    if (e.state === 'CLOSED_BY_AUTO') {
      this.tracker.observePosition(coverId, position + 100);
    }
    return this.opts.covers.setPosition(coverId, position);
  }

  releaseOverride(coverId: string): void {
    this.tracker.markIdle(coverId, 'auto', '"Auto übernehmen" via UI');
    this.persist();
  }
}
