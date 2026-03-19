/**
 * WhatsApp Adapter — Baileys-based WhatsApp Web multi-device integration.
 *
 * Features:
 *   - Multi-device (no phone needed after pairing)
 *   - Auth state persisted to file system (SQLite adapter deferred — Q2)
 *   - QR code pairing via SSE event (emitted to frontend)
 *   - Text messages, media (image, audio, video, document, sticker)
 *   - Group handling
 *   - Reactions (emoji)
 *   - Reply/quote
 *   - Typing indicators (composing/paused)
 *   - Auto-reconnect with backoff
 *   - Allowed JID whitelist
 *
 * Phase 1.3 of HiveClaw Platform Blueprint.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type MessageUpsertType,
  type BaileysEventMap,
  proto,
} from '@whiskeysockets/baileys';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';
import { broadcastSSE } from '../../api/sse.js';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  AdapterStatus,
  AdapterConfig,
  OutboundMessage,
  MessageReceipt,
  MediaPayload,
  InboundMessage,
  InboundMedia,
  InboundReaction,
  InboundHandler,
  ReactionHandler,
  MediaType,
} from './adapter.js';

// ─── Config ───────────────────────────────────────────────────────────────

interface WhatsAppPlatformConfig {
  /** Directory for auth state files (default: ~/.hiveclaw/whatsapp/<channelId>) */
  authDir?: string;
  /** Allowed JIDs (e.g. ['5511999999999@s.whatsapp.net']). Empty = allow all */
  allowedJids?: string[];
  /** Whether to print QR to console (useful for headless servers) */
  printQR?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_WA_MESSAGE_LENGTH = 65536;   // WhatsApp practical limit
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const DEFAULT_AUTH_BASE = join(
  process.env.HIVECLAW_DATA_DIR ?? join(process.env.HOME ?? '/tmp', '.hiveclaw'),
  'whatsapp',
);

