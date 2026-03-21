/**
 * Federation Manager — orchestrates WebSocket connections between HiveClaw instances.
 *
 * Host side: accepts incoming WS connections, validates tokens, manages links.
 * Guest side: connects to host, handles agent invocations.
 * Both sides: heartbeat, reconnect, message sync.
 */
import { WebSocket, type RawData } from 'ws';
import { randomBytes } from 'node:crypto';
import { FederationRepository } from '../../db/federation.js';
import { AgentRepository } from '../../db/agents.js';
import { getDb } from '../../db/schema.js';
import { runAgentV2 } from '../agent-runner-v2.js';
import { runAgent } from '../agent-runner.js';
import type { AgentConfig } from '../agent-runner.js';
import { getSessionManager } from '../session-manager.js';
import { getProviderRouter } from '../providers/index.js';
import {
  type FederationMessage,
  type FederationHello,
  type FederationWelcome,
  type AgentManifestEntry,
  type AgentInvoke,
  type AgentDelta,
  type AgentFinish,
  type FederationError,
  type MessageSync,
  type SquadEvent,
  validateMessage,
  serializeMessage,
  FEDERATION_ENABLED,
  FEDERATION_PROTOCOL_VERSION,
  FEDERATION_PING_INTERVAL_MS,
  FEDERATION_MAX_MISSED_PONGS,
  FEDERATION_MAX_RECONNECT_BACKOFF_MS,
  FEDERATION_RATE_LIMIT_PER_MIN,
  FEDERATION_INVOKE_TIMEOUT_MS,
} from './federation-protocol.js';
import { pino } from 'pino';

const logger = pino({ name: 'federation' });

// ── Types ────────────────────────────────────────────────────────────────────

interface ActiveLink {
  linkId: string;
  ws: WebSocket;
  direction: 'host' | 'guest';
  peerInstanceId: string;
  peerInstanceName: string;
  missedPongs: number;
  pingTimer?: ReturnType<typeof setInterval>;
  rateLimitCounter: number;
  rateLimitResetAt: number;
}

interface PendingInvocation {
  requestId: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  chunks: string[];
  timer: ReturnType<typeof setTimeout>;
  onDelta?: (delta: string) => void;
}

// ── Federation Manager ───────────────────────────────────────────────────────

export class FederationManager {
  private links = new Map<string, ActiveLink>();           // linkId → active link
  private pendingInvocations = new Map<string, PendingInvocation>(); // requestId → pending
  private repo: FederationRepository;
  private instanceId: string;
  private instanceName: string;
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(instanceName?: string) {
    this.repo = new FederationRepository(getDb());
    this.instanceId = this.getOrCreateInstanceId();
    this.instanceName = instanceName ?? process.env.HIVECLAW_INSTANCE_NAME ?? 'HiveClaw';
  }

  private getOrCreateInstanceId(): string {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'instance_id'").get() as { value: string } | undefined;
    if (row) return row.value;
    const id = randomBytes(16).toString('hex');
    try {
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('instance_id', ?)").run(id);
    } catch {
      // settings table might not exist — use in-memory only
    }
    return id;
  }

  get enabled(): boolean {
    return FEDERATION_ENABLED;
  }

  getRepository(): FederationRepository {
    return this.repo;
  }

  // ── Host: Handle incoming WS connection ──────────────────────────────────

