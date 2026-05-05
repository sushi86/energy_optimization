import { describe, it, expect } from 'vitest';
import { OverrideStateTracker, POSITION_TOLERANCE_PCT } from '../verschattung/override-state.js';

describe('OverrideStateTracker', () => {
  it('starts cover in IDLE', () => {
    const t = new OverrideStateTracker();
    const s = t.getState('cover.x');
    expect(s.state).toBe('IDLE');
    expect(s.expectedPosition).toBeNull();
  });

  it('markClosedByAuto sets CLOSED_BY_AUTO with expected', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    expect(t.getState('cover.x').state).toBe('CLOSED_BY_AUTO');
    expect(t.getState('cover.x').expectedPosition).toBe(20);
  });

  it('observePosition transitions CLOSED_BY_AUTO → OVERRIDE if user opens further', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 60);
    expect(t.getState('cover.x').state).toBe('OVERRIDE');
  });

  it('observePosition transitions CLOSED_BY_AUTO → OVERRIDE if user closes further', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 5);
    expect(t.getState('cover.x').state).toBe('OVERRIDE');
  });

  it('observePosition stays in CLOSED_BY_AUTO within tolerance', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 20 + POSITION_TOLERANCE_PCT);
    expect(t.getState('cover.x').state).toBe('CLOSED_BY_AUTO');
  });

  it('observePosition in IDLE does not trigger OVERRIDE (no engine ownership)', () => {
    const t = new OverrideStateTracker();
    t.observePosition('cover.x', 100);
    expect(t.getState('cover.x').state).toBe('IDLE');
  });

  it('markIdle clears expected position and override', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.x', 20);
    t.observePosition('cover.x', 70);  // OVERRIDE
    t.markIdle('cover.x');
    expect(t.getState('cover.x').state).toBe('IDLE');
    expect(t.getState('cover.x').expectedPosition).toBeNull();
  });

  it('serialize/restore round-trip preserves states', () => {
    const t = new OverrideStateTracker();
    t.markClosedByAuto('cover.a', 20);
    t.observePosition('cover.a', 75);  // → OVERRIDE
    t.markClosedByAuto('cover.b', 30);
    const snap = t.serialize();
    const t2 = new OverrideStateTracker();
    t2.restore(snap);
    expect(t2.getState('cover.a').state).toBe('OVERRIDE');
    expect(t2.getState('cover.b').state).toBe('CLOSED_BY_AUTO');
    expect(t2.getState('cover.b').expectedPosition).toBe(30);
  });
});
