/**
 * Channel Architecture v2 — Module index.
 */

export type {
  ChannelAdapter,
  ChannelType,
  ChannelCapabilities,
  AdapterStatus,
  AdapterConfig,
  OutboundMessage,
  InlineButton,
  MediaPayload,
  MediaSource,
  MediaType,
  MessageReceipt,
  InboundMessage,
  InboundMedia,
  InboundReaction,
  CallbackQuery,
  InboundHandler,
  ReactionHandler,
  CallbackHandler,
} from './adapter.js';

export {
  registerAdapterFactory,
  createAdapter,
  getRegisteredAdapterTypes,
} from './adapter.js';

export { TelegramAdapter } from './telegram-adapter.js';
export { WhatsAppAdapter } from './whatsapp-adapter.js';
export { DiscordAdapter } from './discord-adapter.js';
export { SlackAdapter } from './slack-adapter.js';
export { ChannelRouter, getChannelRouter, resetChannelRouter } from './channel-router.js';
export type { ChannelDBEntry } from './channel-router.js';

export {
  InboundRateLimiter,
  CircuitBreaker,
  StreamingDebouncer,
  ReconnectManager,
  verifyTelegramWebhook,
  verifyDiscordSignature,
  verifySlackSignature,
} from './hardening.js';
export type { RateLimiterConfig, CircuitBreakerConfig, CircuitState, ReconnectConfig } from './hardening.js';