  handleConnection(ws: WebSocket): void {
    if (!this.enabled) {
      ws.close(4003, 'Federation not enabled');
      return;
    }

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('message', (raw: RawData) => {
      const msg = validateMessage(raw.toString());
      if (!msg) {
        this.sendError(ws, 'INVALID_MESSAGE', 'Invalid message format');
        return;
      }

      if (!authenticated) {
        if (msg.type !== 'federation.hello') {
          ws.close(4001, 'Expected federation.hello');
          return;
        }
        clearTimeout(authTimeout);
        this.handleHello(ws, msg as FederationHello).then(linkId => {
          if (linkId) {
            authenticated = true;
            this.setupMessageHandler(linkId, ws);
          }
        }).catch(err => {
          logger.error(err, 'Error handling hello');
          ws.close(4002, 'Handshake failed');
        });
        return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
    });
  }

  private async handleHello(ws: WebSocket, hello: FederationHello): Promise<string | null> {
    // Validate token — find the pairing
    const pairing = this.repo.getPairing(hello.token);
    if (!pairing) {
      ws.close(4001, 'Invalid or expired token');
      return null;
    }

    // Version check
    if (hello.protocolVersion !== FEDERATION_PROTOCOL_VERSION) {
      this.sendError(ws, 'VERSION_MISMATCH',
        `Expected protocol ${FEDERATION_PROTOCOL_VERSION}, got ${hello.protocolVersion}`);
      ws.close(4005, 'Protocol version mismatch');
      return null;
    }

    // Create link
    const link = this.repo.createLink({
      peerInstanceId: hello.instanceId,
      peerInstanceName: hello.instanceName,
      direction: 'host',
      sharedSquadId: pairing.squadId,
      connectionTokenHash: pairing.tokenHash,
    });

    // Consume pairing token
    this.repo.consumePairing(hello.token, link.id);

    // Create shadow agents from guest's manifest
    for (const agent of hello.agents) {
      this.repo.createShadowAgent({
        linkId: link.id,
        remoteAgentId: agent.id,
        name: agent.name,
        emoji: agent.emoji,
        role: agent.role,
        model: agent.model,
      });
    }

    // Activate link
    this.repo.updateLinkStatus(link.id, 'active');

    // Get host's contributed agents
    const hostAgents = this.getContributedAgents(pairing.contributedAgentIds);

    // Send welcome
    const welcome: FederationWelcome = {
      type: 'federation.welcome',
      protocolVersion: FEDERATION_PROTOCOL_VERSION,
      instanceId: this.instanceId,
      instanceName: this.instanceName,
      linkId: link.id,
      agents: hostAgents,
    };
    ws.send(serializeMessage(welcome));

    // Register active link
    this.registerActiveLink(link.id, ws, 'host', hello.instanceId, hello.instanceName);

    logger.info('Federation link established: %s (host) ← %s', link.id, hello.instanceName);
    return link.id;
  }

  // ── Guest: Connect to host ───────────────────────────────────────────────

  async connectToHost(peerUrl: string, token: string, localAgents: AgentManifestEntry[]): Promise<string> {
    if (!this.enabled) throw new Error('Federation not enabled');

    return new Promise((resolve, reject) => {
      const wsUrl = peerUrl.replace(/^http/, 'ws') + '/federation/ws';
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 15_000);

      ws.on('open', () => {
        const hello: FederationHello = {
          type: 'federation.hello',
          protocolVersion: FEDERATION_PROTOCOL_VERSION,
          instanceId: this.instanceId,
          instanceName: this.instanceName,
          token,
          agents: localAgents,
        };
        ws.send(serializeMessage(hello));
      });

      ws.on('message', (raw: RawData) => {
        const msg = validateMessage(raw.toString());
        if (!msg) return;

        if (msg.type === 'federation.welcome') {
          clearTimeout(timeout);
          const welcome = msg as FederationWelcome;

          // Create link on guest side
          const link = this.repo.createLink({
            peerInstanceId: welcome.instanceId,
            peerInstanceName: welcome.instanceName,
            peerUrl,
            direction: 'guest',
            sharedSquadId: '', // guest doesn't own the squad
            connectionTokenHash: '',
          });

          // Create shadow agents from host's manifest
          for (const agent of welcome.agents) {
            this.repo.createShadowAgent({
              linkId: link.id,
              remoteAgentId: agent.id,
              name: agent.name,
              emoji: agent.emoji,
              role: agent.role,
              model: agent.model,
            });
          }

          this.repo.updateLinkStatus(link.id, 'active');
          this.registerActiveLink(link.id, ws, 'guest', welcome.instanceId, welcome.instanceName);
          this.setupMessageHandler(link.id, ws);

          logger.info('Federation link established: %s (guest) → %s', link.id, welcome.instanceName);
          resolve(link.id);
        }

        if (msg.type === 'federation.error') {
          clearTimeout(timeout);
          const err = msg as FederationError;
          reject(new Error(`Federation error: ${err.code} — ${err.message}`));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        reject(new Error(`Connection closed: ${code} ${reason.toString()}`));
      });
    });
  }

  // ── Message Handling ─────────────────────────────────────────────────────

  private setupMessageHandler(linkId: string, ws: WebSocket): void {
    ws.on('message', (raw: RawData) => {
      const msg = validateMessage(raw.toString());
      if (!msg) return;

      const link = this.links.get(linkId);
      if (!link) return;

      // Rate limiting
      if (!this.checkRateLimit(link)) {
        this.sendError(ws, 'RATE_LIMITED', 'Too many messages');
        return;
      }

      this.routeMessage(linkId, msg);
    });

    ws.on('close', () => {
      this.handleDisconnect(linkId);
    });

    ws.on('error', (err) => {
      logger.error(err, 'WS error on link %s', linkId);
      this.handleDisconnect(linkId);
    });
  }

  private routeMessage(linkId: string, msg: FederationMessage): void {
    switch (msg.type) {
      case 'federation.ping':
        this.handlePing(linkId);
        break;
      case 'federation.pong':
        this.handlePong(linkId);
        break;
      case 'agent.manifest':
        this.handleManifest(linkId, msg.agents);
        break;
      case 'message.sync':
        this.handleMessageSync(linkId, msg);
        break;
      case 'agent.invoke':
        this.handleInvoke(linkId, msg as AgentInvoke);
        break;
      case 'agent.delta':
        this.handleDelta(msg as AgentDelta);
        break;
      case 'agent.finish':
        this.handleFinish(msg as AgentFinish);
        break;
      case 'squad.event':
        this.handleSquadEvent(linkId, msg);
        break;
      default:
        logger.warn('Unknown federation message type: %s', (msg as { type: string }).type);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  private handlePing(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return;
    link.ws.send(serializeMessage({ type: 'federation.pong', timestamp: new Date().toISOString() }));
    this.repo.touchLink(linkId);
  }

  private handlePong(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return;
    link.missedPongs = 0;
    this.repo.touchLink(linkId);
  }

  private handleManifest(linkId: string, agents: AgentManifestEntry[]): void {
    // Remove existing shadows for this link, recreate
    this.repo.removeShadowAgents(linkId);
    const link = this.repo.getLink(linkId);
    if (!link) return;

    for (const agent of agents) {
      this.repo.createShadowAgent({
        linkId,
        remoteAgentId: agent.id,
        name: agent.name,
        emoji: agent.emoji,
        role: agent.role,
        model: agent.model,
      });
    }
    logger.info('Updated shadow agents for link %s: %d agents', linkId, agents.length);
  }

  private handleMessageSync(linkId: string, msg: FederationMessage): void {
    const sync = msg as MessageSync;
    const sm = getSessionManager();

    // Persist the synced message into the local session
    try {
      sm.addMessage(sync.sessionId, {
        role: sync.role,
        content: sync.content,
        agent_id: sync.agentId,
        agent_name: sync.agentName,
        agent_emoji: sync.agentEmoji,
        sender_type: sync.origin === 'guest' ? 'external_agent' : 'agent',
      });
      logger.info('Message synced from link %s: session=%s role=%s', linkId, sync.sessionId, sync.role);
    } catch (err) {
      logger.error(err, 'Failed to persist synced message on link %s', linkId);
    }
  }

  private handleInvoke(linkId: string, invoke: AgentInvoke): void {
    const link = this.links.get(linkId);
    if (!link) return;

    logger.info('Agent invoke received on link %s for agent %s (req %s)', linkId, invoke.agentId, invoke.requestId);

    // Run asynchronously — don't block the message handler
    this.executeLocalAgent(link, invoke).catch(err => {
      logger.error(err, 'Failed to execute local agent for invoke %s', invoke.requestId);
      const finish: AgentFinish = {
        type: 'agent.finish',
        requestId: invoke.requestId,
        agentId: invoke.agentId,
        fullText: '',
        error: (err as Error).message,
      };
      if (link.ws.readyState === WebSocket.OPEN) {
        link.ws.send(serializeMessage(finish));
      }
    });
  }

  /**
   * Execute a local agent on behalf of a remote host.
   * Streams agent.delta events back through the federation WS,
   * finishes with agent.finish containing the full response text.
   */
  private async executeLocalAgent(link: ActiveLink, invoke: AgentInvoke): Promise<void> {
    const db = getDb();
    const agentRepo = new AgentRepository(db);

    // Find the local agent by ID
    const agentRow = agentRepo.getById(invoke.agentId);
    if (!agentRow) {
      const finish: AgentFinish = {
        type: 'agent.finish',
        requestId: invoke.requestId,
        agentId: invoke.agentId,
        fullText: '',
        error: `Agent ${invoke.agentId} not found on this instance`,
      };
      link.ws.send(serializeMessage(finish));
      return;
    }

    // Build agent config
    const router = getProviderRouter();
    const defaultProvider = router.getDefault();
    const resolvedProvider = (agentRow.providerPreference as string) || defaultProvider?.id || 'unknown';
    const agentConfig: AgentConfig = {
      id: agentRow.id,
      name: agentRow.name,
      emoji: agentRow.emoji ?? '🤖',
      systemPrompt: agentRow.systemPrompt ?? 'You are a helpful AI assistant.',
      providerId: resolvedProvider,
      modelId: (agentRow.modelPreference as string) || 'default',
      temperature: (agentRow.temperature as number) ?? 0.7,
      maxTokens: 4096,
      engineVersion: agentRow.engineVersion ?? 2,
    };

    // Inject previous responses context if provided
    let systemPrompt = agentConfig.systemPrompt;
    if (invoke.context?.previousResponses?.length) {
      systemPrompt += '\n\n## Previous Agent Responses (ECHO-FREE: do not repeat)\n'
        + invoke.context.previousResponses.join('\n');
    }

    // Create a temporary federation session
    const sm = getSessionManager();
    const sessionId = `fed-invoke-${invoke.requestId}`;

    // Seed the session with the conversation messages
    for (const msg of invoke.messages) {
      sm.addMessage(sessionId, {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Select runner based on engine version
    const runner = agentConfig.engineVersion === 2 ? runAgentV2 : runAgent;
    const userMessage = invoke.messages[invoke.messages.length - 1]?.content ?? '';

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of runner(sessionId, userMessage, { ...agentConfig, systemPrompt }, { skipPersistUserMessage: true })) {
        if (event.event === 'message.delta') {
          const data = event.data as Record<string, unknown>;
          const text = typeof data.text === 'string' ? data.text : '';
          if (text && !(data.isHeader as boolean)) {
            fullText += text;

            // Stream delta back to host
            if (link.ws.readyState === WebSocket.OPEN) {
              const delta: AgentDelta = {
                type: 'agent.delta',
                requestId: invoke.requestId,
                agentId: invoke.agentId,
                text,
              };
              link.ws.send(serializeMessage(delta));
            }
          }
        }

        if (event.event === 'message.finish') {
          const data = event.data as Record<string, unknown>;
          inputTokens = (data.inputTokens as number) ?? 0;
          outputTokens = (data.outputTokens as number) ?? 0;
        }
      }
    } catch (err) {
      logger.error(err, 'Agent execution failed for invoke %s', invoke.requestId);
      fullText = '';
    }

    // Send finish
    const finish: AgentFinish = {
      type: 'agent.finish',
      requestId: invoke.requestId,
      agentId: invoke.agentId,
      fullText,
      usage: { inputTokens, outputTokens },
      error: fullText ? undefined : 'Agent produced no output',
    };

    if (link.ws.readyState === WebSocket.OPEN) {
      link.ws.send(serializeMessage(finish));
    }

    // Cleanup temp session (don't persist federation invoke sessions)
    try {
      sm.deleteSession(sessionId);
    } catch {
      // Session might not need cleanup
    }

    logger.info('Agent invoke %s completed: %d chars, %d in/%d out tokens',
      invoke.requestId, fullText.length, inputTokens, outputTokens);
  }

  private handleDelta(delta: AgentDelta): void {
    const pending = this.pendingInvocations.get(delta.requestId);
    if (!pending) return;
    pending.chunks.push(delta.text);
    pending.onDelta?.(delta.text);
  }

  private handleFinish(finish: AgentFinish): void {
    const pending = this.pendingInvocations.get(finish.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingInvocations.delete(finish.requestId);

    if (finish.error) {
      pending.reject(new Error(finish.error));
    } else {
      pending.resolve(finish.fullText);
    }
  }

  private handleSquadEvent(linkId: string, msg: FederationMessage): void {
    const event = msg as SquadEvent;
    logger.info('Squad event on link %s: %s squad=%s agent=%s',
      linkId, event.event, event.squadId, event.agentId ?? 'n/a');

    switch (event.event) {
      case 'agent_added':
        // Peer added a new agent — update shadow agents via manifest refresh
        logger.info('Peer added agent %s — will be synced on next manifest exchange', event.agentId);
        break;
      case 'agent_removed':
        // Peer removed an agent — remove corresponding shadow
        if (event.agentId) {
          const shadows = this.repo.getShadowAgents(linkId);
          const shadow = shadows.find(s => s.remoteAgentId === event.agentId);
          if (shadow) {
            const db = getDb();
            db.prepare('DELETE FROM agents WHERE id = ?').run(shadow.id);
            logger.info('Removed shadow agent %s (remote %s) from link %s', shadow.id, event.agentId, linkId);
          }
        }
        break;
      case 'squad_deleted':
        // Peer deleted the squad — revoke the link
        logger.warn('Peer deleted squad %s — revoking link %s', event.squadId, linkId);
        this.repo.revokeLink(linkId);
        const link = this.links.get(linkId);
        if (link) link.ws.close(4010, 'Squad deleted by peer');
        break;
      default:
        logger.info('Unhandled squad event: %s', event.event);
    }
  }

  // ── Agent Invocation (Host → Guest) ──────────────────────────────────────

  /** Invoke a remote agent via federation. Returns the full response text. */
  invokeRemoteAgent(
    linkId: string,
    agentId: string,
    messages: Array<{ role: string; content: string }>,
    context?: { squadId?: string; previousResponses?: string[] },
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const link = this.links.get(linkId);
    if (!link) return Promise.reject(new Error('Link not active'));

    const requestId = randomBytes(8).toString('hex');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvocations.delete(requestId);
        reject(new Error(`Agent invocation timed out after ${FEDERATION_INVOKE_TIMEOUT_MS}ms`));
      }, FEDERATION_INVOKE_TIMEOUT_MS);

      this.pendingInvocations.set(requestId, {
        requestId,
        resolve,
        reject,
        chunks: [],
        timer,
        onDelta,
      });

      const invoke: AgentInvoke = {
        type: 'agent.invoke',
        requestId,
        agentId,
        messages,
        context,
      };
      link.ws.send(serializeMessage(invoke));
    });
  }

  // ── Message Sync ─────────────────────────────────────────────────────────

  /** Send a message.sync to the peer. */
  syncMessage(linkId: string, msg: {
    messageId: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    agentId?: string;
    agentName?: string;
    agentEmoji?: string;
    origin: 'host' | 'guest';
  }): void {
    const link = this.links.get(linkId);
    if (!link) return;

    link.ws.send(serializeMessage({
      type: 'message.sync',
      ...msg,
      timestamp: new Date().toISOString(),
    }));
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private startHeartbeat(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return;

    link.pingTimer = setInterval(() => {
      if (link.ws.readyState !== WebSocket.OPEN) {
        this.handleDisconnect(linkId);
        return;
      }

      link.missedPongs++;
      if (link.missedPongs >= FEDERATION_MAX_MISSED_PONGS) {
        logger.warn('Link %s: %d missed pongs, marking disconnected', linkId, link.missedPongs);
        this.handleDisconnect(linkId);
        return;
      }

      link.ws.send(serializeMessage({ type: 'federation.ping', timestamp: new Date().toISOString() }));
    }, FEDERATION_PING_INTERVAL_MS);
  }

  // ── Disconnect & Reconnect ───────────────────────────────────────────────

  private handleDisconnect(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return;

    if (link.pingTimer) clearInterval(link.pingTimer);
    this.links.delete(linkId);
    this.repo.updateLinkStatus(linkId, 'disconnected');

    // Cancel pending invocations for this link
    for (const [reqId, pending] of this.pendingInvocations) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Federation link disconnected'));
      this.pendingInvocations.delete(reqId);
    }

    logger.info('Link %s disconnected', linkId);

    // Auto-reconnect for guest links
    const dbLink = this.repo.getLink(linkId);
    if (dbLink?.direction === 'guest' && dbLink.status !== 'revoked' && dbLink.peerUrl) {
      this.scheduleReconnect(linkId, dbLink.peerUrl);
    }
  }

  private scheduleReconnect(linkId: string, peerUrl: string, attempt = 0): void {
    if (this.reconnectTimers.has(linkId)) return;

    const delay = Math.min(5000 * Math.pow(2, attempt), FEDERATION_MAX_RECONNECT_BACKOFF_MS);
    logger.info('Scheduling reconnect for link %s in %dms (attempt %d)', linkId, delay, attempt + 1);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(linkId);
      try {
        // TODO: need stored token for reconnection — for now log warning
        logger.warn('Reconnect not yet implemented — needs stored connection token');
      } catch (err) {
        logger.error(err, 'Reconnect failed for link %s', linkId);
        this.scheduleReconnect(linkId, peerUrl, attempt + 1);
      }
    }, delay);

