import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { HaMqttClient } from '../infra/ha/ha-mqtt-client.js';
import { HaMqttListener } from '../infra/ha/ha-mqtt-listener.js';

function startBroker(): Promise<{ broker: Aedes; server: Server; port: number }> {
  return new Promise((resolve) => {
    const broker = new Aedes();
    const server = createServer(broker.handle);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ broker, server, port });
    });
  });
}

function stopBroker(broker: Aedes, server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => broker.close(() => resolve()));
  });
}

describe('HaMqttListener', () => {
  let broker: Aedes; let server: Server; let port: number;
  let client: HaMqttClient; let listener: HaMqttListener;

  beforeEach(async () => { ({ broker, server, port } = await startBroker()); });
  afterEach(async () => {
    if (client) await client.stop();
    await stopBroker(broker, server);
  });

  it('emits coverPosition event when current_position arrives', async () => {
    client = new HaMqttClient({ url: `mqtt://127.0.0.1:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: { entityId: string; position: number }[] = [];
    listener.on('coverPosition', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/cover/galerie_rolladen/current_position',
      payload: Buffer.from('42'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual([{ entityId: 'cover.galerie_rolladen', position: 42 }]);
  });

  it('emits sensorValue event when sensor state arrives', async () => {
    client = new HaMqttClient({ url: `mqtt://127.0.0.1:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: { entityId: string; value: number }[] = [];
    listener.on('sensorValue', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/sensor/temp_eg/state',
      payload: Buffer.from('23.4'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual([{ entityId: 'sensor.temp_eg', value: 23.4 }]);
  });

  it('ignores non-numeric sensor payloads', async () => {
    client = new HaMqttClient({ url: `mqtt://127.0.0.1:${port}` });
    await client.start();
    listener = new HaMqttListener(client);
    listener.start();

    const events: unknown[] = [];
    listener.on('sensorValue', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    broker.publish({
      topic: 'homeassistant/sensor/x/state',
      payload: Buffer.from('unavailable'),
      cmd: 'publish', qos: 0, dup: false, retain: false,
    }, () => {});

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });
});
