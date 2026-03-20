/**
 * Telegram Adapter — grammy-based full-featured Telegram Bot integration.
 *
 * Features:
 *   - Long polling (default) or webhook mode
 *   - Streaming via editMessageText (progressive response delivery)
 *   - Inline keyboards (buttons)
 *   - Emoji reactions
 *   - Reply/quote with reply_to_message_id
 *   - Media: photos, audio, voice, documents, video
 *   - Group handling: chat titles, mentions, reply context
 *   - Markdown v2 with automatic plain-text fallback
 *   - Typing indicators
 *   - Allowed chat IDs whitelist
 *
 * Phase 1.2 of HiveClaw Platform Blueprint.
 */

import { Bot, type Context, GrammyError, HttpError, InputFile } from 'grammy';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../lib/logger.js';
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
  CallbackQuery as CBQuery,
  InboundHandler,
  ReactionHandler,
  CallbackHandler,
  MediaType,
} from './adapter.js';

// ─── Config ───────────────────────────────────────────────────────────────

interface TelegramPlatformConfig {
  botToken: string;
  allowedChatIds?: string[];
  mode?: 'polling' | 'webhook';
  webhookUrl?: string;
  webhookSecret?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_TG_MESSAGE_LENGTH = 4096;
const TYPING_INTERVAL_MS = 4000;  // Telegram typing expires after 5s

// ─── Adapter ──────────────────────────────────────────────────────────────

export class TelegramAdapter implements ChannelAdapter {
  readonly type = 'telegram' as const;

  readonly capabilities: ChannelCapabilities = {
    streaming: true,
    reactions: true,
    inlineButtons: true,
    media: ['image', 'audio', 'video', 'document', 'voice', 'sticker'],
    groups: true,
    threads: false,  // Telegram has topics but we defer
    replies: true,
    mentions: true,
    editing: true,
    deleting: true,
    typing: true,
    maxMessageLength: MAX_TG_MESSAGE_LENGTH,
  };

  private _status: AdapterStatus = 'disconnected';
  get status(): AdapterStatus { return this._status; }

  private bot: Bot | null = null;
  private botToken: string | null = null;
  private config: AdapterConfig | null = null;
  private platformConfig: TelegramPlatformConfig | null = null;
  private messageHandlers: InboundHandler[] = [];
  private reactionHandlers: ReactionHandler[] = [];
  private callbackHandlers: CallbackHandler[] = [];
  private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.platformConfig = config.platform as unknown as TelegramPlatformConfig;

    if (!this.platformConfig.botToken) {
      throw new Error('[Telegram] botToken is required');
    }

    this._status = 'connecting';
    this.botToken = this.platformConfig.botToken;
    this.bot = new Bot(this.platformConfig.botToken);

    // ─── Register handlers ──────────────────────────────────────────

