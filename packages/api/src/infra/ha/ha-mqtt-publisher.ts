import type { HaMqttClient } from './ha-mqtt-client.js';

export class HaMqttPublisher {
  constructor(private client: HaMqttClient) {}

  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const topic = `energy_control/service/${domain}/${service}`;
    return this.client.publish(topic, JSON.stringify(data));
  }
}
