import type { FastifyInstance } from 'fastify';
import { statSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type Database from 'better-sqlite3';

// In-memory store for interface mode (used for multi-device sync)
let currentInterfaceMode: 'lite' | 'pro' = 'lite';

// B076: Integrations config persisted to SQLite settings table
import { getDb } from '../db/schema.js';
import { getAuthUser } from './auth.js';
import { UserRepository } from '../db/users.js';

function loadIntegrations(): Record<string, unknown> {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : {};
  } catch { return {}; }
}

function saveIntegrations(config: Record<string, unknown>): void {
  try {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('integrations', ?)").run(JSON.stringify(config));
  } catch { /* non-fatal */ }
}

let integrationsConfig: Record<string, unknown> = loadIntegrations();

export function registerConfigRoutes(app: FastifyInstance, db?: Database.Database) {
  const users = db ? new UserRepository(db) : null;
  // Get app config (native — no bridge needed)
  app.get('/config', async () => {
    const { getVersion } = await import('../lib/version.js');
    return { data: { engine: 'native', version: getVersion() } };
  });

  // List available models (from DB providers)
  app.get('/models', async () => {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id, config_json FROM providers WHERE enabled = 1").all() as { id: string; config_json: string | null }[];
      const allModels: Array<{ id: string; name: string; provider: string }> = [];
      for (const row of rows) {
        try {
          const cfg = row.config_json ? JSON.parse(row.config_json) : {};
          for (const m of cfg.models ?? []) {
            allModels.push({
              id: typeof m === 'string' ? m : m.id,
              name: typeof m === 'string' ? m : (m.name ?? m.id),
              provider: row.id,
            });
          }
        } catch { /* skip malformed config */ }
      }
      return { data: allModels };
    } catch { return { data: [] }; }
  });

  // GET /config/mode — get current interface mode
  app.get('/config/mode', async (_req, reply) => {
    return reply.send({ data: { mode: currentInterfaceMode } });
  });

  // PATCH /config/mode — set interface mode (for multi-device sync)
  app.patch('/config/mode', async (req, reply) => {
    const body = req.body as { mode?: string } | undefined;
    const mode = body?.mode;
    if (mode !== 'lite' && mode !== 'pro') {
      return reply.status(400).send({ error: { code: 'INVALID_MODE', message: 'mode must be "lite" or "pro"' } });
    }
    currentInterfaceMode = mode;
    return reply.send({ data: { mode: currentInterfaceMode } });
  });

  // ── Database info (DataStorageTab compat) ─────────────────────────────────

  // GET /api/config/database — database info
  app.get('/api/config/database', async (_req, reply) => {
    try {
      const dbPath = resolve(homedir(), '.hiveclaw', 'hiveclaw.db');
      let sizeBytes = 0;
      let lastModified = '';
      try {
        const st = statSync(dbPath);
        sizeBytes = st.size;
        lastModified = st.mtime.toISOString();
      } catch { /* file not found */ }

      // Get table info from the DB that's passed to config routes
      // We need access to the db instance — use a dynamic import pattern
      let tables: { name: string; rowCount: number }[] = [];
      try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath, { readonly: true });
        const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        tables = tableNames.map(t => {
          const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number };
          return { name: t.name, rowCount: count.cnt };
        });
        db.close();
      } catch { /* unable to read tables */ }

      return reply.send({
        data: {
          path: dbPath,
          sizeBytes,
          sizeMB: +(sizeBytes / (1024 * 1024)).toFixed(2),
          lastModified,
          lastBackup: null,
          engine: 'SQLite (better-sqlite3)',
          tables,
        },
      });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /api/config/database/export — download DB file (requires EXPLICIT API key — no owner fallback)
  app.get('/api/config/database/export', async (req, reply) => {
    // SEC: This endpoint exposes the FULL SQLite DB (tokens, keys, sessions).
    // Must require explicit X-API-Key header — owner fallback is NOT sufficient.
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey || !users) {
      return reply.status(401).send({ error: 'Unauthorized — API key required for database export' });
    }
    const user = users.getByApiKey(apiKey);
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      return reply.status(403).send({ error: 'Forbidden — owner or admin role required' });
    }
    try {
      const dbPath = resolve(homedir(), '.hiveclaw', 'hiveclaw.db');
      const { createReadStream } = await import('fs');
      const stream = createReadStream(dbPath);
      return reply
        .header('Content-Disposition', 'attachment; filename="hiveclaw.db"')
        .header('Content-Type', 'application/octet-stream')
        .send(stream);
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /api/config/database/purge — purge data (sessions, messages, tasks)
  app.post<{ Body: { confirm?: boolean } }>('/api/config/database/purge', async (req, reply) => {
    try {
      const { confirm } = (req.body as Record<string, unknown>) ?? {};
      if (!confirm) {
        return reply.status(400).send({ error: { code: 'CONFIRMATION_REQUIRED', message: 'Set confirm:true to purge data' } });
      }
      // Purge transient data (keep schema, users, settings)
      // This is a best-effort cleanup
      return reply.send({ data: { success: true, message: 'Purge not yet implemented — no data was deleted. Use SQLite tools for manual cleanup.' } });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /api/config/database/import — import DB file (upload)
  app.post('/api/config/database/import', async (req, reply) => {
    try {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ error: { code: 'NO_FILE', message: 'Upload a .db file' } });
      }
      const dbPath = resolve(homedir(), '.hiveclaw', 'hiveclaw.db');
      const backupPath = dbPath + '.backup-' + Date.now();
      const { copyFileSync, writeFileSync } = await import('fs');
      // Backup current DB first
      try { copyFileSync(dbPath, backupPath); } catch { /* first run — no DB yet */ }
      // Write uploaded file
      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk as Buffer);
      }
      writeFileSync(dbPath, Buffer.concat(chunks));
      return reply.send({ data: { success: true, message: `Database imported. Backup at ${backupPath}. Restart server to apply.` } });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── Integrations config ───────────────────────────────────────────────────

  // PUT /api/config/integrations — save integrations config
  app.put('/api/config/integrations', async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (body) {
        integrationsConfig = { ...integrationsConfig, ...body };
        saveIntegrations(integrationsConfig); // B076: persist to SQLite
      }
      return reply.send({ data: integrationsConfig });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /api/config/integrations — get integrations config
  app.get('/api/config/integrations', async (_req, reply) => {
    return reply.send({ data: integrationsConfig });
  });
}
