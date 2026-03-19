/**
 * Tests for Channel Architecture v2 — Adapter interface, Router, streaming.
 *
 * Note: These are unit tests using a mock adapter.
 * The TelegramAdapter is tested via integration (requires bot token).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  AdapterStatus,
  AdapterConfig,
  OutboundMessage,
  MessageReceipt,
  MediaPayload,
  InboundHandler,
  InboundMessage,
} from '../engine/channels/adapter.js';
import { registerAdapterFactory, createAdapter, getRegisteredAdapterTypes } from '../engine/channels/adapter.js';
import { ChannelRouter } from '../engine/channels/channel-router.js';

// ─── Mock Adapter ─────────────────────────────────────────────────────────

class MockAdapter implements ChannelAdapter {
  readonly type = 'webhook' as const;
  readonly capabilities: ChannelCapabilities = {
    streaming: true,
    reactions: false,
    inlineButtons: false,
    media: [],
    groups: false,
    threads: false,
    replies: true,
    mentions: false,
    editing: true,
    deleting: true,
    typing: true,
    maxMessageLength: 4096,
  };

  private _status: AdapterStatus = 'disconnected';
  get status(): AdapterStatus { return this._status; }

  config: AdapterConfig | null = null;
  sentMessages: { chatId: string; message: OutboundMessage }[] = [];
  editedMessages: { chatId: string; messageId: string; text: string }[] = [];
  deletedMessages: { chatId: string; messageId: string }[] = [];
  typingActions: { chatId: string; action: 'start' | 'stop' }[] = [];
  private messageHandlers: InboundHandler[] = [];
  private messageCounter = 0;

  async connect(config: AdapterConfig): Promise<void> {
    this.config = config;
    this._status = 'connected';
  }

  async disconnect(): Promise<void> {
    this._status = 'disconnected';
  }

  async sendMessage(chatId: string, message: OutboundMessage): Promise<MessageReceipt> {
    this.sentMessages.push({ chatId, message });
    this.messageCounter++;
    return {
      messageId: `msg-${this.messageCounter}`,
      chatId,
      timestamp: Date.now(),
    };
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    this.editedMessages.push({ chatId, messageId, text });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.deletedMessages.push({ chatId, messageId });
  }

  async sendReaction(): Promise<void> { /* noop */ }

  async sendMedia(chatId: string, _media: MediaPayload): Promise<MessageReceipt> {
    this.messageCounter++;
    return { messageId: `media-${this.messageCounter}`, chatId, timestamp: Date.now() };
  }

  async sendTyping(chatId: string, action: 'start' | 'stop'): Promise<void> {
    this.typingActions.push({ chatId, action });
  }

  onMessage(handler: InboundHandler): void {
    this.messageHandlers.push(handler);
  }

  /** Simulate an inbound message (for testing) */
  simulateInbound(msg: InboundMessage): void {
    for (const handler of this.messageHandlers) {
      void handler(msg);
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Channel Adapter Interface', () => {
  it('adapter has correct type and capabilities', () => {
    const adapter = new MockAdapter();
    expect(adapter.type).toBe('webhook');
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.reactions).toBe(false);
    expect(adapter.capabilities.maxMessageLength).toBe(4096);
    expect(adapter.status).toBe('disconnected');
  });

  it('connect sets status to connected', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({
      channelId: 'test-1',
      name: 'Test',
      agentId: 'agent-1',
      platform: {},
    });
    expect(adapter.status).toBe('connected');
  });

  it('disconnect sets status to disconnected', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({ channelId: '1', name: 'T', agentId: 'a', platform: {} });
    await adapter.disconnect();
    expect(adapter.status).toBe('disconnected');
  });

  it('sendMessage returns receipt', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({ channelId: '1', name: 'T', agentId: 'a', platform: {} });

    const receipt = await adapter.sendMessage('chat-123', { text: 'Hello' });
    expect(receipt.messageId).toBeTruthy();
    expect(receipt.chatId).toBe('chat-123');
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].message.text).toBe('Hello');
  });

  it('editMessage records edit', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({ channelId: '1', name: 'T', agentId: 'a', platform: {} });

    await adapter.editMessage('chat-1', 'msg-1', 'updated text');
    expect(adapter.editedMessages).toHaveLength(1);
    expect(adapter.editedMessages[0].text).toBe('updated text');
  });

  it('deleteMessage records delete', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({ channelId: '1', name: 'T', agentId: 'a', platform: {} });

    await adapter.deleteMessage('chat-1', 'msg-1');
    expect(adapter.deletedMessages).toHaveLength(1);
  });

  it('sendTyping records typing actions', async () => {
    const adapter = new MockAdapter();
    await adapter.connect({ channelId: '1', name: 'T', agentId: 'a', platform: {} });

    await adapter.sendTyping('chat-1', 'start');
    await adapter.sendTyping('chat-1', 'stop');
    expect(adapter.typingActions).toEqual([
      { chatId: 'chat-1', action: 'start' },
      { chatId: 'chat-1', action: 'stop' },
    ]);
  });

  it('onMessage handler receives inbound messages', async () => {
    const adapter = new MockAdapter();
    const received: InboundMessage[] = [];
    adapter.onMessage(async (msg) => { received.push(msg); });

    adapter.simulateInbound({
      messageId: 'in-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      senderName: 'Test User',
      text: 'hello bot',
      isGroup: false,
      raw: {},
    });

    // Give handler time to run
    await new Promise(r => setTimeout(r, 10));
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('hello bot');
    expect(received[0].senderName).toBe('Test User');
  });
});

