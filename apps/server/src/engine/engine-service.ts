/**
 * engine/engine-service.ts — Thin facade between API Layer (Block 3) and Engine (Block 2)
 *
 * Design principles:
 *   - ZERO logic — pure delegation to existing engine modules
 *   - Namespaced interface — engine.sessions.runAgent(), not engine.runAgent()
 *   - IEngineService interface for easy mocking in tests
 *   - Singleton (lazy) — compatible with existing singleton pattern
 *   - workflows.ts intentionally excluded — already uses proper constructor DI
 *     UPDATE: Now included via workflows.setEngine() / workflows.getEngine()
 *     The WorkflowEngine is still constructed in index.ts but registered on the facade.
 *
 * Usage in API routes:
 *   import { getEngineService } from '../engine/engine-service.js';
 *   const engine = getEngineService();
 *   const result = await engine.sessions.runAgent(...);
 *
 * @see https://github.com/hiveclaw/hiveclaw — Block Architecture docs
 */

// ─── Engine module imports ─────────────────────────────────────────────────────
import { DataAnalysisTool } from './tools/data-analysis.js';
import { formatToolResult } from './tools/types.js';
import { getCircuitBreaker } from './circuit-breaker.js';
import { buildTierConfig, classifyComplexity, classifyTask, getModelQuality } from './smart-router.js';
import type { ModelTier, TierConfig, RoutingContext, RoutingDecision, SystemTask } from './smart-router.js';
import { CURATED_SKILLS, searchSkills, getSkillsByCategory, getCategoryStats } from './skill-hub.js';
import type { SkillCategory } from './skill-hub.js';
import { getMCPClient } from './mcp-client.js';
import type { MCPServerConfig } from './mcp-client.js';
import { handleChannelInbound } from './channel-responder.js';
import type { ChannelInbound } from './channel-responder.js';
import { getSessionManager } from './session-manager.js';
import { runAgent, serializeSSE } from './agent-runner.js';
import { runAgentV2 } from './agent-runner-v2.js';
import { registerRun, unregisterRun, cancelRun, hasActiveRun, activeRunCount } from './run-registry.js';
import type { AgentConfig, SSEEvent } from './agent-runner.js';
import { runSquad } from './squad-runner.js';
import type { SquadConfig } from './squad-runner.js';
import { handoffSession } from './session-handoff.js';
import type { HandoffRequest, HandoffResult } from './session-handoff.js';
import { WorkflowEngine } from './workflow-engine.js';
import { getMessageBus, type MessageBus } from './message-bus.js';
import { getDb } from '../db/schema.js';
import { ExternalAgentRepository } from '../db/external-agents.js';
import { SharedLinkRepository } from '../db/shared-links.js';
import { AgentRepository } from '../db/agents.js';
import { ProviderRepository } from '../db/providers.js';
import type Database from 'better-sqlite3';

// ─── Re-exports — API routes import types from here only ──────────────────────
export type {
  AgentConfig,
  SSEEvent,
  SquadConfig,
  HandoffRequest,
  HandoffResult,
  ChannelInbound,
  ModelTier,
  TierConfig,
  RoutingContext,
  RoutingDecision,
  SystemTask,
  MCPServerConfig,
  SkillCategory,
  MessageBus,
};

// ─── Namespace interfaces ─────────────────────────────────────────────────────

export interface IDataService {
  tool: DataAnalysisTool;
  formatResult: typeof formatToolResult;
}

export interface ICircuitService {
  getBreaker: typeof getCircuitBreaker;
}

export interface IRoutingService {
  buildTierConfig: typeof buildTierConfig;
  classifyComplexity: typeof classifyComplexity;
  classifyTask: typeof classifyTask;
  getModelQuality: typeof getModelQuality;
}

export interface ISkillHubService {
  CURATED_SKILLS: typeof CURATED_SKILLS;
  searchSkills: typeof searchSkills;
  getSkillsByCategory: typeof getSkillsByCategory;
  getCategoryStats: typeof getCategoryStats;
}

export interface IMCPService {
  getClient: typeof getMCPClient;
}

export interface IChannelService {
  handleInbound: typeof handleChannelInbound;
}

