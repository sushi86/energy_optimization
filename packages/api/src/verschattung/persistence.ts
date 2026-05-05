import fs from 'node:fs';
import path from 'node:path';
import type { OverrideSnapshot } from './override-state.js';

export interface PersistedState {
  covers: OverrideSnapshot;
  pvBelowHalfThresholdSinceMs: number | null;
  savedAt: string;
}

const EMPTY: PersistedState = { covers: {}, pvBelowHalfThresholdSinceMs: null, savedAt: '1970-01-01T00:00:00Z' };

export function loadPersistedState(filePath: string): PersistedState {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<PersistedState>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

export function savePersistedState(filePath: string, state: PersistedState): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
