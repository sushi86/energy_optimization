const CURRENT_POWER_VARIABLE_ID = 43141;
const INVALID_SENSOR_VALUE = -32768;
const POLL_INTERVAL_MS = 60_000;

export interface NibePollerOptions {
  url: string;
  username: string;
  password: string;
}

export class NibePoller {
  private options: NibePollerOptions;
  private powerW: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NibePollerOptions) {
    this.options = options;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getPowerW(): number | null {
    return this.powerW;
  }

  async poll(): Promise<void> {
    const { url, username, password } = this.options;
    const endpoint = `${url}/api/v1/devices/0/points`;
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        console.error(`[nibe] HTTP error ${res.status}`);
        return;
      }

      const data = await res.json() as Array<{ variableId: number; value: number }>;
      const point = data.find((p) => p.variableId === CURRENT_POWER_VARIABLE_ID);

      if (!point) {
        console.warn('[nibe] variableId 43141 not found in response');
        this.powerW = null;
        return;
      }

      if (point.value === INVALID_SENSOR_VALUE) {
        console.warn('[nibe] Sensor invalid (value -32768)');
        this.powerW = null;
        return;
      }

      // Raw value / 100 = kW, × 1000 = W
      this.powerW = (point.value / 100) * 1000;
    } catch (err) {
      console.error('[nibe] Fetch error, keeping last value:', (err as Error).message);
      // Keep last known value — do not reset to null
    }
  }
}
