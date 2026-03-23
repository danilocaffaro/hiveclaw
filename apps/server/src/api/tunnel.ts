/**
 * HiveClaw — Remote Access API Routes
 *
 * POST /api/tunnel/start    → start tunnel (body: { provider?, port? })
 * POST /api/tunnel/stop     → stop tunnel
 * GET  /api/tunnel/status   → get tunnel status
 * GET  /api/tunnel/providers → list available providers
 *
 * Security:
 *   When a tunnel is active, ALL requests coming through it must include
 *   the tunnel access token as ?token=XXX or Authorization: Bearer XXX.
 *   Local requests (127.0.0.1 / ::1) bypass this check.
 */

import type { FastifyInstance } from 'fastify';
import { tunnelManager, type TunnelProvider } from '../lib/tunnel.js';

export function registerTunnelRoutes(app: FastifyInstance) {
  const log = app.log.child({ module: 'tunnel' });

  /* ── Auth middleware for tunnel access ─────────────────────────────── */

  app.addHook('onRequest', async (req, reply) => {
    // Only enforce when tunnel is active
    if (!tunnelManager.status.active) return;

    // Allow local requests without token
    const ip = req.ip;
    const isLocal =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip === 'localhost';
    if (isLocal) return;

    // Tunnel management routes are always local-only (can't start/stop from remote)
    const tunnelMgmtPaths = ['/api/tunnel/start', '/api/tunnel/stop'];
    if (tunnelMgmtPaths.includes(req.url.split('?')[0] || '')) {
      reply.status(403).send({ error: { code: 'LOCAL_ONLY', message: 'Tunnel management is only available from localhost' } });
      return;
    }

    // Check for tunnel access token
    const tokenFromQuery = (req.query as Record<string, string>)?.token;
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
    // Also check X-Tunnel-Token header
    const tokenFromCustomHeader = req.headers['x-tunnel-token'] as string | undefined;

    const token = tokenFromQuery || tokenFromHeader || tokenFromCustomHeader;

    // Allow existing auth (API key / session cookie) to pass through
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) return; // Already handled by existing auth system

    // Validate tunnel token
    if (!tunnelManager.verifyAccessToken(token)) {
      reply.status(401).send({
        error: {
          code: 'TUNNEL_AUTH_REQUIRED',
          message: 'Remote access requires authentication. Add ?token=YOUR_TOKEN to the URL or use Authorization: Bearer YOUR_TOKEN header.',
        },
      });
      return;
    }
  });

  /* ── Routes ────────────────────────────────────────────────────────── */

  // GET /api/tunnel/status
  app.get('/api/tunnel/status', async () => {
    const status = tunnelManager.status;
    // If not active, check if we have persisted state from before restart
    if (!status.active) {
      const persisted = tunnelManager.restoreFromSettings();
      if (persisted.url) {
        return {
          data: {
            ...persisted,
            stale: true, // Tunnel was running before, but process died
            message: 'Tunnel was previously active but process is no longer running. Start again to reconnect.',
          },
        };
      }
    }
    return { data: status };
  });

  // GET /api/tunnel/providers
  app.get('/api/tunnel/providers', async () => {
    const providers = tunnelManager.detectProviders();
    const details = providers.map(p => ({
      id: p,
      name: p === 'cloudflared' ? 'Cloudflare Tunnel' : 'ngrok',
      authConfigured: p === 'ngrok' ? tunnelManager.isNgrokAuthConfigured() : true,
      warning: p === 'ngrok' && !tunnelManager.isNgrokAuthConfigured()
        ? 'ngrok auth token not configured — connections will be rate-limited. Run: ngrok config add-authtoken <TOKEN>'
        : null,
    }));
    return { data: details };
  });

  // POST /api/tunnel/start
  app.post<{ Body: { provider?: TunnelProvider; port?: number } }>(
    '/api/tunnel/start',
    async (req) => {
      const { provider, port } = (req.body as Record<string, unknown>) ?? {};
      log.info({ provider, port }, 'Starting remote access tunnel');
      const url = await tunnelManager.start(
        provider as TunnelProvider | undefined,
        port as number | undefined,
      );
      log.info({ url }, 'Remote access enabled');

      const status = tunnelManager.status;
      return {
        data: {
          ...status,
          accessUrl: `${url}?token=${status.accessToken}`,
          message: 'Tunnel started. Share the accessUrl with anyone who needs remote access.',
          warning: status.ngrokAuthConfigured === false
            ? 'ngrok auth token not configured — connections may be rate-limited.'
            : null,
        },
      };
    },
  );

  // POST /api/tunnel/stop
  app.post('/api/tunnel/stop', async () => {
    tunnelManager.stop();
    log.info('Remote access disabled');
    return {
      data: tunnelManager.status,
      message: 'Tunnel stopped',
    };
  });
}
