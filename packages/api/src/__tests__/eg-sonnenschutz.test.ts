import { describe, it, expect } from 'vitest';
import { evaluateEgSonnenschutz } from '../verschattung/automations/eg-sonnenschutz.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import { OverrideStateTracker } from '../verschattung/override-state.js';
import type { VerschattungContext } from '../verschattung/context.js';

function ctx(overrides: Partial<VerschattungContext> = {}): VerschattungContext {
  return {
    now: new Date('2026-05-20T13:00:00Z'),
    sun: { azimuthDeg: 180, elevationDeg: 50 },
    pvPowerW: 4500,
    indoorTempC: 23,
    pvThresholdW: 2000,
    pvBelowHalfThresholdSinceMs: null,
    isSummerMode: true,
    coverPositions: new Map([
      ['cover.galerie_rolladen', 100],
      ['cover.eingang_rolladen', 100],
      ['cover.westen_gross_rolladen', 100],
    ]),
    zones: {
      ost:  { inZone: false, azimuthDeg: 180 },
      sued: { inZone: true,  azimuthDeg: 180 },
      west: { inZone: false, azimuthDeg: 180 },
    },
    ...overrides,
  };
}

describe('evaluateEgSonnenschutz — close decisions', () => {
  it('emits close for sued covers when all conditions met', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const sued = decisions.filter((d) => d.zone === 'sued' && d.action === 'close');
    expect(sued.length).toBeGreaterThan(0);
    for (const d of sued) {
      expect(d.expectedPosition).toBe(20);
      expect(d.evaluatedConditions.every((c) => c.ok)).toBe(true);
    }
  });

  it('does NOT close ost covers when sun is in sued only', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const ost = decisions.filter((d) => d.zone === 'ost' && d.action === 'close');
    expect(ost).toHaveLength(0);
  });

  it('skips close when not summer mode', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ isSummerMode: false }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close when indoor temp below threshold', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ indoorTempC: 21 }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close when pv below threshold', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ pvPowerW: 1000 }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    expect(decisions.filter((d) => d.action === 'close')).toHaveLength(0);
  });

  it('skips close for cover already in OVERRIDE', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    tracker.observePosition('cover.galerie_rolladen', 80);   // → OVERRIDE
    const decisions = evaluateEgSonnenschutz(ctx(), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });

  it('skips close for cover already CLOSED_BY_AUTO at expected position', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const positions = new Map([
      ['cover.galerie_rolladen', 20],
      ['cover.eingang_rolladen', 100],
      ['cover.westen_gross_rolladen', 100],
    ]);
    const decisions = evaluateEgSonnenschutz(ctx({ coverPositions: positions }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });

  it('reports indoor temp unavailable as skip with reason', () => {
    const tracker = new OverrideStateTracker();
    const decisions = evaluateEgSonnenschutz(ctx({ indoorTempC: null }), DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const sued = decisions.find((d) => d.zone === 'sued');
    expect(sued?.action).toBe('skip');
    expect(sued?.reason).toMatch(/Innentemp/);
  });
});

describe('evaluateEgSonnenschutz — open decisions', () => {
  it('opens cover when sun leaves zone and cover is CLOSED_BY_AUTO', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);

    const c = ctx({
      zones: {
        ost:  { inZone: false, azimuthDeg: 280 },
        sued: { inZone: false, azimuthDeg: 280 },
        west: { inZone: true,  azimuthDeg: 280 },
      },
    });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
    expect(galerie?.expectedPosition).toBe(100);
  });

  it('opens when pv has been below half threshold for >= duration', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const tenMinAgo = new Date('2026-05-20T13:00:00Z').getTime() - 10 * 60_000;
    const c = ctx({ pvPowerW: 500, pvBelowHalfThresholdSinceMs: tenMinAgo });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
  });

  it('does not open if pv below half but < duration', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const fiveMinAgo = new Date('2026-05-20T13:00:00Z').getTime() - 5 * 60_000;
    const c = ctx({ pvPowerW: 500, pvBelowHalfThresholdSinceMs: fiveMinAgo });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).not.toBe('open');
  });

  it('opens when indoor temp drops below threshold minus hysteresis', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    const c = ctx({ indoorTempC: 20.5 });   // 22 - 1 - more
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('open');
  });

  it('does NOT auto-open when state is OVERRIDE', () => {
    const tracker = new OverrideStateTracker();
    tracker.markClosedByAuto('cover.galerie_rolladen', 20);
    tracker.observePosition('cover.galerie_rolladen', 70);  // → OVERRIDE
    const c = ctx({
      zones: {
        ost:  { inZone: false, azimuthDeg: 280 },
        sued: { inZone: false, azimuthDeg: 280 },
        west: { inZone: true,  azimuthDeg: 280 },
      },
    });
    const decisions = evaluateEgSonnenschutz(c, DEFAULT_VERSCHATTUNG_CONFIG, tracker);
    const galerie = decisions.find((d) => d.coverId === 'cover.galerie_rolladen');
    expect(galerie?.action).toBe('skip');
  });
});
