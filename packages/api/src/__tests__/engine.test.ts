import { describe, it, expect, beforeEach } from 'vitest';
import { Engine } from '../verschattung/engine.js';
import type { CoverActuator, IndoorTempSource, PvPowerSource } from '../verschattung/ports.js';
import { DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

class FakeCovers implements CoverActuator {
  positions = new Map<string, number>();
  setCalls: { id: string; pos: number }[] = [];
  observers: ((id: string, pos: number) => void)[] = [];
  setPosition(id: string, pos: number): Promise<void> {
    this.setCalls.push({ id, pos });
    setTimeout(() => {
      this.positions.set(id, pos);
      for (const cb of this.observers) cb(id, pos);
    }, 5);
    return Promise.resolve();
  }
  observePosition(cb: (id: string, pos: number) => void): void { this.observers.push(cb); }
  current(id: string): number | null { return this.positions.get(id) ?? null; }
  externalSet(id: string, pos: number): void {
    this.positions.set(id, pos);
    for (const cb of this.observers) cb(id, pos);
  }
}
class FakeTemp implements IndoorTempSource {
  value: number | null = 23;
  obs: ((v: number) => void)[] = [];
  current(): number | null { return this.value; }
  observe(cb: (v: number) => void): void { this.obs.push(cb); }
  set(v: number): void { this.value = v; for (const cb of this.obs) cb(v); }
}
class FakePv implements PvPowerSource {
  value: number | null = 4500;
  obs: ((v: number) => void)[] = [];
  current(): number | null { return this.value; }
  observe(cb: (v: number) => void): void { this.obs.push(cb); }
  set(v: number): void { this.value = v; for (const cb of this.obs) cb(v); }
}

describe('Engine', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-')); });

  it('emits close decision and calls actuator when conditions met', async () => {
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);

    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: path.join(dir, 'state.json'),
      now: () => new Date('2026-05-20T11:00:00Z'),
    });

    await engine.tick();

    const sudCloses = covers.setCalls.filter((c) => c.pos === 20);
    expect(sudCloses.length).toBeGreaterThan(0);
    const decisions = engine.recentDecisions();
    expect(decisions.some((d) => d.zone === 'sued' && d.action === 'close')).toBe(true);
  });

  it('persists override state on transitions', async () => {
    const stateFile = path.join(dir, 'state.json');
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);
    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: stateFile,
      now: () => new Date('2026-05-20T11:00:00Z'),
    });
    await engine.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(fs.existsSync(stateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(Object.keys(state.covers).length).toBeGreaterThan(0);
  });

  it('detects external override and skips next tick', async () => {
    const covers = new FakeCovers();
    covers.positions.set('cover.galerie_rolladen', 100);
    covers.positions.set('cover.eingang_rolladen', 100);
    covers.positions.set('cover.westen_gross_rolladen', 100);
    const engine = new Engine({
      covers, pv: new FakePv(), temp: new FakeTemp(),
      config: DEFAULT_VERSCHATTUNG_CONFIG,
      latitude: 51.227, longitude: 9.31,
      stateFilePath: path.join(dir, 'state.json'),
      now: () => new Date('2026-05-20T11:00:00Z'),
    });
    await engine.tick();
    await new Promise((r) => setTimeout(r, 30));

    covers.externalSet('cover.galerie_rolladen', 80);
    await new Promise((r) => setTimeout(r, 30));

    covers.setCalls.length = 0;
    await engine.tick();
    expect(covers.setCalls.find((c) => c.id === 'cover.galerie_rolladen')).toBeUndefined();
  });
});
