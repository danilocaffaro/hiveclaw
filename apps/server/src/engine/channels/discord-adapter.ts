/**
 * Discord Adapter — discord.js-based full-featured Discord Bot integration.
 *
 * Features:
 *   - Gateway (WebSocket) connection
 *   - Text messages in channels
 *   - Streaming via editMessage (progressive delivery)
 *   - Inline buttons (ActionRow + Button components)
 *   - Emoji reactions (add/remove)
 *   - Reply/quote with message reference
 *   - Media: images, audio, video, documents (as attachments)
 *   - Thread support
 *   - Typing indicators
 *   - Allowed channel IDs whitelist
 *   - Message splitting (2000 char limit)
 *   - Interaction (slash command + button) handling
 *
 * Phase 1.4 of HiveClaw Platform Blueprint.
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Message as DiscordMessage,
  type TextChannel,
  type DMChannel,
  type NewsChannel,
  type MessageReaction,
  type User as DiscordUser,
  type PartialMessageReaction,
  type PartialUser,
  type Interaction,
} from 'discord.js';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
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

interface DiscordPlatformConfig {
  botToken: string;
  /** Allowed channel IDs (empty = allow all) */
  allowedChannelIds?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_DISCORD_MESSAGE_LENGTH = 2000;

// ─── Adapter ──────────────────────────────────────────────────────────────

export class DiscordAdapter implements ChannelAdapter {
  readonly type = 'discord' as const;

  readonly capabilities: ChannelCapabilities = {
    streaming: true,
    reactions: true,
    inlineButtons: true,
    media: ['image', 'audio', 'video', 'document'],
    groups: true,
    threads: true,
    replies: true,
    mentions: true,
    editing: true,
    deleting: true,
    typing: true,
    maxMessageLength: MAX_DISCORD_MESSAGE_LENGTH,
  };

  private _status: AdapterStatus = 'disconnected';
  get status(): AdapterStatus { return this._status; }

  private client: Client | null = null;
  private config: AdapterConfig | null = null;
  private platformConfig: DiscordPlatformConfig | null = null;
  private messageHandlers: InboundHandler[] = [];
  private reactionHandlers: ReactionHandler[] = [];
  private callbackHandlers: CallbackHandler[] = [];

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this.platformConfig = config.platform as unknown as DiscordPlatformConfig;

    if (!this.platformConfig.botToken) {
      throw new Error('[Discord] botToken is required');
    }

