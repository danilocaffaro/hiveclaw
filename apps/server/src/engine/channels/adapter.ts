/**
 * Channel Adapter v2 — Core interface and types.
 *
 * Every channel adapter (Telegram, WhatsApp, Discord, etc.) implements
 * ChannelAdapter. The ChannelRouter uses capabilities to decide what
 * features are available per-platform.
 *
 * Phase 1.1 of HiveClaw Platform Blueprint.
 */

// ─── Channel Types ────────────────────────────────────────────────────────

export type ChannelType = 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'webhook';

export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'voice' | 'sticker';

export type AdapterStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// ─── Capabilities ─────────────────────────────────────────────────────────

export interface ChannelCapabilities {
  streaming: boolean;            // Can edit messages progressively
  reactions: boolean;            // Can send emoji reactions
  inlineButtons: boolean;        // Can send inline keyboards / buttons
  media: MediaType[];            // Supported media types
  groups: boolean;               // Supports group chats
  threads: boolean;              // Supports thread/topic replies
  replies: boolean;              // Supports reply-to-message
  mentions: boolean;             // Supports @mentions
  editing: boolean;              // Can edit sent messages
  deleting: boolean;             // Can delete sent messages
  typing: boolean;               // Can send typing indicators
  maxMessageLength: number;      // Max chars per message
}

// ─── Messages ─────────────────────────────────────────────────────────────

export interface OutboundMessage {
  text: string;
  parseMode?: 'markdown' | 'html' | 'plain';
  replyToMessageId?: string;
  buttons?: InlineButton[][];    // rows of buttons
  silent?: boolean;              // no notification
}

export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface MediaPayload {
  type: MediaType;
  source: MediaSource;
  caption?: string;
  filename?: string;
  mimeType?: string;
  replyToMessageId?: string;
}

export type MediaSource =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
  | { kind: 'buffer'; buffer: Buffer; filename: string };

export interface MessageReceipt {
  messageId: string;
  chatId: string;
  timestamp: number;
}

export interface InboundMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  text: string;
  replyToMessageId?: string;
  isGroup: boolean;
  groupTitle?: string;
  media?: InboundMedia[];
  raw: unknown;                  // original platform payload
}

export interface InboundMedia {
  type: MediaType;
  fileId?: string;               // platform file reference
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  filename?: string;
}

export interface InboundReaction {
  messageId: string;
  chatId: string;
  senderId: string;
  emoji: string;
  added: boolean;                // true = added, false = removed
}

export interface CallbackQuery {
  id: string;
  messageId: string;
  chatId: string;
  senderId: string;
  data: string;
}

// ─── Handlers ─────────────────────────────────────────────────────────────

export type InboundHandler = (message: InboundMessage) => void | Promise<void>;
export type ReactionHandler = (reaction: InboundReaction) => void | Promise<void>;
export type CallbackHandler = (query: CallbackQuery) => void | Promise<void>;

// ─── Adapter Config ───────────────────────────────────────────────────────

export interface AdapterConfig {
  /** Unique channel ID from DB */
  channelId: string;
  /** Human-readable name */
  name: string;
  /** Which agent handles inbound */
  agentId: string;
  /** Platform-specific config (tokens, secrets, etc.) */
  platform: Record<string, unknown>;
}

// ─── The Interface ────────────────────────────────────────────────────────

export interface ChannelAdapter {
  /** Platform type */
  readonly type: ChannelType;

  /** What this adapter can do */
  readonly capabilities: ChannelCapabilities;

  /** Current connection status */
  readonly status: AdapterStatus;

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /** Initialize and connect */
  connect(config: AdapterConfig): Promise<void>;

  /** Graceful disconnect */
  disconnect(): Promise<void>;

  // ─── Core Messaging ─────────────────────────────────────────────────

  /** Send a text message (with optional buttons, formatting, reply) */
  sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt>;

  /** Edit a previously sent message */
  editMessage(chatId: string, messageId: string, text: string, parseMode?: 'markdown' | 'html' | 'plain'): Promise<void>;

  /** Delete a message */
  deleteMessage(chatId: string, messageId: string): Promise<void>;

  // ─── Rich Features ──────────────────────────────────────────────────

  /** Send an emoji reaction on a message */
  sendReaction(chatId: string, messageId: string, emoji: string): Promise<void>;

  /** Send media (image, audio, document, etc.) */
  sendMedia(chatId: string, media: MediaPayload): Promise<MessageReceipt>;

  /** Send typing indicator (start/stop) */
  sendTyping(chatId: string, action: 'start' | 'stop'): Promise<void>;

  /** Answer a callback query (inline button press) */
  answerCallback?(queryId: string, text?: string): Promise<void>;

  // ─── Inbound ────────────────────────────────────────────────────────

  /** Register handler for incoming messages */
  onMessage(handler: InboundHandler): void;

  /** Register handler for reactions (if supported) */
  onReaction?(handler: ReactionHandler): void;

  /** Register handler for inline button callbacks */
  onCallback?(handler: CallbackHandler): void;
}

// ─── Adapter Registry ─────────────────────────────────────────────────────

const adapterFactories = new Map<ChannelType, () => ChannelAdapter>();

export function registerAdapterFactory(type: ChannelType, factory: () => ChannelAdapter): void {
  adapterFactories.set(type, factory);
}

export function createAdapter(type: ChannelType): ChannelAdapter {
  const factory = adapterFactories.get(type);
  if (!factory) {
    throw new Error(`No adapter registered for channel type: ${type}`);
  }
  return factory();
}

export function getRegisteredAdapterTypes(): ChannelType[] {
  return [...adapterFactories.keys()];
}
