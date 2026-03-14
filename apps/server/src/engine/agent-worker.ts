// ============================================================
// Agent Worker — Individual agent actor with state machine, inbox, and outbox
// ============================================================

import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import type { AgentConfig, SSEEvent } from './agent-runner.js';
import { runAgent } from './agent-runner.js';
import { getMessageBus, type AgentMessage } from './message-bus.js';

// ─── Agent State ──────────────────────────────────────────────────────────────

export type AgentState = 'idle' | 'thinking' | 'tool_use' | 'responding' | 'waiting' | 'error' | 'offline';

// ─── Worker Config ────────────────────────────────────────────────────────────

export interface AgentWorkerConfig extends AgentConfig {
  autoStart?: boolean;
}

// ─── Agent Worker ─────────────────────────────────────────────────────────────

export class AgentWorker extends EventEmitter {
  readonly agentId: string;
  readonly config: AgentWorkerConfig;
  /** Most recent session id — restored on startup for session persistence */
  currentSessionId: string | null = null;
  private _state: AgentState = 'idle';
  private inbox: AgentMessage[] = [];
  private processing = false;
  private unsubscribe: (() => void) | null = null;
  private _lastActivity: number = Date.now();
  private _totalMessages = 0;
  private _totalTokens = 0;

  constructor(config: AgentWorkerConfig) {
    super();
    this.agentId = config.id;
    this.config = config;
    if (config.autoStart !== false) {
      this.start();
    }
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get state(): AgentState {
    return this._state;
  }

  get lastActivity(): number {
    return this._lastActivity;
  }

  get stats(): { messages: number; tokens: number } {
    return { messages: this._totalMessages, tokens: this._totalTokens };
  }

  // ─── State Machine ────────────────────────────────────────────────────────

  private setState(s: AgentState): void {
    const prev = this._state;
    this._state = s;
    this._lastActivity = Date.now();
    this.emit('stateChange', { agentId: this.agentId, from: prev, to: s });

    // Publish status to bus
    const bus = getMessageBus();
    bus.publish({
      from: this.agentId,
      to: 'system.events',
      type: 'status',
      content: JSON.stringify({ state: s, prev }),
      metadata: { sessionId: '', priority: 0, timestamp: Date.now() },
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    const bus = getMessageBus();
    this.unsubscribe = bus.subscribe(`agent.${this.agentId}.inbox`, (msg) => {
      this.inbox.push(msg);
      void this.processQueue();
    });
    this.setState('idle');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setState('offline');
    this.inbox = [];
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  /**
   * Send a message to another agent or topic via the message bus.
   */
  send(
    to: string,
    content: string,
    type: AgentMessage['type'] = 'request',
    sessionId = '',
    replyTo?: string,
  ): AgentMessage {
    const bus = getMessageBus();
    return bus.publish({
      from: this.agentId,
      to,
      type,
      content,
      metadata: { sessionId, replyTo, priority: 1, timestamp: Date.now() },
    });
  }

  // ─── Process User Message ─────────────────────────────────────────────────

  /**
   * Process a user message through the agent's LLM loop.
   * Yields SSE events as the agent thinks, uses tools, and responds.
   */
  async *processUserMessage(sessionId: string, content: string, opts?: { skipPersistUserMessage?: boolean }): AsyncGenerator<SSEEvent> {
    this.setState('thinking');
    this._totalMessages++;
    try {
      for await (const event of runAgent(sessionId, content, this.config, opts)) {
        if (event.event === 'tool.start') this.setState('tool_use');
        if (event.event === 'message.delta') this.setState('responding');
        if (event.event === 'message.finish') {
          const data = event.data as Record<string, unknown>;
          this._totalTokens +=
            ((data?.tokens_in as number) ?? 0) +
            ((data?.tokens_out as number) ?? 0);
        }
        yield event;
      }
    } catch (err) {
      this.setState('error');
      yield { event: 'error', data: { error: (err as Error).message } };
    } finally {
      this.setState('idle');
    }
  }

  // ─── Internal Queue Processing ────────────────────────────────────────────

  /**
   * Process queued bus messages sequentially.
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.inbox.length === 0) return;
    this.processing = true;

    while (this.inbox.length > 0) {
      const msg = this.inbox.shift()!;
      this.setState('thinking');
      this._totalMessages++;

      try {
        // For bus messages, run the agent with the message content.
        // The agent can respond via the bus.
        const chunks: string[] = [];
        for await (const event of runAgent(
          msg.metadata.sessionId || `bus-${uuid()}`,
          `[Message from ${msg.from}]: ${msg.content}`,
          this.config,
        )) {
          if (event.event === 'message.delta') {
            const delta = event.data as { text?: string };
            if (delta.text) chunks.push(delta.text);
          }
        }

        // Send response back via bus
        if (chunks.length > 0 && msg.type === 'request') {
          this.send(msg.from, chunks.join(''), 'response', msg.metadata.sessionId, msg.id);
        }
      } catch (err) {
        this.setState('error');
        this.emit('error', err);
      }
      this.setState('idle');
    }

    this.processing = false;
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  toJSON(): {
    agentId: string;
    name: string;
    emoji: string | undefined;
    state: AgentState;
    lastActivity: number;
    stats: { messages: number; tokens: number };
  } {
    return {
      agentId: this.agentId,
      name: this.config.name,
      emoji: this.config.emoji,
      state: this._state,
      lastActivity: this._lastActivity,
      stats: this.stats,
    };
  }
}
