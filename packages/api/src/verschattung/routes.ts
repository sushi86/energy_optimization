import type { FastifyInstance } from 'fastify';
import type { Engine } from './engine.js';
import { COVERS } from './covers.js';
import { loadVerschattungConfig, saveVerschattungConfig, type VerschattungConfig } from './config.js';

export interface VerschattungRouteOptions {
  engine: Engine;
  configPath: string;
}

export function registerVerschattungRoutes(app: FastifyInstance, opts: VerschattungRouteOptions): void {
  const { engine, configPath } = opts;

  app.get('/api/verschattung/state', async () => buildStateResponse(engine));
  app.get('/api/verschattung/decisions', async () => engine.recentDecisions());
  app.get('/api/verschattung/config', async () => loadVerschattungConfig(configPath));

  app.put('/api/verschattung/config', async (req) => {
    const body = req.body as VerschattungConfig;
    saveVerschattungConfig(configPath, body);
    return loadVerschattungConfig(configPath);
  });

  app.put('/api/verschattung/cover/:id/position', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { position } = req.body as { position: number };
    await engine.setManualPosition(id, position);
    reply.status(204).send();
  });

  app.post('/api/verschattung/cover/:id/auto', async (req, reply) => {
    const { id } = req.params as { id: string };
    engine.releaseOverride(id);
    reply.status(204).send();
  });
}

function buildStateResponse(engine: Engine) {
  const ctx = engine.buildContext();
  const tracker = engine.trackerSnapshot();
  return {
    covers: COVERS.map((c) => {
      const t = tracker[c.id] ?? { state: 'IDLE', expectedPosition: null, lastEvent: null };
      return {
        id: c.id, zone: c.zone, floor: c.floor, label: c.label,
        currentPosition: ctx.coverPositions.get(c.id) ?? null,
        state: t.state, expectedPosition: t.expectedPosition,
        lastEvent: t.lastEvent ?? null,
      };
    }),
    inputs: {
      sun: ctx.sun,
      pvPowerW: ctx.pvPowerW,
      pvThresholdW: ctx.pvThresholdW,
      indoorTempC: ctx.indoorTempC,
      isSummerMode: ctx.isSummerMode,
    },
  };
}
