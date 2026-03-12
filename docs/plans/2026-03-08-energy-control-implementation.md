# Energy Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically control the Victron grid setpoint to maximize solar yield by spreading feed-in across the day based on forecast data, preventing power clipping when DC production exceeds AC capacity.

**Architecture:** pnpm monorepo with 3 packages: `api` (Fastify backend + WebSocket + controller logic), `web` (Next.js dashboard), `shared` (OpenAPI-generated types). Contract-first: all API changes start in `openapi/spec.yaml`. Stateless — all data in-memory. External interfaces (MQTT, VRM API) are injected and mockable.

**Tech Stack:** Node.js 22, TypeScript (strict), pnpm workspaces, Fastify, WebSocket (ws), Next.js 15, React 19, Tailwind CSS 4, Vitest, aedes (MQTT mock), OpenAPI 3.1, openapi-typescript

---

## Task 1: Repository Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/index.ts`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `openapi/spec.yaml`

**Step 1: Create root config files**

`package.json`:
```json
{
  "name": "energy-control",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter @energy-control/api dev",
    "dev:web": "pnpm --filter @energy-control/web dev",
    "build": "pnpm -r build",
    "test": "pnpm --filter @energy-control/api test",
    "generate:types": "pnpm --filter @energy-control/shared generate"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.next/
.env
*.tsbuildinfo
```

`.env.example`:
```bash
# Victron MQTT
VICTRON_MQTT_URL=tcp://192.168.1.224:1883
VICTRON_DEVICE_ID=c0619ab5450c

# Victron VRM
VICTRON_VRM_TOKEN=your-vrm-token
VICTRON_VRM_SITE_ID=your-site-id

# Defaults (overridable via API)
BATTERY_CAPACITY_KWH=16
MIN_SOC_PERCENT=20
TARGET_SOC_PERCENT=100
MAX_AC_POWER_W=12000
WINTER_MODE_THRESHOLD_FACTOR=1.2
REGULATION_INTERVAL_MS=60000
LARGE_CHANGE_THRESHOLD_W=3000
DEADBAND_W=1500
```

**Step 2: Create shared package**

`packages/shared/package.json`:
```json
{
  "name": "@energy-control/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "openapi-typescript ../openapi/spec.yaml -o src/api-types.ts && tsc",
    "generate": "openapi-typescript ../openapi/spec.yaml -o src/api-types.ts",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "openapi-typescript": "^7.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```typescript