    this.reconnectTimers.set(linkId, timer);
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  private registerActiveLink(
    linkId: string, ws: WebSocket, direction: 'host' | 'guest',
    peerInstanceId: string, peerInstanceName: string,
  ): void {
    this.links.set(linkId, {
      linkId, ws, direction, peerInstanceId, peerInstanceName,
      missedPongs: 0,
      rateLimitCounter: 0,
      rateLimitResetAt: Date.now() + 60_000,
    });
    this.startHeartbeat(linkId);
  }

  private checkRateLimit(link: ActiveLink): boolean {
    const now = Date.now();
    if (now > link.rateLimitResetAt) {
      link.rateLimitCounter = 0;
      link.rateLimitResetAt = now + 60_000;
    }
    link.rateLimitCounter++;
    return link.rateLimitCounter <= FEDERATION_RATE_LIMIT_PER_MIN;
  }

  private sendError(ws: WebSocket, code: string, message: string, requestId?: string): void {
    const err: FederationError = { type: 'federation.error', code, message, requestId };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeMessage(err));
    }
  }

  private getContributedAgents(agentIds: string[]): AgentManifestEntry[] {
    const db = getDb();
    const agents: AgentManifestEntry[] = [];
    for (const id of agentIds) {
      const row = db.prepare('SELECT id, name, emoji, role, model_preference FROM agents WHERE id = ?').get(id) as {
        id: string; name: string; emoji: string; role: string; model_preference: string;
      } | undefined;
      if (row) {
        agents.push({
          id: row.id,
          name: row.name,
          emoji: row.emoji || '🤖',
          role: row.role || 'assistant',
          model: row.model_preference || 'unknown',
          capabilities: ['text', 'tools'],
        });
      }
    }
    return agents;
  }

  // ── Status ───────────────────────────────────────────────────────────────

  /** Get active link count. */
  getActiveLinkCount(): number {
    return this.links.size;
  }

  /** Check if a specific link is currently connected. */
  isLinkActive(linkId: string): boolean {
    return this.links.has(linkId);
  }

  /** Get link status summary. */
  getLinkStatus(linkId: string): { connected: boolean; lastSeen: string | null; missedPongs: number } | null {
    const active = this.links.get(linkId);
    const dbLink = this.repo.getLink(linkId);
    if (!dbLink) return null;

    return {
      connected: !!active && active.ws.readyState === WebSocket.OPEN,
      lastSeen: dbLink.lastSeenAt,
      missedPongs: active?.missedPongs ?? -1,
    };
  }

  /** Shutdown — close all connections. */
  shutdown(): void {
    for (const [linkId, link] of this.links) {
      if (link.pingTimer) clearInterval(link.pingTimer);
      link.ws.close(1001, 'Server shutting down');
      this.links.delete(linkId);
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.pendingInvocations.clear();
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: FederationManager | null = null;

export function getFederationManager(): FederationManager {
  if (!_instance) {
    _instance = new FederationManager();
  }
  return _instance;
}