    // Text messages
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAllowedChat(ctx)) return;
      const msg = this.parseInbound(ctx);
      if (msg) {
        for (const handler of this.messageHandlers) {
          try { await handler(msg); } catch (err) {
            logger.error({ err }, '[Telegram] Message handler error');
          }
        }
      }
    });

    // Media messages (photo, audio, video, document, voice)
    this.bot.on('message', async (ctx) => {
      if (!this.isAllowedChat(ctx)) return;
      // Skip text-only (handled above)
      if (ctx.message.text && !ctx.message.photo && !ctx.message.audio &&
          !ctx.message.video && !ctx.message.document && !ctx.message.voice) return;

      const msg = this.parseInbound(ctx);
      if (msg && msg.media && msg.media.length > 0) {
        for (const handler of this.messageHandlers) {
          try { await handler(msg); } catch (err) {
            logger.error({ err }, '[Telegram] Media handler error');
          }
        }
      }
    });

    // Callback queries (inline button presses)
    this.bot.on('callback_query:data', async (ctx) => {
      const query: CBQuery = {
        id: ctx.callbackQuery.id,
        messageId: String(ctx.callbackQuery.message?.message_id ?? ''),
        chatId: String(ctx.callbackQuery.message?.chat?.id ?? ''),
        senderId: String(ctx.callbackQuery.from.id),
        data: ctx.callbackQuery.data,
      };
      for (const handler of this.callbackHandlers) {
        try { await handler(query); } catch (err) {
          logger.error({ err }, '[Telegram] Callback handler error');
        }
      }
    });

    // Reaction updates
    this.bot.on('message_reaction', async (ctx) => {
      const update = ctx.messageReaction;
      if (!update) return;
      const newReactions = update.new_reaction ?? [];
      const oldReactions = update.old_reaction ?? [];

      // Detect added reactions
      for (const r of newReactions) {
        if ('emoji' in r) {
          const reaction: InboundReaction = {
            messageId: String(update.message_id),
            chatId: String(update.chat.id),
            senderId: String(update.user?.id ?? ''),
            emoji: r.emoji,
            added: true,
          };
          for (const handler of this.reactionHandlers) {
            try { await handler(reaction); } catch (err) {
              logger.error({ err }, '[Telegram] Reaction handler error');
            }
          }
        }
      }

      // Detect removed reactions (present in old but not in new)
      for (const r of oldReactions) {
        if ('emoji' in r && !newReactions.some(n => 'emoji' in n && n.emoji === r.emoji)) {
          const reaction: InboundReaction = {
            messageId: String(update.message_id),
            chatId: String(update.chat.id),
            senderId: String(update.user?.id ?? ''),
            emoji: r.emoji,
            added: false,
          };
          for (const handler of this.reactionHandlers) {
            try { await handler(reaction); } catch (err) {
              logger.error({ err }, '[Telegram] Reaction handler error');
            }
          }
        }
      }
    });

    // Error handler
    this.bot.catch((err) => {
      if (err.error instanceof GrammyError) {
        logger.error('[Telegram] Grammy API error: %s', err.error.description);
      } else if (err.error instanceof HttpError) {
        logger.error('[Telegram] HTTP error: %s', err.error);
      } else {
        logger.error({ err: err.error }, '[Telegram] Unknown error');
      }
    });

    // ─── Start (with retry + backoff) ─────────────────────────────

    const MAX_CONNECT_RETRIES = 3;
    const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
      try {
        const me = await this.bot.api.getMe();
        logger.info('[Telegram] Connected as @%s (id: %d)', me.username, me.id);

        // Start long polling (non-blocking)
        this.bot.start({
          onStart: () => {
            this._status = 'connected';
            logger.info('[Telegram] Long polling started for channel %s', config.channelId);
          },
          allowed_updates: ['message', 'edited_message', 'callback_query', 'message_reaction'],
        });

        lastErr = null;
        break; // success
      } catch (err) {
        lastErr = err as Error;
        if (attempt < MAX_CONNECT_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt - 1] ?? 30_000;
          logger.warn('[Telegram] Connect attempt %d/%d failed: %s — retrying in %ds',
            attempt, MAX_CONNECT_RETRIES, lastErr.message, delay / 1000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (lastErr) {
      this._status = 'error';
      throw new Error(`[Telegram] Failed to connect after ${MAX_CONNECT_RETRIES} attempts: ${lastErr.message}`);
    }
  }

  async disconnect(): Promise<void> {
    // Clear all typing intervals
    for (const [, interval] of this.typingIntervals) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
    this._status = 'disconnected';
    logger.info('[Telegram] Disconnected');
  }

  // ─── Core Messaging ─────────────────────────────────────────────────

  async sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    this.ensureConnected();

    const chunks = splitMessage(message.text, MAX_TG_MESSAGE_LENGTH);
    let lastReceipt: MessageReceipt | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const params: Record<string, unknown> = {};

      // Parse mode
      if (message.parseMode === 'html') {
        params.parse_mode = 'HTML';
      } else if (message.parseMode !== 'plain') {
        params.parse_mode = 'Markdown';
      }

      // Reply
      if (i === 0 && message.replyToMessageId) {
        params.reply_parameters = { message_id: parseInt(message.replyToMessageId, 10) };
      }

      // Buttons (only on last chunk)
      if (isLast && message.buttons?.length) {
        params.reply_markup = {
          inline_keyboard: message.buttons.map(row =>
            row.map(btn => ({
              text: btn.text,
              ...(btn.callbackData ? { callback_data: btn.callbackData } : {}),
              ...(btn.url ? { url: btn.url } : {}),
            })),
          ),
        };
      }

      // Silent
      if (message.silent) {
        params.disable_notification = true;
      }

      const result = await this.sendWithFallback(chatId, chunks[i], params);
      lastReceipt = {
        messageId: String(result.message_id),
        chatId: String(result.chat.id),
        timestamp: result.date,
      };
    }

    return lastReceipt!;
  }

  async editMessage(chatId: string, messageId: string, text: string, parseMode?: 'markdown' | 'html' | 'plain'): Promise<void> {
    this.ensureConnected();

    const truncated = text.slice(0, MAX_TG_MESSAGE_LENGTH);
    const params: Record<string, unknown> = {};

    if (parseMode === 'html') {
      params.parse_mode = 'HTML';
    } else if (parseMode !== 'plain') {
      params.parse_mode = 'Markdown';
    }

    try {
      await this.bot!.api.editMessageText(chatId, parseInt(messageId, 10), truncated, params);
    } catch (err) {
      // Telegram returns 400 if text is unchanged — not an error
      if (err instanceof GrammyError && err.description.includes('message is not modified')) {
        return;
      }
      // Markdown failed — retry plain
      if (err instanceof GrammyError && params.parse_mode) {
        delete params.parse_mode;
        await this.bot!.api.editMessageText(chatId, parseInt(messageId, 10), truncated, params);
        return;
      }
      throw err;
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.ensureConnected();
    await this.bot!.api.deleteMessage(chatId, parseInt(messageId, 10));
  }

  // ─── Rich Features ──────────────────────────────────────────────────

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureConnected();
    // grammy types require a specific union — cast to satisfy TypeScript
    await this.bot!.api.setMessageReaction(
      chatId,
      parseInt(messageId, 10),
      [{ type: 'emoji', emoji: emoji as never }],
    );
  }

  async sendMedia(chatId: string, media: MediaPayload): Promise<MessageReceipt> {
    this.ensureConnected();

    const file = this.resolveMediaSource(media.source);
    const params: Record<string, unknown> = {};
    if (media.caption) params.caption = media.caption;
    if (media.replyToMessageId) {
      params.reply_parameters = { message_id: parseInt(media.replyToMessageId, 10) };
    }

    let result: { message_id: number; chat: { id: number }; date: number };

    switch (media.type) {
      case 'image':
        result = await this.bot!.api.sendPhoto(chatId, file, params);
        break;
      case 'audio':
        result = await this.bot!.api.sendAudio(chatId, file, params);
        break;
      case 'video':
        result = await this.bot!.api.sendVideo(chatId, file, params);
        break;
      case 'document':
        result = await this.bot!.api.sendDocument(chatId, file, params);
        break;
      case 'voice':
        result = await this.bot!.api.sendVoice(chatId, file, params);
        break;
      case 'sticker':
        result = await this.bot!.api.sendSticker(chatId, file, params);
        break;
      default:
        throw new Error(`Unsupported media type: ${media.type}`);
    }

    return {
      messageId: String(result.message_id),
      chatId: String(result.chat.id),
      timestamp: result.date,
    };
  }

  /**
   * Download a file from Telegram by file_id.
   * Returns local path to the downloaded file.
   */
  async downloadFile(fileId: string, ext = '.ogg'): Promise<string> {
    this.ensureConnected();
    const file = await this.bot!.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram did not return file_path');

    const token = this.botToken!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to download file: HTTP ${resp.status}`);

    const mediaDir = join(process.env.HOME ?? '/tmp', '.hiveclaw', 'media', 'inbound');
    mkdirSync(mediaDir, { recursive: true });

    const filename = `telegram-${fileId.slice(0, 16)}-${Date.now()}${ext}`;
    const localPath = join(mediaDir, filename);
    const buffer = Buffer.from(await resp.arrayBuffer());
    writeFileSync(localPath, buffer);

    logger.info('[Telegram] Downloaded file %s (%d bytes) → %s', fileId.slice(0, 16), buffer.length, localPath);
    return localPath;
  }

  async sendTyping(chatId: string, action: 'start' | 'stop'): Promise<void> {
    this.ensureConnected();
    const key = chatId;

    if (action === 'stop') {
      const interval = this.typingIntervals.get(key);
      if (interval) {
        clearInterval(interval);
        this.typingIntervals.delete(key);
      }
      return;
    }

    // Already typing — skip
    if (this.typingIntervals.has(key)) return;

    // Send immediately + set interval (Telegram typing expires after 5s)
    const sendAction = async () => {
      try {
        await this.bot!.api.sendChatAction(chatId, 'typing');
      } catch {
        // Ignore — chat might be gone
        const interval = this.typingIntervals.get(key);
        if (interval) {
          clearInterval(interval);
          this.typingIntervals.delete(key);
        }
      }
    };

    void sendAction();
    this.typingIntervals.set(key, setInterval(sendAction, TYPING_INTERVAL_MS));
  }

  async answerCallback(queryId: string, text?: string): Promise<void> {
    this.ensureConnected();
    await this.bot!.api.answerCallbackQuery(queryId, text ? { text } : undefined);
  }

  // ─── Inbound Registration ──────────────────────────────────────────

  onMessage(handler: InboundHandler): void {
    this.messageHandlers.push(handler);
  }

  onReaction(handler: ReactionHandler): void {
    this.reactionHandlers.push(handler);
  }

  onCallback(handler: CallbackHandler): void {
    this.callbackHandlers.push(handler);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.bot || this._status !== 'connected') {
      throw new Error('[Telegram] Adapter not connected');
    }
  }

  private isAllowedChat(ctx: Context): boolean {
    if (!this.platformConfig?.allowedChatIds?.length) return true;
    const chatId = String(ctx.chat?.id ?? '');
    return this.platformConfig.allowedChatIds.includes(chatId);
  }

  private parseInbound(ctx: Context): InboundMessage | null {
    const msg = ctx.message ?? ctx.editedMessage;
    if (!msg) return null;

    const media: InboundMedia[] = [];

    // Photos — take largest
    if (msg.photo?.length) {
      const largest = msg.photo[msg.photo.length - 1];
      media.push({
        type: 'image',
        fileId: largest.file_id,
        sizeBytes: largest.file_size,
      });
    }

    // Audio
    if (msg.audio) {
      media.push({
        type: 'audio',
        fileId: msg.audio.file_id,
        mimeType: msg.audio.mime_type,
        sizeBytes: msg.audio.file_size,
        filename: msg.audio.file_name,
      });
    }

    // Voice
    if (msg.voice) {
      media.push({
        type: 'voice',
        fileId: msg.voice.file_id,
        mimeType: msg.voice.mime_type,
        sizeBytes: msg.voice.file_size,
      });
    }

    // Video
    if (msg.video) {
      media.push({
        type: 'video',
        fileId: msg.video.file_id,
        mimeType: msg.video.mime_type,
        sizeBytes: msg.video.file_size,
        filename: msg.video.file_name,
      });
    }

    // Document
    if (msg.document) {
      media.push({
        type: 'document',
        fileId: msg.document.file_id,
        mimeType: msg.document.mime_type,
        sizeBytes: msg.document.file_size,
        filename: msg.document.file_name,
      });
    }

    const chat = msg.chat;
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    const text = msg.text ?? msg.caption ?? '';

    return {
      messageId: String(msg.message_id),
      chatId: String(chat.id),
      senderId: String(msg.from?.id ?? ''),
      senderName: buildSenderName(msg.from),
      text,
      replyToMessageId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      isGroup,
      groupTitle: isGroup ? (chat as { title?: string }).title : undefined,
      media: media.length > 0 ? media : undefined,
      raw: msg,
    };
  }

  /**
   * Send text with Markdown, auto-fallback to plain on parse error.
   */
  private async sendWithFallback(
    chatId: string,
    text: string,
    params: Record<string, unknown>,
  ): Promise<{ message_id: number; chat: { id: number }; date: number }> {
    try {
      return await this.bot!.api.sendMessage(chatId, text, params) as unknown as {
        message_id: number; chat: { id: number }; date: number;
      };
    } catch (err) {
      if (err instanceof GrammyError && params.parse_mode) {
        logger.warn('[Telegram] Markdown send failed (%s), retrying as plain', err.description.slice(0, 80));
        const plainParams = { ...params };
        delete plainParams.parse_mode;
        return await this.bot!.api.sendMessage(chatId, text, plainParams) as unknown as {
          message_id: number; chat: { id: number }; date: number;
        };
      }
      throw err;
    }
  }

  private resolveMediaSource(source: MediaPayload['source']): InputFile | string {
    switch (source.kind) {
      case 'url':
        return source.url;
      case 'path':
        return new InputFile(readFileSync(source.path), source.path.split('/').pop());
      case 'buffer':
        return new InputFile(source.buffer, source.filename);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildSenderName(from: { first_name?: string; last_name?: string; username?: string } | undefined): string {
  if (!from) return 'Unknown';
  const parts = [from.first_name, from.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return from.username ?? 'Unknown';
}

/**
 * Split long messages into chunks at newline or space boundaries.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point
    let breakAt = remaining.lastIndexOf('\n', maxLength);
    if (breakAt < maxLength * 0.5) {
      breakAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakAt < maxLength * 0.3) {
      breakAt = maxLength; // Hard cut
    }

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }

  return chunks;
}
