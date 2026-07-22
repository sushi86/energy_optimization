import fs from 'node:fs';
import path from 'node:path';

export interface WallboxSlot {
  energyWh: number;
}

function slotKey(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')!.value;
  const rawM = parseInt(parts.find((p) => p.type === 'minute')!.value);
  const m = (Math.floor(rawM / 15) * 15).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function todayDateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

export class WallboxHistoryService {
  private dataDir: string;
  private accumulators: Record<string, number> = {}; // slotKey -> Wh
  private currentDate: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private lastTotalKwh: number | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.currentDate = todayDateStr();
    this.load();
    // Persist every 60 seconds, same cadence as GridHistoryService
    this.saveTimer = setInterval(() => this.save(), 60_000);
  }

  recordEnergyTotalKwh(totalKwh: number): void {
    const now = todayDateStr();
    if (now !== this.currentDate) {
      this.save();
      this.accumulators = {};
      this.currentDate = now;
    }

    if (this.lastTotalKwh === null) {
      // First reading ever (or after a restart): establish baseline only.
      this.lastTotalKwh = totalKwh;
      return;
    }

    const deltaKwh = totalKwh - this.lastTotalKwh;
    this.lastTotalKwh = totalKwh;
    if (deltaKwh <= 0) return; // Counter reset/rollover or no change: ignore, keep new baseline

    const key = slotKey();
    this.accumulators[key] = (this.accumulators[key] ?? 0) + deltaKwh * 1000;
  }

  /** For testing: inject a raw Wh value for a slot */
  injectSlot(key: string, energyWh: number): void {
    this.accumulators[key] = energyWh;
  }

  getSlots(date?: string): Record<string, WallboxSlot> {
    const targetDate = date ?? todayDateStr();
    if (targetDate !== this.currentDate) {
      return this.loadFromFile(targetDate);
    }
    return this.accumulatorsToSlots(this.accumulators);
  }

  getDailyTotals(): { date: string; chargedKwh: number }[] {
    const dates = new Set<string>();
    try {
      for (const f of fs.readdirSync(this.dataDir)) {
        if (f.endsWith('.json')) dates.add(f.replace(/\.json$/, ''));
      }
    } catch {
      // Directory doesn't exist yet — no historical days
    }
    dates.add(this.currentDate);
    return Array.from(dates).sort().map((date) => {
      const slots = this.getSlots(date);
      const totalWh = Object.values(slots).reduce((sum, s) => sum + s.energyWh, 0);
      return { date, chargedKwh: totalWh / 1000 };
    });
  }

  private accumulatorsToSlots(accs: Record<string, number>): Record<string, WallboxSlot> {
    const result: Record<string, WallboxSlot> = {};
    for (const [key, wh] of Object.entries(accs)) {
      result[key] = { energyWh: Math.round(wh) };
    }
    return result;
  }

  private filePath(date: string): string {
    return path.join(this.dataDir, `${date}.json`);
  }

  private load(): void {
    try {
      const content = fs.readFileSync(this.filePath(this.currentDate), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, number> };
      if (data.accumulators) {
        this.accumulators = data.accumulators;
        console.log(`[wallbox-history] Loaded ${Object.keys(this.accumulators).length} slots for ${this.currentDate}`);
      }
    } catch {
      // No file yet — start fresh
    }
  }

  private loadFromFile(date: string): Record<string, WallboxSlot> {
    try {
      const content = fs.readFileSync(this.filePath(date), 'utf-8');
      const data = JSON.parse(content) as { accumulators?: Record<string, number> };
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
      console.error('[wallbox-history] Failed to save:', err);
    }
  }

  stop(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.save();
  }
}
