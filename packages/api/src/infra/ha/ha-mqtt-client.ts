import mqtt, { type MqttClient } from 'mqtt';

export interface HaMqttClientOptions {
  url: string;
  username?: string;
  password?: string;
  clientId?: string;
}

export class HaMqttClient {
  private client: MqttClient | null = null;
  private connectedListeners = new Set<() => void>();
  private messageListeners = new Set<(topic: string, payload: Buffer) => void>();

  constructor(private options: HaMqttClientOptions) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.client = mqtt.connect(this.options.url, {
        clientId: this.options.clientId ?? `energy-control-ha-${Date.now()}`,
        username: this.options.username,
        password: this.options.password,
        reconnectPeriod: 5000,
        connectTimeout: 10_000,
        clean: true,
      });

      this.client.on('connect', () => {
        for (const cb of this.connectedListeners) cb();
        resolve();
      });
      this.client.on('message', (topic, payload) => {
        for (const cb of this.messageListeners) cb(topic, payload);
      });
      this.client.on('error', (err) => {
        console.error('[ha-mqtt] error:', err.message);
      });
    });
  }

  onConnected(cb: () => void): void { this.connectedListeners.add(cb); }
  onMessage(cb: (topic: string, payload: Buffer) => void): void { this.messageListeners.add(cb); }

  subscribe(topics: string | string[]): void {
    if (!this.client) throw new Error('HaMqttClient not started');
    this.client.subscribe(topics);
  }

  publish(topic: string, payload: string): Promise<void> {
    if (!this.client) throw new Error('HaMqttClient not started');
    return new Promise((resolve, reject) => {
      this.client!.publish(topic, payload, (err) => err ? reject(err) : resolve());
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, () => resolve()));
      this.client = null;
    }
  }
}
