/**
 * Channel Router — manages adapter lifecycle, inbound routing, and outbound delivery.
 *
 * Responsibilities:
 *   - Start/stop adapters based on DB channel configs
 *   - Route inbound messages → find/create session → engine v2
 *   - Deliver engine responses back via correct adapter
 *   - Streaming bridge: SSE events from engine → progressive message edits
 *   - Multi-agent routing rules
 *   - Typing indicator lifecycle
 *
 * Phase 1.5 of HiveClaw Platform Blueprint.
 */

import { logger } from '../../lib/logger.js';
import { getEngineService } from '../engine-service.js';
import type {
  ChannelAdapter,
  ChannelType,
  AdapterConfig,
  InboundMessage,
  InboundReaction,
  CallbackQuery,
  OutboundMessage,
  MessageReceipt,
  MediaPayload,
} from './adapter.js';
import { createAdapter, registerAdapterFactory } from './adapter.js';
import { TelegramAdapter } from './telegram-adapter.js';
import { WhatsAppAdapter } from './whatsapp-adapter.js';
import { DiscordAdapter } from './discord-adapter.js';
import { SlackAdapter } from './slack-adapter.js';
import { transcribeAudio } from './audio-transcriber.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ChannelRouterConfig {
  /** Loaded from DB — channels to activate */
  channels: ChannelDBEntry[];
}

export interface ChannelDBEntry {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  agentId: string;
  config: Record<string, unknown>;
}

interface ActiveChannel {
  entry: ChannelDBEntry;
  adapter: ChannelAdapter;
}

interface StreamingSession {
  chatId: string;
  messageId: string;        // ID of the message being edited
  adapter: ChannelAdapter;
  buffer: string;
  lastFlush: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Minimum interval between edit calls (hybrid debounce — Adler Q3) */
const STREAM_DEBOUNCE_MS = 500;

/** Punctuation that triggers an immediate flush */
const FLUSH_PUNCTUATION = /[.!?\n]$/;

// ─── Router ───────────────────────────────────────────────────────────────

export class ChannelRouter {
  private activeChannels = new Map<string, ActiveChannel>();
  private streamingSessions = new Map<string, StreamingSession>();

