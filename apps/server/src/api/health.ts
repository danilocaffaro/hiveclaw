import type { FastifyInstance } from 'fastify';
import { getWatchdog } from '../engine/self-watchdog.js';
import { getVersionInfo } from '../lib/version.js';
import { getDb } from '../db/schema.js';
import { checkForUpdate, getCachedUpdate } from '../lib/update-checker.js';
import { getToolRegistry } from '../engine/tools/index.js';

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => {
    const { version } = getVersionInfo();
    return {
      status: 'ok',
      version,
      engine: 'native',
    };
  });

  app.get('/status', async () => {
    const { version, commit } = getVersionInfo();
    const watchdog = getWatchdog();
    const snapshot = watchdog.getSnapshot();
    return {
      status: 'ok',
      version,
      commit,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      engine: { type: 'native' },
      watchdog: snapshot ?? { status: 'not yet checked' },
    };
  });

  app.get('/api/health', async () => {
    const { version, commit, buildDate } = getVersionInfo();

    // DB stats (quick, cached)
    let dbStats = { agents: 0, sessions: 0, messages: 0, schemaVersion: 0 };
    try {
      const db = getDb();
      dbStats.agents = (db.prepare("SELECT COUNT(*) as c FROM agents").get() as { c: number }).c;
      dbStats.sessions = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
      dbStats.messages = (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;
      const sv = db.prepare("SELECT version FROM schema_version WHERE id=1").get() as { version: number } | undefined;
      dbStats.schemaVersion = sv?.version ?? 0;
    } catch { /* non-fatal */ }

    // Provider status — query directly from DB
    let providers: Array<{ id: string; name: string; enabled: boolean }> = [];
    try {
      const db = getDb();
      providers = (db.prepare('SELECT id, name, enabled FROM providers ORDER BY name').all() as Array<{ id: string; name: string; enabled: number }>)
        .map(p => ({ id: p.id, name: p.name, enabled: !!p.enabled }));
    } catch { /* non-fatal */ }

    // Include update info if cached
    const update = getCachedUpdate();

    return {
      version,
      commit,
      buildDate,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      engine: 'native',
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      db: dbStats,
      providers,
      tools: getToolRegistry().size, // dynamic — reflects actual registered tools
      ...(update?.available ? { update: { latest: update.latest, url: update.url } } : {}),
    };
  });

  // GET /api/version — lightweight version info
  app.get('/api/version', async () => {
    return { data: getVersionInfo() };
  });

  // GET /api/update — check for updates (returns cached or fresh)
  app.get('/api/update', async (req) => {
    const force = (req.query as Record<string, string>).force === 'true';
    const info = await checkForUpdate(force);
    return { data: info };
  });
}
