import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { MqttService } from '../mqtt-service.js';

const DEVICE_ID = 'test-device';

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

function stopBroker(broker: Aedes, server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      broker.close(() => resolve());
    });
  });
}

describe('MqttService', () => {
  let broker: Aedes;
  let server: Server;
  let port: number;
  let service: MqttService;

  beforeEach(async () => {
    ({ broker, server, port } = await startBroker());
  });

  afterEach(async () => {
    if (service) await service.stop();
    await stopBroker(broker, server);
  });

  it('receives PV power from MQTT', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    const topic = `N/${DEVICE_ID}/system/0/Dc/Pv/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 5000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(service.getState().pvPower).toBe(5000);
  });

  it('receives battery SOC from MQTT', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    const topic = `N/${DEVICE_ID}/system/0/Dc/Battery/Soc`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 75 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(service.getState().batterySoc).toBe(75);
  });

  it('calculates total consumption from phases', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    for (const phase of ['L1', 'L2', 'L3']) {
      const topic = `N/${DEVICE_ID}/system/0/Ac/Consumption/${phase}/Power`;
      broker.publish(
        { topic, payload: Buffer.from(JSON.stringify({ value: 1000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
        () => {}
      );
    }

    await new Promise((r) => setTimeout(r, 100));
    expect(service.getState().consumptionPower).toBe(3000);
  });

  it('writes grid setpoint via MQTT', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    const received: { topic: string; payload: string }[] = [];
    broker.on('publish', (packet) => {
      const payload = packet.payload.toString();
      if (packet.topic.includes('AcPowerSetPoint') && payload.length > 0) {
        received.push({ topic: packet.topic, payload });
      }
    });

    await service.setGridSetpoint(-2000);
    await new Promise((r) => setTimeout(r, 100));

    expect(received.length).toBeGreaterThan(0);
    expect(JSON.parse(received[0].payload)).toEqual({ value: -2000 });
  });

  it('detects external setpoint changes', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
      startupGraceMs: 0,
    });
    await service.start();

    const externalChanges: number[] = [];
    service.on('externalSetpointChange', (value: number) => {
      externalChanges.push(value);
    });

    const topic = `N/${DEVICE_ID}/settings/0/Settings/CGwacs/AcPowerSetPoint`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: -3000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(externalChanges).toEqual([-3000]);
  });

  it('does not emit external change for own setpoint writes', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    const externalChanges: number[] = [];
    service.on('externalSetpointChange', (value: number) => {
      externalChanges.push(value);
    });

    await service.setGridSetpoint(-2000);
    await new Promise((r) => setTimeout(r, 200));

    expect(externalChanges).toEqual([]);
  });

  it('emits largeChange for large power changes', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
      largeChangeThresholdW: 3000,
    });
    await service.start();

    const changes: string[] = [];
    service.on('largeChange', (field: string) => {
      changes.push(field);
    });

    const topic = `N/${DEVICE_ID}/system/0/Ac/Consumption/L1/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 1000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 50));

    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 5000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(changes).toContain('consumptionPower');
  });
});