export interface ISessionService {
  getManager: typeof getSessionManager;
  runAgent: typeof runAgent;
  /** Cancel an active v2 run. Returns true if found and cancelled. */
  cancelRun: (sessionId: string) => boolean;
  /** Check if a session has an active run. */
  hasActiveRun: (sessionId: string) => boolean;
  /** Number of currently active runs. */
  activeRunCount: () => number;
  runSquad: typeof runSquad;
  serializeSSE: typeof serializeSSE;
  handoff: typeof handoffSession;
}

export interface IWorkflowService {
  /** Set the engine instance (called once from index.ts during bootstrap). */
  setEngine(engine: WorkflowEngine): void;
  /** Get the engine singleton. Throws if not yet set. */
  getEngine(): WorkflowEngine;
  /** Get the MessageBus (always available). */
  getBus(): MessageBus;
}

/** DB access — repositories + raw getDb() for complex queries. */
export interface IDbService {
  getDb(): Database.Database;
  externalAgents(db?: Database.Database): ExternalAgentRepository;
  sharedLinks(): SharedLinkRepository;
  agents(db?: Database.Database): AgentRepository;
  providers(db?: Database.Database): ProviderRepository;
}

// ─── Top-level facade interface ───────────────────────────────────────────────

export interface IEngineService {
  data: IDataService;
  circuits: ICircuitService;
  routing: IRoutingService;
  skills: ISkillHubService;
  mcp: IMCPService;
  channels: IChannelService;
  sessions: ISessionService;
  workflows: IWorkflowService;
  db: IDbService;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class EngineServiceImpl implements IEngineService {
  // DataAnalysisTool: one instance shared across requests (stateless internally)
  private readonly _dataTool = new DataAnalysisTool();

  readonly data: IDataService = {
    tool: this._dataTool,
    formatResult: formatToolResult,
  };

  readonly circuits: ICircuitService = {
    getBreaker: getCircuitBreaker,
  };

  readonly routing: IRoutingService = {
    buildTierConfig,
    classifyComplexity,
    classifyTask,
    getModelQuality,
  };

  readonly skills: ISkillHubService = {
    CURATED_SKILLS,
    searchSkills,
    getSkillsByCategory,
    getCategoryStats,
  };

  readonly mcp: IMCPService = {
    getClient: getMCPClient,
  };

  readonly channels: IChannelService = {
    handleInbound: handleChannelInbound,
  };

  readonly sessions: ISessionService = {
    getManager: getSessionManager,
    runAgent: (...args: Parameters<typeof runAgent>) => {
      const agentConfig = args[2];
      if (agentConfig?.engineVersion === 2) {
        const sessionId = args[0];
        const controller = registerRun(sessionId);
        // Wrap the v2 generator to unregister on completion
        const gen = runAgentV2(args[0], args[1], args[2], { ...args[3], signal: controller.signal });
        return (async function* () {
          try {
            yield* gen;
          } finally {
            unregisterRun(sessionId);
          }
        })();
      }
      return runAgent(...args);
    },
    cancelRun,
    hasActiveRun,
    activeRunCount,
    runSquad,
    serializeSSE,
    handoff: handoffSession,
  };

  // WorkflowEngine requires repo + bus at construction time,
  // so it's set externally via setEngine() during bootstrap.
  private _workflowEngine: WorkflowEngine | null = null;

  readonly workflows: IWorkflowService = {
    setEngine: (engine: WorkflowEngine) => {
      this._workflowEngine = engine;
    },
    getEngine: () => {
      if (!this._workflowEngine) throw new Error('WorkflowEngine not initialized — call workflows.setEngine() during bootstrap');
      return this._workflowEngine;
    },
    getBus: () => getMessageBus(),
  };

  readonly db: IDbService = {
    getDb: () => getDb(),
    externalAgents: (db?) => new ExternalAgentRepository(db ?? getDb()),
    sharedLinks: () => new SharedLinkRepository(),
    agents: (db?) => new AgentRepository(db ?? getDb()),
    providers: (db?) => new ProviderRepository(db ?? getDb()),
  };
}

// ─── Singleton (lazy init) ────────────────────────────────────────────────────

let _instance: IEngineService | null = null;

/**
 * Returns the shared EngineService singleton.
 * Safe to call multiple times — instance is created on first call only.
 */
export function getEngineService(): IEngineService {
  if (!_instance) _instance = new EngineServiceImpl();
  return _instance;
}

/**
 * Reset the singleton — only for use in tests.
 * @internal
 */
export function _resetEngineServiceForTesting(): void {
  _instance = null;
}
