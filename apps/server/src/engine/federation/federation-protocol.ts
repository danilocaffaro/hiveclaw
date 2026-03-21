/**
 * Federation Protocol — Message types for HiveClaw↔HiveClaw WebSocket communication.
 *
 * Protocol flow:
 *   Guest connects → hello → welcome → agent.manifest (both) → ready
 *   Host invokes → agent.invoke → agent.delta* → agent.finish
 *   Either side → message.sync, squad.event, ping/pong
 */

// ── Feature Flag ─────────────────────────────────────────────────────────────

export const FEDERATION_ENABLED = process.env.ENABLE_FEDERATION === 'true';

// ── Constants ────────────────────────────────────────────────────────────────

export const FEDERATION_PROTOCOL_VERSION = '1.0.0';
export const FEDERATION_WS_PATH = '/federation/ws';
export const FEDERATION_PING_INTERVAL_MS = 30_000;
export const FEDERATION_MAX_MISSED_PONGS = 3;
export const FEDERATION_MAX_RECONNECT_BACKOFF_MS = 60_000; // Clark suggestion: 60s cap
export const FEDERATION_RATE_LIMIT_PER_MIN = 100;          // Clark suggestion: concrete rate limit
export const FEDERATION_INVOKE_TIMEOUT_MS = Number(process.env.FEDERATION_INVOKE_TIMEOUT_MS) || 120_000; // Clark suggestion: configurable

// ── Agent Manifest ───────────────────────────────────────────────────────────

export interface AgentManifestEntry {
  id: string;
  name: string;
  emoji: string;
  role: string;
  model: string;
  capabilities: string[];   // ['text', 'vision', 'tools']
}

// ── Message Types ────────────────────────────────────────────────────────────

/** Guest → Host: initial handshake */
export interface FederationHello {
  type: 'federation.hello';
  protocolVersion: string;
  instanceId: string;
  instanceName: string;
  token: string;               // connection token for auth
  agents: AgentManifestEntry[]; // guest's contributed agents
}

/** Host → Guest: handshake response */
export interface FederationWelcome {
  type: 'federation.welcome';
  protocolVersion: string;
  instanceId: string;
  instanceName: string;
  linkId: string;
  agents: AgentManifestEntry[]; // host's contributed agents
}

/** Either → Either: share/update agent manifest */
export interface AgentManifest {
  type: 'agent.manifest';
  agents: AgentManifestEntry[];
}

/** Either → Either: sync a user or agent message */
export interface MessageSync {
  type: 'message.sync';
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  origin: 'host' | 'guest';
  timestamp: string;
}

/** Host → Guest: invoke a remote agent */
export interface AgentInvoke {
  type: 'agent.invoke';
  requestId: string;
  agentId: string;             // remote agent's real ID (not shadow ID)
  messages: Array<{ role: string; content: string }>;
  context?: {
    squadId?: string;
    previousResponses?: string[];  // for ECHO-FREE
  };
}

/** Guest → Host: streaming text delta from invoked agent */
export interface AgentDelta {
  type: 'agent.delta';
  requestId: string;
  agentId: string;
  text: string;                // incremental text chunk
}

/** Guest → Host: agent invocation completed */
export interface AgentFinish {
  type: 'agent.finish';
  requestId: string;
  agentId: string;
  fullText: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;              // set if agent errored
}

/** Either → Either: squad membership changed */
export interface SquadEvent {
  type: 'squad.event';
  event: 'agent_added' | 'agent_removed' | 'routing_changed' | 'squad_deleted';
  squadId: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

/** Either → Either: heartbeat */
export interface FederationPing {
  type: 'federation.ping';
  timestamp: string;
}

export interface FederationPong {
  type: 'federation.pong';
  timestamp: string;
}

/** Either → Either: error notification */
export interface FederationError {
  type: 'federation.error';
  code: string;
  message: string;
  requestId?: string;
}

// ── Union Type ───────────────────────────────────────────────────────────────

export type FederationMessage =
  | FederationHello
  | FederationWelcome
  | AgentManifest
  | MessageSync
  | AgentInvoke
  | AgentDelta
  | AgentFinish
  | SquadEvent
  | FederationPing
  | FederationPong
  | FederationError;

// ── Valid message types ──────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>([
  'federation.hello',
  'federation.welcome',
  'agent.manifest',
  'message.sync',
  'agent.invoke',
  'agent.delta',
  'agent.finish',
  'squad.event',
  'federation.ping',
  'federation.pong',
  'federation.error',
]);

// ── Validation ───────────────────────────────────────────────────────────────

/** Parse and validate a federation message from raw data. Returns null if invalid. */
export function validateMessage(data: unknown): FederationMessage | null {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== 'object') return null;

  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== 'string') return null;
  if (!VALID_TYPES.has(msg.type)) return null;

  return msg as unknown as FederationMessage;
}

/** Serialize a federation message to JSON string. */
export function serializeMessage(msg: FederationMessage): string {
  return JSON.stringify(msg);
}
