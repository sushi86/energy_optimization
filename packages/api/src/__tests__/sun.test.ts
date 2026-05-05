import { describe, it, expect } from 'vitest';
import { computeSunPosition } from '../verschattung/sun.js';

describe('computeSunPosition', () => {
  it('returns azimuth and elevation for known reference (summer solstice solar noon Munich)', () => {
    // Solar noon in Munich (lon 11.575°E) on summer solstice ≈ 11:15 UTC
    const date = new Date('2026-06-21T11:15:00Z');
    const pos = computeSunPosition(date, 48.137, 11.575);
    expect(pos.azimuthDeg).toBeGreaterThan(170);
    expect(pos.azimuthDeg).toBeLessThan(190);
    expect(pos.elevationDeg).toBeGreaterThan(60);
    expect(pos.elevationDeg).toBeLessThan(68);
  });

  it('returns negative elevation at night', () => {
    const date = new Date('2026-06-21T00:00:00Z');
    const pos = computeSunPosition(date, 48.137, 11.575);
    expect(pos.elevationDeg).toBeLessThan(0);
  });

  it('azimuth is in 0..360', () => {
    for (const isoH of [0, 6, 12, 18]) {
      const date = new Date(`2026-06-21T${String(isoH).padStart(2, '0')}:00:00Z`);
      const pos = computeSunPosition(date, 48.137, 11.575);
      expect(pos.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(pos.azimuthDeg).toBeLessThan(360);
    }
  });
});
