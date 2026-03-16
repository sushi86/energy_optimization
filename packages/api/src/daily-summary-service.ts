import fs from 'node:fs';
import path from 'node:path';
import { energyEvents, type ProductionEndedEvent } from './energy-events.js';

export interface DailySummary {
  date: string;
  totalYieldKwh: number;
  feedInKwh: number;
  revenueFixedCent: number;
  revenueMarketCent: number;
}

export class DailySummaryService {
  constructor(private dataDir: string) {
    energyEvents.on('pv:production-ended', (event) => this.handleProductionEnded(event));
    console.log('[daily-summary] Service started');
  }

  private handleProductionEnded(event: ProductionEndedEvent): void {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const summary: DailySummary = {
      date: today,
      totalYieldKwh: event.totalYieldKwh,
      feedInKwh: event.feedInKwh,
      revenueFixedCent: event.revenueFixedCent,
      revenueMarketCent: event.revenueMarketCent,
    };

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dataDir, `${today}.json`),
      JSON.stringify(summary),
      'utf-8',
    );
    console.log(`[daily-summary] Saved summary for ${today}`);
  }

  getSummary(date: string): DailySummary | null {
    try {
      const content = fs.readFileSync(path.join(this.dataDir, `${date}.json`), 'utf-8');
      return JSON.parse(content) as DailySummary;
    } catch {
      return null;
    }
  }

  getAllSummaries(): DailySummary[] {
    try {
      const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json')).sort();
      return files.map(f => {
        const content = fs.readFileSync(path.join(this.dataDir, f), 'utf-8');
        return JSON.parse(content) as DailySummary;
      });
    } catch {
      return [];
    }
  }
}
