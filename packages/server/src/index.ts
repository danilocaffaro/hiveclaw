// @superclaw/server — Fastify API server

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '4070', 10);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // ─── API routes ────────────────────────────────────────────────────────

  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  }));

  // ─── Setup wizard check ────────────────────────────────────────────────

  app.get('/api/setup/status', async () => {
    // TODO: Check if setup is complete (has at least one provider + one agent)
    return { setupComplete: false, step: 'welcome' };
  });

  // ─── Static SPA serving ────────────────────────────────────────────────

  const webOut = resolve(__dirname, '../../web/out');
  if (existsSync(webOut)) {
    const staticPlugin = await import('@fastify/static');
    await app.register(staticPlugin.default, {
      root: webOut,
      prefix: '/',
      wildcard: false,
    });

    // SPA catch-all
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile('index.html');
    });
  }

  // ─── Start ─────────────────────────────────────────────────────────────

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n  ✨ SuperClaw Pure running at http://localhost:${PORT}\n`);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
