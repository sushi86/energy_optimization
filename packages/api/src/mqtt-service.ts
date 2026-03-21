import mqtt, { type MqttClient } from 'mqtt';
import { EventEmitter } from 'events';

export interface MqttServiceOptions {
  url: string;
  deviceId: string;
  largeChangeThresholdW?: number;
  startupGraceMs?: number;
}

export interface SystemState {
  pvPower: number;
  consumptionPower: number;
  gridPower: number;
  batteryPower: number;
  batterySoc: number;
  gridSetpoint: number;
  timestamp: Date;
}

export class MqttService extends EventEmitter {
  private client: MqttClient | null = null;
  private options: MqttServiceOptions;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  private pvPower = 0;
  private consumptionPhases: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
  private gridPhases: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
  private batteryPower = 0;
  private batterySoc = 0;
  private gridSetpoint = 0;

  private lastSetpointWriteTime = 0;
  private lastSetpointWriteValue: number | null = null;
  private lastKnownSetpoint: number | null = null;
  private startupGraceUntil = 0;

  constructor(options: MqttServiceOptions) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    const { url, deviceId } = this.options;
    const prefix = `N/${deviceId}/system/0/`;
    const settingsPrefix = `N/${deviceId}/settings/0/`;

    return new Promise((resolve) => {
      this.client = mqtt.connect(url, {
        clientId: `energy-control-${Date.now()}`,
        reconnectPeriod: 5000,
        keepalive: 60,
      });

      this.client.on('connect', () => {
        this.startupGraceUntil = Date.now() + (this.options.startupGraceMs ?? 10_000);
        const keepaliveTopic = `R/${deviceId}/keepalive`;
        this.client!.publish(keepaliveTopic, '');
        this.keepaliveInterval = setInterval(() => {
          this.client?.publish(keepaliveTopic, '');
        }, 50_000);

        const topics = [
          `${prefix}Dc/Pv/Power`,
          `${prefix}Ac/Consumption/+/Power`,
          `${prefix}Ac/Grid/+/Power`,
          `${prefix}Dc/Battery/Power`,
          `${prefix}Dc/Battery/Soc`,
          `${settingsPrefix}Settings/CGwacs/AcPowerSetPoint`,
        ];

        this.client!.subscribe(topics, () => {
          // Request initial values via R/ prefix
          const readTopics = [
            `R/${deviceId}/system/0/Dc/Pv/Power`,
            `R/${deviceId}/system/0/Ac/Consumption/L1/Power`,
            `R/${deviceId}/system/0/Ac/Consumption/L2/Power`,
            `R/${deviceId}/system/0/Ac/Consumption/L3/Power`,
            `R/${deviceId}/system/0/Ac/Grid/L1/Power`,
            `R/${deviceId}/system/0/Ac/Grid/L2/Power`,
            `R/${deviceId}/system/0/Ac/Grid/L3/Power`,
            `R/${deviceId}/system/0/Dc/Battery/Power`,
            `R/${deviceId}/system/0/Dc/Battery/Soc`,
            `R/${deviceId}/settings/0/Settings/CGwacs/AcPowerSetPoint`,
          ];
          for (const topic of readTopics) {
            this.client!.publish(topic, '');
          }

          resolve();
        });
      });

      this.client.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          const value = payload.value;
          if (typeof value !== 'number') return;

          if (topic.includes('Settings/CGwacs/AcPowerSetPoint')) {
            this.handleSetpointMessage(value);
            return;
          }

          const suffix = topic.slice(prefix.length);
          this.handleSystemMessage(suffix, value);
        } catch {
          // Ignore parse errors
        }
      });

      this.client.on('error', (err) => console.error('[mqtt] Error:', err.message));
    });
  }

  private handleSystemMessage(suffix: string, value: number): void {
    const threshold = this.options.largeChangeThresholdW ?? 3000;

    if (suffix === 'Dc/Pv/Power') {
      const oldTotal = this.pvPower;
      this.pvPower = value;
      if (Math.abs(value - oldTotal) >= threshold) {
        this.emit('largeChange', 'pvPower');
      }
    } else if (suffix.startsWith('Ac/Consumption/')) {
      const parts = suffix.split('/');
      const phase = parts[2];
      const oldTotal = Object.values(this.consumptionPhases).reduce((a, b) => a + b, 0);
      this.consumptionPhases[phase] = value;
      const newTotal = Object.values(this.consumptionPhases).reduce((a, b) => a + b, 0);
      if (Math.abs(newTotal - oldTotal) >= threshold) {
        this.emit('largeChange', 'consumptionPower');
      }
    } else if (suffix.startsWith('Ac/Grid/')) {
      const parts = suffix.split('/');
      const phase = parts[2];
      this.gridPhases[phase] = value;
    } else if (suffix === 'Dc/Battery/Power') {
      this.batteryPower = value;
    } else if (suffix === 'Dc/Battery/Soc') {
      this.batterySoc = value;
    }

    this.emit('stateChange');
  }

  private handleSetpointMessage(value: number): void {
    this.gridSetpoint = value;

    // Ignore setpoint messages during startup grace period (retained messages from broker)
    if (Date.now() < this.startupGraceUntil) {
      this.lastKnownSetpoint = value;
      return;
    }

    // Ignore echo of our own writes (within 5s and same value)
    const timeSinceWrite = Date.now() - this.lastSetpointWriteTime;
    if (timeSinceWrite < 5000 && this.lastSetpointWriteValue === value) {
      this.lastKnownSetpoint = value;
      return;
    }

    // Only emit if the value actually changed
    if (this.lastKnownSetpoint !== null && value === this.lastKnownSetpoint) {
      return;
    }

    this.lastKnownSetpoint = value;
    this.emit('externalSetpointChange', value);
  }

  async setGridSetpoint(valueW: number): Promise<void> {
    if (!this.client) return;
    const topic = `W/${this.options.deviceId}/settings/0/Settings/CGwacs/AcPowerSetPoint`;
    this.lastSetpointWriteTime = Date.now();
    this.lastSetpointWriteValue = valueW;
    return new Promise((resolve) => {
      this.client!.publish(topic, JSON.stringify({ value: valueW }), () => resolve());
    });
  }

  getState(): SystemState {
    return {
      pvPower: this.pvPower,
      consumptionPower: Object.values(this.consumptionPhases).reduce((a, b) => a + b, 0),
      gridPower: Object.values(this.gridPhases).reduce((a, b) => a + b, 0),
      batteryPower: this.batteryPower,
      batterySoc: this.batterySoc,
      gridSetpoint: this.gridSetpoint,
      timestamp: new Date(),
    };
  }

  getInverterPhases(): {
    L1: number; L2: number; L3: number;
    feedIn: { L1: number; L2: number; L3: number };
    selfConsumption: { L1: number; L2: number; L3: number };
    grid: { L1: number; L2: number; L3: number };
    consumption: { L1: number; L2: number; L3: number };
  } {
    const result = {} as ReturnType<MqttService['getInverterPhases']>;
    const feedIn = { L1: 0, L2: 0, L3: 0 };
    const selfConsumption = { L1: 0, L2: 0, L3: 0 };
    for (const phase of ['L1', 'L2', 'L3'] as const) {
      const total = this.consumptionPhases[phase] - this.gridPhases[phase];
      result[phase] = total;
      if (total > 0) {
        // grid negative = exporting, that portion is feed-in
        const phaseExport = Math.max(0, -this.gridPhases[phase]);
        feedIn[phase] = Math.min(phaseExport, total);
        selfConsumption[phase] = total - feedIn[phase];
      }
    }
    result.feedIn = feedIn;
    result.selfConsumption = selfConsumption;
    result.grid = { ...this.gridPhases } as { L1: number; L2: number; L3: number };
    result.consumption = { ...this.consumptionPhases } as { L1: number; L2: number; L3: number };
    return result;
  }

  async stop(): Promise<void> {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, () => resolve()));
    }
  }
}