// ─── Adapter ──────────────────────────────────────────────────────────────

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = 'whatsapp' as const;

  readonly capabilities: ChannelCapabilities = {
    streaming: false,       // WA doesn't support message editing for streaming
    reactions: true,
    inlineButtons: false,   // WA has list/button messages but they're restricted
    media: ['image', 'audio', 'video', 'document', 'voice', 'sticker'],
    groups: true,
    threads: false,
    replies: true,
    mentions: true,
    editing: false,         // WA edit is limited (15min window, recent feature)
    deleting: true,
    typing: true,
    maxMessageLength: MAX_WA_MESSAGE_LENGTH,
  };

  private _status: AdapterStatus = 'disconnected';
  get status(): AdapterStatus { return this._status; }

  private sock: WASocket | null = null;
  private config: AdapterConfig | null = null;
  private platformConfig: WhatsAppPlatformConfig | null = null;
  private messageHandlers: InboundHandler[] = [];
  private reactionHandlers: ReactionHandler[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.platformConfig = config.platform as unknown as WhatsAppPlatformConfig;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;

    await this.createSocket();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }

    this._status = 'disconnected';
    logger.info('[WhatsApp] Disconnected');
  }

  // ─── Core Messaging ─────────────────────────────────────────────────

  async sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    this.ensureConnected();

    const jid = normalizeJid(chatId);
    const content: Record<string, unknown> = { text: message.text };

    // Reply/quote
    if (message.replyToMessageId) {
      content.quoted = {
        key: { remoteJid: jid, id: message.replyToMessageId },
      };
    }

    const result = await this.sock!.sendMessage(jid, content as never);

    return {
      messageId: result?.key?.id ?? '',
      chatId: jid,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async editMessage(_chatId: string, _messageId: string, _text: string): Promise<void> {
    // WhatsApp edit is very limited — not implementing for now
    logger.warn('[WhatsApp] editMessage not supported');
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.ensureConnected();
    const jid = normalizeJid(chatId);
    await this.sock!.sendMessage(jid, {
      delete: { remoteJid: jid, id: messageId, fromMe: true },
    } as never);
  }

  // ─── Rich Features ──────────────────────────────────────────────────

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureConnected();
    const jid = normalizeJid(chatId);
    await this.sock!.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: jid, id: messageId } },
    } as never);
  }

  async sendMedia(chatId: string, media: MediaPayload): Promise<MessageReceipt> {
    this.ensureConnected();
    const jid = normalizeJid(chatId);

    const content = this.buildMediaContent(media);

    if (media.caption) {
      (content as Record<string, unknown>).caption = media.caption;
    }

    if (media.replyToMessageId) {
      (content as Record<string, unknown>).quoted = {
        key: { remoteJid: jid, id: media.replyToMessageId },
      };
    }

    const result = await this.sock!.sendMessage(jid, content as never);

    return {
      messageId: result?.key?.id ?? '',
      chatId: jid,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async sendTyping(chatId: string, action: 'start' | 'stop'): Promise<void> {
    this.ensureConnected();
    const jid = normalizeJid(chatId);
    await this.sock!.sendPresenceUpdate(
      action === 'start' ? 'composing' : 'paused',
      jid,
    );
  }

  // ─── Inbound Registration ──────────────────────────────────────────

  onMessage(handler: InboundHandler): void {
    this.messageHandlers.push(handler);
  }

  onReaction(handler: ReactionHandler): void {
    this.reactionHandlers.push(handler);
  }

  // ─── Socket Creation ───────────────────────────────────────────────

  private async createSocket(): Promise<void> {
    const channelId = this.config!.channelId;
    const authDir = this.platformConfig?.authDir ?? join(DEFAULT_AUTH_BASE, channelId);

    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true });
    }

    this._status = 'connecting';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: this.platformConfig?.printQR ?? true,
      browser: ['HiveClaw', 'Server', '1.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    // ─── Event: connection.update ──────────────────────────────────

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code for pairing — broadcast to frontend
      if (qr) {
        logger.info('[WhatsApp] QR code generated — scan to pair');
        broadcastSSE(null, 'whatsapp_qr', {
          channelId,
          qr,
          timestamp: new Date().toISOString(),
        });
      }

      if (connection === 'open') {
        this._status = 'connected';
        this.reconnectAttempt = 0;
        logger.info('[WhatsApp] Connected for channel %s', channelId);
      }

      if (connection === 'close') {
        const err = lastDisconnect?.error as unknown as { output?: { statusCode?: number } } | undefined;
        const statusCode = err?.output?.statusCode ?? 0;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn('[WhatsApp] Connection closed (status %d, loggedOut=%s)', statusCode, !shouldReconnect);

        if (shouldReconnect && this.shouldReconnect) {
          this._status = 'reconnecting';
          this.scheduleReconnect();
        } else {
          this._status = 'disconnected';
          if (statusCode === DisconnectReason.loggedOut) {
            logger.error('[WhatsApp] Logged out — re-pairing required for channel %s', channelId);
            broadcastSSE(null, 'whatsapp_logged_out', { channelId });
          }
        }
      }
    });

    // ─── Event: creds.update ──────────────────────────────────────

    this.sock.ev.on('creds.update', saveCreds);

    // ─── Event: messages.upsert ───────────────────────────────────

    this.sock.ev.on('messages.upsert', async ({ messages, type }: BaileysEventMap['messages.upsert']) => {
      if (type !== 'notify') return; // only real-time messages

      for (const waMsg of messages) {
        // Skip own messages
        if (waMsg.key.fromMe) continue;

        // Allowed JID filter
        if (!this.isAllowedJid(waMsg.key.remoteJid ?? '')) continue;

        const msg = this.parseInbound(waMsg);
        if (!msg) continue;

        // Skip empty
        if (!msg.text.trim() && (!msg.media || msg.media.length === 0)) continue;

        for (const handler of this.messageHandlers) {
          try {
            await handler(msg);
          } catch (err) {
            logger.error({ err }, '[WhatsApp] Message handler error');
          }
        }
      }
    });

    // ─── Event: messages.reaction ─────────────────────────────────

    this.sock.ev.on('messages.reaction', async (reactions) => {
      for (const { key, reaction } of reactions) {
        const parsed: InboundReaction = {
          messageId: key.id ?? '',
          chatId: key.remoteJid ?? '',
          senderId: reaction.key?.participant ?? reaction.key?.remoteJid ?? '',
          emoji: reaction.text ?? '',
          added: !!reaction.text, // empty text = reaction removed
        };

        for (const handler of this.reactionHandlers) {
          try {
            await handler(parsed);
          } catch (err) {
            logger.error({ err }, '[WhatsApp] Reaction handler error');
          }
        }
      }
    });
  }

  // ─── Reconnection ──────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempt++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1),
      RECONNECT_MAX_MS,
    );

    logger.info('[WhatsApp] Reconnecting in %dms (attempt %d)...', delay, this.reconnectAttempt);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.createSocket();
      } catch (err) {
        logger.error({ err }, '[WhatsApp] Reconnect failed');
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.sock || this._status !== 'connected') {
      throw new Error('[WhatsApp] Adapter not connected');
    }
  }

  private isAllowedJid(jid: string): boolean {
    if (!this.platformConfig?.allowedJids?.length) return true;
    return this.platformConfig.allowedJids.some(allowed =>
      jid === allowed || jid.startsWith(allowed.split('@')[0]),
    );
  }

  private parseInbound(waMsg: WAMessage): InboundMessage | null {
    const msg = waMsg.message;
    if (!msg) return null;

    const jid = waMsg.key.remoteJid ?? '';
    const isGroup = jid.endsWith('@g.us');
    const senderId = isGroup
      ? (waMsg.key.participant ?? '')
      : jid;

    // Extract text
    let text = '';
    if (msg.conversation) {
      text = msg.conversation;
    } else if (msg.extendedTextMessage?.text) {
      text = msg.extendedTextMessage.text;
    } else if (msg.imageMessage?.caption) {
      text = msg.imageMessage.caption;
    } else if (msg.videoMessage?.caption) {
      text = msg.videoMessage.caption;
    } else if (msg.documentMessage?.caption) {
      text = msg.documentMessage.caption;
    }

    // Extract media
    const media: InboundMedia[] = [];

    if (msg.imageMessage) {
      media.push({
        type: 'image',
        mimeType: msg.imageMessage.mimetype ?? undefined,
        sizeBytes: msg.imageMessage.fileLength
          ? Number(msg.imageMessage.fileLength) : undefined,
      });
    }

    if (msg.audioMessage) {
      const isVoice = msg.audioMessage.ptt === true;
      media.push({
        type: isVoice ? 'voice' : 'audio',
        mimeType: msg.audioMessage.mimetype ?? undefined,
        sizeBytes: msg.audioMessage.fileLength
          ? Number(msg.audioMessage.fileLength) : undefined,
      });
    }

    if (msg.videoMessage) {
      media.push({
        type: 'video',
        mimeType: msg.videoMessage.mimetype ?? undefined,
        sizeBytes: msg.videoMessage.fileLength
          ? Number(msg.videoMessage.fileLength) : undefined,
      });
    }

    if (msg.documentMessage) {
      media.push({
        type: 'document',
        mimeType: msg.documentMessage.mimetype ?? undefined,
        sizeBytes: msg.documentMessage.fileLength
          ? Number(msg.documentMessage.fileLength) : undefined,
        filename: msg.documentMessage.fileName ?? undefined,
      });
    }

    if (msg.stickerMessage) {
      media.push({
        type: 'sticker',
        mimeType: msg.stickerMessage.mimetype ?? undefined,
      });
    }

    // Sender name from push name
    const senderName = waMsg.pushName ?? senderId.split('@')[0];

    // Reply context
    const contextInfo = msg.extendedTextMessage?.contextInfo
      ?? msg.imageMessage?.contextInfo
      ?? msg.videoMessage?.contextInfo;
    const replyToMessageId = contextInfo?.stanzaId ?? undefined;

    return {
      messageId: waMsg.key.id ?? '',
      chatId: jid,
      senderId,
      senderName,
      text,
      replyToMessageId,
      isGroup,
      groupTitle: undefined, // Would need group metadata cache
      media: media.length > 0 ? media : undefined,
      raw: waMsg,
    };
  }

  private buildMediaContent(media: MediaPayload): Record<string, unknown> {
    let sourceValue: unknown;

    switch (media.source.kind) {
      case 'url':
        sourceValue = { url: media.source.url };
        break;
      case 'path':
        sourceValue = { url: media.source.path }; // Baileys accepts file paths as url
        break;
      case 'buffer':
        sourceValue = media.source.buffer;
        break;
    }

    switch (media.type) {
      case 'image':
        return { image: sourceValue };
      case 'audio':
        return { audio: sourceValue, mimetype: media.mimeType ?? 'audio/mpeg' };
      case 'voice':
        return { audio: sourceValue, mimetype: media.mimeType ?? 'audio/ogg; codecs=opus', ptt: true };
      case 'video':
        return { video: sourceValue };
      case 'document':
        return { document: sourceValue, mimetype: media.mimeType ?? 'application/octet-stream', fileName: media.filename };
      case 'sticker':
        return { sticker: sourceValue };
      default:
        throw new Error(`Unsupported media type: ${media.type}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize chat ID to a WhatsApp JID.
 * If it looks like a phone number, append @s.whatsapp.net.
 * If it's already a JID, return as-is.
 */
function normalizeJid(chatId: string): string {
  if (chatId.includes('@')) return chatId;
  // Strip any + prefix and non-digit chars
  const digits = chatId.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}
