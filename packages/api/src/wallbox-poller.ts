interface VitalsResponse {
  contactor_closed: boolean;
  vehicle_connected: boolean;
  vehicle_current_a: number;
  grid_v: number;
  currentA_a: number;
  currentB_a: number;
  currentC_a: number;
  voltageA_v: number;
  voltageB_v: number;
  voltageC_v: number;
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
      this.charging = data.contactor_closed;
      this.powerW = this.charging
        ? Math.round(
            data.currentA_a * data.voltageA_v +
            data.currentB_a * data.voltageB_v +
            data.currentC_a * data.voltageC_v,
          )
        : 0;
    } catch (err) {
      console.error('[wallbox] Poll error:', (err as Error).message);
      // Keep last known values
    }
  }
}