describe('Adapter Registry', () => {
  it('registers and creates adapter', () => {
    registerAdapterFactory('webhook', () => new MockAdapter());
    const adapter = createAdapter('webhook');
    expect(adapter.type).toBe('webhook');
  });

  it('throws for unregistered type', () => {
    expect(() => createAdapter('discord')).toThrow('No adapter registered');
  });

  it('lists registered types', () => {
    registerAdapterFactory('webhook', () => new MockAdapter());
    const types = getRegisteredAdapterTypes();
    expect(types).toContain('webhook');
  });
});

describe('Channel Router', () => {
  let router: ChannelRouter;

  beforeEach(() => {
    // Fresh router with mock adapter factory
    router = new ChannelRouter();
    // Override telegram factory with mock for testing
    registerAdapterFactory('telegram', () => new MockAdapter());
    registerAdapterFactory('webhook', () => new MockAdapter());
  });

  it('starts and stops a channel', async () => {
    await router.startChannel({
      id: 'ch-1',
      name: 'Test Channel',
      type: 'webhook',
      enabled: true,
      agentId: 'agent-1',
      config: {},
    });

    const status = router.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe('Test Channel');
    expect(status[0].status).toBe('connected');

    await router.stopChannel('ch-1');
    expect(router.getStatus()).toHaveLength(0);
  });

  it('startAll starts only enabled channels', async () => {
    await router.startAll([
      { id: 'ch-1', name: 'Enabled', type: 'webhook', enabled: true, agentId: 'a1', config: {} },
      { id: 'ch-2', name: 'Disabled', type: 'webhook', enabled: false, agentId: 'a2', config: {} },
    ]);

    expect(router.getStatus()).toHaveLength(1);
    expect(router.getStatus()[0].name).toBe('Enabled');
  });

  it('stopAll stops everything', async () => {
    await router.startAll([
      { id: 'ch-1', name: 'A', type: 'webhook', enabled: true, agentId: 'a1', config: {} },
      { id: 'ch-2', name: 'B', type: 'webhook', enabled: true, agentId: 'a2', config: {} },
    ]);

    expect(router.getStatus()).toHaveLength(2);
    await router.stopAll();
    expect(router.getStatus()).toHaveLength(0);
  });

  it('send routes to correct adapter', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const receipt = await router.send('ch-1', 'chat-123', { text: 'hello' });
    expect(receipt.chatId).toBe('chat-123');
    expect(receipt.messageId).toBeTruthy();
  });

  it('send throws for non-active channel', async () => {
    await expect(router.send('missing', 'chat', { text: 'hi' })).rejects.toThrow('not active');
  });

  it('getAdapter returns adapter for active channel', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const adapter = router.getAdapter('ch-1');
    expect(adapter).toBeTruthy();
    expect(adapter!.type).toBe('webhook');
  });

  it('getAdapter returns undefined for missing channel', () => {
    expect(router.getAdapter('missing')).toBeUndefined();
  });

  it('replaces channel on restart (double start)', async () => {
    const entry = { id: 'ch-1', name: 'Test', type: 'webhook' as const, enabled: true, agentId: 'a1', config: {} };

    await router.startChannel(entry);
    const adapter1 = router.getAdapter('ch-1');

    await router.startChannel(entry);
    const adapter2 = router.getAdapter('ch-1');

    // Should be different instances
    expect(adapter1).not.toBe(adapter2);
    expect(router.getStatus()).toHaveLength(1);
  });
});

describe('Channel Router Streaming', () => {
  let router: ChannelRouter;

  beforeEach(() => {
    router = new ChannelRouter();
    registerAdapterFactory('webhook', () => new MockAdapter());
  });

  it('startStream sends initial message and returns streamId', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const streamId = await router.startStream('ch-1', 'chat-1');
    expect(streamId).toContain('ch-1');
    expect(streamId).toContain('chat-1');

    const adapter = router.getAdapter('ch-1') as MockAdapter;
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].message.text).toBe('▍');
  });

  it('startStream with initial text', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    await router.startStream('ch-1', 'chat-1', 'Starting...');

    const adapter = router.getAdapter('ch-1') as MockAdapter;
    expect(adapter.sentMessages[0].message.text).toBe('Starting...');
  });

  it('endStream edits with final text', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const streamId = await router.startStream('ch-1', 'chat-1');
    await router.endStream(streamId, 'Final answer here.');

    const adapter = router.getAdapter('ch-1') as MockAdapter;
    expect(adapter.editedMessages).toHaveLength(1);
    expect(adapter.editedMessages[0].text).toBe('Final answer here.');
  });

  it('endStream is safe for non-existent stream', async () => {
    await router.endStream('nonexistent'); // should not throw
  });

  it('feedStream flushes on punctuation', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const streamId = await router.startStream('ch-1', 'chat-1');
    router.feedStream(streamId, 'Hello world.');

    // Give async edit time to fire
    await new Promise(r => setTimeout(r, 50));

    const adapter = router.getAdapter('ch-1') as MockAdapter;
    // Should have been flushed due to period
    expect(adapter.editedMessages.length).toBeGreaterThanOrEqual(1);

    await router.endStream(streamId);
  });

  it('feedStream flushes on 500ms even without punctuation', async () => {
    await router.startChannel({
      id: 'ch-1', name: 'Test', type: 'webhook', enabled: true, agentId: 'a1', config: {},
    });

    const streamId = await router.startStream('ch-1', 'chat-1');
    router.feedStream(streamId, 'no punctuation here');

    // Wait for debounce
    await new Promise(r => setTimeout(r, 600));

    const adapter = router.getAdapter('ch-1') as MockAdapter;
    expect(adapter.editedMessages.length).toBeGreaterThanOrEqual(1);

    await router.endStream(streamId);
  });
});