export type * from './api-types.js';
```

**Step 3: Create api package**

`packages/api/package.json`:
```json
{
  "name": "@energy-control/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx --watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "@energy-control/shared": "workspace:*",
    "dotenv": "^17.2.4",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "mqtt": "^5.10.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "aedes": "^0.51.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/api/src/index.ts`:
```typescript
console.log('[energy-control] Starting...');
```

**Step 4: Create minimal OpenAPI spec**

`openapi/spec.yaml`:
```yaml
openapi: 3.1.0
info:
  title: Energy Control API
  version: 0.1.0
  description: Intelligent grid setpoint controller for Victron solar systems
paths:
  /api/health:
    get:
      operationId: getHealth
      summary: Health check
      responses:
        '200':
          description: Service is healthy
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthResponse'
components:
  schemas:
    HealthResponse:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [ok]
```

**Step 5: Create web package (minimal Next.js)**

`packages/web/package.json`:
```json
{
  "name": "@energy-control/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start --port 3001"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],
    "outDir": null,
    "rootDir": null,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src", "app", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 6: Install dependencies and verify build**

Run: `pnpm install && pnpm build`
Expected: All packages build without errors.

**Step 7: Init git repo and commit**

```bash
git init
git add -A
git commit -m "chore: scaffold monorepo with api, web, shared packages"
```

---

## Task 2: OpenAPI Spec — Config & Status Endpoints

**Files:**
- Modify: `openapi/spec.yaml`

**Step 1: Add domain schemas to OpenAPI spec**

Add the following schemas to the OpenAPI spec. These define the core data model for the entire application:

```yaml
# Add to components/schemas:

    ControllerMode:
      type: string
      enum: [auto, manual, winter]

    SystemStatus:
      type: object
      required: [pv, grid, battery, consumption, controller, timestamp]
      properties:
        pv:
          type: object
          required: [power]
          properties:
            power:
              type: number
              description: Current PV power in watts
        grid:
          type: object
          required: [power, setpoint]
          properties:
            power:
              type: number
              description: Current grid power in watts (negative = feed-in)
            setpoint:
              type: number
              description: Current grid setpoint in watts
        battery:
          type: object
          required: [power, soc]
          properties:
            power:
              type: number
              description: Battery power in watts (positive = charging)
            soc:
              type: number
              description: State of charge in percent (0-100)
        consumption:
          type: object
          required: [power]
          properties:
            power:
              type: number
              description: Total consumption in watts
        controller:
          type: object
          required: [mode, activeSetpoint]
          properties:
            mode:
              $ref: '#/components/schemas/ControllerMode'
            activeSetpoint:
              type: number
              description: Currently active grid setpoint in watts
            reason:
              type: string
              description: Human-readable reason for current setpoint
        timestamp:
          type: string
          format: date-time

    ControllerConfig:
      type: object
      required: [batteryCapacityKwh, minSocPercent, targetSocPercent, maxAcPowerW, winterModeThresholdFactor, regulationIntervalMs, largeChangeThresholdW, deadbandW]
      properties:
        batteryCapacityKwh:
          type: number
        minSocPercent:
          type: number
        targetSocPercent:
          type: number
        maxAcPowerW:
          type: number
        winterModeThresholdFactor:
          type: number
        regulationIntervalMs:
          type: number
        largeChangeThresholdW:
          type: number
        deadbandW:
          type: number

    ForecastHour:
      type: object
      required: [timestamp, powerW]
      properties:
        timestamp:
          type: string
          format: date-time
        powerW:
          type: number
          description: Forecasted power in watts for this hour

    ForecastResponse:
      type: object
      required: [hours, totalKwh, winterModeActive]
      properties:
        hours:
          type: array
          items:
            $ref: '#/components/schemas/ForecastHour'
        totalKwh:
          type: number
          description: Total forecasted production for the day in kWh
        winterModeActive:
          type: boolean
          description: Whether winter mode threshold is met

    SetModeRequest:
      type: object
      required: [mode]
      properties:
        mode:
          $ref: '#/components/schemas/ControllerMode'

    SetSetpointRequest:
      type: object
      required: [setpointW]
      properties:
        setpointW:
          type: number

    ErrorResponse:
      type: object
      required: [error]
      properties:
        error:
          type: string
```

**Step 2: Add all API paths**

```yaml
# Add to paths:

  /api/status:
    get:
      operationId: getStatus
      summary: Current system status with live values and controller state
      responses:
        '200':
          description: Current system status
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SystemStatus'

  /api/forecast:
    get:
      operationId: getForecast
      summary: Today's solar forecast (hourly)
      responses:
        '200':
          description: Forecast data
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForecastResponse'

  /api/config:
    get:
      operationId: getConfig
      summary: Current controller configuration
      responses:
        '200':
          description: Current config
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ControllerConfig'
    put:
      operationId: updateConfig
      summary: Update controller configuration
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ControllerConfig'
      responses:
        '200':
          description: Updated config
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ControllerConfig'

  /api/controller/mode:
    post:
      operationId: setControllerMode
      summary: Switch controller mode (auto/manual/winter)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SetModeRequest'
      responses:
        '200':
          description: Mode updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SystemStatus'

  /api/controller/setpoint:
    put:
      operationId: setManualSetpoint
      summary: Set manual grid setpoint (only in manual mode)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SetSetpointRequest'
      responses:
        '200':
          description: Setpoint updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SystemStatus'
        '409':
          description: Not in manual mode
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
```

**Step 3: Generate types from spec**

Run: `cd packages/shared && pnpm generate && pnpm build`
Expected: `packages/shared/src/api-types.ts` is generated, `dist/` is built.

**Step 4: Commit**

```bash
git add openapi/spec.yaml packages/shared/src/api-types.ts
git commit -m "feat: add OpenAPI spec with all endpoints and generate types"
```

---

## Task 3: Config Module

**Files:**
- Create: `packages/api/src/config.ts`
- Create: `packages/api/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

`packages/api/src/__tests__/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads config with defaults', () => {
    process.env.VICTRON_VRM_TOKEN = 'test-token';
    process.env.VICTRON_VRM_SITE_ID = 'test-site';
    const config = loadConfig();
    expect(config.VICTRON_MQTT_URL).toBe('tcp://192.168.1.224:1883');
    expect(config.VICTRON_DEVICE_ID).toBe('c0619ab5450c');
    expect(config.BATTERY_CAPACITY_KWH).toBe(16);
    expect(config.MIN_SOC_PERCENT).toBe(20);
    expect(config.TARGET_SOC_PERCENT).toBe(100);
    expect(config.MAX_AC_POWER_W).toBe(12000);
    expect(config.WINTER_MODE_THRESHOLD_FACTOR).toBe(1.2);
    expect(config.REGULATION_INTERVAL_MS).toBe(60000);
    expect(config.LARGE_CHANGE_THRESHOLD_W).toBe(3000);
    expect(config.DEADBAND_W).toBe(1500);
  });

  it('overrides defaults from env', () => {
    process.env.VICTRON_VRM_TOKEN = 'test-token';
    process.env.VICTRON_VRM_SITE_ID = 'test-site';
    process.env.BATTERY_CAPACITY_KWH = '20';
    process.env.MIN_SOC_PERCENT = '30';
    const config = loadConfig();
    expect(config.BATTERY_CAPACITY_KWH).toBe(20);
    expect(config.MIN_SOC_PERCENT).toBe(30);
  });

  it('throws on missing required fields', () => {
    delete process.env.VICTRON_VRM_TOKEN;
    delete process.env.VICTRON_VRM_SITE_ID;
    expect(() => loadConfig()).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `loadConfig` not found

**Step 3: Write the implementation**

`packages/api/src/config.ts`:
```typescript
import { z } from 'zod';

const configSchema = z.object({
  VICTRON_MQTT_URL: z.string().default('tcp://192.168.1.224:1883'),
  VICTRON_DEVICE_ID: z.string().default('c0619ab5450c'),
  VICTRON_VRM_TOKEN: z.string().min(1),
  VICTRON_VRM_SITE_ID: z.string().min(1),
  BATTERY_CAPACITY_KWH: z.coerce.number().default(16),
  MIN_SOC_PERCENT: z.coerce.number().default(20),
  TARGET_SOC_PERCENT: z.coerce.number().default(100),
  MAX_AC_POWER_W: z.coerce.number().default(12000),
  WINTER_MODE_THRESHOLD_FACTOR: z.coerce.number().default(1.2),
  REGULATION_INTERVAL_MS: z.coerce.number().default(60000),
  LARGE_CHANGE_THRESHOLD_W: z.coerce.number().default(3000),
  DEADBAND_W: z.coerce.number().default(1500),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse(process.env);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test -- --run`
Expected: PASS — all 3 tests green

**Step 5: Commit**

```bash
git add packages/api/src/config.ts packages/api/src/__tests__/config.test.ts
git commit -m "feat: add config module with Zod validation and defaults"
```

---

## Task 4: MQTT Service

**Files:**
- Create: `packages/api/src/mqtt-service.ts`
- Create: `packages/api/src/__tests__/mqtt-service.test.ts`

The MQTT service subscribes to Victron topics, maintains current state in memory, and emits events when values change. It also writes the grid setpoint. Crucially, it detects external setpoint changes.

**Step 1: Write the failing tests**

`packages/api/src/__tests__/mqtt-service.test.ts`:
```typescript
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

    // Publish a PV power value via the broker
    const topic = `N/${DEVICE_ID}/system/0/Dc/Pv/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 5000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    // Wait for message processing
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
      if (packet.topic.includes('AcPowerSetPoint')) {
        received.push({ topic: packet.topic, payload: packet.payload.toString() });
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
    });
    await service.start();

    const externalChanges: number[] = [];
    service.on('externalSetpointChange', (value: number) => {
      externalChanges.push(value);
    });

    // Simulate external setpoint change (not from our service)
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

  it('emits onChange for large power changes', async () => {
    service = new MqttService({
      url: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
    });
    await service.start();

    const changes: string[] = [];
    service.on('largeChange', (field: string) => {
      changes.push(field);
    });

    // First value establishes baseline
    const topic = `N/${DEVICE_ID}/system/0/Ac/Consumption/L1/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 1000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 50));

    // Large jump (car starts charging)
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 5000 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(changes).toContain('consumptionPower');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `MqttService` not found

**Step 3: Write the implementation**

`packages/api/src/mqtt-service.ts`:
```typescript
import mqtt, { type MqttClient } from 'mqtt';
import { EventEmitter } from 'events';

export interface MqttServiceOptions {
  url: string;
  deviceId: string;
  largeChangeThresholdW?: number;
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
  private previousConsumption = 0;
  private previousPvPower = 0;

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

        this.client!.subscribe(topics, () => resolve());
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
      this.previousPvPower = oldTotal;
    } else if (suffix.startsWith('Ac/Consumption/')) {
      const parts = suffix.split('/');
      const phase = parts[2];
      const oldTotal = this.consumptionPower;
      this.consumptionPhases[phase] = value;
      const newTotal = this.consumptionPower;
      if (Math.abs(newTotal - oldTotal) >= threshold) {
        this.emit('largeChange', 'consumptionPower');
      }
      this.previousConsumption = oldTotal;
    } else if (suffix.startsWith('Ac/Grid/')) {
      const parts = suffix.split('/');
      const phase = parts[2];
      this.gridPhases[phase] = value;
    } else if (suffix === 'Dc/Battery/Power') {
      this.batteryPower = value;
    } else if (suffix === 'Dc/Battery/Soc') {
      this.batterySoc = value;
    }
  }

  private handleSetpointMessage(value: number): void {
    this.gridSetpoint = value;

    // If we recently wrote this exact value, ignore it (it's our own echo)
    const timeSinceWrite = Date.now() - this.lastSetpointWriteTime;
    if (timeSinceWrite < 5000 && this.lastSetpointWriteValue === value) {
      return;
    }

    this.emit('externalSetpointChange', value);
  }

  async setGridSetpoint(valueW: number): Promise<void> {
    if (!this.client) return;
    const topic = `N/${this.options.deviceId}/settings/0/Settings/CGwacs/AcPowerSetPoint`;
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

  get consumptionPower(): number {
    return Object.values(this.consumptionPhases).reduce((a, b) => a + b, 0);
  }

  async stop(): Promise<void> {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, () => resolve()));
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test -- --run`
Expected: All MQTT tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/mqtt-service.ts packages/api/src/__tests__/mqtt-service.test.ts
git commit -m "feat: add MQTT service with state tracking and external setpoint detection"
```

---

## Task 5: VRM Forecast Service

**Files:**
- Create: `packages/api/src/vrm-service.ts`
- Create: `packages/api/src/__tests__/vrm-service.test.ts`

**Step 1: Write the failing tests**

`packages/api/src/__tests__/vrm-service.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VrmService } from '../vrm-service.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createForecastResponse(hours: Array<{ timestamp: number; wh: number }>) {
  const records: Record<string, Array<[number, number]>> = {};
  // VRM forecast returns solar_yield_forecast as key
  records['solar_yield_forecast'] = hours.map((h) => [h.timestamp * 1000, h.wh]);
  return { records, success: true };
}

describe('VrmService', () => {
  let service: VrmService;

  beforeEach(() => {
    mockFetch.mockReset();
    service = new VrmService({
      token: 'test-token',
      siteId: 'test-site',
    });
  });

  afterEach(() => {
    service.stop();
  });

  it('fetches and caches forecast data', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createForecastResponse([
          { timestamp: now, wh: 2000 },
          { timestamp: now + 3600, wh: 4000 },
          { timestamp: now + 7200, wh: 3000 },
        ]),
    });

    await service.refreshForecast();
    const forecast = service.getForecast();

    expect(forecast.hours).toHaveLength(3);
    expect(forecast.totalKwh).toBeCloseTo(9.0);
  });

  it('returns empty forecast when no data', () => {
    const forecast = service.getForecast();
    expect(forecast.hours).toEqual([]);
    expect(forecast.totalKwh).toBe(0);
  });

  it('calls VRM API with correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createForecastResponse([]),
    });

    await service.refreshForecast();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('https://vrmapi.victronenergy.com/v2/installations/test-site/stats');
    expect(url).toContain('type=forecast');
    expect(url).toContain('interval=hours');
    expect(options.headers['X-Authorization']).toBe('Token test-token');
  });

  it('determines winter mode based on threshold', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Total 10 kWh — below 16 * 1.2 = 19.2 kWh threshold
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createForecastResponse([
          { timestamp: now, wh: 5000 },
          { timestamp: now + 3600, wh: 5000 },
        ]),
    });

    await service.refreshForecast();
    expect(service.isWinterMode(16, 1.2)).toBe(true);
  });

  it('is not winter mode when forecast exceeds threshold', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Total 25 kWh — above 19.2 kWh threshold
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        createForecastResponse([
          { timestamp: now, wh: 10000 },
          { timestamp: now + 3600, wh: 15000 },
        ]),
    });

    await service.refreshForecast();
    expect(service.isWinterMode(16, 1.2)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `VrmService` not found

**Step 3: Write the implementation**

`packages/api/src/vrm-service.ts`:
```typescript
const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';

export interface VrmServiceOptions {
  token: string;
  siteId: string;
  refreshIntervalMs?: number;
}

export interface ForecastHour {
  timestamp: Date;
  powerW: number;
}

export interface Forecast {
  hours: ForecastHour[];
  totalKwh: number;
}

export class VrmService {
  private options: VrmServiceOptions;
  private forecast: Forecast = { hours: [], totalKwh: 0 };
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: VrmServiceOptions) {
    this.options = options;
  }

  startAutoRefresh(): void {
    const interval = this.options.refreshIntervalMs ?? 30 * 60 * 1000;
    this.refreshTimer = setInterval(() => {
      void this.refreshForecast();
    }, interval);
  }

  async refreshForecast(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const startOfDay = now - (now % 86400);
      const endOfDay = startOfDay + 86400;

      const params = new URLSearchParams({
        type: 'forecast',
        interval: 'hours',
        start: String(startOfDay),
        end: String(endOfDay),
      });

      const url = `${VRM_BASE_URL}/installations/${this.options.siteId}/stats?${params}`;
      const res = await fetch(url, {
        headers: { 'X-Authorization': `Token ${this.options.token}` },
      });

      if (!res.ok) {
        throw new Error(`VRM API HTTP ${res.status}`);
      }

      const data = await res.json();
      const records = data.records;
      if (!records || typeof records !== 'object') return;

      const forecastEntries = records['solar_yield_forecast'];
      if (!Array.isArray(forecastEntries)) return;

      const hours: ForecastHour[] = [];
      let totalWh = 0;

      for (const entry of forecastEntries) {
        if (!Array.isArray(entry) || entry.length < 2 || entry[1] == null) continue;
        const timestamp = new Date(entry[0]); // VRM returns ms
        const wh = entry[1] as number;
        hours.push({ timestamp, powerW: wh });
        totalWh += wh;
      }

      this.forecast = { hours, totalKwh: totalWh / 1000 };
    } catch (err) {
      console.error('[vrm] Forecast refresh error:', (err as Error).message);
    }
  }

  getForecast(): Forecast {
    return this.forecast;
  }

  isWinterMode(batteryCapacityKwh: number, thresholdFactor: number): boolean {
    return this.forecast.totalKwh < batteryCapacityKwh * thresholdFactor;
  }

  getRemainingForecastKwh(): number {
    const now = new Date();
    let remainingWh = 0;
    for (const hour of this.forecast.hours) {
      if (hour.timestamp >= now) {
        remainingWh += hour.powerW;
      }
    }
    return remainingWh / 1000;
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test -- --run`
Expected: All VRM tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/vrm-service.ts packages/api/src/__tests__/vrm-service.test.ts
git commit -m "feat: add VRM forecast service with winter mode detection"
```

---

## Task 6: Controller (Regellogik)

**Files:**
- Create: `packages/api/src/controller.ts`
- Create: `packages/api/src/__tests__/controller.test.ts`

This is the core algorithm. It takes system state + forecast + config → computes the desired grid setpoint.

**Step 1: Write the failing tests**

`packages/api/src/__tests__/controller.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Controller, type ControllerDeps } from '../controller.js';
import type { SystemState } from '../mqtt-service.js';
import type { Forecast } from '../vrm-service.js';

function makeState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    pvPower: 8000,
    consumptionPower: 1000,
    gridPower: 0,
    batteryPower: 0,
    batterySoc: 50,
    gridSetpoint: 0,
    timestamp: new Date(),
    ...overrides,
  };
}

function makeForecast(totalKwh: number, remainingKwh?: number): Forecast {
  return {
    hours: [],
    totalKwh,
  };
}

function makeController(overrides: Partial<ControllerDeps> = {}): Controller {
  return new Controller({
    batteryCapacityKwh: 16,
    minSocPercent: 20,
    targetSocPercent: 100,
    maxAcPowerW: 12000,
    winterModeThresholdFactor: 1.2,
    deadbandW: 1500,
    ...overrides,
  });
}

describe('Controller', () => {
  describe('mode management', () => {
    it('starts in auto mode', () => {
      const ctrl = makeController();
      expect(ctrl.getMode()).toBe('auto');
    });

    it('can switch to manual mode', () => {
      const ctrl = makeController();
      ctrl.setMode('manual');
      expect(ctrl.getMode()).toBe('manual');
    });

    it('switches to manual on external setpoint change', () => {
      const ctrl = makeController();
      ctrl.handleExternalSetpointChange(-3000);
      expect(ctrl.getMode()).toBe('manual');
    });
  });

  describe('winter mode', () => {
    it('activates winter mode when forecast below threshold', () => {
      const ctrl = makeController();
      // 16 kWh * 1.2 = 19.2 kWh threshold, forecast is 15 kWh
      const result = ctrl.computeSetpoint(makeState(), makeForecast(15), 10);
      expect(result.mode).toBe('winter');
      expect(result.setpointW).toBe(0);
    });

    it('does not activate winter mode when forecast above threshold', () => {
      const ctrl = makeController();
      const result = ctrl.computeSetpoint(makeState(), makeForecast(25), 20);
      expect(result.mode).toBe('auto');
    });
  });

  describe('setpoint calculation', () => {
    it('returns 0 setpoint when SOC below minimum', () => {
      const ctrl = makeController();
      const state = makeState({ batterySoc: 15 }); // below 20%
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
      expect(result.reason).toContain('SOC');
    });

    it('returns 0 setpoint when PV production is below consumption', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 500, consumptionPower: 1000 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
    });

    it('feeds in surplus when battery will be full by end of day', () => {
      const ctrl = makeController();
      // SOC 50% → need 8 kWh to fill. Remaining forecast 25 kWh.
      // Surplus = 25 - 8 = 17 kWh. Hours remaining = 8h → ~2125W avg feed-in
      // With 8kW PV and 1kW consumption: plenty of surplus
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      // Setpoint should be negative (feed-in)
      expect(result.setpointW).toBeLessThan(0);
    });

    it('charges battery when insufficient forecast for full charge', () => {
      const ctrl = makeController();
      // SOC 20% → need 12.8 kWh. Remaining forecast only 15 kWh. Tight.
      const state = makeState({ pvPower: 3000, consumptionPower: 1000, batterySoc: 20 });
      const result = ctrl.computeSetpoint(state, makeForecast(20), 15);
      // Should prioritize battery charging, setpoint closer to 0
      expect(result.setpointW).toBeGreaterThanOrEqual(0);
    });
  });

  describe('deadband', () => {
    it('does not change setpoint for small differences', () => {
      const ctrl = makeController({ deadbandW: 1500 });
      const state = makeState({ pvPower: 8000, consumptionPower: 1000, batterySoc: 50 });
      const result1 = ctrl.computeSetpoint(state, makeForecast(30), 25);
      ctrl.applySetpoint(result1.setpointW);

      // Small change in consumption
      const state2 = makeState({ pvPower: 8000, consumptionPower: 1500, batterySoc: 50 });
      const result2 = ctrl.computeSetpoint(state2, makeForecast(30), 25);
      expect(result2.setpointW).toBe(result1.setpointW);
      expect(result2.reason).toContain('deadband');
    });
  });

  describe('safety', () => {
    it('falls back to 0 when no MQTT data available', () => {
      const ctrl = makeController();
      const state = makeState({ pvPower: 0, consumptionPower: 0, batterySoc: 0 });
      const result = ctrl.computeSetpoint(state, makeForecast(30), 25);
      expect(result.setpointW).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `Controller` not found

**Step 3: Write the implementation**

`packages/api/src/controller.ts`:
```typescript
import type { SystemState } from './mqtt-service.js';
import type { Forecast } from './vrm-service.js';

export type ControllerMode = 'auto' | 'manual' | 'winter';

export interface ControllerDeps {
  batteryCapacityKwh: number;
  minSocPercent: number;
  targetSocPercent: number;
  maxAcPowerW: number;
  winterModeThresholdFactor: number;
  deadbandW: number;
}

export interface SetpointResult {
  setpointW: number;
  mode: ControllerMode;
  reason: string;
}

export class Controller {
  private config: ControllerDeps;
  private mode: ControllerMode = 'auto';
  private lastAppliedSetpoint: number | null = null;

  constructor(config: ControllerDeps) {
    this.config = config;
  }

  getMode(): ControllerMode {
    return this.mode;
  }

  setMode(mode: ControllerMode): void {
    this.mode = mode;
  }

  updateConfig(config: Partial<ControllerDeps>): void {
    Object.assign(this.config, config);
  }

  handleExternalSetpointChange(valueW: number): void {
    this.mode = 'manual';
    this.lastAppliedSetpoint = valueW;
  }

  applySetpoint(valueW: number): void {
    this.lastAppliedSetpoint = valueW;
  }

  computeSetpoint(state: SystemState, forecast: Forecast, remainingForecastKwh: number): SetpointResult {
    const { batteryCapacityKwh, minSocPercent, targetSocPercent, winterModeThresholdFactor, deadbandW } = this.config;

    // Winter mode check
    if (forecast.totalKwh < batteryCapacityKwh * winterModeThresholdFactor) {
      return { setpointW: 0, mode: 'winter', reason: 'Winter mode: forecast below threshold' };
    }

    // Manual mode — don't compute, keep existing
    if (this.mode === 'manual') {
      return {
        setpointW: this.lastAppliedSetpoint ?? 0,
        mode: 'manual',
        reason: 'Manual mode active',
      };
    }

    // Safety: SOC below minimum
    if (state.batterySoc < minSocPercent) {
      return { setpointW: 0, mode: 'auto', reason: `SOC (${state.batterySoc}%) below minimum (${minSocPercent}%)` };
    }

    // Safety: no meaningful PV production
    if (state.pvPower <= state.consumptionPower) {
      return { setpointW: 0, mode: 'auto', reason: 'PV production below consumption' };
    }

    // Calculate how much energy the battery still needs
    const currentSocFraction = state.batterySoc / 100;
    const targetSocFraction = targetSocPercent / 100;
    const batteryNeedKwh = (targetSocFraction - currentSocFraction) * batteryCapacityKwh;

    // If battery is already at target, feed everything in
    if (batteryNeedKwh <= 0) {
      const setpoint = -(state.pvPower - state.consumptionPower);
      return { setpointW: setpoint, mode: 'auto', reason: 'Battery full, feeding in all surplus' };
    }

    // Calculate surplus: remaining forecast minus what battery needs
    const surplusKwh = remainingForecastKwh - batteryNeedKwh;

    if (surplusKwh <= 0) {
      // Not enough forecast to fill battery — prioritize charging
      return { setpointW: 0, mode: 'auto', reason: 'Prioritizing battery charge — tight forecast' };
    }

    // We have surplus. Spread the battery charging over remaining sun hours.
    // Calculate desired charging power: batteryNeedKwh spread over remaining hours
    const now = new Date();
    const sunsetApprox = new Date(now);
    sunsetApprox.setHours(20, 0, 0, 0); // Approximate sunset
    const remainingHours = Math.max(1, (sunsetApprox.getTime() - now.getTime()) / (3600 * 1000));

    const desiredChargePowerW = (batteryNeedKwh / remainingHours) * 1000;

    // Setpoint = we want the grid to take: -(PV - consumption - desiredCharge)
    const availableForGrid = state.pvPower - state.consumptionPower - desiredChargePowerW;
    const setpoint = availableForGrid > 0 ? -availableForGrid : 0;

    // Deadband: if difference to last setpoint is small, keep the old one
    if (this.lastAppliedSetpoint !== null) {
      const diff = Math.abs(setpoint - this.lastAppliedSetpoint);
      if (diff < deadbandW) {
        return {
          setpointW: this.lastAppliedSetpoint,
          mode: 'auto',
          reason: `Within deadband (${diff.toFixed(0)}W < ${deadbandW}W)`,
        };
      }
    }

    return {
      setpointW: Math.round(setpoint),
      mode: 'auto',
      reason: `Feeding in ${Math.abs(Math.round(setpoint))}W, charging at ${Math.round(desiredChargePowerW)}W (need ${batteryNeedKwh.toFixed(1)} kWh over ${remainingHours.toFixed(1)}h)`,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test -- --run`
Expected: All controller tests PASS

**Step 5: Commit**

```bash
git add packages/api/src/controller.ts packages/api/src/__tests__/controller.test.ts
git commit -m "feat: add grid setpoint controller with safety checks and deadband"
```

---

## Task 7: Fastify API Server + Health Endpoint

**Files:**
- Create: `packages/api/src/server.ts`
- Create: `packages/api/src/__tests__/server.test.ts`

**Step 1: Write the failing test**

`packages/api/src/__tests__/server.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('API Server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer({ testing: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `buildServer` not found

**Step 3: Write the implementation**

`packages/api/src/server.ts`:
```typescript
import Fastify, { type FastifyInstance } from 'fastify';

export interface ServerOptions {
  testing?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: !options.testing,
  });

  app.get('/api/health', async () => {
    return { status: 'ok' as const };
  });

  return app;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test -- --run`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/__tests__/server.test.ts
git commit -m "feat: add Fastify server with health endpoint"
```

---

## Task 8: Status, Config, and Controller API Endpoints

**Files:**
- Modify: `packages/api/src/server.ts`
- Create: `packages/api/src/app-state.ts`
- Create: `packages/api/src/__tests__/api-endpoints.test.ts`

The `AppState` class wires together MqttService, VrmService, Controller, and Config into a single injectable state object. For testing, we create it with mocked services.

**Step 1: Write the failing tests**

`packages/api/src/__tests__/api-endpoints.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import { buildServer } from '../server.js';
import { AppState } from '../app-state.js';
import type { FastifyInstance } from 'fastify';

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

describe('API Endpoints', () => {
  let broker: Aedes;
  let netServer: Server;
  let port: number;
  let app: FastifyInstance;
  let appState: AppState;

  beforeAll(async () => {
    ({ broker, server: netServer, port } = await startBroker());
    appState = await AppState.create({
      mqttUrl: `tcp://localhost:${port}`,
      deviceId: DEVICE_ID,
      vrmToken: 'test',
      vrmSiteId: 'test',
      batteryCapacityKwh: 16,
      minSocPercent: 20,
      targetSocPercent: 100,
      maxAcPowerW: 12000,
      winterModeThresholdFactor: 1.2,
      regulationIntervalMs: 60000,
      largeChangeThresholdW: 3000,
      deadbandW: 1500,
    });
    app = buildServer({ testing: true, appState });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await appState.stop();
    await new Promise<void>((resolve) => {
      netServer.close(() => {
        broker.close(() => resolve());
      });
    });
  });

  it('GET /api/status returns system status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('pv');
    expect(body).toHaveProperty('grid');
    expect(body).toHaveProperty('battery');
    expect(body).toHaveProperty('consumption');
    expect(body).toHaveProperty('controller');
    expect(body).toHaveProperty('timestamp');
  });

  it('GET /api/config returns config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batteryCapacityKwh).toBe(16);
    expect(body.minSocPercent).toBe(20);
  });

  it('PUT /api/config updates config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        batteryCapacityKwh: 20,
        minSocPercent: 25,
        targetSocPercent: 100,
        maxAcPowerW: 12000,
        winterModeThresholdFactor: 1.2,
        regulationIntervalMs: 60000,
        largeChangeThresholdW: 3000,
        deadbandW: 1500,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().batteryCapacityKwh).toBe(20);
  });

  it('POST /api/controller/mode sets mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'manual' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().controller.mode).toBe('manual');
  });

  it('PUT /api/controller/setpoint works in manual mode', async () => {
    // Ensure manual mode
    await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'manual' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/controller/setpoint',
      payload: { setpointW: -3000 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('PUT /api/controller/setpoint rejects when not in manual mode', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/controller/mode',
      payload: { mode: 'auto' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/controller/setpoint',
      payload: { setpointW: -3000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /api/forecast returns forecast', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/forecast' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('hours');
    expect(body).toHaveProperty('totalKwh');
    expect(body).toHaveProperty('winterModeActive');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — `AppState` not found

**Step 3: Write AppState**

`packages/api/src/app-state.ts`:
```typescript
import { MqttService } from './mqtt-service.js';
import { VrmService } from './vrm-service.js';
import { Controller } from './controller.js';

export interface AppStateOptions {
  mqttUrl: string;
  deviceId: string;
  vrmToken: string;
  vrmSiteId: string;
  batteryCapacityKwh: number;
  minSocPercent: number;
  targetSocPercent: number;
  maxAcPowerW: number;
  winterModeThresholdFactor: number;
  regulationIntervalMs: number;
  largeChangeThresholdW: number;
  deadbandW: number;
}

export class AppState {
  readonly mqtt: MqttService;
  readonly vrm: VrmService;
  readonly controller: Controller;
  private config: AppStateOptions;
  private regulationTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(options: AppStateOptions) {
    this.config = { ...options };
    this.mqtt = new MqttService({
      url: options.mqttUrl,
      deviceId: options.deviceId,
      largeChangeThresholdW: options.largeChangeThresholdW,
    });
    this.vrm = new VrmService({
      token: options.vrmToken,
      siteId: options.vrmSiteId,
    });
    this.controller = new Controller({
      batteryCapacityKwh: options.batteryCapacityKwh,
      minSocPercent: options.minSocPercent,
      targetSocPercent: options.targetSocPercent,
      maxAcPowerW: options.maxAcPowerW,
      winterModeThresholdFactor: options.winterModeThresholdFactor,
      deadbandW: options.deadbandW,
    });
  }

  static async create(options: AppStateOptions): Promise<AppState> {
    const state = new AppState(options);
    await state.mqtt.start();

    // External setpoint detection → switch to manual
    state.mqtt.on('externalSetpointChange', (value: number) => {
      state.controller.handleExternalSetpointChange(value);
    });

    // Large change → immediate regulation
    state.mqtt.on('largeChange', () => {
      void state.regulate();
    });

    return state;
  }

  startRegulation(): void {
    this.regulationTimer = setInterval(() => {
      void this.regulate();
    }, this.config.regulationIntervalMs);
    this.vrm.startAutoRefresh();
  }

  async regulate(): Promise<void> {
    const state = this.mqtt.getState();
    const forecast = this.vrm.getForecast();
    const remainingKwh = this.vrm.getRemainingForecastKwh();
    const result = this.controller.computeSetpoint(state, forecast, remainingKwh);

    if (result.mode === 'manual') return;

    this.controller.applySetpoint(result.setpointW);
    if (result.mode !== 'winter') {
      await this.mqtt.setGridSetpoint(result.setpointW);
    }
  }

  getConfig(): AppStateOptions {
    return { ...this.config };
  }

  updateConfig(updates: Partial<AppStateOptions>): AppStateOptions {
    Object.assign(this.config, updates);
    this.controller.updateConfig({
      batteryCapacityKwh: this.config.batteryCapacityKwh,
      minSocPercent: this.config.minSocPercent,
      targetSocPercent: this.config.targetSocPercent,
      maxAcPowerW: this.config.maxAcPowerW,
      winterModeThresholdFactor: this.config.winterModeThresholdFactor,
      deadbandW: this.config.deadbandW,
    });
    return { ...this.config };
  }

  async stop(): Promise<void> {
    if (this.regulationTimer) clearInterval(this.regulationTimer);
    this.vrm.stop();
    await this.mqtt.stop();
  }
}
```

**Step 4: Add API routes to server**

Update `packages/api/src/server.ts` to accept `appState` and register all routes:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppState } from './app-state.js';

export interface ServerOptions {
  testing?: boolean;
  appState?: AppState;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: !options.testing });
  const state = options.appState;

  app.get('/api/health', async () => {
    return { status: 'ok' as const };
  });

  app.get('/api/status', async () => {
    if (!state) throw new Error('AppState not initialized');
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: {
        mode: state.controller.getMode(),
        activeSetpoint: s.gridSetpoint,
      },
      timestamp: s.timestamp.toISOString(),
    };
  });

  app.get('/api/forecast', async () => {
    if (!state) throw new Error('AppState not initialized');
    const forecast = state.vrm.getForecast();
    const config = state.getConfig();
    return {
      hours: forecast.hours.map((h) => ({
        timestamp: h.timestamp.toISOString(),
        powerW: h.powerW,
      })),
      totalKwh: forecast.totalKwh,
      winterModeActive: state.vrm.isWinterMode(
        config.batteryCapacityKwh,
        config.winterModeThresholdFactor,
      ),
    };
  });

  app.get('/api/config', async () => {
    if (!state) throw new Error('AppState not initialized');
    const c = state.getConfig();
    return {
      batteryCapacityKwh: c.batteryCapacityKwh,
      minSocPercent: c.minSocPercent,
      targetSocPercent: c.targetSocPercent,
      maxAcPowerW: c.maxAcPowerW,
      winterModeThresholdFactor: c.winterModeThresholdFactor,
      regulationIntervalMs: c.regulationIntervalMs,
      largeChangeThresholdW: c.largeChangeThresholdW,
      deadbandW: c.deadbandW,
    };
  });

  app.put('/api/config', async (request) => {
    if (!state) throw new Error('AppState not initialized');
    const body = request.body as Record<string, number>;
    const updated = state.updateConfig(body);
    return {
      batteryCapacityKwh: updated.batteryCapacityKwh,
      minSocPercent: updated.minSocPercent,
      targetSocPercent: updated.targetSocPercent,
      maxAcPowerW: updated.maxAcPowerW,
      winterModeThresholdFactor: updated.winterModeThresholdFactor,
      regulationIntervalMs: updated.regulationIntervalMs,
      largeChangeThresholdW: updated.largeChangeThresholdW,
      deadbandW: updated.deadbandW,
    };
  });

  app.post('/api/controller/mode', async (request) => {
    if (!state) throw new Error('AppState not initialized');
    const { mode } = request.body as { mode: 'auto' | 'manual' | 'winter' };
    state.controller.setMode(mode);
    // Return full status
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: { mode: state.controller.getMode(), activeSetpoint: s.gridSetpoint },
      timestamp: s.timestamp.toISOString(),
    };
  });

  app.put('/api/controller/setpoint', async (request, reply) => {
    if (!state) throw new Error('AppState not initialized');
    if (state.controller.getMode() !== 'manual') {
      return reply.code(409).send({ error: 'Not in manual mode' });
    }
    const { setpointW } = request.body as { setpointW: number };
    await state.mqtt.setGridSetpoint(setpointW);
    state.controller.applySetpoint(setpointW);
    const s = state.mqtt.getState();
    return {
      pv: { power: s.pvPower },
      grid: { power: s.gridPower, setpoint: s.gridSetpoint },
      battery: { power: s.batteryPower, soc: s.batterySoc },
      consumption: { power: s.consumptionPower },
      controller: { mode: state.controller.getMode(), activeSetpoint: setpointW },
      timestamp: s.timestamp.toISOString(),
    };
  });

  return app;
}
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/api && pnpm test -- --run`
Expected: All API endpoint tests PASS

**Step 6: Commit**

```bash
git add packages/api/src/app-state.ts packages/api/src/server.ts packages/api/src/__tests__/api-endpoints.test.ts
git commit -m "feat: add REST API endpoints with AppState wiring"
```

---

## Task 9: WebSocket Support

**Files:**
- Modify: `packages/api/src/server.ts`
- Create: `packages/api/src/__tests__/websocket.test.ts`

**Step 1: Write the failing test**

`packages/api/src/__tests__/websocket.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Aedes from 'aedes';
import { createServer, type Server } from 'net';
import WebSocket from 'ws';
import { buildServer } from '../server.js';
import { AppState } from '../app-state.js';
import type { FastifyInstance } from 'fastify';

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

describe('WebSocket', () => {
  let broker: Aedes;
  let netServer: Server;
  let mqttPort: number;
  let app: FastifyInstance;
  let appState: AppState;

  beforeAll(async () => {
    ({ broker, server: netServer, port: mqttPort } = await startBroker());
    appState = await AppState.create({
      mqttUrl: `tcp://localhost:${mqttPort}`,
      deviceId: DEVICE_ID,
      vrmToken: 'test',
      vrmSiteId: 'test',
      batteryCapacityKwh: 16,
      minSocPercent: 20,
      targetSocPercent: 100,
      maxAcPowerW: 12000,
      winterModeThresholdFactor: 1.2,
      regulationIntervalMs: 60000,
      largeChangeThresholdW: 3000,
      deadbandW: 1500,
    });
    app = buildServer({ testing: true, appState });
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await appState.stop();
    await new Promise<void>((resolve) => {
      netServer.close(() => {
        broker.close(() => resolve());
      });
    });
  });

  it('receives real-time updates via WebSocket', async () => {
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    const messages: unknown[] = [];
    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Trigger a PV update via MQTT
    const topic = `N/${DEVICE_ID}/system/0/Dc/Pv/Power`;
    broker.publish(
      { topic, payload: Buffer.from(JSON.stringify({ value: 7500 })), cmd: 'publish', qos: 0, dup: false, retain: false },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    expect(messages.length).toBeGreaterThan(0);
    const lastMsg = messages[messages.length - 1] as Record<string, unknown>;
    expect(lastMsg).toHaveProperty('pv');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test -- --run`
Expected: FAIL — WebSocket route not registered

**Step 3: Add WebSocket support to server**

Add `@fastify/websocket` and `ws` to dependencies, then update `server.ts` to register a `/ws` route that broadcasts MQTT state changes. The MQTT service already emits events; we listen and forward to all connected WebSocket clients.

Add a `broadcastState()` method on the server that listens to MQTT message events and sends the current status to all connected clients (throttled to max 2 updates/second).

**Step 4: Run tests to verify they pass**

Run: `cd packages/api && pnpm test -- --run`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/__tests__/websocket.test.ts packages/api/package.json
git commit -m "feat: add WebSocket support for real-time updates"
```

---

## Task 10: Main Entry Point

**Files:**
- Modify: `packages/api/src/index.ts`

**Step 1: Wire everything together**

`packages/api/src/index.ts`:
```typescript
import 'dotenv/config';
import { loadConfig } from './config.js';
import { AppState } from './app-state.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();

  console.log('[energy-control] Starting...');

  const appState = await AppState.create({
    mqttUrl: config.VICTRON_MQTT_URL,
    deviceId: config.VICTRON_DEVICE_ID,
    vrmToken: config.VICTRON_VRM_TOKEN,
    vrmSiteId: config.VICTRON_VRM_SITE_ID,
    batteryCapacityKwh: config.BATTERY_CAPACITY_KWH,
    minSocPercent: config.MIN_SOC_PERCENT,
    targetSocPercent: config.TARGET_SOC_PERCENT,
    maxAcPowerW: config.MAX_AC_POWER_W,
    winterModeThresholdFactor: config.WINTER_MODE_THRESHOLD_FACTOR,
    regulationIntervalMs: config.REGULATION_INTERVAL_MS,
    largeChangeThresholdW: config.LARGE_CHANGE_THRESHOLD_W,
    deadbandW: config.DEADBAND_W,
  });

  // Fetch initial forecast
  await appState.vrm.refreshForecast();

  // Start regulation loop
  appState.startRegulation();

  const server = buildServer({ appState });
  await server.listen({ port: 3002, host: '0.0.0.0' });

  console.log('[energy-control] Server running on http://0.0.0.0:3002');

  const shutdown = async () => {
    console.log('[energy-control] Shutting down...');
    await server.close();
    await appState.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[energy-control] Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Verify build**

Run: `cd packages/api && pnpm build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat: add main entry point wiring all services together"
```

---

## Task 11: Next.js Frontend — Setup & Dashboard

**Files:**
- Create: `packages/web/app/layout.tsx`
- Create: `packages/web/app/page.tsx`
- Create: `packages/web/app/globals.css`
- Create: `packages/web/hooks/use-websocket.ts`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/next.config.ts`

**Step 1: Set up Next.js with Tailwind dark theme**

`packages/web/app/globals.css`:
```css
@import "tailwindcss";

:root {
  --accent: #10EFD8;
  --bg-primary: #0a0a0a;
  --bg-card: #141414;
  --bg-card-hover: #1a1a1a;
  --text-primary: #e5e5e5;
  --text-secondary: #a3a3a3;
  --border: #262626;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, sans-serif;
}
```

`packages/web/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

`packages/web/next.config.ts`:
```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:3002/api/:path*' },
      { source: '/ws', destination: 'http://localhost:3002/ws' },
    ];
  },
};

export default nextConfig;
```

**Step 2: Create WebSocket hook**

`packages/web/hooks/use-websocket.ts`:
```typescript
'use client';
import { useState, useEffect, useRef } from 'react';

interface SystemStatus {
  pv: { power: number };
  grid: { power: number; setpoint: number };
  battery: { power: number; soc: number };
  consumption: { power: number };
  controller: { mode: string; activeSetpoint: number; reason?: string };
  timestamp: string;
}

export function useWebSocket() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3s
      setTimeout(() => {
        wsRef.current = null;
      }, 3000);
    };
    ws.onmessage = (event) => {
      try {
        setStatus(JSON.parse(event.data));
      } catch { /* ignore */ }
    };

    return () => {
      ws.close();
    };
  }, []);

  return { status, connected };
}
```

**Step 3: Create dashboard layout and page**

`packages/web/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Energy Control',
  description: 'Intelligent grid setpoint controller',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
```

`packages/web/app/page.tsx` — Dashboard with live values, controller status, mode switch. Uses the `useWebSocket` hook for real-time updates. Displays:
- PV power, consumption, grid power, battery SOC as large numbers
- Controller mode badge (Auto/Manual/Winter) with color coding using accent #10EFD8
- Current setpoint value
- Mode toggle buttons

**Step 4: Verify dev server starts**

Run: `cd packages/web && pnpm dev`
Expected: Next.js starts on port 3001

**Step 5: Commit**

```bash
git add packages/web/
git commit -m "feat: add Next.js dashboard with dark theme and real-time WebSocket"
```

---

## Task 12: Frontend — Settings Page & Forecast Chart

**Files:**
- Create: `packages/web/app/settings/page.tsx`
- Modify: `packages/web/app/page.tsx` (add forecast chart)

**Step 1: Create settings page**

Settings page that fetches `GET /api/config`, displays editable fields, and saves with `PUT /api/config`. Also includes mode toggle and manual setpoint slider.

**Step 2: Add forecast chart to dashboard**

Fetch `GET /api/forecast` on load, display as a bar chart showing hourly expected production. Overlay actual production if available from WebSocket data.

**Step 3: Verify both pages work**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/web/
git commit -m "feat: add settings page and forecast chart to dashboard"
```

---

## Task 13: Docker Setup

**Files:**
- Create: `packages/api/Dockerfile`
- Create: `packages/web/Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Create Dockerfiles**

Follow the same multi-stage pattern as energy_monitor. Base image `node:22-slim`.

**Step 2: Create docker-compose.yml**

```yaml
services:
  energy-control-api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    network_mode: host
    env_file: .env
    restart: unless-stopped

  energy-control-web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    ports:
      - "3001:3001"
    depends_on:
      - energy-control-api
    restart: unless-stopped
```

**Step 3: Verify build**

Run: `docker compose build`
Expected: Both images build

**Step 4: Commit**

```bash
git add packages/api/Dockerfile packages/web/Dockerfile docker-compose.yml
git commit -m "chore: add Docker setup for api and web services"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Repository scaffolding | Build check |
| 2 | OpenAPI spec + type generation | Type generation |
| 3 | Config module | 3 unit tests |
| 4 | MQTT service | 7 integration tests |
| 5 | VRM forecast service | 5 unit tests |
| 6 | Controller (core algorithm) | 8 unit tests |
| 7 | Fastify server + health | 1 integration test |
| 8 | REST API endpoints | 6 integration tests |
| 9 | WebSocket support | 1 integration test |
| 10 | Main entry point | Build check |
| 11 | Frontend dashboard | Dev server check |
| 12 | Settings + forecast chart | Build check |
| 13 | Docker setup | Docker build |

**Total: ~31 tests, 13 tasks**

Key contract-first workflow: **Always modify `openapi/spec.yaml` first → generate types → write tests → implement.**
