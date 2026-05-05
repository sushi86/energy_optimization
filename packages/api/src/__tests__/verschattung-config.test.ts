import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadVerschattungConfig, saveVerschattungConfig, DEFAULT_VERSCHATTUNG_CONFIG } from '../verschattung/config.js';

describe('verschattung config', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verschattung-'));
    file = path.join(dir, 'config.json');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns defaults if file does not exist', () => {
    expect(loadVerschattungConfig(file)).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('returns defaults if file is corrupt', () => {
    fs.writeFileSync(file, 'not json {{', 'utf-8');
    expect(loadVerschattungConfig(file)).toEqual(DEFAULT_VERSCHATTUNG_CONFIG);
  });

  it('merges partial file with defaults', () => {
    fs.writeFileSync(file, JSON.stringify({ indoorTempThresholdC: 24 }), 'utf-8');
    const cfg = loadVerschattungConfig(file);
    expect(cfg.indoorTempThresholdC).toBe(24);
    expect(cfg.summerModeMonths).toEqual(DEFAULT_VERSCHATTUNG_CONFIG.summerModeMonths);
  });

  it('round-trip via save+load', () => {
    const updated = { ...DEFAULT_VERSCHATTUNG_CONFIG, indoorTempThresholdC: 21.5 };
    saveVerschattungConfig(file, updated);
    expect(loadVerschattungConfig(file).indoorTempThresholdC).toBe(21.5);
  });

  it('save uses atomic write (tmp + rename)', () => {
    saveVerschattungConfig(file, DEFAULT_VERSCHATTUNG_CONFIG);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
  });
});
