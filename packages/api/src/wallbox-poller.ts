interface VitalsResponse {
  contactor_closed: boolean;
  vehicle_connected: boolean;
  vehicle_current_a: number;
  grid_v: number;
  session_energy_wh: number;
}

export interface WallboxPollerOptions {
  url: string;
}

export class WallboxPoller {
  private url: string;
  private powerW: number | null = null;
  private charging: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WallboxPollerOptions) {
    this.url = options.url;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getPowerW(): number | null {
    return this.powerW;
  }

  isCharging(): boolean {
    return this.charging;
  }

  async poll(): Promise<void> {
    try {
      const res = await fetch(`${this.url}/api/1/vitals`);
      const data = (await res.json()) as VitalsResponse;
      this.powerW = Math.round(data.vehicle_current_a * data.grid_v);
      this.charging = data.contactor_closed;
    } catch (err) {
      console.error('[wallbox] Poll error:', (err as Error).message);
      // Keep last known values
    }
  }
}
