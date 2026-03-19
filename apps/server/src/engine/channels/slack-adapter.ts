/**
 * Slack Adapter — @slack/bolt-based Slack app integration.
 *
 * Features:
 *   - Socket Mode (no public URL needed) or HTTP mode
 *   - Text messages with mrkdwn formatting
 *   - Streaming via chat.update (progressive delivery)
 *   - Inline buttons (Block Kit actions)
 *   - Emoji reactions (add/remove)
 *   - Reply in thread (thread_ts)
 *   - Media: file uploads (image, audio, video, document)
 *   - Typing indicator (not natively supported — no-op)
 *   - Allowed channel IDs whitelist
 *   - Message splitting (Slack ~40K limit but blocks limit at ~3000)
 *
 * Phase 1.5 of HiveClaw Platform Blueprint.
 */

import { App } from '@slack/bolt';
import { readFileSync } from 'node:fs';
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
  InboundHandler,
  CallbackQuery as CBQuery,
  CallbackHandler,
  MediaType,
} from './adapter.js';

// ─── Config ───────────────────────────────────────────────────────────────

interface SlackPlatformConfig {
  botToken: string;
  appToken?: string;         // For Socket Mode
  signingSecret?: string;    // For HTTP mode
  /** Allowed channel IDs (empty = allow all) */
  allowedChannelIds?: string[];
  /** Use Socket Mode instead of HTTP (default: true if appToken provided) */
  socketMode?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_SLACK_MESSAGE_LENGTH = 3000; // Practical limit for clean display

// ─── Adapter ──────────────────────────────────────────────────────────────

export class SlackAdapter implements ChannelAdapter {
  readonly type = 'slack' as const;

  readonly capabilities: ChannelCapabilities = {
    streaming: true,        // via chat.update
    reactions: true,
    inlineButtons: true,    // Block Kit buttons
    media: ['image', 'audio', 'video', 'document'],
    groups: true,
    threads: true,
    replies: true,          // via thread_ts
    mentions: true,
    editing: true,
    deleting: true,
    typing: false,          // Slack has no typing indicator API for bots
    maxMessageLength: MAX_SLACK_MESSAGE_LENGTH,
  };

  private _status: AdapterStatus = 'disconnected';
  get status(): AdapterStatus { return this._status; }

  private app: App | null = null;
  private config: AdapterConfig | null = null;
  private platformConfig: SlackPlatformConfig | null = null;
  private messageHandlers: InboundHandler[] = [];
  private callbackHandlers: CallbackHandler[] = [];
  private botUserId: string | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.platformConfig = config.platform as unknown as SlackPlatformConfig;

    if (!this.platformConfig.botToken) {
      throw new Error('[Slack] botToken is required');
    }

    this._status = 'connecting';

    const useSocketMode = this.platformConfig.socketMode ?? !!this.platformConfig.appToken;

    this.app = new App({
      token: this.platformConfig.botToken,
      ...(useSocketMode
        ? { socketMode: true, appToken: this.platformConfig.appToken }
        : { signingSecret: this.platformConfig.signingSecret }),
    });

    // ─── Event: message ────────────────────────────────────────────

    this.app.message(async ({ message, say }) => {
      const msg = message as unknown as Record<string, unknown>;

      // Skip bot messages
      if (msg.bot_id) return;
      if (!msg.text) return;

      // Channel whitelist
      if (!this.isAllowedChannel(msg.channel as string)) return;

      const parsed = this.parseInbound(msg);
      if (!parsed || !parsed.text.trim()) return;

      for (const handler of this.messageHandlers) {
        try {
          await handler(parsed);
        } catch (err) {
          logger.error({ err }, '[Slack] Message handler error');
        }
      }
    });

    // ─── Event: action (button clicks) ─────────────────────────────

    this.app.action(/.*/, async ({ action, body, ack }) => {
      await ack();

      if (body.type !== 'block_actions') return;
      const blockAction = body.actions?.[0];
      if (!blockAction) return;

      const query: CBQuery = {
        id: blockAction.action_id,
        messageId: body.message?.ts ?? '',
        chatId: body.channel?.id ?? '',
        senderId: body.user.id,
        data: 'value' in blockAction ? (blockAction.value ?? blockAction.action_id) : blockAction.action_id,
      };

      for (const handler of this.callbackHandlers) {
        try {
          await handler(query);
        } catch (err) {
          logger.error({ err }, '[Slack] Button handler error');
        }
      }
    });

    // ─── Start ─────────────────────────────────────────────────────

    await this.app.start();

    // Get bot user ID for self-message filtering
    try {
      const authResult = await this.app.client.auth.test({ token: this.platformConfig.botToken });
      this.botUserId = authResult.user_id as string ?? null;
      logger.info('[Slack] Connected as %s (user_id: %s)', authResult.user, this.botUserId);
    } catch (err) {
      logger.warn('[Slack] Could not fetch bot identity: %s', (err as Error).message);
    }

    this._status = 'connected';
    logger.info('[Slack] Channel %s started (%s mode)', config.channelId, useSocketMode ? 'socket' : 'http');
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this._status = 'disconnected';
    logger.info('[Slack] Disconnected');
  }

  // ─── Core Messaging ─────────────────────────────────────────────────

  async sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    this.ensureConnected();

    const chunks = splitMessage(message.text, MAX_SLACK_MESSAGE_LENGTH);
    let lastTs = '';

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;

