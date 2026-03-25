// ============================================================
// Message Tool — Channel interaction for agents
// ============================================================
// Gives agents the ability to send media (images, audio, video, documents),
// react to messages, edit messages, and send typing indicators via their
// connected channel. Works with any channel adapter (Telegram, WhatsApp,
// Discord, Slack) by resolving the session's channel at runtime.

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { getDb } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { existsSync } from 'fs';

// Lazy import to avoid circular dependencies — channel router is wired at startup
async function getRouter() {
  const mod = await import('../channels/channel-router.js');
  return mod.getChannelRouter();
}

export class MessageTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'message',
    description:
      'Send media (images, audio, video, documents), react to messages, edit messages, or send typing indicators ' +
      'through your connected chat channel (Telegram, WhatsApp, Discord, etc.).\n\n' +
      'Actions:\n' +
      '- send_media: Send an image/audio/video/document. Provide file_path (local path) or base64 + media_type.\n' +
      '- react: Add an emoji reaction to a message by message_id.\n' +
      '- edit: Edit a previously sent message by message_id.\n' +
      '- typing: Show typing indicator.\n\n' +
      'For send_media with screenshots: use the screenshot tool first, then pass the base64 result here.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['send_media', 'react', 'edit', 'typing'],
          description: 'Action to perform',
        },
        // send_media params
        media_type: {
          type: 'string',
          enum: ['image', 'audio', 'video', 'document', 'voice', 'sticker'],
          description: 'Type of media to send (for send_media)',
        },
        file_path: {
          type: 'string',
          description: 'Local file path to send (for send_media)',
        },
        base64: {
          type: 'string',
          description: 'Base64-encoded file content (for send_media, alternative to file_path)',
        },
        caption: {
          type: 'string',
          description: 'Optional caption for the media (for send_media)',
        },
        // react params
        message_id: {
          type: 'string',
          description: 'Message ID to react to or edit',
        },
        emoji: {
          type: 'string',
          description: 'Emoji to react with (for react)',
        },
        // edit params
        text: {
          type: 'string',
          description: 'New text content (for edit)',
        },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, context?: ToolContext): Promise<ToolOutput> {
    const action = input['action'] as string;
    const sessionId = context?.sessionId;

    if (!sessionId) {
      return { success: false, error: 'No session context — cannot determine channel' };
    }

    // Resolve channel + chatId from session
    const channel = this.resolveChannel(sessionId);
    if (!channel) {
      return { success: false, error: 'Session is not linked to a channel — message tool only works in channel sessions' };
    }

    try {
      switch (action) {
        case 'send_media':
          return await this.sendMedia(input, channel);
        case 'react':
          return await this.react(input, channel);
        case 'edit':
          return await this.editMessage(input, channel);
        case 'typing':
          return await this.sendTyping(channel);
        default:
          return { success: false, error: `Unknown action: ${action}. Use send_media, react, edit, or typing.` };
      }
    } catch (err) {
      logger.error('[MessageTool] %s failed: %s', action, (err as Error).message);
      return { success: false, error: `${action} failed: ${(err as Error).message}` };
    }
  }

  private resolveChannel(sessionId: string): { channelId: string; chatId: string; type: string } | null {
    const db = getDb();
    // Session title format: "channel:{channelId}:{chatId}"
    const session = db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId) as { title: string } | undefined;
    if (!session?.title) return null;

    const match = session.title.match(/^channel:([^:]+):(.+)$/);
    if (!match) return null;

    const channelId = match[1];
    const chatId = match[2];

    // Get channel type
    const channel = db.prepare('SELECT type FROM channels WHERE id = ?').get(channelId) as { type: string } | undefined;
    const type = channel?.type ?? 'telegram';

    return { channelId, chatId, type };
  }

  private async sendMedia(
    input: ToolInput,
    channel: { channelId: string; chatId: string; type: string },
  ): Promise<ToolOutput> {
    const mediaType = (input['media_type'] as string) || 'image';
    const filePath = input['file_path'] as string | undefined;
    const base64Data = input['base64'] as string | undefined;
    const caption = input['caption'] as string | undefined;

    if (!filePath && !base64Data) {
      return { success: false, error: 'Provide file_path or base64 for send_media' };
    }

    // Get the channel adapter via router
    const router = await getRouter();
    const adapter = router.getAdapter(channel.channelId);
    if (!adapter) {
      return { success: false, error: `No adapter found for channel ${channel.channelId}` };
    }

    if (typeof adapter.sendMedia !== 'function') {
      return { success: false, error: `Channel adapter does not support sendMedia` };
    }

    // Build media payload
    let source: { kind: 'path'; path: string } | { kind: 'buffer'; buffer: Buffer; filename: string };

    if (filePath) {
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      source = { kind: 'path', path: filePath };
    } else if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      const ext = mediaType === 'image' ? 'png' : mediaType === 'audio' ? 'ogg' : mediaType === 'video' ? 'mp4' : 'bin';
      source = { kind: 'buffer', buffer, filename: `file.${ext}` };
    } else {
      return { success: false, error: 'No media source provided' };
    }

    const receipt = await adapter.sendMedia(channel.chatId, {
      type: mediaType as 'image' | 'audio' | 'video' | 'document' | 'voice' | 'sticker',
      source,
      caption,
    });

    logger.info('[MessageTool] Sent %s to %s:%s (msgId=%s)', mediaType, channel.channelId, channel.chatId, receipt.messageId);

    return {
      success: true,
      result: {
        action: 'send_media',
        messageId: receipt.messageId,
        mediaType,
      },
    };
  }

  private async react(
    input: ToolInput,
    channel: { channelId: string; chatId: string; type: string },
  ): Promise<ToolOutput> {
    const messageId = input['message_id'] as string;
    const emoji = input['emoji'] as string;

    if (!messageId || !emoji) {
      return { success: false, error: 'message_id and emoji are required for react' };
    }

    const router = await getRouter();
    const adapter = router.getAdapter(channel.channelId);
    if (!adapter || typeof adapter.sendReaction !== 'function') {
      return { success: false, error: 'Channel adapter does not support reactions' };
    }

    await adapter.sendReaction(channel.chatId, messageId, emoji);

    return {
      success: true,
      result: { action: 'react', messageId, emoji },
    };
  }

  private async editMessage(
    input: ToolInput,
    channel: { channelId: string; chatId: string; type: string },
  ): Promise<ToolOutput> {
    const messageId = input['message_id'] as string;
    const text = input['text'] as string;

    if (!messageId || !text) {
      return { success: false, error: 'message_id and text are required for edit' };
    }

    const router = await getRouter();
    const adapter = router.getAdapter(channel.channelId);
    if (!adapter || typeof adapter.editMessage !== 'function') {
      return { success: false, error: 'Channel adapter does not support editing messages' };
    }

    await adapter.editMessage(channel.chatId, messageId, text);

    return {
      success: true,
      result: { action: 'edit', messageId },
    };
  }

  private async sendTyping(
    channel: { channelId: string; chatId: string; type: string },
  ): Promise<ToolOutput> {
    const router = await getRouter();
    const adapter = router.getAdapter(channel.channelId);
    if (!adapter || typeof adapter.sendTyping !== 'function') {
      return { success: false, error: 'Channel adapter does not support typing indicators' };
    }

    await adapter.sendTyping(channel.chatId, 'start');

    return {
      success: true,
      result: { action: 'typing' },
    };
  }
}
