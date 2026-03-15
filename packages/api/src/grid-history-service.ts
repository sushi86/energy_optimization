import fs from 'node:fs';
import path from 'node:path';

export interface GridSlot {
  avgPowerW: number;
  energyWh: number;
  samples: number;
}

interface SlotAccumulator {
  sum: number;
  count: number;
}

function slotKey(): string {
  // Use Europe/Berlin timezone consistently
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = parts.find(p => p.type === 'hour')!.value;
  const rawM = parseInt(parts.find(p => p.type === 'minute')!.value);
  const m = (Math.floor(rawM / 15) * 15).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function todayDateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

export class GridHistoryService {
  private dataDir: string;
  private accumulators: Record<string, SlotAccumulator> = {};
  private currentDate: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private mode: 'accumulate' | 'snapshot';

  constructor(dataDir: string, mode: 'accumulate' | 'snapshot' = 'accumulate') {
    this.dataDir = dataDir;
    this.mode = mode;
    this.currentDate = todayDateStr();
    this.load();
    // Persist every 60 seconds
    this.saveTimer = setInterval(() => this.save(), 60_000);
  }

  recordSample(gridPowerW: number): void {
    const now = todayDateStr();
    if (now !== this.currentDate) {
      this.save();
      this.accumulators = {};
      this.currentDate = now;
    }

    const key = slotKey();
    if (this.mode === 'snapshot') {
      // Store latest value only (e.g. for SOC percentage)
      this.accumulators[key] = { sum: gridPowerW, count: 1 };
    } else {
      if (!this.accumulators[key]) {
        this.accumulators[key] = { sum: 0, count: 0 };
      }
      this.accumulators[key].sum += gridPowerW;
      this.accumulators[key].count += 1;
    }
  }

  /** For testing: inject raw accumulator data for a slot */
  injectSlot(key: string, acc: { sum: number; count: number }): void {
    this.accumulators[key] = acc;
  }

  getSlots(date?: string): Record<string, GridSlot> {
    const targetDate = date ?? todayDateStr();

    // If requesting a different date, load from file
    if (targetDate !== this.currentDate) {
      return this.loadFromFile(targetDate);
    }

    return this.accumulatorsToSlots(this.accumulators);
  }

  private accumulatorToSlot(acc: SlotAccumulator): GridSlot {
    const avg = Math.round(acc.sum / acc.count);
    return { avgPowerW: avg, energyWh: Math.round(avg * 0.25), samples: acc.count };
  }

  private accumulatorsToSlots(accs: Record<string, SlotAccumulator>): Record<string, GridSlot> {
    const result: Record<string, GridSlot> = {};
    for (const [key, acc] of Object.entries(accs)) {
      if (acc.count === 0) continue;
      result[key] = this.accumulatorToSlot(acc);
    }
    return result;
  }

  private filePath(date: string): string {
    return path.join(this.dataDir, `${date}.json`);
  }

  private load(): void {
    try {
      const content = fs.readFileSync(this.filePath(this.currentDate), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, SlotAccumulator> };
      if (data.accumulators) {
        this.accumulators = data.accumulators;
        console.log(`[grid-history] Loaded ${Object.keys(this.accumulators).length} slots for ${this.currentDate}`);
      }
    } catch {
      // No file yet — start fresh
    }
  }

  private loadFromFile(date: string): Record<string, GridSlot> {
    try {
      const content = fs.readFileSync(this.filePath(date), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, SlotAccumulator> };
      if (data.accumulators) return this.accumulatorsToSlots(data.accumulators);
      return {};
    } catch {
      return {};
    }
  }

  save(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const data = { date: this.currentDate, accumulators: this.accumulators };
      fs.writeFileSync(this.filePath(this.currentDate), JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.error('[grid-history] Failed to save:', err);
    }
  }

  stop(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.save();
  }
}
