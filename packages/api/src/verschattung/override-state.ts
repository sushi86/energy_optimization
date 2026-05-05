import type { CoverState } from './decision.js';

export const POSITION_TOLERANCE_PCT = 5;

export interface CoverStateEntry {
  state: CoverState;
  expectedPosition: number | null;
  sinceTs: string;
  lastEvent: {
    ts: string;
    source: 'auto' | 'user' | 'reset';
    fromPosition: number | null;
    toPosition: number | null;
    reason: string | null;
  } | null;
}

export type OverrideSnapshot = Record<string, CoverStateEntry>;

export class OverrideStateTracker {
  private states: Map<string, CoverStateEntry> = new Map();

  getState(coverId: string): CoverStateEntry {
    return this.states.get(coverId) ?? { state: 'IDLE', expectedPosition: null, sinceTs: new Date().toISOString(), lastEvent: null };
  }

  markClosedByAuto(coverId: string, expectedPosition: number, reason?: string): void {
    const prev = this.getState(coverId);
    this.states.set(coverId, {
      state: 'CLOSED_BY_AUTO',
      expectedPosition,
      sinceTs: new Date().toISOString(),
      lastEvent: {
        ts: new Date().toISOString(),
        source: 'auto',
        fromPosition: prev.expectedPosition,
        toPosition: expectedPosition,
        reason: reason ?? null,
      },
    });
  }

  markIdle(coverId: string, source: 'auto' | 'reset' = 'auto', reason?: string): void {
    const prev = this.getState(coverId);
    this.states.set(coverId, {
      state: 'IDLE',
      expectedPosition: null,
      sinceTs: new Date().toISOString(),
      lastEvent: {
        ts: new Date().toISOString(),
        source,
        fromPosition: prev.expectedPosition,
        toPosition: null,
        reason: reason ?? null,
      },
    });
  }

  observePosition(coverId: string, currentPosition: number): void {
    const entry = this.getState(coverId);
    if (entry.state !== 'CLOSED_BY_AUTO') return;
    if (entry.expectedPosition === null) return;
    const drift = Math.abs(currentPosition - entry.expectedPosition);
    if (drift > POSITION_TOLERANCE_PCT) {
      this.states.set(coverId, {
        ...entry,
        state: 'OVERRIDE',
        sinceTs: new Date().toISOString(),
        lastEvent: {
          ts: new Date().toISOString(),
          source: 'user',
          fromPosition: entry.expectedPosition,
          toPosition: currentPosition,
          reason: 'Externe Position-Änderung erkannt',
        },
      });
    }
  }

  serialize(): OverrideSnapshot {
    const out: OverrideSnapshot = {};
    for (const [k, v] of this.states.entries()) out[k] = v;
    return out;
  }

  restore(snap: OverrideSnapshot): void {
    this.states = new Map(Object.entries(snap));
  }
}
