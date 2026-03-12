/**
 * api/channels.ts — External channel integrations (Batch 7)
 *
 * Allows SuperClaw to send/receive messages via:
 *   - Telegram Bot API
 *   - WhatsApp (via Twilio or Meta Cloud API)
 *   - Discord Webhook
 *   - Slack Webhook
 *   - Generic Webhook
 *
 * Architecture:
 *   - Channels are stored in DB (channels table)
 *   - Outbound: POST /channels/:id/send — send a message via channel
 *   - Inbound: POST /channels/:id/webhook — receive from platform (webhook)
 *   - SSE bridge: inbound messages → session → SSE stream (agent responds)
 */

import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { broadcastSSE } from './sse.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ChannelType = 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'webhook';

export interface ChannelConfig {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  agentId: string;            // Which agent handles inbound messages
  config: ChannelTypeConfig;
  createdAt: string;
  updatedAt: string;
}

export type ChannelTypeConfig =
  | { type: 'telegram'; botToken: string; allowedChatIds?: string[] }
  | { type: 'whatsapp'; provider: 'twilio' | 'meta'; accountSid?: string; authToken?: string; phoneNumber?: string; accessToken?: string }
  | { type: 'discord'; webhookUrl: string; botToken?: string; guildId?: string }
  | { type: 'slack'; webhookUrl: string; botToken?: string; signingSecret?: string }
  | { type: 'webhook'; url?: string; secret?: string; method?: 'GET' | 'POST' };

export interface OutboundMessage {
  text: string;
  to?: string;          // Chat ID, channel ID, etc.
  imageUrl?: string;
  replyToId?: string;
}

// ─── DB Schema ──────────────────────────────────────────────────────────────────

