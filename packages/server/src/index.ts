// @superclaw/server — Fastify API server
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { getDb, isSetupComplete } from './db/index.js';
import { registerSetupRoutes } from './api/setup.js';
import { registerChatRoutes } from './api/chat.js';
import { registerAgentRoutes } from './api/agents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '4070', 10);

async function main() {
  // Initialize DB early
  getDb();

  const app = Fastify({
    logger: process.env.NODE_ENV !== 'production' ? { level: 'info' } : false,
  });

  await app.register(cors, { origin: true });

  // ─── Health ──────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    setupComplete: isSetupComplete(),
    uptime: Math.round(process.uptime()),
  }));

  // ─── API routes ──────────────────────────────────────────────────────
  registerSetupRoutes(app);
  registerChatRoutes(app);
  registerAgentRoutes(app);

  // ─── Static SPA serving ──────────────────────────────────────────────
  // Try multiple possible locations for the web build
  const candidates = [
    resolve(__dirname, '../../web/out'),       // dev: from packages/server/dist/
    resolve(__dirname, '../../../web/out'),     // alt layout
    resolve(process.cwd(), 'packages/web/out'), // from project root
  ];
  
  const webOut = candidates.find(c => existsSync(c));
  
  if (webOut) {
    await app.register(fastifyStatic, {
      root: webOut,
      prefix: '/',
      wildcard: false,
    });

    // SPA catch-all — only for non-API routes
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    // No web build found — serve a minimal redirect
    app.setNotFoundHandler(async (_req, reply) => {
      reply.code(200).header('Content-Type', 'text/html').send(`
        <!DOCTYPE html>
        <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0f;color:#e4e4e7">
          <div style="text-align:center">
            <h1>✨ SuperClaw Pure</h1>
            <p>Server running on port ${PORT}</p>
            <p style="color:#71717a">Run <code>pnpm build</code> in packages/web to build the frontend</p>
            <p style="margin-top:20px"><a href="/api/health" style="color:#7c5bf5">API Health →</a></p>
          </div>
        </body></html>
      `);
    });
  }

  // ─── Start ───────────────────────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' });
  
  const setupDone = isSetupComplete();
  console.log('');
  console.log('  ✨ SuperClaw Pure v0.1.0');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → Setup: ${setupDone ? '✅ Complete' : '⏳ Pending (open browser to start)'}`);
  console.log('');
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
