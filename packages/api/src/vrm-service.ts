const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';

export interface VrmServiceOptions {
  token: string;
  siteId: string;
  refreshIntervalMs?: number;
}

export interface ForecastHour {
  timestamp: Date;
  powerW: number;
}

export interface Forecast {
  hours: ForecastHour[];
  totalKwh: number;
  /** Duration of each slot in hours (0.25 for 15-min, 1.0 for hourly) */
  intervalHours: number;
}

export class VrmService {
  private options: VrmServiceOptions;
  private forecast: Forecast = { hours: [], totalKwh: 0, intervalHours: 0.25 };
  private actualYield: ForecastHour[] = [];
  private forecastTimer: ReturnType<typeof setInterval> | null = null;
  private actualYieldTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: VrmServiceOptions) {
    this.options = options;
  }

  startAutoRefresh(): void {
    const forecastInterval = this.options.refreshIntervalMs ?? 30 * 60 * 1000;
    this.forecastTimer = setInterval(() => {
      void this.refreshForecast();
    }, forecastInterval);

    // Actual yield: refresh every 15 min (at :05, :20, :35, :50)
    // so the completed 15-min slot is always up-to-date
    this.scheduleNextActualYieldRefresh();
  }

  private scheduleNextActualYieldRefresh(): void {
    const now = new Date();
    const next = new Date(now);
    // Align to 15-min boundaries + 5 min offset: :05, :20, :35, :50
    const currentQuarter = Math.floor(now.getMinutes() / 15);
    const nextQuarterMin = (currentQuarter + 1) * 15 + 5;
    next.setMinutes(nextQuarterMin, 0, 0);
    if (next <= now) {
      next.setMinutes(next.getMinutes() + 15);
    }
    const delayMs = next.getTime() - now.getTime();
    console.log(`[vrm] Next actual yield refresh at ${next.toLocaleTimeString('de-DE')} (in ${Math.round(delayMs / 1000)}s)`);
    this.actualYieldTimer = setTimeout(() => {
      void this.refreshActualYield();
      this.scheduleNextActualYieldRefresh();
    }, delayMs);
  }

  private getTimeBounds(): { startOfDay: number; endOfDay: number } {
    // Use local midnight (Europe/Berlin), not UTC midnight
    const now = new Date();
    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDay = Math.floor(local.getTime() / 1000);
    const endOfDay = startOfDay + 86400;
    return { startOfDay, endOfDay };
  }

  private async fetchVrmStats(type: string, recordKey: string): Promise<ForecastHour[]> {
    const { startOfDay, endOfDay } = this.getTimeBounds();

    const params = new URLSearchParams({
      type,
      interval: '15mins',
      start: String(startOfDay),
      end: String(endOfDay),
    });

    const url = `${VRM_BASE_URL}/installations/${this.options.siteId}/stats?${params}`;
    const res = await fetch(url, {
      headers: { 'X-Authorization': `Token ${this.options.token}` },
    });

    if (!res.ok) {
      throw new Error(`VRM API HTTP ${res.status}`);
    }

    const data = await res.json();
    const records = data.records;
    if (!records || typeof records !== 'object') return [];

    const entries = records[recordKey];
    if (!Array.isArray(entries)) return [];

    const hours: ForecastHour[] = [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2 || entry[1] == null) continue;
      // VRM API may return timestamps in milliseconds or seconds — auto-detect
      const raw = entry[0] as number;
      const ts = raw < 1e12 ? raw * 1000 : raw; // seconds if < ~2001 in ms, else already ms
      hours.push({ timestamp: new Date(ts), powerW: entry[1] as number });
    }

    if (hours.length > 0) {
      const raw0 = entries[0][0];
      const parsed = hours[0].timestamp;
      console.log(`[vrm] ${type}/${recordKey}: ${hours.length} entries, raw[0]=${raw0}, parsed=${parsed.toISOString()}`);
    }

    return hours;
  }

  async refreshForecast(): Promise<void> {
    try {
      const intervalHours = 0.25; // 15-min slots
      const hours = await this.fetchVrmStats('forecast', 'solar_yield_forecast');

      // VRM forecast is hourly: only :00 entries have values, :15/:30/:45 are 0.
      // Interpolate between hourly values for smooth 15-min transitions.
      // First, collect the hourly anchor values.
      const hourlyAnchors: Array<{ index: number; powerW: number }> = [];
      for (let i = 0; i < hours.length; i++) {
        if (hours[i].timestamp.getMinutes() === 0) {
          hourlyAnchors.push({ index: i, powerW: hours[i].powerW });
        }
      }

      // Interpolate between anchors
      for (let a = 0; a < hourlyAnchors.length; a++) {
        const curr = hourlyAnchors[a];
        const next = a + 1 < hourlyAnchors.length ? hourlyAnchors[a + 1] : null;

        for (let q = 1; q <= 3; q++) {
          const slotIdx = curr.index + q;
          if (slotIdx >= hours.length) break;
          if (hours[slotIdx].timestamp.getMinutes() !== q * 15) continue;

          if (next) {
            // Linear interpolation: q/4 of the way from curr to next
            const t = q / 4;
            hours[slotIdx].powerW = Math.max(0, Math.round(
              curr.powerW + (next.powerW - curr.powerW) * t,
            ));
          } else {
            // Last hour: no next value, keep flat
            hours[slotIdx].powerW = curr.powerW;
          }
        }
      }

      let totalWh = 0;
      for (const h of hours) totalWh += h.powerW * intervalHours;
      this.forecast = { hours, totalKwh: totalWh / 1000, intervalHours };
    } catch (err) {
      console.error('[vrm] Forecast refresh error:', (err as Error).message);
    }
  }

  async refreshActualYield(): Promise<void> {
    try {
      // Total PV yield = Pg (PV→Grid) + Pc (PV→Consumption) + Pb (PV→Battery)
      // VRM 'kwh' type returns these components in kWh — convert to Wh
      const { startOfDay, endOfDay } = this.getTimeBounds();

      const params = new URLSearchParams({
        type: 'kwh',
        interval: '15mins',
        start: String(startOfDay),
        end: String(endOfDay),
      });

      const url = `${VRM_BASE_URL}/installations/${this.options.siteId}/stats?${params}`;
      const res = await fetch(url, {
        headers: { 'X-Authorization': `Token ${this.options.token}` },
      });

      if (!res.ok) throw new Error(`VRM API HTTP ${res.status}`);

      const data = await res.json();
      const records = data.records;
      if (!records || typeof records !== 'object') return;

      // Sum Pg + Pc + Pb per timestamp
      const byTimestamp = new Map<number, number>();
      for (const key of ['Pg', 'Pc', 'Pb']) {
        const entries = records[key];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length < 2 || entry[1] == null) continue;
          const ts = entry[0] as number;
          byTimestamp.set(ts, (byTimestamp.get(ts) ?? 0) + (entry[1] as number));
        }
      }

      const hours: ForecastHour[] = [];
      for (const [ts, kwh] of byTimestamp) {
        // kwh is energy per 15-min interval; convert to average power (W)
        // VRM API may return timestamps in seconds or milliseconds — auto-detect
        const tsMs = ts < 1e12 ? ts * 1000 : ts;
        hours.push({ timestamp: new Date(tsMs), powerW: kwh * 4 * 1000 });
      }
      hours.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      this.actualYield = hours;
    } catch (err) {
      console.error('[vrm] Actual yield refresh error:', (err as Error).message);
    }
  }

  getForecast(): Forecast {
    return this.forecast;
  }

  getActualYield(): ForecastHour[] {
    return this.actualYield;
  }

  isWinterMode(batteryCapacityKwh: number, thresholdFactor: number): boolean {
    return this.forecast.totalKwh < batteryCapacityKwh * thresholdFactor;
  }

  getRemainingForecastKwh(): number {
    const now = new Date();
    let remainingWh = 0;
    const ih = this.forecast.intervalHours;
    for (const hour of this.forecast.hours) {
      if (hour.timestamp >= now) {
        remainingWh += hour.powerW * ih;
      }
    }
    return remainingWh / 1000;
  }

  stop(): void {
    if (this.forecastTimer) clearInterval(this.forecastTimer);
    if (this.actualYieldTimer) clearTimeout(this.actualYieldTimer);
  }
}
