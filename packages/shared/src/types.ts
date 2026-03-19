// ============================================================
// HiveClaw Shared Types
// ============================================================

// --- Agent ---
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  type: 'super' | 'specialist';
  systemPrompt: string;
  skills: string[];
  modelPreference: string;
  providerPreference: string;
  fallbackProviders: string[];
  temperature: number;
  maxTokens: number;
  status: 'active' | 'idle' | 'busy' | 'error' | 'offline';
  color: string;
  apiToken?: string;
  engineVersion?: 1 | 2;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreateInput {
  name: string;
  emoji?: string;
  role: string;
  type?: 'super' | 'specialist';
  systemPrompt: string;
  skills?: string[];
  modelPreference?: string;
  maxTokens?: number;
  providerPreference?: string;
  fallbackProviders?: string[];
  temperature?: number;
  color?: string;
}

// --- Squad ---
export interface Squad {
  id: string;
  name: string;
  emoji: string;
  description: string;
  agentIds: string[];
  sprintConfig: Record<string, unknown>;
  routingStrategy: 'auto' | 'round-robin' | 'manual';
  debateEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SquadCreateInput {
  name: string;
  emoji?: string;
  description?: string;
  agentIds: string[];
  routingStrategy?: 'auto' | 'round-robin' | 'manual' | 'sequential' | 'specialist' | 'debate';
  debateEnabled?: boolean;
}

// --- Session ---
export interface Session {
  id: string;
  title: string;
  agentId?: string;
  squadId?: string;
  mode: 'dm' | 'squad';
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

// --- Message ---
export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  agentId?: string;
  content: MessageContent[];
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  createdAt: string;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool'; toolName: string; toolInput: string; toolOutput?: string; status?: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'image'; url: string; alt?: string };

// --- Sprint ---
export interface Sprint {
  id: string;
  squadId: string;
  sessionId: string;
  name: string;
  status: 'planning' | 'active' | 'review' | 'done';
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface SprintTask {
  id: string;
  sprintId: string;
  title: string;
  description: string;
  assignedAgentId?: string;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// --- Debate ---
export interface Debate {
  id: string;
  sessionId: string;
  squadId?: string;
  topic: string;
  status: 'active' | 'resolved' | 'escalated';
  resolution: string;
  rounds: number;
  maxRounds: number;
  entries: DebateEntry[];
  createdAt: string;
}

export interface DebateEntry {
  id: string;
  debateId: string;
  agentId: string;
  round: number;
  position: 'propose' | 'counter' | 'argue' | 'concede';
  content: string;
  createdAt: string;
}

// --- SSE Events ---
export type SSEEvent =
  | { type: 'message.start'; sessionId: string; agentId?: string }
  | { type: 'message.delta'; text: string; agentId?: string }
  | { type: 'message.finish'; tokensInput: number; tokensOutput: number; cost: number }
  | { type: 'tool.start'; name: string; input: string; agentId?: string }
  | { type: 'tool.finish'; name: string; output: string }
  | { type: 'debate.start'; debateId: string; topic: string }
  | { type: 'debate.entry'; debateId: string; entry: DebateEntry }
  | { type: 'debate.resolve'; debateId: string; resolution: string }
  | { type: 'sprint.update'; sprintId: string; sprint: Sprint }
  | { type: 'task.update'; taskId: string; task: SprintTask }
  | { type: 'session.updated'; session: Session }
  | { type: 'error'; message: string }
  | { type: 'heartbeat' };

// --- Config ---
export interface HiveClawConfig {
  server: {
    port: number;
    host: string;
  };
  openclaw: {
    wsUrl: string;
    configPath: string;
  };
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
  defaultModel: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  models: string[];
}

// --- API Responses ---
export interface ApiResponse<T> {
  data: T;
  error?: never;
}

export interface ApiError {
  data?: never;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
