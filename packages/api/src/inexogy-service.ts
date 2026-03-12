const BASE_URL = 'https://api.inexogy.com/public/v1';

export interface InexogyReading {
  time: Date;
  powerW: number;
  energyKwh: number;
  energyOutKwh: number;
}

export interface InexogyServiceConfig {
  email: string;
  password: string;
  meterId?: string;
}

export class InexogyService {
  private email: string;
  private password: string;
  private meterId: string | undefined;

  constructor(config: InexogyServiceConfig) {
    this.email = config.email;
    this.password = config.password;
    this.meterId = config.meterId;
  }

  private get authHeader(): string {
    return 'Basic ' + btoa(`${this.email}:${this.password}`);
  }

  private async resolveMeterId(): Promise<string> {
    if (this.meterId) return this.meterId;

    const res = await fetch(`${BASE_URL}/meters`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`inexogy API error: ${res.status}`);

    const meters = (await res.json()) as { meterId: string; measurementType: string }[];
    const elec = meters.find((m) => m.measurementType === 'ELECTRICITY');
    if (!elec) throw new Error('No electricity meter found');

    this.meterId = elec.meterId;
    return this.meterId;
  }

  async getReadings(from: Date, to: Date): Promise<InexogyReading[]> {
    const meterId = await this.resolveMeterId();

    const params = new URLSearchParams({
      meterId,
      from: from.getTime().toString(),
      to: to.getTime().toString(),
      resolution: 'fifteen_minutes',
      fields: 'energy,energyOut,power',
    });

    const res = await fetch(`${BASE_URL}/readings?${params}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`inexogy API error: ${res.status}`);

    const raw = (await res.json()) as { time: number; values: Record<string, number> }[];

    return raw.map((r) => ({
      time: new Date(r.time),
      powerW: Math.round((r.values.power ?? 0) / 1000),
      energyKwh: Math.round(((r.values.energy ?? 0) / 1e10) * 100) / 100,
      energyOutKwh: Math.round(((r.values.energyOut ?? 0) / 1e10) * 100) / 100,
    }));
  }

  getMeterId(): string | undefined {
    return this.meterId;
  }
}
