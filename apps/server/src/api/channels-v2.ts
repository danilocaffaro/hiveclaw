/**
 * Channel Adapter v2 Management API
 *
 * Endpoints to control the ChannelRouter from the frontend:
 *   GET  /channels/v2/status         — status of all active adapters
 *   POST /channels/v2/:id/start       — start adapter for a channel
 *   POST /channels/v2/:id/stop        — stop adapter for a channel
 *   POST /channels/v2/:id/restart     — stop + start
 *   POST /channels/v2/:id/send        — send a message via v2 adapter
 *   GET  /channels/v2/:id/qr          — get latest WA QR code (if pending)
 *
 * This runs alongside the v1 /channels/:id/webhook routes — no conflict.
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getChannelRouter } from '../engine/channels/channel-router.js';
import { ChannelRepository } from './channels.js';
import { logger } from '../lib/logger.js';

// In-memory store for latest WA QR codes (keyed by channelId)
const qrStore = new Map<string, { qr: string; timestamp: string }>();

export function registerChannelV2Routes(app: FastifyInstance, db: Database.Database): void {
  const repo = new ChannelRepository(db);

  // Capture QR events from SSE broadcasts (WA pairing)
  // The whatsapp-adapter broadcasts 'whatsapp_qr' via broadcastSSE
  // We intercept those here so the /qr endpoint can serve them
  // (ChannelRouter emits them but we hook via the SSE event store)

  // GET /channels/v2/status — all active adapters
  app.get('/channels/v2/status', async () => {
    const router = getChannelRouter();
    return { data: router.getStatus() };
  });

  // POST /channels/v2/:id/start — start a single adapter
  app.post<{ Params: { id: string } }>('/channels/v2/:id/start', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (!ch.enabled) return reply.status(400).send({ error: { code: 'CHANNEL_DISABLED' } });

    const SUPPORTED = new Set(['telegram', 'whatsapp', 'discord', 'slack']);
    if (!SUPPORTED.has(ch.type)) {
      return reply.status(400).send({ error: { code: 'UNSUPPORTED_TYPE', message: `${ch.type} has no v2 adapter` } });
    }

    try {
      const router = getChannelRouter();
      await router.startChannel({
        id: ch.id,
        name: ch.name,
        type: ch.type as 'telegram' | 'whatsapp' | 'discord' | 'slack',
        enabled: ch.enabled,
        agentId: ch.agentId,
        config: ch.config as Record<string, unknown>,
      });
      logger.info('[Channels v2] Started via API: %s', ch.name);
      return { data: { ok: true, channelId: ch.id, status: 'connected' } };
    } catch (err) {
      logger.error({ err }, '[Channels v2] Failed to start %s', ch.id);
      return reply.status(500).send({ error: { code: 'START_FAILED', message: (err as Error).message } });
    }
  });

  // POST /channels/v2/:id/stop — stop a single adapter
  app.post<{ Params: { id: string } }>('/channels/v2/:id/stop', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    try {
      const router = getChannelRouter();
      await router.stopChannel(req.params.id);
      logger.info('[Channels v2] Stopped via API: %s', ch.name);
      return { data: { ok: true, channelId: ch.id, status: 'disconnected' } };
    } catch (err) {
      logger.error({ err }, '[Channels v2] Failed to stop %s', ch.id);
      return reply.status(500).send({ error: { code: 'STOP_FAILED', message: (err as Error).message } });
    }
  });

  // POST /channels/v2/:id/restart — stop + start
  app.post<{ Params: { id: string } }>('/channels/v2/:id/restart', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const SUPPORTED = new Set(['telegram', 'whatsapp', 'discord', 'slack']);
    if (!SUPPORTED.has(ch.type)) {
      return reply.status(400).send({ error: { code: 'UNSUPPORTED_TYPE' } });
    }

    try {
      const router = getChannelRouter();
      await router.stopChannel(req.params.id);
      await router.startChannel({
        id: ch.id,
        name: ch.name,
        type: ch.type as 'telegram' | 'whatsapp' | 'discord' | 'slack',
        enabled: ch.enabled,
        agentId: ch.agentId,
        config: ch.config as Record<string, unknown>,
      });
      logger.info('[Channels v2] Restarted via API: %s', ch.name);
      return { data: { ok: true, channelId: ch.id, status: 'connected' } };
    } catch (err) {
      logger.error({ err }, '[Channels v2] Failed to restart %s', ch.id);
      return reply.status(500).send({ error: { code: 'RESTART_FAILED', message: (err as Error).message } });
    }
  });

  // POST /channels/v2/:id/send — send a message via v2 adapter
  app.post<{
    Params: { id: string };
    Body: { chatId: string; text: string; replyToMessageId?: string };
  }>('/channels/v2/:id/send', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const { chatId, text, replyToMessageId } = req.body ?? {};
    if (!chatId || !text) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'chatId and text required' } });
    }

    const router = getChannelRouter();
    const adapter = router.getAdapter(ch.id);
    if (!adapter) {
      return reply.status(400).send({ error: { code: 'ADAPTER_NOT_ACTIVE', message: 'Start the channel adapter first' } });
    }

    try {
      const receipt = await router.send(ch.id, chatId, { text, replyToMessageId });
      return { data: { ok: true, ...receipt } };
    } catch (err) {
      return reply.status(500).send({ error: { code: 'SEND_FAILED', message: (err as Error).message } });
    }
  });

  // GET /channels/v2/:id/qr — latest WhatsApp QR code
  app.get<{ Params: { id: string } }>('/channels/v2/:id/qr', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (ch.type !== 'whatsapp') {
      return reply.status(400).send({ error: { code: 'NOT_WHATSAPP' } });
    }

    const entry = qrStore.get(req.params.id);
    if (!entry) {
      return reply.status(404).send({ error: { code: 'NO_QR', message: 'No QR code available — start the adapter first' } });
    }

    return { data: entry };
  });

  // Internal: store QR codes from SSE broadcast (called by whatsapp-adapter)
  // This is exposed as a module-level function so the adapter can call it
  logger.debug('[Channels v2] Management routes registered');
}

/**
 * Store a WA QR code for the /qr endpoint.
 * Called by the WhatsApp adapter (via the broadcastSSE hook or direct call).
 */
export function storeQRCode(channelId: string, qr: string): void {
  qrStore.set(channelId, { qr, timestamp: new Date().toISOString() });
}

/**
 * Clear a stored QR code (when WA connects successfully).
 */
export function clearQRCode(channelId: string): void {
  qrStore.delete(channelId);
}