      const options: Record<string, unknown> = {
        token: this.platformConfig!.botToken,
        channel: chatId,
        text: chunks[i],
        mrkdwn: true,
      };

      // Thread reply
      if (isFirst && message.replyToMessageId) {
        options.thread_ts = message.replyToMessageId;
      }

      // Buttons (last chunk only)
      if (isLast && message.buttons?.length) {
        options.blocks = [
          { type: 'section', text: { type: 'mrkdwn', text: chunks[i] } },
          {
            type: 'actions',
            elements: message.buttons.flat().map(btn => ({
              type: btn.url ? 'button' : 'button',
              text: { type: 'plain_text', text: btn.text },
              ...(btn.callbackData ? { action_id: btn.callbackData, value: btn.callbackData } : {}),
              ...(btn.url ? { url: btn.url } : {}),
            })),
          },
        ];
      }

      const result = await this.app!.client.chat.postMessage(options as never);
      lastTs = result.ts as string ?? '';
    }

    return {
      messageId: lastTs,
      chatId,
      timestamp: lastTs ? parseFloat(lastTs) : Math.floor(Date.now() / 1000),
    };
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    this.ensureConnected();
    await this.app!.client.chat.update({
      token: this.platformConfig!.botToken,
      channel: chatId,
      ts: messageId,
      text: text.slice(0, MAX_SLACK_MESSAGE_LENGTH),
    });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.ensureConnected();
    await this.app!.client.chat.delete({
      token: this.platformConfig!.botToken,
      channel: chatId,
      ts: messageId,
    });
  }

  // ─── Rich Features ──────────────────────────────────────────────────

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureConnected();
    // Slack reactions use names without colons (e.g. 'thumbsup' not ':thumbsup:')
    const name = emoji.replace(/:/g, '');
    await this.app!.client.reactions.add({
      token: this.platformConfig!.botToken,
      channel: chatId,
      timestamp: messageId,
      name,
    });
  }

  async sendMedia(chatId: string, media: MediaPayload): Promise<MessageReceipt> {
    this.ensureConnected();

    let fileContent: Buffer;
    let filename = media.filename ?? 'file';

    switch (media.source.kind) {
      case 'path':
        fileContent = readFileSync(media.source.path);
        filename = media.source.path.split('/').pop() ?? filename;
        break;
      case 'buffer':
        fileContent = media.source.buffer;
        filename = media.source.filename;
        break;
      case 'url':
        // Slack's files.uploadV2 doesn't accept URLs directly — fetch first
        const res = await fetch(media.source.url);
        fileContent = Buffer.from(await res.arrayBuffer());
        break;
    }

    const uploadOptions: Record<string, unknown> = {
      token: this.platformConfig!.botToken,
      channel_id: chatId,
      file: fileContent,
      filename,
      initial_comment: media.caption,
    };
    if (media.replyToMessageId) {
      uploadOptions.thread_ts = media.replyToMessageId;
    }

    const result = await this.app!.client.filesUploadV2(uploadOptions as never);

    // filesUploadV2 returns different structure
    const ts = (result as unknown as Record<string, unknown>).ts as string ?? '';

    return {
      messageId: ts,
      chatId,
      timestamp: ts ? parseFloat(ts) : Math.floor(Date.now() / 1000),
    };
  }

  async sendTyping(_chatId: string, _action: 'start' | 'stop'): Promise<void> {
    // Slack doesn't have a typing indicator API for bots
  }

  async answerCallback(_queryId: string, _text?: string): Promise<void> {
    // Slack button interactions are ack'd in the action handler
  }

  // ─── Inbound Registration ──────────────────────────────────────────

  onMessage(handler: InboundHandler): void {
    this.messageHandlers.push(handler);
  }

  onCallback(handler: CallbackHandler): void {
    this.callbackHandlers.push(handler);
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.app || this._status !== 'connected') {
      throw new Error('[Slack] Adapter not connected');
    }
  }

  private isAllowedChannel(channelId: string): boolean {
    if (!this.platformConfig?.allowedChannelIds?.length) return true;
    return this.platformConfig.allowedChannelIds.includes(channelId);
  }

  private parseInbound(msg: Record<string, unknown>): InboundMessage | null {
    const media: InboundMedia[] = [];
    const files = msg.files as Array<Record<string, unknown>> | undefined;

    if (files) {
      for (const file of files) {
        const type = inferMediaType(String(file.mimetype ?? ''));
        media.push({
          type,
          url: file.url_private as string | undefined,
          mimeType: file.mimetype as string | undefined,
          sizeBytes: file.size as number | undefined,
          filename: file.name as string | undefined,
        });
      }
    }

    const channel = String(msg.channel ?? '');
    const channelType = String(msg.channel_type ?? '');

    return {
      messageId: String(msg.ts ?? ''),
      chatId: channel,
      senderId: String(msg.user ?? ''),
      senderName: undefined, // Would need users.info call — deferred
      text: String(msg.text ?? ''),
      replyToMessageId: msg.thread_ts as string | undefined,
      isGroup: channelType === 'channel' || channelType === 'group',
      groupTitle: undefined, // Would need conversations.info — deferred
      media: media.length > 0 ? media : undefined,
      raw: msg,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function inferMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf('\n', maxLength);
    if (breakAt < maxLength * 0.5) {
      breakAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakAt < maxLength * 0.3) {
      breakAt = maxLength;
    }

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }

  return chunks;
}
