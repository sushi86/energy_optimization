import type { Forecast, ForecastHour } from './vrm-service.js';

const API_BASE = 'https://api.forecast.solar/estimate';

export interface ForecastSolarConfig {
  latitude: number;
  longitude: number;
  tiltDeg: number;
  azimuthDeg: number;
  kwp: number;
}

interface ForecastSolarApiResponse {
  result: {
    watts: Record<string, number>;
    watt_hours_day: Record<string, number>;
  };
}

export class ForecastSolarService {
  private config: ForecastSolarConfig;
  private forecast: Forecast = { hours: [], totalKwh: 0, intervalHours: 1 };

  constructor(config: ForecastSolarConfig) {
    this.config = { ...config };
  }

  updateConfig(config: ForecastSolarConfig): void {
    this.config = { ...config };
  }

  async refresh(): Promise<void> {
    const { kwp, tiltDeg, azimuthDeg, latitude, longitude } = this.config;
    const url = `${API_BASE}/${kwp}/${tiltDeg}/${azimuthDeg}/${latitude}/${longitude}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as ForecastSolarApiResponse;
      const watts = data.result.watts;
      const wattHoursDay = data.result.watt_hours_day;

      const hours: ForecastHour[] = Object.entries(watts)
        .map(([dateStr, powerW]) => ({
          timestamp: parseBerlinDateTime(dateStr),
          powerW,
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const totalKwh =
        Object.values(wattHoursDay).reduce((sum, wh) => sum + wh, 0) / 1000;

      this.forecast = { hours, totalKwh, intervalHours: 1 };
    } catch {
      // Return empty forecast on any error
    }
  }

  getForecast(): Forecast {
    return this.forecast;
  }

  hasData(): boolean {
    return this.forecast.hours.length > 0;
  }
}

function parseBerlinDateTime(dateStr: string): Date {
  // dateStr format: "2026-03-09 08:00:00"
  // Parse as Europe/Berlin timezone
  const isoStr = dateStr.replace(' ', 'T');
  // Use Intl to determine the offset for this datetime in Europe/Berlin
  const naive = new Date(isoStr + 'Z'); // temporary UTC parse to get components

  // Format in Europe/Berlin to find the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  });

  // Get the offset string for this date in Berlin
  const parts = formatter.formatToParts(naive);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  // tzPart.value is like "GMT+01:00" or "GMT+02:00"
  const offsetMatch = tzPart?.value.match(/GMT([+-]\d{2}):(\d{2})/);

  let offsetStr = '+01:00'; // CET default
  if (offsetMatch) {
    offsetStr = `${offsetMatch[1]}:${offsetMatch[2]}`;
  }

  return new Date(`${isoStr}${offsetStr}`);
}
