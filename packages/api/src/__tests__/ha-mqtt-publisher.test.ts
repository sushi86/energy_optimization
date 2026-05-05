import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { HaMqttClient } from '../infra/ha/ha-mqtt-client.js';
import { HaMqttPublisher } from '../infra/ha/ha-mqtt-publisher.js';
import mqtt from 'mqtt';

function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
  return new Promise((resolve) => {
    const broker = new Aedes();
    const server = createServer(broker.handle);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ broker, server, port });
    });
  });
}

describe('HaMqttPublisher', () => {
  let broker: Aedes; let server: Server; let port: number;
  let client: HaMqttClient;

  beforeEach(async () => { ({ broker, server, port } = await startBroker()); });
  afterEach(async () => {
    if (client) await client.stop();
    await new Promise<void>((r) => server.close(() => broker.close(() => r())));
  });

  it('publishes service call to correct topic with JSON payload', async () => {
    client = new HaMqttClient({ url: `mqtt://localhost:${port}` });
    await client.start();
    const publisher = new HaMqttPublisher(client);

    const spy = mqtt.connect(`mqtt://localhost:${port}`);
    const messages: { topic: string; payload: string }[] = [];
    await new Promise<void>((r) => spy.on('connect', () => { spy.subscribe('energy_control/service/+/+', () => r()); }));
    spy.on('message', (topic, payload) => messages.push({ topic, payload: payload.toString() }));

    await publisher.callService('cover', 'set_cover_position', {
      entity_id: 'cover.galerie_rolladen', position: 20,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(1);
    expect(messages[0].topic).toBe('energy_control/service/cover/set_cover_position');
    expect(JSON.parse(messages[0].payload)).toEqual({
      entity_id: 'cover.galerie_rolladen', position: 20,
    });

    spy.end();
  });
});