    this._status = 'connecting';

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
      ],
    });

    // ─── Event: ready ──────────────────────────────────────────────

    this.client.once('ready', (c) => {
      this._status = 'connected';
      logger.info('[Discord] Connected as %s (id: %s)', c.user.tag, c.user.id);
    });

    // ─── Event: messageCreate ──────────────────────────────────────

    this.client.on('messageCreate', async (msg: DiscordMessage) => {
      // Skip own messages
      if (msg.author.bot) return;

      // Channel whitelist
      if (!this.isAllowedChannel(msg.channelId)) return;

      const parsed = this.parseInbound(msg);
      if (!parsed) return;
      if (!parsed.text.trim() && (!parsed.media || parsed.media.length === 0)) return;

      for (const handler of this.messageHandlers) {
        try {
          await handler(parsed);
        } catch (err) {
          logger.error({ err }, '[Discord] Message handler error');
        }
      }
    });

    // ─── Event: messageReactionAdd / Remove ────────────────────────

    this.client.on('messageReactionAdd', async (reaction: MessageReaction | PartialMessageReaction, user: DiscordUser | PartialUser) => {
      if (user.bot) return;
      const parsed = this.parseReaction(reaction, user, true);
      for (const handler of this.reactionHandlers) {
        try { await handler(parsed); } catch (err) {
          logger.error({ err }, '[Discord] Reaction handler error');
        }
      }
    });

    this.client.on('messageReactionRemove', async (reaction: MessageReaction | PartialMessageReaction, user: DiscordUser | PartialUser) => {
      if (user.bot) return;
      const parsed = this.parseReaction(reaction, user, false);
      for (const handler of this.reactionHandlers) {
        try { await handler(parsed); } catch (err) {
          logger.error({ err }, '[Discord] Reaction handler error');
        }
      }
    });

    // ─── Event: interactionCreate (buttons) ────────────────────────

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (!interaction.isButton()) return;

      const query: CBQuery = {
        id: interaction.id,
        messageId: interaction.message.id,
        chatId: interaction.channelId,
        senderId: interaction.user.id,
        data: interaction.customId,
      };

      for (const handler of this.callbackHandlers) {
        try { await handler(query); } catch (err) {
          logger.error({ err }, '[Discord] Button handler error');
        }
      }

      // Acknowledge
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(() => {});
      }
    });

    // ─── Event: error ──────────────────────────────────────────────

    this.client.on('error', (err) => {
      logger.error({ err }, '[Discord] Client error');
    });

    // ─── Login ─────────────────────────────────────────────────────

    await this.client.login(this.platformConfig.botToken);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
    this._status = 'disconnected';
    logger.info('[Discord] Disconnected');
  }

  // ─── Core Messaging ─────────────────────────────────────────────────

  async sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    this.ensureConnected();

    const channel = await this.resolveChannel(chatId);
    const chunks = splitMessage(message.text, MAX_DISCORD_MESSAGE_LENGTH);
    let lastMsg: DiscordMessage | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;

      const options: Record<string, unknown> = { content: chunks[i] };

      // Reply to (first chunk only)
      if (isFirst && message.replyToMessageId) {
        options.reply = { messageReference: message.replyToMessageId };
      }

      // Inline buttons (last chunk only)
      if (isLast && message.buttons?.length) {
        const rows = message.buttons.map(row => {
          const actionRow = new ActionRowBuilder<ButtonBuilder>();
          for (const btn of row) {
            const builder = new ButtonBuilder()
              .setLabel(btn.text)
              .setStyle(btn.url ? ButtonStyle.Link : ButtonStyle.Primary);
            if (btn.url) builder.setURL(btn.url);
            if (btn.callbackData) builder.setCustomId(btn.callbackData);
            actionRow.addComponents(builder);
          }
          return actionRow;
        });
        options.components = rows;
      }

      // Silent (suppress notifications)
      if (message.silent) {
        options.flags = [4096]; // SUPPRESS_NOTIFICATIONS
      }

      lastMsg = await channel.send(options) as DiscordMessage;
    }

    return {
      messageId: lastMsg!.id,
      chatId,
      timestamp: Math.floor(lastMsg!.createdTimestamp / 1000),
    };
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    this.ensureConnected();
    const channel = await this.resolveChannel(chatId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ content: text.slice(0, MAX_DISCORD_MESSAGE_LENGTH) });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.ensureConnected();
    const channel = await this.resolveChannel(chatId);
    const msg = await channel.messages.fetch(messageId);
    await msg.delete();
  }

  // ─── Rich Features ──────────────────────────────────────────────────

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureConnected();
    const channel = await this.resolveChannel(chatId);
    const msg = await channel.messages.fetch(messageId);
    await msg.react(emoji);
  }

  async sendMedia(chatId: string, media: MediaPayload): Promise<MessageReceipt> {
    this.ensureConnected();
    const channel = await this.resolveChannel(chatId);

    const attachment = this.buildAttachment(media);
    const options: Record<string, unknown> = {
      files: [attachment],
    };
    if (media.caption) options.content = media.caption;
    if (media.replyToMessageId) {
      options.reply = { messageReference: media.replyToMessageId };
    }

    const msg = await channel.send(options) as DiscordMessage;

    return {
      messageId: msg.id,
      chatId,
      timestamp: Math.floor(msg.createdTimestamp / 1000),
    };
  }

  async sendTyping(chatId: string, action: 'start' | 'stop'): Promise<void> {
    if (action === 'stop') return; // Discord typing auto-expires

    this.ensureConnected();
    const channel = await this.resolveChannel(chatId);
    await channel.sendTyping();
  }

  async answerCallback(queryId: string, text?: string): Promise<void> {
    // Discord button interactions are handled in interactionCreate via deferUpdate
    // This method exists for interface compliance
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
    if (!this.client || this._status !== 'connected') {
      throw new Error('[Discord] Adapter not connected');
    }
  }

  private isAllowedChannel(channelId: string): boolean {
    if (!this.platformConfig?.allowedChannelIds?.length) return true;
    return this.platformConfig.allowedChannelIds.includes(channelId);
  }

  private async resolveChannel(chatId: string): Promise<TextChannel | DMChannel | NewsChannel> {
    const channel = await this.client!.channels.fetch(chatId);
    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel ${chatId}`);
    }
    return channel as TextChannel | DMChannel | NewsChannel;
  }

  private parseInbound(msg: DiscordMessage): InboundMessage | null {
    const isGroup = msg.guild !== null;
    const media: InboundMedia[] = [];

    for (const att of msg.attachments.values()) {
      const type = inferMediaType(att.contentType ?? '');
      media.push({
        type,
        url: att.url,
        mimeType: att.contentType ?? undefined,
        sizeBytes: att.size,
        filename: att.name ?? undefined,
      });
    }

    return {
      messageId: msg.id,
      chatId: msg.channelId,
      senderId: msg.author.id,
      senderName: msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
      text: msg.content,
      replyToMessageId: msg.reference?.messageId ?? undefined,
      isGroup,
      groupTitle: msg.guild?.name,
      media: media.length > 0 ? media : undefined,
      raw: msg,
    };
  }

  private parseReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: DiscordUser | PartialUser,
    added: boolean,
  ): InboundReaction {
    return {
      messageId: reaction.message.id,
      chatId: reaction.message.channelId,
      senderId: user.id,
      emoji: reaction.emoji.name ?? reaction.emoji.toString(),
      added,
    };
  }

  private buildAttachment(media: MediaPayload): AttachmentBuilder {
    const name = media.filename ?? `file.${media.mimeType?.split('/')[1] ?? 'bin'}`;

    switch (media.source.kind) {
      case 'url':
        return new AttachmentBuilder(media.source.url, { name });
      case 'path':
        return new AttachmentBuilder(readFileSync(media.source.path), { name: basename(media.source.path) });
      case 'buffer':
        return new AttachmentBuilder(media.source.buffer, { name: media.source.filename });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function inferMediaType(contentType: string): MediaType {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
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
