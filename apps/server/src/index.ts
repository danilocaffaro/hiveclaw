/**
 * HiveClaw — Server Entry Point
 * 
 * This is the "Pure" version: standalone engine.
 * All LLM communication goes through the native chat engine.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import {
  initDatabase,
  AgentRepository,
  SquadRepository,
  SquadMemberRepository,
  ProviderRepository,
  TaskRepository,
  ArtifactRepository,
  DatasetRepository,
  FinetuneJobRepository,
  AgentMemoryRepository,
} from './db/index.js';
import { MarketplaceRepository } from './db/marketplace.js';
import { UserRepository } from './db/users.js';
import { registerHealthRoutes } from './api/health.js';
import { registerAgentRoutes } from './api/agents.js';
import { registerSquadRoutes } from './api/squads.js';
import { registerSessionRoutes } from './api/sessions.js';
import { registerConfigRoutes } from './api/config.js';
import { registerProviderRoutes } from './api/providers.js';
import { registerSSERoutes } from './api/sse.js';
import { memoryRoutes } from './api/memory.js';
import { planRoutes } from './api/plans.js';
import { skillRoutes } from './api/skills.js';
import { heartbeatRoutes } from './api/heartbeat.js';
import { questionRoutes } from './api/questions.js';
import { registerTaskRoutes } from './api/tasks.js';
import { registerFileRoutes } from './api/files.js';
import { registerBrowserRoutes } from './api/browser.js';
import { registerArtifactRoutes } from './api/artifacts.js';
import { registerMCPRoutes } from './api/mcp.js';
import { registerDataRoutes } from './api/data.js';
import { registerPresentationRoutes } from './api/presentations.js';
import { registerTunnelRoutes } from './api/tunnel.js';
import { registerConnectRoutes } from './api/connect.js';
import { registerMarketplaceRoutes } from './api/marketplace.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerInviteRoutes } from './api/invites.js';
import { registerAutomationRoutes, startCronScheduler } from './api/automations.js';
import { registerFinetuneRoutes } from './api/finetune.js';
import { registerCredentialRoutes } from './api/credentials.js';
import { registerTokenVaultRoutes } from './api/token-vault.js';
import { CredentialRepository } from './db/credentials.js';
import { registerPreviewRoutes } from './api/preview.js';
import { registerConsoleRoutes } from './api/console.js';
import { registerWorkflowRoutes } from './api/workflows.js';
import { registerSetupRoutes } from './api/setup.js';
import { registerPublicChatRoutes } from './api/public-chat.js';
import { registerFederationRoutes } from './api/federation.js';
import { FederationRepository } from './db/federation.js';
import { getFederationManager } from './engine/federation/federation-manager.js';
import { FEDERATION_ENABLED, FEDERATION_WS_PATH } from './engine/federation/federation-protocol.js';
import { WebSocketServer } from 'ws';
import { registerBacklogRoutes } from './api/backlog.js';
import { registerRoutingRoutes } from './api/routing.js';
import { registerAnalyticsRoutes } from './api/analytics.js';
import { registerEmbeddingRoutes } from './api/embeddings.js';
import { registerChannelRoutes } from './api/channels.js';
import { registerChannelV2Routes } from './api/channels-v2.js';
import { registerNodeRoutes } from './api/nodes.js';
import { NodeRepository } from './engine/nodes/node-repository.js';
import { createNodeRPCHost, resetNodeRPCHost } from './engine/nodes/rpc-host.js';
import { NodeControlTool } from './engine/nodes/node-tool.js';
import { registerN8nRoutes } from './api/n8n.js';
import { registerExternalAgentRoutes } from './api/external-agents.js';
import { registerSearchRoutes } from './api/search.js';
import { registerOGPreviewRoutes } from './api/og-preview.js';
import { registerMessageRoutes } from './api/messages.js';
import { registerSkillScoutRoutes } from './api/skill-scout.js';
import { registerCanvasRoutes, resetCanvasHost } from './engine/canvas/canvas-host.js';
import { getChannelRouter, resetChannelRouter } from './engine/channels/channel-router.js';
import { startSkillScoutCron } from './engine/skill-scout-cron.js';
import { WorkflowRepository } from './db/workflow-repository.js';
import { WorkflowEngine, seedBuiltinWorkflows } from './engine/workflow-engine.js';
import { getMessageBus } from './engine/message-bus.js';
import { getEngineService } from './engine/engine-service.js';
import { logger, safeFire } from './lib/logger.js';
import { rotateAllLogs } from './lib/log-rotation.js';

import { DEFAULT_PORT, DEFAULT_HOST, DEV_CORS_ORIGINS } from './config/defaults.js';
import { SECURITY_HEADERS, isPublicRoute, SSE_MAX_CONNECTIONS_PER_IP, SSE_MAX_TOTAL_CONNECTIONS } from './config/security.js';
import { getAuthUser } from './api/auth.js';

const PORT = parseInt(process.env.PORT ?? process.env.HIVECLAW_PORT ?? process.env.SUPERCLAW_PORT ?? String(DEFAULT_PORT), 10);
const HOST = process.env.HIVECLAW_HOST ?? process.env.SUPERCLAW_HOST ?? DEFAULT_HOST;
import { getVersion } from './lib/version.js';
const VERSION = getVersion();

async function main() {
  // ─── Initialize SQLite ──────────────────────────────────────────────────
  const db = initDatabase();
  const agents = new AgentRepository(db);
  const squads = new SquadRepository(db);
  const squadMembers = new SquadMemberRepository(db);
  const { ExternalAgentRepository } = await import('./db/external-agents.js');
  const extAgents = new ExternalAgentRepository(db);
  const providers = new ProviderRepository(db);
  const tasks = new TaskRepository(db);
  const artifactRepo = new ArtifactRepository(db);
  const finetuneDatasets = new DatasetRepository(db);
  const finetuneJobs = new FinetuneJobRepository(db);
  const credentialRepo = new CredentialRepository(db);
  const agentMemoryRepo = new AgentMemoryRepository(db);

  // Workflow subsystem
  const workflowRepo = new WorkflowRepository(db);
  const bus = getMessageBus();
  const workflowEngine = new WorkflowEngine(workflowRepo, bus);
  seedBuiltinWorkflows(workflowRepo);

  // Register workflow engine on facade (completes 3-block decoupling)
  getEngineService().workflows.setEngine(workflowEngine);

  // Seed defaults on first run
  providers.seedDefaults();

  // Sync Ollama models from live server (non-blocking)
  // Replaces DEFAULT_PROVIDERS placeholder models with actually installed models
  safeFire((async () => {
    try {
      const ollamaRow = providers.get('ollama');
      if (!ollamaRow) return;
      const baseUrl = ollamaRow.baseUrl ?? 'http://localhost:11434';
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const data = await res.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
      const installed = data.models ?? [];
      if (installed.length === 0) return; // No models — keep defaults for display
      const modelConfigs = installed.map(m => ({
        id: m.name, name: m.name, provider: 'ollama',
        contextWindow: 128000, maxOutput: 8192,
        costPerMInput: 0, costPerMOutput: 0, capabilities: ['text', 'tools'] as string[],
      }));
      providers.upsert({ id: 'ollama', models: modelConfigs });
      logger.info(`[Ollama] Synced ${installed.length} installed model(s): ${installed.map(m => m.name).join(', ')}`);
    } catch { /* Ollama not running — ignore, keep defaults */ }
  })(), 'startup:ollamaSync');
  const marketplace = new MarketplaceRepository(db);
  marketplace.seed();
  const userRepo = new UserRepository(db);
  userRepo.seedOwner();

  // ─── Fix model capabilities — ensure 'tools' is present ──────────────
  // Runtime-discovered models were previously saved with capabilities: ['text']
  // only.  All modern LLMs support tool calling.
  for (const prov of providers.list()) {
    let updated = false;
    const fixedModels = prov.models.map(m => {
      if (m.capabilities && !m.capabilities.includes('tools')) {
        updated = true;
        return { ...m, capabilities: [...m.capabilities, 'tools'] };
      }
      return m;
    });
    if (updated) {
      providers.upsert({ id: prov.id, models: fixedModels });
      logger.info(`[Boot] Fixed model capabilities for ${prov.name} — added 'tools'`);
    }
  }

  // ─── Log configured providers ─────────────────────────────────────────
  const providerList = providers.list();
  const enabledProviders = providerList.filter(p => p.enabled);
  if (enabledProviders.length > 0) {
    const names = enabledProviders.map(p => `${p.name} (${p.models.length} models)`);
    logger.info(`   Providers: ${names.join(', ')}`);
  } else {
    logger.info('   Providers: ⚠️  None configured — open browser to run Setup Wizard');
  }

  // ─── No Bridge needed! ────────────────────────────────────────────────
  // HiveClaw uses native chat engine (engine/chat-engine.ts)
  // All LLM calls go directly from server → provider API
  logger.info('[Engine] Native mode — direct LLM communication (no Bridge)');

  // ─── Create Fastify server ────────────────────────────────────────────
  const isDev = process.env.NODE_ENV !== 'production';

  // /api/ prefix rewrite — frontend calls /api/* but routes are at root
  const nativeApiPrefixes = [
    '/api/config/database/', '/api/config/database',
    '/api/config/integrations',
    '/api/console/',
    '/api/files/upload',
    '/api/health',
    '/api/version',
    '/api/update',
    '/api/invites',
    '/api/invites/',
    '/api/automations',
    '/api/automations/',
    '/api/preview/',
    '/api/agents/status/stream',
    '/api/tunnel/',
    '/api/tunnel',
    // NOTE: /api/engine/ is intentionally NOT here — rewriteUrl strips /api prefix
    // so /api/engine/events/:id becomes /engine/events/:id, matching the registered route
  ];

  const app = Fastify({
    logger: {
      level: 'info',
      ...(isDev ? {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      } : {}),
    },
    rewriteUrl: (req) => {
      const url = req.url ?? '/';
      if (!url.startsWith('/api/')) return url;
      const urlPath = url.split('?')[0];
      for (const prefix of nativeApiPrefixes) {
        if (prefix.endsWith('/')) {
          if (urlPath.startsWith(prefix)) return url;
        } else {
          if (urlPath === prefix) return url;
        }
      }
      return url.replace(/^\/api/, '') || '/';
    },
  });

    // CORS
  const corsEnv = process.env.HIVECLAW_CORS_ORIGINS || process.env.SUPERCLAW_CORS_ORIGINS;
  const corsOrigins: (string | RegExp)[] = corsEnv
    ? corsEnv.split(',').map(s => s.trim())
    : [
        ...DEV_CORS_ORIGINS,
        /^https?:\/\/.*\.ts\.net$/,
      ];
  await app.register(cors, { origin: corsOrigins });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // ─── Rate Limiting ────────────────────────────────────────────────────
  // Global: 200 req/min per IP (replaces the old manual Map-based limiter)
  // Sensitive endpoints (chat/message/squad-run): 30 req/min
  // Webhook callbacks (external agents): 500 req/min (high-throughput inbound)
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: (req) => {
      // Exempt localhost / loopback — internal agent browser navigation
      const ip = req.ip;
      return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
    },
    errorResponseBuilder: (_req, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Limit: ${context.max} per ${context.after}. Try again later.`,
      },
    }),
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // ─── Path Sanitization Hook ────────────────────────────────────────────
  // Reject requests with path traversal sequences or SQL-injection-like
  // characters in the URL path. This fires BEFORE routing so malformed URLs
  // get a clean 400 instead of a connection reset.
  app.addHook('onRequest', async (req, reply) => {
    const rawPath = req.url.split('?')[0];
    // Block path traversal
    if (rawPath.includes('..') || rawPath.includes('%2e%2e') || rawPath.includes('%2E%2E')) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid path' } });
    }
    // Block SQL-injection characters in path segments (' ; -- are not valid in UUIDs/slugs)
    if (/['"`;]/.test(rawPath)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid characters in path' } });
    }
  });

  // ─── Security Headers ───────────────────────────────────────────────────
  app.addHook('onSend', async (_req, reply) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(header, value);
    }
  });

  // ─── Auth Middleware (production) ─────────────────────────────────────
  // Strategy: API-key auth for external clients; same-origin (SPA) falls back to owner.
  // Since the frontend is served by this same Fastify instance, unauthenticated
  // same-origin requests get owner-level access. External API clients must use x-api-key.
  if (!isDev) {
    // Cache whether any API keys exist (refresh on user changes)
    let cachedOwner: ReturnType<typeof userRepo.list>[0] | null | undefined;
    const getOwner = () => {
      if (cachedOwner === undefined) cachedOwner = userRepo.list()[0] ?? null;
      return cachedOwner;
    };

    app.addHook('onRequest', async (req, reply) => {
      // Check if route is public (no auth needed)
      const url = req.url.split('?')[0];
      if (isPublicRoute(url)) return;

      // Static files don't need auth
      if (req.method === 'GET' && (
        url.startsWith('/_next/') ||
        url === '/' ||
        url.endsWith('.html') ||
        url.endsWith('.js') ||
        url.endsWith('.css') ||
        url.endsWith('.png') ||
        url.endsWith('.svg') ||
        url.endsWith('.ico') ||
        url.endsWith('.webmanifest') ||
        url.endsWith('.woff2')
      )) return;

      // R15: Agent bearer token auth — hc-agent-* tokens
      const authHeader = req.headers['authorization'] as string | undefined;
      if (authHeader?.startsWith('Bearer hc-agent-')) {
        const token = authHeader.slice(7); // strip "Bearer "
        const agent = agents.getByToken(token);
        if (agent) {
          // Attach agent identity to request for sender_type resolution
          (req as unknown as Record<string, unknown>).agentAuth = {
            id: agent.id,
            name: agent.name,
            emoji: agent.emoji,
            type: 'agent',
          };
          // Also grant owner-level access for API permissions
          const owner = getOwner();
          if (owner) (req as unknown as Record<string, unknown>).authUser = owner;
          return;
        }
        // Invalid agent token — reject
        return reply.status(401).send({
          error: { code: 'INVALID_TOKEN', message: 'Invalid agent bearer token' },
        });
      }

      // Try API key auth first
      const user = getAuthUser(req, userRepo);
      if (user) return;

      // Fallback: self-hosted mode — if no API key provided but owner exists,
      // grant access. The SPA doesn't send API keys in same-origin mode.
      // This is safe for single-user self-hosted deployments.
      const owner = getOwner();
      if (owner) {
        (req as unknown as Record<string, unknown>).authUser = owner;
        return;
      }

      reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'API key required. Set x-api-key header.' },
      });
    });
    logger.info('[Auth] Production mode — self-hosted (owner fallback for same-origin)');
  }

  // ─── SSE Connection Tracking ────────────────────────────────────────────
  const sseConnections = new Map<string, number>();
  let sseTotalConnections = 0;

  // Expose SSE tracking for routes to use
  app.decorate('sseTracker', {
    canConnect(ip: string): boolean {
      if (sseTotalConnections >= SSE_MAX_TOTAL_CONNECTIONS) return false;
      const count = sseConnections.get(ip) ?? 0;
      return count < SSE_MAX_CONNECTIONS_PER_IP;
    },
    connect(ip: string) {
      sseConnections.set(ip, (sseConnections.get(ip) ?? 0) + 1);
      sseTotalConnections++;
    },
    disconnect(ip: string) {
      const count = sseConnections.get(ip) ?? 1;
      if (count <= 1) sseConnections.delete(ip);
      else sseConnections.set(ip, count - 1);
      sseTotalConnections = Math.max(0, sseTotalConnections - 1);
    },
  });

  // ─── Static SPA serving ───────────────────────────────────────────────
  const webDir = process.env.HIVECLAW_WEB_DIR || process.env.SUPERCLAW_WEB_DIR
    || (() => {
      const monorepoOut = join(import.meta.dirname, '..', '..', 'web', 'out');
      return existsSync(join(monorepoOut, 'index.html')) ? monorepoOut : undefined;
    })();

  if (webDir && existsSync(webDir)) {
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2',
      '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webmanifest': 'application/manifest+json', '.map': 'application/json',
    };

    app.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET') return;
      if (req.url.startsWith('/api/')) return;

      const apiPrefixes = ['/healthz', '/agents', '/sessions', '/squads', '/tasks',
        '/providers', '/config', '/sse', '/memory', '/plans', '/skills', '/heartbeat',
        '/questions', '/credentials', '/token-vault', '/files', '/artifacts', '/browser', '/mcp',
        '/datasets', '/presentation', '/marketplace', '/auth', '/finetune',
        '/workflows', '/workflow-runs', '/setup', '/debug', '/console',
        '/n8n', '/preview', '/audit', '/integrations', '/webhooks',
        '/public', '/shared-links', '/backlog', '/routing', '/analytics',
        '/channels', '/embeddings', '/data', '/events', '/models', '/status', '/external-agents',
        '/nodes', '/canvas',
        '/engine', '/search', '/preview/og', '/messages', '/starred', '/canvas'];
      if (apiPrefixes.some(p => req.url.startsWith(p))) return;

      if (req.url.startsWith('/_next/')) {
        const filePath = join(webDir, req.url);
        if (existsSync(filePath)) {
          const ext = extname(filePath);
          reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
          return reply.send(readFileSync(filePath));
        }
      }

      const safePath = req.url.split('?')[0];
      const filePath = join(webDir, safePath === '/' ? 'index.html' : safePath);
      if (existsSync(filePath)) {
        const ext = extname(filePath);
        if (ext) {
          reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          // sw.js and manifest.json must NOT be cached — browser needs to detect new builds
          const noCacheFiles = ['/sw.js', '/manifest.json'];
          if (ext === '.html' || noCacheFiles.includes(safePath)) {
            reply.header('Cache-Control', 'no-cache');
          } else {
            reply.header('Cache-Control', 'public, max-age=31536000, immutable');
          }
          return reply.send(readFileSync(filePath));
        }
      }

      const indexPath = join(webDir, 'index.html');
      if (existsSync(indexPath)) {
        reply.header('Content-Type', 'text/html');
        reply.header('Cache-Control', 'no-cache');
        return reply.send(readFileSync(indexPath));
      }
    });

    logger.info(`[Static] Serving web from ${webDir}`);
  }

  // ─── Routes ───────────────────────────────────────────────────────────
  registerHealthRoutes(app);
  registerSessionRoutes(app);
  registerAgentRoutes(app, agents, agentMemoryRepo);
  registerSquadRoutes(app, squads, squadMembers, agents, extAgents);
  registerConfigRoutes(app, db);
  registerProviderRoutes(app, providers);
  registerSSERoutes(app);
  app.register(memoryRoutes);
  app.register(planRoutes);
  app.register(skillRoutes);
  app.register(heartbeatRoutes);
  app.register(questionRoutes);
  registerTaskRoutes(app, tasks);
  registerFileRoutes(app, process.cwd());
  registerArtifactRoutes(app, artifactRepo);
  registerBrowserRoutes(app);
  registerMCPRoutes(app);
  registerDataRoutes(app);
  registerPresentationRoutes(app);
  registerTunnelRoutes(app);
  registerConnectRoutes(app);
  registerMarketplaceRoutes(app, db);
  registerAuthRoutes(app, db);
  registerInviteRoutes(app, db);
  registerAutomationRoutes(app, db);
  registerFinetuneRoutes(app, finetuneDatasets, finetuneJobs);
  registerConsoleRoutes(app);
  registerCredentialRoutes(app, credentialRepo)
  registerTokenVaultRoutes(app, db);
  registerPreviewRoutes(app);
  registerWorkflowRoutes(app, workflowRepo);
  registerSetupRoutes(app, providers);
  registerPublicChatRoutes(app);
  registerBacklogRoutes(app);
  registerRoutingRoutes(app, providers);
  registerAnalyticsRoutes(app, db);
  registerEmbeddingRoutes(app);
  registerChannelRoutes(app, db);
  registerChannelV2Routes(app, db);
  registerNodeRoutes(app, db);
  registerExternalAgentRoutes(app);
  registerSearchRoutes(app, db);
  registerOGPreviewRoutes(app);
  registerMessageRoutes(app, db);
  registerN8nRoutes(app);
  registerSkillScoutRoutes(app, db);
  registerCanvasRoutes(app);

  // ─── Federation (feature-flagged) ──────────────────────────────────────
  const federationRepo = new FederationRepository(db);
  registerFederationRoutes(app, federationRepo);

  // ─── Start ────────────────────────────────────────────────────────────
  // R16: Rotate log files before startup (keeps them < 10MB each)
  rotateAllLogs();

  try {
    await app.listen({ port: PORT, host: HOST });

    // Attach federation WS upgrade handler (after server is listening)
    if (FEDERATION_ENABLED) {
      const server = app.server;
      const fedManager = getFederationManager();
      const federationWss = new WebSocketServer({ noServer: true });

      server.on('upgrade', (request, socket, head) => {
        if (request.url?.startsWith(FEDERATION_WS_PATH)) {
          federationWss.handleUpgrade(request, socket, head, (ws) => {
            fedManager.handleConnection(ws);
          });
        }
        // Other upgrade handlers (RPC, etc.) are already attached elsewhere
      });
    }

    console.log('');
    console.log(`  ✨ HiveClaw v${VERSION}`);
    console.log(`  → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  → Engine: Native (direct LLM)`);
    console.log(`  → Providers: ${enabledProviders.length > 0 ? enabledProviders.map(p => p.name).join(', ') : 'None (run Setup Wizard)'}`);
    console.log(`  → Agents: ${agents.list().length}`);
    if (FEDERATION_ENABLED) console.log(`  → Federation: enabled`);
    console.log('');

    // Start weekly skill discovery cron (Sprint 78)
    startSkillScoutCron(db);

    // Start automation cron scheduler (R6)
    startCronScheduler(db);

    // Start Node RPC Host (Phase 3 — Platform Blueprint)
    {
      const nodeRepo = new NodeRepository(db);
      const rpcHost = createNodeRPCHost(nodeRepo);
      rpcHost.attach(app.server);
      logger.info('[Nodes] RPC host attached');
    }

    // Start channel adapters v2 (Phase 1 — Platform Blueprint)
    {
      const { ChannelRepository } = await import('./api/channels.js');
      const channelRepo = new ChannelRepository(db);
      const channels = channelRepo.list();
      const v2Types = new Set(['telegram', 'whatsapp', 'discord', 'slack']);
      const v2Channels = channels
        .filter(c => c.enabled && v2Types.has(c.type))  // all 4 adapters
        .map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          enabled: c.enabled,
          agentId: c.agentId,
          config: c.config as Record<string, unknown>,
        }));
      if (v2Channels.length > 0) {
        const router = getChannelRouter();
        router.startAll(v2Channels).then(() => {
          logger.info('[Channels v2] Started %d adapter(s)', v2Channels.length);
        }).catch(err => {
          logger.error({ err }, '[Channels v2] Failed to start adapters');
        });
      }
    }

    // Start heartbeat scheduler (P4)
    import('./engine/heartbeat-scheduler.js').then(m => m.startHeartbeatScheduler()).catch(err => {
      app.log.warn('Heartbeat scheduler failed to start: %s', (err as Error).message);
    });

    // Check for updates (non-blocking, fires after startup)
    import('./lib/update-checker.js').then(m => m.checkForUpdate()).catch(() => {});
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ─── Self-Watchdog (autonomous health monitoring) ─────────────────────
  const { getWatchdog } = await import('./engine/self-watchdog.js');
  const watchdog = getWatchdog({ port: PORT });
  watchdog.start();

  // Graceful shutdown
  const shutdown = () => {
    logger.info('\n✨ Shutting down...');
    watchdog.stop();
    if (FEDERATION_ENABLED) getFederationManager().shutdown();
    resetCanvasHost();
    resetChannelRouter();
    resetNodeRPCHost();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
