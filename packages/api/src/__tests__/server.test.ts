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
