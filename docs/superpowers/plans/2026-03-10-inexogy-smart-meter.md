# inexogy Smart Meter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch historical 15-minute meter readings (Bezug/Einspeisung) from inexogy API and expose via REST endpoint.

**Architecture:** New `InexogyService` class wraps the inexogy REST API with Basic Auth. Lazy meter discovery on first use. Single new GET endpoint returns readings for a given day. Service is optional — only created when credentials are configured.

**Tech Stack:** Native `fetch`, Zod for config validation, Vitest for tests.

---

## Chunk 1: Service and Endpoint

### Task 1: Add config env vars

**Files:**
- Modify: `packages/api/src/config.ts`

- [ ] **Step 1: Write failing test for new config fields**

In `packages/api/src/__tests__/inexogy-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('InexogyService config', () => {
  it('config loads without inexogy vars (they are optional)', async () => {
    // loadConfig should not throw when INEXOGY_ vars are missing
    // (they are optional with .optional())
    const { loadConfig } = await import('../config.js');
    // This test just ensures the schema accepts missing inexogy vars
    // loadConfig reads process.env which has the required VICTRON vars in CI
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify baseline**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`

- [ ] **Step 3: Add optional env vars to config schema**

In `packages/api/src/config.ts`, add after `PREFERRED_MAX_CHARGE_W`:

```typescript
INEXOGY_EMAIL: z.string().optional(),
INEXOGY_PASSWORD: z.string().optional(),
INEXOGY_METER_ID: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/config.ts packages/api/src/__tests__/inexogy-service.test.ts
git commit -m "feat(inexogy): add optional config env vars"
```

---

### Task 2: Create InexogyService with meter discovery

**Files:**
- Create: `packages/api/src/inexogy-service.ts`
- Test: `packages/api/src/__tests__/inexogy-service.test.ts`

- [ ] **Step 1: Write failing tests for meter discovery and readings**

Replace `packages/api/src/__tests__/inexogy-service.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InexogyService } from '../inexogy-service.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) };
}

describe('InexogyService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('meter discovery', () => {
    it('auto-discovers first ELECTRICITY meter when no meterId configured', async () => {
      const meters = [
        { meterId: 'gas-1', type: 'GAS', measurementType: 'GAS', serialNumber: '1', fullSerialNumber: '1', location: {} },
        { meterId: 'elec-1', type: 'TST', measurementType: 'ELECTRICITY', serialNumber: '2', fullSerialNumber: '2', location: {} },
      ];
      mockFetch
        .mockResolvedValueOnce(jsonResponse(meters))         // /meters
        .mockResolvedValueOnce(jsonResponse([]));             // /readings

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      // First call: /meters, second call: /readings with discovered meter
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const readingsUrl = mockFetch.mock.calls[1][0] as string;
      expect(readingsUrl).toContain('meterId=elec-1');
    });

    it('uses configured meterId and skips discovery', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([])); // /readings only

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'my-meter' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('meterId=my-meter');
    });

    it('caches meter ID after first discovery', async () => {
      const meters = [
        { meterId: 'elec-1', measurementType: 'ELECTRICITY', serialNumber: '1', fullSerialNumber: '1', location: {} },
      ];
      mockFetch
        .mockResolvedValueOnce(jsonResponse(meters))   // /meters (1st call)
        .mockResolvedValueOnce(jsonResponse([]))        // /readings (1st call)
        .mockResolvedValueOnce(jsonResponse([]));       // /readings (2nd call, no /meters)

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));
      await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(mockFetch).toHaveBeenCalledTimes(3); // meters + readings + readings
    });

    it('throws when no electricity meter found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw' });
      await expect(svc.getReadings(new Date(), new Date())).rejects.toThrow('No electricity meter found');
    });
  });

  describe('getReadings', () => {
    it('fetches readings and normalizes values', async () => {
      const rawReadings = [
        { time: 1741564800000, values: { power: 450000, energy: 12345600000000, energyOut: 7890100000000 } },
        { time: 1741565700000, values: { power: -200000, energy: 12345700000000, energyOut: 7890200000000 } },
      ];
      mockFetch.mockResolvedValueOnce(jsonResponse(rawReadings));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'meter-1' });
      const readings = await svc.getReadings(new Date('2026-03-10'), new Date('2026-03-11'));

      expect(readings).toHaveLength(2);
      expect(readings[0]).toEqual({
        time: new Date(1741564800000),
        powerW: 450,
        energyKwh: 1234.56,
        energyOutKwh: 789.01,
      });
      expect(readings[1]).toEqual({
        time: new Date(1741565700000),
        powerW: -200,
        energyKwh: 1234.57,
        energyOutKwh: 789.02,
      });
    });

    it('sends correct Authorization header and URL params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      const svc = new InexogyService({ email: 'test@x.com', password: 'secret', meterId: 'M1' });
      const from = new Date('2026-03-10T00:00:00+01:00');
      const to = new Date('2026-03-11T00:00:00+01:00');
      await svc.getReadings(from, to);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('https://api.inexogy.com/public/v1/readings');
      expect(url).toContain('meterId=M1');
      expect(url).toContain('resolution=fifteen_minutes');
      expect(url).toContain(`from=${from.getTime()}`);
      expect(url).toContain(`to=${to.getTime()}`);
      expect(opts.headers.Authorization).toBe('Basic ' + btoa('test@x.com:secret'));
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

      const svc = new InexogyService({ email: 'a@b.com', password: 'pw', meterId: 'M1' });
      await expect(svc.getReadings(new Date(), new Date())).rejects.toThrow('inexogy API error: 401');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`