export function initChannelSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      agent_id TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      from_id TEXT,
      to_id TEXT,
      content TEXT NOT NULL,
      raw TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_messages_direction ON channel_messages(channel_id, direction);
  `);
}

// ─── DB Row Type ────────────────────────────────────────────────────────────────

interface ChannelRow {
  id: string;
  name: string;
  type: string;
  enabled: number;
  agent_id: string;
  config: string;
  created_at: string;
  updated_at: string;
}

// ─── Channel Repository ─────────────────────────────────────────────────────────

export class ChannelRepository {
  constructor(private db: Database.Database) {
    initChannelSchema(db);
  }

  list(): ChannelConfig[] {
    const rows = this.db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all() as ChannelRow[];
    return rows.map(this.rowToConfig);
  }

  get(id: string): ChannelConfig | undefined {
    const row = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
    return row ? this.rowToConfig(row) : undefined;
  }

  create(data: Omit<ChannelConfig, 'id' | 'createdAt' | 'updatedAt'>): ChannelConfig {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO channels (id, name, type, enabled, agent_id, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.type, data.enabled ? 1 : 0, data.agentId, JSON.stringify(data.config), now, now);
    return this.get(id)!;
  }

  update(id: string, data: Partial<Omit<ChannelConfig, 'id' | 'createdAt'>>): ChannelConfig | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE channels SET
        name = ?, type = ?, enabled = ?, agent_id = ?, config = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.name ?? existing.name,
      data.type ?? existing.type,
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      data.agentId ?? existing.agentId,
      JSON.stringify(data.config ?? existing.config),
      now,
      id,
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const r = this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return r.changes > 0;
  }

  logMessage(channelId: string, direction: 'inbound' | 'outbound', content: string, fromId?: string, toId?: string, raw?: string): void {
    this.db.prepare(`
      INSERT INTO channel_messages (id, channel_id, direction, from_id, to_id, content, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), channelId, direction, fromId ?? null, toId ?? null, content, raw ? JSON.stringify(raw) : null);
  }

  private rowToConfig(row: ChannelRow): ChannelConfig {
    return {
      id: row.id,
      name: row.name,
      type: row.type as ChannelType,
      enabled: row.enabled === 1,
      agentId: row.agent_id,
      config: JSON.parse(row.config || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ─── Outbound Senders ───────────────────────────────────────────────────────────

async function sendTelegram(config: Extract<ChannelTypeConfig, { type: 'telegram' }>, msg: OutboundMessage): Promise<void> {
  const chatId = msg.to;
  if (!chatId) throw new Error('Telegram: to (chat_id) required');

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: msg.text,
      parse_mode: 'Markdown',
      ...(msg.replyToId ? { reply_to_message_id: msg.replyToId } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Telegram API error ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function sendDiscord(config: Extract<ChannelTypeConfig, { type: 'discord' }>, msg: OutboundMessage): Promise<void> {
  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: msg.text.slice(0, 2000),
      ...(msg.imageUrl ? { embeds: [{ image: { url: msg.imageUrl } }] } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord webhook error ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function sendSlack(config: Extract<ChannelTypeConfig, { type: 'slack' }>, msg: OutboundMessage): Promise<void> {
  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg.text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook error ${res.status}`);
  }
}

async function sendWebhook(config: Extract<ChannelTypeConfig, { type: 'webhook' }>, msg: OutboundMessage): Promise<void> {
  if (!config.url) throw new Error('Webhook: url required');
  const method = config.method ?? 'POST';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.secret) headers['X-Webhook-Secret'] = config.secret;
  const res = await fetch(config.url, {
    method,
    headers,
    body: JSON.stringify({ text: msg.text, to: msg.to }),
  });
  if (!res.ok) {
    throw new Error(`Webhook error ${res.status}`);
  }
}

/** Extract a test target chat ID from channel config */
function getChannelTestTarget(config: ChannelTypeConfig): string | undefined {
  const c = config as Record<string, unknown>;
  const ids = c.allowedChatIds as string[] | undefined;
  return ids?.[0] ?? (c.defaultChatId as string | undefined);
}

/**
 * Route a message to the correct sender based on channel type.
 */
async function sendViaChannel(channel: ChannelConfig, msg: OutboundMessage): Promise<void> {
  const cfg = channel.config as ChannelTypeConfig;
  switch (channel.type) {
    case 'telegram': return sendTelegram(cfg as Extract<ChannelTypeConfig, { type: 'telegram' }>, msg);
    case 'discord':  return sendDiscord(cfg as Extract<ChannelTypeConfig, { type: 'discord' }>, msg);
    case 'slack':    return sendSlack(cfg as Extract<ChannelTypeConfig, { type: 'slack' }>, msg);
    case 'webhook':  return sendWebhook(cfg as Extract<ChannelTypeConfig, { type: 'webhook' }>, msg);
    case 'whatsapp':
      throw new Error('WhatsApp not yet implemented — use Twilio or Meta Cloud API');
    default:
      throw new Error(`Unknown channel type: ${channel.type}`);
  }
}

// ─── Inbound Parsing ────────────────────────────────────────────────────────────

function parseTelegramUpdate(body: unknown): { fromId: string; text: string; replyToId?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const msg = (b.message ?? b.edited_message) as Record<string, unknown> | undefined;
  if (!msg || typeof msg.text !== 'string') return null;
  const chat = msg.chat as Record<string, unknown> | undefined;
  const from = msg.from as Record<string, unknown> | undefined;
  return {
    fromId: String(chat?.id ?? from?.id ?? ''),
    text: msg.text,
    replyToId: msg.message_id ? String(msg.message_id) : undefined,
  };
}

function parseDiscordInteraction(body: unknown): { fromId: string; text: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.type === 1) return null; // PING
  const content = (b.content as string) ?? ((b.data as Record<string, unknown>)?.options as Array<Record<string, unknown>>)?.[0]?.value;
  if (!content || typeof content !== 'string') return null;
  const author = b.author as Record<string, unknown> | undefined;
  const member = b.member as Record<string, unknown> | undefined;
  const memberUser = member?.user as Record<string, unknown> | undefined;
  return {
    fromId: String(author?.id ?? memberUser?.id ?? ''),
    text: content,
  };
}

function parseSlackEvent(body: unknown): { fromId: string; text: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const event = b.event as Record<string, unknown> | undefined;
  if (!event || event.type !== 'message' || event.bot_id) return null;
  return {
    fromId: String(event.user ?? ''),
    text: String(event.text ?? ''),
  };
}

function parseInbound(channel: ChannelConfig, body: unknown): { fromId: string; text: string; replyToId?: string } | null {
  switch (channel.type) {
    case 'telegram': return parseTelegramUpdate(body);
    case 'discord':  return parseDiscordInteraction(body);
    case 'slack':    return parseSlackEvent(body);
    default: {
      if (!body || typeof body !== 'object') return null;
      const b = body as Record<string, unknown>;
      return typeof b.text === 'string' ? { fromId: String(b.from ?? ''), text: b.text } : null;
    }
  }
}

// ─── Route Registration ─────────────────────────────────────────────────────────

export function registerChannelRoutes(app: FastifyInstance, db: Database.Database): void {
  const repo = new ChannelRepository(db);

  // GET /channels — list all
  app.get('/channels', async () => {
    const channels = repo.list().map(c => ({
      ...c,
      config: maskConfig(c.config), // Never expose tokens in list
    }));
    return { data: channels };
  });

  // GET /channels/:id
  app.get<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    return { data: { ...ch, config: maskConfig(ch.config) } };
  });

  // POST /channels — create
  app.post<{
    Body: {
      name: string;
      type: ChannelType;
      agentId?: string;
      config: ChannelTypeConfig;
    };
  }>('/channels', async (req, reply) => {
    const { name, type, agentId = '', config } = req.body ?? {};
    if (!name || !type || !config) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name, type, config required' } });
    }
    const ch = repo.create({ name, type, enabled: true, agentId, config });
    return reply.status(201).send({ data: ch });
  });

  // PUT /channels/:id — update
  app.put<{
    Params: { id: string };
    Body: Partial<Omit<ChannelConfig, 'id' | 'createdAt'>>;
  }>('/channels/:id', async (req, reply) => {
    const updated = repo.update(req.params.id, req.body ?? {});
    if (!updated) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    return { data: updated };
  });

  // DELETE /channels/:id
  app.delete<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const ok = repo.delete(req.params.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.status(204).send();
  });

  // POST /channels/:id/send — outbound message
  app.post<{
    Params: { id: string };
    Body: OutboundMessage;
  }>('/channels/:id/send', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    if (!ch.enabled) return reply.status(400).send({ error: { code: 'CHANNEL_DISABLED' } });

    try {
      await sendViaChannel(ch, req.body ?? {});
      repo.logMessage(ch.id, 'outbound', req.body?.text ?? '', undefined, req.body?.to);
      return { data: { ok: true } };
    } catch (err) {
      logger.error('[Channels] Send error on %s: %s', ch.id, (err as Error).message);
      return reply.status(500).send({ error: { code: 'SEND_ERROR', message: (err as Error).message } });
    }
  });

  // POST /channels/:id/webhook — inbound from platform
  // This endpoint is called by Telegram/Discord/Slack webhooks
  // It should be PUBLIC (no API key required) — protected by channel secret or platform verification
  app.post<{
    Params: { id: string };
    Body: any;
  }>('/channels/:id/webhook', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    // Discord PING response
    const body = req.body as Record<string, unknown>;
    if (ch.type === 'discord' && body?.type === 1) {
      return { type: 1 }; // Discord PONG
    }

    // Slack URL verification challenge
    if (ch.type === 'slack' && body?.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    const parsed = parseInbound(ch, body);
    if (!parsed || !parsed.text.trim()) {
      return reply.status(200).send({ ok: true }); // Always 200 to platform
    }

    // Log inbound
    repo.logMessage(ch.id, 'inbound', parsed.text, parsed.fromId, undefined, JSON.stringify(req.body));

    // Broadcast to SSE so connected clients can see it
    if (ch.agentId) {
      broadcastSSE(null, 'channel_message', {
        channelId: ch.id,
        channelType: ch.type,
        agentId: ch.agentId,
        fromId: parsed.fromId,
        text: parsed.text,
        timestamp: new Date().toISOString(),
      });
    }

    // TODO: Route to agent session for auto-reply (Phase 2)
    // For now: just log + broadcast to SSE

    return reply.status(200).send({ ok: true });
  });

  // POST /channels/:id/test — verify connection
  app.post<{ Params: { id: string } }>('/channels/:id/test', async (req, reply) => {
    const ch = repo.get(req.params.id);
    if (!ch) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    try {
      await sendViaChannel(ch, {
        text: '✅ SuperClaw channel connection test — working!',
        to: getChannelTestTarget(ch.config),
      });
      return { data: { ok: true, message: 'Test message sent successfully' } };
    } catch (err) {
      return reply.status(500).send({ error: { code: 'TEST_FAILED', message: (err as Error).message } });
    }
  });

  // GET /channels/:id/messages — message history
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; direction?: 'inbound' | 'outbound' };
  }>('/channels/:id/messages', async (req, reply) => {
    if (!repo.get(req.params.id)) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const direction = req.query.direction;

    let query = 'SELECT * FROM channel_messages WHERE channel_id = ?';
    const params: any[] = [req.params.id];
    if (direction) { query += ' AND direction = ?'; params.push(direction); }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    return { data: rows };
  });
}

// ─── Helper: Mask sensitive config fields ───────────────────────────────────────

function maskConfig(config: ChannelTypeConfig): object {
  const c = { ...(config as Record<string, unknown>) };
  for (const key of ['botToken', 'authToken', 'accessToken', 'webhookUrl', 'signingSecret', 'secret']) {
    if (c[key]) c[key] = `${String(c[key]).slice(0, 4)}...${String(c[key]).slice(-4)}`;
  }
  return c;
}