  constructor() {
    // Register adapter factories
    registerAdapterFactory('telegram', () => new TelegramAdapter());
    registerAdapterFactory('whatsapp', () => new WhatsAppAdapter());
    registerAdapterFactory('discord', () => new DiscordAdapter());
    registerAdapterFactory('slack', () => new SlackAdapter());
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start all enabled channels from DB config.
   */
  async startAll(channels: ChannelDBEntry[]): Promise<void> {
    const enabled = channels.filter(c => c.enabled);
    logger.info('[Router] Starting %d channel(s)...', enabled.length);

    for (const entry of enabled) {
      try {
        await this.startChannel(entry);
      } catch (err) {
        logger.error({ err }, '[Router] Failed to start channel %s (%s)', entry.name, entry.type);
      }
    }
  }

  /**
   * Start a single channel.
   */
  async startChannel(entry: ChannelDBEntry): Promise<void> {
    // Stop existing if running
    if (this.activeChannels.has(entry.id)) {
      await this.stopChannel(entry.id);
    }

    const adapter = createAdapter(entry.type);

    const config: AdapterConfig = {
      channelId: entry.id,
      name: entry.name,
      agentId: entry.agentId,
      platform: entry.config,
    };

    // Wire up inbound handlers BEFORE connecting
    adapter.onMessage(async (msg) => this.handleInbound(entry, adapter, msg));

    if (adapter.onReaction) {
      adapter.onReaction(async (reaction) => this.handleReaction(entry, reaction));
    }

    if (adapter.onCallback) {
      adapter.onCallback(async (query) => this.handleCallback(entry, adapter, query));
    }

    await adapter.connect(config);

    this.activeChannels.set(entry.id, { entry, adapter });
    logger.info('[Router] Channel started: %s (%s)', entry.name, entry.type);
  }

  /**
   * Stop a single channel.
   */
  async stopChannel(channelId: string): Promise<void> {
    const active = this.activeChannels.get(channelId);
    if (!active) return;

    await active.adapter.disconnect();
    this.activeChannels.delete(channelId);
    logger.info('[Router] Channel stopped: %s', active.entry.name);
  }

  /**
   * Stop all channels.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.activeChannels.keys()];
    for (const id of ids) {
      await this.stopChannel(id);
    }

    // Clear streaming sessions
    for (const [, session] of this.streamingSessions) {
      if (session.timer) clearTimeout(session.timer);
    }
    this.streamingSessions.clear();

    logger.info('[Router] All channels stopped');
  }

  // ─── Outbound ───────────────────────────────────────────────────────

  /**
   * Send a message through a channel by ID.
   */
  async send(channelId: string, chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    const active = this.activeChannels.get(channelId);
    if (!active) throw new Error(`Channel not active: ${channelId}`);
    return active.adapter.sendMessage(chatId, message);
  }

  /**
   * Send media through a channel.
   */
  async sendMedia(channelId: string, chatId: string, media: MediaPayload): Promise<MessageReceipt> {
    const active = this.activeChannels.get(channelId);
    if (!active) throw new Error(`Channel not active: ${channelId}`);
    return active.adapter.sendMedia(chatId, media);
  }

  /**
   * Start streaming: send initial message, then progressively edit it.
   * Returns a streamId to use with feedStream/endStream.
   */
  async startStream(channelId: string, chatId: string, initialText?: string): Promise<string> {
    const active = this.activeChannels.get(channelId);
    if (!active) throw new Error(`Channel not active: ${channelId}`);

    // Send initial placeholder
    const receipt = await active.adapter.sendMessage(chatId, {
      text: initialText ?? '▍',
      parseMode: 'plain',
    });

    const streamId = `${channelId}:${chatId}:${receipt.messageId}`;
    this.streamingSessions.set(streamId, {
      chatId,
      messageId: receipt.messageId,
      adapter: active.adapter,
      buffer: initialText ?? '',
      lastFlush: Date.now(),
      timer: null,
    });

    return streamId;
  }

  /**
   * Feed text chunk to a streaming session.
   * Uses hybrid debounce: flush on punctuation OR after 500ms.
   */
  feedStream(streamId: string, chunk: string): void {
    const session = this.streamingSessions.get(streamId);
    if (!session) return;

    session.buffer += chunk;

    const now = Date.now();
    const elapsed = now - session.lastFlush;
    const hasPunctuation = FLUSH_PUNCTUATION.test(session.buffer);

    if (hasPunctuation || elapsed >= STREAM_DEBOUNCE_MS) {
      // Flush now
      this.flushStream(streamId);
    } else if (!session.timer) {
      // Schedule flush at debounce boundary
      session.timer = setTimeout(() => {
        this.flushStream(streamId);
      }, STREAM_DEBOUNCE_MS - elapsed);
    }
  }

  /**
   * End a streaming session — final edit with complete text.
   */
  async endStream(streamId: string, finalText?: string): Promise<void> {
    const session = this.streamingSessions.get(streamId);
    if (!session) return;

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    const text = finalText ?? session.buffer;
    if (text) {
      try {
        await session.adapter.editMessage(session.chatId, session.messageId, text);
      } catch (err) {
        logger.warn('[Router] Stream final edit failed: %s', (err as Error).message);
      }
    }

    this.streamingSessions.delete(streamId);
  }

  // ─── Status ─────────────────────────────────────────────────────────

  /**
   * Get status of all channels.
   */
  getStatus(): Array<{ channelId: string; name: string; type: ChannelType; status: string }> {
    return [...this.activeChannels.values()].map(({ entry, adapter }) => ({
      channelId: entry.id,
      name: entry.name,
      type: entry.type,
      status: adapter.status,
    }));
  }

  /**
   * Get adapter for a channel (for direct access).
   */
  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.activeChannels.get(channelId)?.adapter;
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private flushStream(streamId: string): void {
    const session = this.streamingSessions.get(streamId);
    if (!session || !session.buffer) return;

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    const text = session.buffer + ' ▍';  // cursor indicator
    session.lastFlush = Date.now();

    // Fire and forget — don't block the stream
    session.adapter.editMessage(session.chatId, session.messageId, text, 'plain').catch((err) => {
      logger.debug('[Router] Stream edit failed (non-fatal): %s', (err as Error).message);
    });
  }

  /**
   * Handle an inbound message from a channel adapter.
   */
  private async handleInbound(entry: ChannelDBEntry, adapter: ChannelAdapter, msg: InboundMessage): Promise<void> {
    if (!msg.text.trim() && (!msg.media || msg.media.length === 0)) return;

    logger.info('[Router] Inbound on %s from %s: %s', entry.name, msg.senderName ?? msg.senderId, msg.text.slice(0, 80));

    // Send typing indicator
    if (adapter.capabilities.typing) {
      void adapter.sendTyping(msg.chatId, 'start');
    }

    // ─── Audio transcription: download + transcribe voice/audio ───
    let audioTranscription = '';
    const audioMedia = msg.media?.filter(m => m.type === 'voice' || m.type === 'audio');
    if (audioMedia?.length && adapter instanceof TelegramAdapter) {
      for (const media of audioMedia) {
        try {
          const ext = media.mimeType?.includes('ogg') ? '.ogg'
            : media.mimeType?.includes('mp4') ? '.m4a'
            : media.mimeType?.includes('mpeg') ? '.mp3' : '.ogg';
          const localPath = await adapter.downloadFile(media.fileId!, ext);
          const text = await transcribeAudio(localPath);
          if (text) {
            audioTranscription += `[🎤 Voice message: "${text}"]\n`;
          } else {
            audioTranscription += '[🎤 Voice message — transcription unavailable]\n';
          }
        } catch (err) {
          logger.error('[Router] Failed to transcribe audio: %s', (err as Error).message);
          audioTranscription += '[🎤 Voice message — transcription failed]\n';
        }
      }
    }

    const messageText = audioTranscription
      ? `${audioTranscription}${msg.text ? '\n' + msg.text : ''}`
      : msg.text;

    try {
      // Route to engine — get agent response
      const response = await getEngineService().channels.handleInbound({
        channelId: entry.id,
        agentId: entry.agentId,
        fromId: msg.senderId,
        text: messageText,
        senderName: msg.senderName,
        isGroup: msg.isGroup,
        groupTitle: msg.groupTitle,
        channelType: entry.type,
        channelName: entry.name,
      });

      // Stop typing
      if (adapter.capabilities.typing) {
        void adapter.sendTyping(msg.chatId, 'stop');
      }

      // Send response back
      if (response) {
        // ─── Outbound audio: detect [VOICE:/path] or [AUDIO:/path] tags ───
        const voiceMatch = response.match(/\[(?:VOICE|AUDIO):([^\]]+)\]/);
        if (voiceMatch && adapter.capabilities.media.includes('voice')) {
          const audioPath = voiceMatch[1].trim();
          const textWithout = response.replace(voiceMatch[0], '').trim();

          try {
            await adapter.sendMedia(msg.chatId, {
              type: 'voice',
              source: { kind: 'path', path: audioPath },
              caption: textWithout || undefined,
              replyToMessageId: msg.messageId,
            });
          } catch (err) {
            logger.error('[Router] Failed to send voice: %s — falling back to text', (err as Error).message);
            await adapter.sendMessage(msg.chatId, {
              text: textWithout || response,
              replyToMessageId: msg.messageId,
            });
          }
        } else {
          await adapter.sendMessage(msg.chatId, {
            text: response,
            replyToMessageId: msg.messageId,
          });
        }
      }
    } catch (err) {
      logger.error({ err }, '[Router] Engine error for inbound on %s', entry.name);

      // Stop typing on error
      if (adapter.capabilities.typing) {
        void adapter.sendTyping(msg.chatId, 'stop');
      }
    }
  }

  private async handleReaction(entry: ChannelDBEntry, reaction: InboundReaction): Promise<void> {
    logger.debug('[Router] Reaction on %s: %s %s by %s', entry.name, reaction.added ? '+' : '-', reaction.emoji, reaction.senderId);
    // Future: route to agent for interpretation
  }

  private async handleCallback(entry: ChannelDBEntry, adapter: ChannelAdapter, query: CallbackQuery): Promise<void> {
    logger.debug('[Router] Callback on %s: %s from %s', entry.name, query.data, query.senderId);

    // Acknowledge callback immediately
    if (adapter.answerCallback) {
      await adapter.answerCallback(query.id);
    }

    // Future: route callback data to engine
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _router: ChannelRouter | null = null;

export function getChannelRouter(): ChannelRouter {
  if (!_router) {
    _router = new ChannelRouter();
  }
  return _router;
}

export function resetChannelRouter(): void {
  if (_router) {
    void _router.stopAll();
    _router = null;
  }
}