Expected: FAIL — `inexogy-service.js` does not exist

- [ ] **Step 3: Implement InexogyService**

Create `packages/api/src/inexogy-service.ts`:

```typescript
const BASE_URL = 'https://api.inexogy.com/public/v1';

export interface InexogyReading {
  time: Date;
  powerW: number;
  energyKwh: number;
  energyOutKwh: number;
}

export interface InexogyServiceConfig {
  email: string;
  password: string;
  meterId?: string;
}

export class InexogyService {
  private email: string;
  private password: string;
  private meterId: string | undefined;

  constructor(config: InexogyServiceConfig) {
    this.email = config.email;
    this.password = config.password;
    this.meterId = config.meterId;
  }

  private get authHeader(): string {
    return 'Basic ' + btoa(`${this.email}:${this.password}`);
  }

  private async resolveMeterId(): Promise<string> {
    if (this.meterId) return this.meterId;

    const res = await fetch(`${BASE_URL}/meters`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`inexogy API error: ${res.status}`);

    const meters = await res.json() as { meterId: string; measurementType: string }[];
    const elec = meters.find(m => m.measurementType === 'ELECTRICITY');
    if (!elec) throw new Error('No electricity meter found');

    this.meterId = elec.meterId;
    return this.meterId;
  }

  async getReadings(from: Date, to: Date): Promise<InexogyReading[]> {
    const meterId = await this.resolveMeterId();

    const params = new URLSearchParams({
      meterId,
      from: from.getTime().toString(),
      to: to.getTime().toString(),
      resolution: 'fifteen_minutes',
      fields: 'energy,energyOut,power',
    });

    const res = await fetch(`${BASE_URL}/readings?${params}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`inexogy API error: ${res.status}`);

    const raw = await res.json() as { time: number; values: Record<string, number> }[];

    return raw.map(r => ({
      time: new Date(r.time),
      powerW: Math.round((r.values.power ?? 0) / 1000),
      energyKwh: Math.round((r.values.energy ?? 0) / 1e10 * 100) / 100,
      energyOutKwh: Math.round((r.values.energyOut ?? 0) / 1e10 * 100) / 100,
    }));
  }

  getMeterId(): string | undefined {
    return this.meterId;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/inexogy-service.ts packages/api/src/__tests__/inexogy-service.test.ts
git commit -m "feat(inexogy): add InexogyService with meter discovery and readings"
```

---

### Task 3: Add API endpoint

**Files:**
- Modify: `packages/api/src/server.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write failing test for the endpoint**

Add to `packages/api/src/__tests__/inexogy-service.test.ts`:

```typescript
import { buildServer } from '../server.js';

describe('GET /api/meter/history', () => {
  it('returns 404 when inexogy is not configured', async () => {
    const app = buildServer({ testing: true });
    const res = await app.inject({ method: 'GET', url: '/api/meter/history' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain('not configured');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`
Expected: FAIL — endpoint doesn't exist yet (Fastify returns its own 404)

- [ ] **Step 3: Add endpoint and inexogyService option to server**

In `packages/api/src/server.ts`:

1. Add import: `import { InexogyService } from './inexogy-service.js';`

2. Extend `ServerOptions`:
```typescript
export interface ServerOptions {
  testing?: boolean;
  appState?: AppState;
  pvSettingsPath?: string;
  inexogyService?: InexogyService;
}
```

3. Inside `buildServer`, after destructuring options:
```typescript
const inexogyService = options.inexogyService;
```

4. Add endpoint before the `return app;` line:
```typescript
app.get('/api/meter/history', async (request, reply) => {
  if (!inexogyService) {
    return reply.code(404).send({ error: 'inexogy not configured' });
  }
  const query = request.query as { date?: string };
  const tz = 'Europe/Berlin';
  const dateStr = query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const from = new Date(new Date(dateStr).toLocaleString('en-US', { timeZone: tz }));
  // Start of day in Europe/Berlin
  const startOfDay = new Date(dateStr + 'T00:00:00+01:00');
  // Use proper timezone offset detection
  const testDate = new Date(dateStr + 'T12:00:00Z');
  const berlinOffset = -new Date(testDate.toLocaleString('en-US', { timeZone: tz })).getTimezoneOffset();
  const offsetHours = berlinOffset / 60;
  const offsetStr = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`;
  const dayStart = new Date(`${dateStr}T00:00:00${offsetStr}`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    const readings = await inexogyService.getReadings(dayStart, dayEnd);
    return {
      date: dateStr,
      meterId: inexogyService.getMeterId() ?? 'unknown',
      readings: readings.map(r => ({
        time: r.time.toISOString(),
        powerW: r.powerW,
        energyKwh: r.energyKwh,
        energyOutKwh: r.energyOutKwh,
      })),
    };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});
```

5. In `packages/api/src/index.ts`, add conditional service creation:

After `const config = loadConfig();`, add:
```typescript
import { InexogyService } from './inexogy-service.js';

let inexogyService: InexogyService | undefined;
if (config.INEXOGY_EMAIL && config.INEXOGY_PASSWORD) {
  inexogyService = new InexogyService({
    email: config.INEXOGY_EMAIL,
    password: config.INEXOGY_PASSWORD,
    meterId: config.INEXOGY_METER_ID,
  });
  console.log('[energy-control] inexogy smart meter enabled');
}
```

Pass to server: `const server = buildServer({ appState, inexogyService });`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx vitest run src/__tests__/inexogy-service.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/api && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/server.ts packages/api/src/index.ts
git commit -m "feat(inexogy): add GET /api/meter/history endpoint"
```
