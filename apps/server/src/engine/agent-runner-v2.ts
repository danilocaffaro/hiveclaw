/**
 * Engine v2 — Agent Runner with Native Tool Loop
 *
 * Clean rewrite of the agentic loop using Phase 1 provider adapters.
 * The adapter handles the provider protocol (streaming, message format,
 * retries, token exchange). The runner handles the loop, tools, and safety.
 *
 * Architecture:
 *   User message → Build messages → adapter.streamTurn(messages, options)
 *     [text events]       → stream to UI
 *     [tool_call events]  → collect
 *     [finish: tool_calls] → execute tools → append results → loop
 *     [finish: stop]       → done, persist
 *     [finish: max_tokens] → auto-continue
 *     [finish: error]      → persist partial, yield error
 */

import type { LLMMessage } from './providers/types.js';
import type { AgentEvent, AdapterOptions } from './providers/adapters/types.js';
import type { ProviderAdapter } from './providers/adapters/types.js';
import { getAdapterForProvider } from './providers/adapters/index.js';
import { getSessionManager } from './session-manager.js';
import type { Tool, ToolDefinition } from './tools/types.js';
import { formatToolResult } from './tools/types.js';
import { getToolRegistry } from './tools/index.js';
import { AgentMemoryRepository } from '../db/agent-memory.js';
import { ProviderRepository } from '../db/providers.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { LoopDetector } from './loop-detector.js';
import { ProgressChecker } from './progress-checker.js';
import { touchSession } from './session-consolidator.js';
import { checkTokenStatus } from './token-monitor.js';
import { handleThreshold, ensureSessionChainSchema } from './session-rotator.js';
import { getWorkspaceRoot } from '../config/security.js';
import { estimateTokenCost } from '../config/pricing.js';
import { TOOL_LIMITS, ENABLE_MESSAGE_BUS, DEFAULT_PORT } from '../config/defaults.js';
import { messageBus } from './message-bus.js';
import type { SSEEvent, AgentConfig } from './agent-runner.js';

// ─── Squad Context: Substantive Preview Extraction ──────────────────────────

/** Common boilerplate patterns that agents use to start responses */
const BOILERPLATE_RE = /^(okay,?\s+|sure[,!]?\s+|alright[,!]?\s+|certainly[,!]?\s+|let me\s+|i('ll| will)\s+|claro[,!]?\s+|vou\s+|certo[,!]?\s+|ok[,!]?\s+)/i;

/**
 * Extract a substantive preview from an agent response, skipping boilerplate openers.
 * Returns the first meaningful chunk up to maxLen characters.
 */
function extractSubstantivePreview(content: string, maxLen: number): string {
  if (!content || content.length <= maxLen) return content;

  // Split into sentences (simple split by period/newline)
  const sentences = content.split(/(?:\.\s|\n)+/).filter(s => s.trim().length > 5);

  // Skip leading boilerplate sentences
  let startIdx = 0;
  while (startIdx < sentences.length && BOILERPLATE_RE.test(sentences[startIdx].trim())) {
    startIdx++;
  }
  if (startIdx >= sentences.length) startIdx = 0; // all boilerplate? use from start

  // Build preview from substantive sentences
  let preview = '';
  for (let i = startIdx; i < sentences.length; i++) {
    const next = (preview ? '. ' : '') + sentences[i].trim();
    if (preview.length + next.length > maxLen) break;
    preview += next;
  }

  if (!preview) preview = content.slice(0, maxLen);
  return preview + (content.length > preview.length ? '...' : '');
}

// ─── Anti-Fabrication: Empty Result Detection ────────────────────────────────

const EMPTY_IS_FAILURE = new Set(['web_search', 'webfetch', 'browser']);

function detectEmptyToolResult(toolName: string, resultContent: string): boolean {
  if (!EMPTY_IS_FAILURE.has(toolName)) return false;
  try {
    const parsed = JSON.parse(resultContent);
    if (toolName === 'web_search') {
      if (Array.isArray(parsed.results) && parsed.results.length === 0) return true;
      if (parsed.count === 0) return true;
    }
    if (toolName === 'webfetch') {
      const text = typeof parsed === 'string' ? parsed : (parsed.result ?? parsed.text ?? '');
      if (typeof text === 'string' && text.trim().length < 50) return true;
    }
    if (toolName === 'browser') {
      const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      if (text.trim().length < 50) return true;
    }
    return false;
  } catch {
    const trimmed = resultContent.trim();
    if (trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') return true;
    if (EMPTY_IS_FAILURE.has(toolName) && trimmed.length < 50) return true;
    return false;
  }
}

// ─── Tool Helpers ─────────────────────────────────────────────────────────────

function getToolsForAgent(allowedNames?: string[]): { tools: Tool[]; byName: Map<string, Tool> } {
  const registry = getToolRegistry();
  const allTools = Array.from(registry.values());
  const enabledTools = allowedNames
    ? allTools.filter((t) => allowedNames.includes(t.definition.name))
    : allTools;
  const byName = new Map<string, Tool>(enabledTools.map((t) => [t.definition.name, t]));
  return { tools: enabledTools, byName };
}

function toolsToAdapterDefinitions(tools: Tool[]): AdapterOptions['tools'] {
  return tools.map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    parameters: t.definition.parameters as Record<string, unknown>,
  }));
}

// ─── Message Conversion ───────────────────────────────────────────────────────

function historyToLLMMessages(
  history: Array<{
    role: string;
    content: string;
    tool_name?: string;
    tool_result?: string;
  }>,
): LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const msg of history) {
    if (msg.role === 'system') continue;
    const role = msg.role as LLMMessage['role'];
    if (role === 'tool') {
      out.push({
        role: 'tool',
        content: msg.content ?? msg.tool_result ?? '',
        name: msg.tool_name ?? undefined,
      });
    } else {
      out.push({ role, content: msg.content });
    }
  }
  return out;
}

// ─── Pending Tool Call type ──────────────────────────────────────────────────

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
  input: Record<string, unknown>;
}

// ─── Provider Fallback Chain Builder ─────────────────────────────────────────

function buildFallbackChain(agentConfig: AgentConfig): string[] {
  const chain: string[] = [];
  if (agentConfig.providerId) chain.push(agentConfig.providerId);
  if (agentConfig.fallbackProviders) {
    for (const fbId of agentConfig.fallbackProviders) {
      if (!chain.includes(fbId)) chain.push(fbId);
    }
  }
  // Add any other configured providers from DB
  try {
    const providerRepo = new ProviderRepository(getDb());
    for (const p of providerRepo.list()) {
      if (p.enabled && !chain.includes(p.id)) chain.push(p.id);
    }
  } catch { /* non-fatal — use what we have */ }
  return chain;
}

// ─── Resolve Adapter for a Provider ID ───────────────────────────────────────

function resolveAdapter(providerId: string): ProviderAdapter | null {
  try {
    // First try cache
    return getAdapterForProvider(providerId);
  } catch {
    // Not cached — try to create from DB config
    try {
      const providerRepo = new ProviderRepository(getDb());
      const config = providerRepo.getUnmasked(providerId);
      if (!config) return null;
      return getAdapterForProvider(providerId, config);
    } catch {
      return null;
    }
  }
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(agentConfig: AgentConfig, sessionId: string, toolNames: string[]): string {
  let systemPrompt = agentConfig.systemPrompt;

  // Agent memory injection
  try {
    const memoryRepo = new AgentMemoryRepository(getDb());
    const memoryContext = memoryRepo.getContextStringBudgeted(agentConfig.id, sessionId);
    if (memoryContext) systemPrompt = `${agentConfig.systemPrompt}${memoryContext}`;
  } catch { /* continue without memory */ }

  // Runtime + tool integrity + operational awareness (same as v1)
  const serverPort = process.env.PORT ?? DEFAULT_PORT;
  const runtimeParts = [
    `agent=${agentConfig.id}`, `name=${agentConfig.name}`, `model=${agentConfig.modelId || 'unknown'}`,
    `provider=${agentConfig.providerId || 'unknown'}`, `temperature=${agentConfig.temperature ?? 0.7}`,
    `tools=${toolNames.length}`, `date=${new Date().toISOString().split('T')[0]}`,
    `platform=HiveClaw`, `cwd=${process.cwd()}`, `workspace=${getWorkspaceRoot()}`, `engine=v2`,
  ];
  const toolsList = toolNames.length > 0
    ? `\nAvailable tools: ${toolNames.join(', ')}. Use them proactively.` : '';
  systemPrompt += `\n\n## Runtime\nRuntime: ${runtimeParts.join(' | ')}${toolsList}`;
  systemPrompt += `\n\n## Tool Output Integrity (MANDATORY)
- Report EXACT errors. NEVER fabricate results. Prefer "I don't know" over wrong answers.
- When empty results: say "found no results". NEVER invent content not returned by tools.`;
  systemPrompt += `\n\n## Operational Awareness
Agent running INSIDE HiveClaw server on port ${serverPort}. OS: ${process.platform} ${process.arch}.
Self-preservation: do NOT run pnpm start/dev, kill, or launchctl unload — those crash YOUR process.
You CAN: read/write/edit files, run pnpm test/build/git, curl localhost:${serverPort}/api/*, use all tools.
NEVER claim something works without verifying. NEVER fabricate outputs.`;

  // Active task context
  try {
    const db = getDb();
    const activeTasks = db.prepare(
      "SELECT title, status, assigned_agent_id FROM tasks WHERE session_id = ? AND status NOT IN ('done') ORDER BY sort_order LIMIT 10"
    ).all(sessionId) as Array<{ title: string; status: string; assigned_agent_id: string | null }>;
    if (activeTasks.length > 0) {
      const taskLines = activeTasks.map(t => {
        const isMe = t.assigned_agent_id === agentConfig.id;
        return `${t.status === 'doing' ? '▶' : '○'} [${t.status.toUpperCase()}]${isMe ? ' ← YOUR TASK' : ''}: ${t.title}`;
      }).join('\n');
      systemPrompt += `\n\n## Active Squad Tasks\n${taskLines}`;
    }
  } catch { /* non-fatal */ }

  return systemPrompt;
}

// ─── Background Memory Extraction (fire-and-forget, simplified from v1) ──────

function backgroundMemoryExtract(agentId: string, sessionId: string, userMessage: string, _assistantResponse: string): void {
  void (async () => {
    try {
      const repo = new AgentMemoryRepository(getDb());
      let total = 0;
      if (userMessage && userMessage.length > 10) {
        for (const line of userMessage.split(/[.\n]+/).filter(l => l.trim().length > 8)) {
          const lo = line.toLowerCase().trim();
          if (/(?:i prefer|i like|i always|i never|i want|favorite|eu prefiro|eu gosto|eu sempre|eu nunca|eu quero)\b/i.test(lo)) {
            const isNeg = /(?:i never|don't like|i hate|eu nunca|não gosto|eu odeio)\b/i.test(lo);
            const key = `pref_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, isNeg ? `[AVOID] ${line.trim().slice(0, 295)}` : line.trim().slice(0, 300),
              isNeg ? 'correction' : 'preference', isNeg ? 0.95 : 0.9, undefined, { source: 'auto_extract', tags: ['from_user'] });
            total++;
          }
          if (/(?:actually|no,? that's wrong|correction|na verdade|está errado|correção)\b/i.test(lo)) {
            repo.set(agentId, `corr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, line.trim().slice(0, 300),
              'correction', 1.0, undefined, { source: 'auto_extract', tags: ['from_user'] });
            total++;
          }
        }
      }
      if (total > 0) {
        repo.logEpisode({ sessionId, agentId, type: 'extraction',
          content: `Auto-extracted ${total} memories`, eventAt: new Date().toISOString(), metadata: { total } });
      }
    } catch (err) {
      logger.warn('[MemoryExtract-v2] Failed: %s', (err as Error).message);
    }
  })();
}

// ─── Core V2 Agentic Loop ────────────────────────────────────────────────────

export async function* runAgentV2(
  sessionId: string,
  userMessage: string,
  agentConfig: AgentConfig,
  opts?: {
    skipPersistUserMessage?: boolean;
    sender?: { id?: string; name?: string; emoji?: string; type?: string };
    signal?: AbortSignal;
    /** P6: In squad mode, filter context to only show this agent's own messages + user messages.
     *  Other agents' tool results and assistant messages are replaced with a brief summary. */
    squadContextIsolation?: { agentId: string; squadAgentNames?: Map<string, string> };
  },
): AsyncGenerator<SSEEvent> {
  const sessionManager = getSessionManager();

  // ── 1. Load session ─────────────────────────────────────────────────────────
  try {
    sessionManager.getSessionWithMessages(sessionId);
  } catch {
    yield { event: 'error', data: { message: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' } };
    return;
  }

  // ── 2. Persist user message ─────────────────────────────────────────────────
  if (!opts?.skipPersistUserMessage) {
    try {
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: userMessage,
        ...(opts?.sender?.type === 'agent' ? {
          sender_type: 'agent' as const,
          agent_name: opts.sender.name ?? '',
          agent_emoji: opts.sender.emoji ?? '',
          agent_id: opts.sender.id ?? '',
        } : { sender_type: 'human' as const }),
      });
    } catch (err) {
      yield { event: 'error', data: { message: `Failed to persist user message: ${(err as Error).message}`, code: 'DB_ERROR' } };
      return;
    }
  }

  // ── 3. Smart context compaction ─────────────────────────────────────────────
  try {
    await sessionManager.smartCompact(sessionId, 80_000, agentConfig.id);
  } catch { /* continue with full history */ }

  // ── 4. Prepare tools & system prompt ────────────────────────────────────────
  const { tools: enabledTools, byName: toolsByName } = getToolsForAgent(agentConfig.tools);
  const toolDefs = toolsToAdapterDefinitions(enabledTools);
  const toolNames = enabledTools.map(t => t.definition.name);
  const systemPrompt = buildSystemPrompt(agentConfig, sessionId, toolNames);

  // ── 5. Build messages array ─────────────────────────────────────────────────
  const freshMessages = sessionManager.getMessages(sessionId);
  let messages: LLMMessage[] = [...historyToLLMMessages(freshMessages)];
  if (opts?.skipPersistUserMessage && userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  // ── 5b. P6: Squad context isolation ──────────────────────────────────────────
  // In squad mode, other agents' tool results and detailed responses create noise.
  // Filter to show: (1) all user messages, (2) this agent's own messages in full,
  // (3) other agents' messages as brief summaries.
  if (opts?.squadContextIsolation) {
    const myAgentId = opts.squadContextIsolation.agentId;
    const agentNames = opts.squadContextIsolation.squadAgentNames;
    messages = messages.map(msg => {
      // Keep all user messages untouched
      if (msg.role === 'user') return msg;
      // Keep system messages untouched
      if (msg.role === 'system') return msg;

      // For assistant messages: check if it's from this agent
      const msgRecord = msg as unknown as Record<string, unknown>;
      const msgAgentId = msgRecord.agent_id as string | undefined;

      // Own messages: keep in full
      if (msgAgentId === myAgentId || !msgAgentId) return msg;

      // Other agent's messages: summarize to reduce noise
      const agentName = agentNames?.get(msgAgentId) || 'Another agent';
      const content = typeof msg.content === 'string' ? msg.content : '';
      // Extract substantive preview: skip common boilerplate openers, take first meaningful chunk
      const preview = extractSubstantivePreview(content, 200);
      return { ...msg, content: `[${agentName} responded: ${preview}]` };
    });

    // Remove other agents' tool messages entirely (they're noise for this agent)
    messages = messages.filter(msg => {
      if (msg.role !== 'tool') return true;
      // Tool messages don't have agent_id, but they follow tool_calls from assistant messages.
      // We keep all tool messages for simplicity — the important filtering is on assistant messages.
      return true;
    });
  }

  // ── 6. Token monitoring & session rotation ──────────────────────────────────
  try {
    ensureSessionChainSchema();
    const tokenStatus = checkTokenStatus(
      freshMessages.map(m => ({ role: m.role, content: m.content, tool_result: m.tool_result })),
      agentConfig.modelId || 'unknown',
    );
    if (tokenStatus.actionRequired) {
      const newSessionId = await handleThreshold(tokenStatus, sessionId, agentConfig.id, agentConfig.modelId || 'unknown');
      if (newSessionId) {
        yield { event: 'message.delta' as const, data: { text: '\n\n🔄 *Session auto-rotated for optimal performance. Memory preserved.*\n' } };
        yield { event: 'message.finish' as const, data: { sessionId: newSessionId, rotated: true, oldSessionId: sessionId } };
        return;
      }
    }
  } catch { /* continue normally */ }

  // ── 7. Signal start ─────────────────────────────────────────────────────────
  yield { event: 'message.start', data: { sessionId, agentId: agentConfig.id } };
  if (ENABLE_MESSAGE_BUS) {
    messageBus.publish(sessionId, 'message.start', {
      agentId: agentConfig.id, agentName: agentConfig.name ?? '', agentEmoji: agentConfig.emoji ?? '',
    });
  }

  // ── 8. Setup loop control ──────────────────────────────────────────────────
  const loopDetector = new LoopDetector();
  const maxIterations = agentConfig.maxToolIterations ?? TOOL_LIMITS.MAX_TOOL_ITERATIONS;
  const progressChecker = new ProgressChecker({
    duplicateThreshold: 5,
    timeBudgetMs: 1_800_000, // 30min wall
  });
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let fullAssistantText = '';
  let consecutiveLoopBreaks = 0;

  // ── Build provider fallback chain ──────────────────────────────────────────
  const fallbackChain = buildFallbackChain(agentConfig);
  if (fallbackChain.length === 0) {
    yield { event: 'error', data: { message: `No LLM provider available (requested: ${agentConfig.providerId})`, code: 'NO_PROVIDER' } };
    return;
  }

  // ── Helper: persist partial response ───────────────────────────────────────
  // R22-P1 Bug 2: prevent double persist within the runner itself.
  // persistPartialResponse (abort/error paths) + final persist (line ~901)
  // could both fire when the loop breaks after a partial persist.
  let alreadyPersisted = false;

  const persistPartialResponse = (reason: string) => {
    if (alreadyPersisted) return;
    if (!fullAssistantText.trim()) return;
    alreadyPersisted = true;
    try {
      sessionManager.addMessage(sessionId, {
        role: 'assistant', content: fullAssistantText,
        agent_id: agentConfig.id, agent_name: agentConfig.name ?? '',
        agent_emoji: agentConfig.emoji ?? '🤖', sender_type: 'agent',
        tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost: 0,
      });
      logger.info('[AgentRunner-v2] Persisted partial response (%d chars) on %s', fullAssistantText.length, reason);
    } catch (e) {
      logger.error('[AgentRunner-v2] Failed to persist partial response: %s', (e as Error).message);
    }
  };

  // ── 9. Native Tool Loop ────────────────────────────────────────────────────
  const signal = opts?.signal;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ── P1: Abort check at each iteration ─────────────────────────────────────
    if (signal?.aborted) {
      persistPartialResponse('aborted');
      yield { event: 'message.delta', data: { text: '\n\n[Run cancelled by user.]' } };
      break;
    }
    // ── R20.2d: Proactive token budget check ──────────────────────────────────
    const PROACTIVE_TOKEN_LIMIT = 60_000;
    const estimatedContextChars = messages.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0) + systemPrompt.length;

    if (estimatedContextChars > PROACTIVE_TOKEN_LIMIT * 4 && iteration > 0) {
      const midpoint = Math.floor(messages.length / 2);
      let pruned = 0;
      for (let i = 0; i < midpoint; i++) {
        const msg = messages[i];
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 200) {
          msg.content = `[context pruned — tool output from iteration ${(msg as unknown as Record<string, unknown>)._iter ?? '?'} removed to stay within token budget]`;
          pruned++;
        }
      }
      if (pruned > 0) {
        logger.info(`[AgentRunner-v2] Proactive context prune: replaced ${pruned} old tool outputs`);
      }
    }

    // ── Time wall check ───────────────────────────────────────────────────────
    const progressCheck = progressChecker.fullCheck(iteration);
    if (progressCheck.shouldStop) {
      logger.warn(`[AgentRunner-v2] Time wall reached: ${progressCheck.details}`);
      // Consolidation call — no tools
      messages.push({ role: 'user', content: `[SYSTEM] ${progressCheck.recommendation} Do NOT call any more tools.` });
      const consolidationAdapter = resolveAdapter(fallbackChain[0]);
      if (consolidationAdapter) {
        try {
          const consolidationOpts: AdapterOptions = {
            model: agentConfig.modelId, temperature: agentConfig.temperature,
            maxTokens: agentConfig.maxTokens, systemPrompt, signal,
          };
          for await (const evt of consolidationAdapter.streamTurn(messages, consolidationOpts)) {
            if (evt.type === 'text') {
              fullAssistantText += evt.text;
              yield { event: 'message.delta', data: { text: evt.text } };
            }
          }
        } catch (e) {
          logger.warn('[AgentRunner-v2] Time-wall consolidation failed: %s', (e as Error).message);
        }
      }
      break;
    }

    // ── Stream a turn from the adapter (with fallback) ────────────────────────
    const pendingToolCalls: PendingToolCall[] = [];
    let iterationText = '';
    let iterationTokensIn = 0;
    let iterationTokensOut = 0;
    let finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'max_tokens_tool_call' | 'error' = 'stop';

    // Sprint 80 stream buffer: truncation detection safety net
    const TRUNCATION_NEEDLE = '⚠️ Summarize progress';
    const TRUNCATION_NEEDLE_SHORT = 'Summarize progress so far';
    let streamBuffer = '';
    const BUFFER_THRESHOLD = 120;

    let streamSuccess = false;

    for (const providerId of fallbackChain) {
      const adapter = resolveAdapter(providerId);
      if (!adapter) continue;

      const adapterOpts: AdapterOptions = {
        model: agentConfig.modelId,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        systemPrompt,
        tools: toolDefs && toolDefs.length > 0 ? toolDefs : undefined,
        signal,
      };

      try {
        for await (const evt of adapter.streamTurn(messages, adapterOpts)) {
          switch (evt.type) {
            case 'text': {
              iterationText += evt.text;
              fullAssistantText += evt.text;
              streamBuffer += evt.text;

              // Truncation filtering
              const mightBeTruncation = streamBuffer.includes('⚠️') || streamBuffer.includes('Summarize progress');
              if (mightBeTruncation && streamBuffer.length < BUFFER_THRESHOLD) {
                // Hold back
              } else if (mightBeTruncation && (streamBuffer.includes(TRUNCATION_NEEDLE) || streamBuffer.includes(TRUNCATION_NEEDLE_SHORT))) {
                // Confirmed truncation — suppress
              } else if (streamBuffer) {
                yield { event: 'message.delta', data: { text: streamBuffer } };
                if (ENABLE_MESSAGE_BUS) {
                  messageBus.publish(sessionId, 'message.delta', { text: streamBuffer, agentId: agentConfig.id ?? '' });
                }
                streamBuffer = '';
              }
              break;
            }

            case 'tool_call': {
              // Flush safe buffer before tool calls
              if (streamBuffer && !streamBuffer.includes(TRUNCATION_NEEDLE) && !streamBuffer.includes(TRUNCATION_NEEDLE_SHORT)) {
                yield { event: 'message.delta', data: { text: streamBuffer } };
                if (ENABLE_MESSAGE_BUS) {
                  messageBus.publish(sessionId, 'message.delta', { text: streamBuffer, agentId: agentConfig.id ?? '' });
                }
                streamBuffer = '';
              }

              let toolInput: Record<string, unknown> = {};
              try { toolInput = JSON.parse(evt.arguments); } catch { /* empty */ }

              pendingToolCalls.push({
                id: evt.id,
                name: evt.name,
                arguments: evt.arguments,
                input: toolInput,
              });
              yield { event: 'tool.start', data: { id: evt.id, name: evt.name, input: toolInput } };
              break;
            }

            case 'usage': {
              iterationTokensIn += evt.inputTokens;
              iterationTokensOut += evt.outputTokens;
              break;
            }

            case 'finish': {
              // Flush remaining buffer
              if (streamBuffer) {
                const isTruncBuf = streamBuffer.includes(TRUNCATION_NEEDLE) || streamBuffer.includes(TRUNCATION_NEEDLE_SHORT);
                if (!isTruncBuf) {
                  yield { event: 'message.delta', data: { text: streamBuffer } };
                  if (ENABLE_MESSAGE_BUS) {
                    messageBus.publish(sessionId, 'message.delta', { text: streamBuffer, agentId: agentConfig.id ?? '' });
                  }
                }
                streamBuffer = '';
              }
              finishReason = evt.reason;
              break;
            }

            case 'error': {
              // Adapter-level error — try next provider in chain
              logger.warn(`[AgentRunner-v2] Adapter ${providerId} error: ${evt.error}`);
              break;
            }
          }
        }
        streamSuccess = true;
        break; // Success — don't try other providers
      } catch (err) {
        logger.warn(`[AgentRunner-v2] Adapter ${providerId} threw: ${(err as Error).message}`);
        continue; // Try next provider
      }
    }

    if (!streamSuccess) {
      // P1: Distinguish abort from real provider failure
      if (signal?.aborted) {
        persistPartialResponse('aborted');
        yield { event: 'message.delta', data: { text: '\n\n[Run cancelled.]' } };
        break;
      }
      persistPartialResponse('all-providers-exhausted');
      yield { event: 'error', data: { message: 'All providers failed', code: 'PROVIDER_ERROR' } };
      return;
    }

    totalTokensIn += iterationTokensIn;
    totalTokensOut += iterationTokensOut;
    progressChecker.recordTokens(iterationTokensIn, iterationTokensOut);

    // ── Handle finish reasons ─────────────────────────────────────────────────

    // P1: Check abort before processing finish reason
    if (signal?.aborted) {
      persistPartialResponse('aborted');
      yield { event: 'message.delta', data: { text: '\n\n[Run cancelled.]' } };
      break;
    }

    if (finishReason === 'error') {
      persistPartialResponse('provider-finish-error');
      yield { event: 'error', data: { message: 'Provider returned an error', code: 'PROVIDER_ERROR' } };
      return;
    }

    // R22-P1 Bug 1: Tool call JSON was truncated by max_tokens mid-generation.
    // The adapter detected inToolUse=true at stream end and signaled this reason.
    // Inject a recovery prompt telling the agent to change strategy.
    if (finishReason === 'max_tokens_tool_call') {
      logger.warn('[AgentRunner-v2] Tool call truncated by max_tokens at iteration %d — injecting recovery prompt', iteration);
      if (iterationText) {
        messages.push({ role: 'assistant', content: iterationText });
      }
      messages.push({
        role: 'user',
        content: '[SYSTEM] ⚠️ Your tool call was truncated — the JSON arguments exceeded the output token budget. You MUST use a different approach: (1) write large content to disk in smaller chunks using multiple tool calls, (2) use a more concise format, or (3) generate less content per call. Do NOT retry the same approach.',
      });
      continue;
    }

    if (finishReason === 'max_tokens' && pendingToolCalls.length === 0) {
      // Normal text truncation — append partial text and continue
      if (iterationText) {
        messages.push({ role: 'assistant', content: iterationText });
      }
      messages.push({
        role: 'user',
        content: '[SYSTEM] Your previous response was truncated by the provider output limit. Continue from exactly where you left off. Do not repeat what you already said.',
      });
      continue;
    }

    // ── No tool calls → done or handle truncation ─────────────────────────────
    if (pendingToolCalls.length === 0) {
      // Check for provider truncation leaking as text
      const PROVIDER_TRUNCATION_PATTERNS = [
        /\u26a0\ufe0f\s*Summarize progress/i,
        /continue in a new iteration/i,
        /Summarize progress so far/i,
      ];
      const isProviderTruncation = PROVIDER_TRUNCATION_PATTERNS.some(p => p.test(iterationText));
      if (isProviderTruncation) {
        logger.warn(`[AgentRunner-v2] Provider truncation at iteration ${iteration} — auto-continuing`);
        const stripPattern = /\u26a0\ufe0f?\s*(Summarize progress|continue in a new iteration)[^]*/i;
        iterationText = iterationText.replace(stripPattern, '').trim();
        fullAssistantText = fullAssistantText.replace(stripPattern, '').trim();
        if (iterationText) messages.push({ role: 'assistant', content: iterationText });
        messages.push({
          role: 'user',
          content: '[SYSTEM] Your previous response was truncated by the provider output limit. Continue from exactly where you left off. Do not repeat what you already said.',
        });
        continue;
      }

      // Response loop detection
      if (iterationText) {
        const responseLoop = loopDetector.recordResponse(iterationText);
        if (responseLoop.loopDetected) {
          logger.warn(`[AgentRunner-v2] Response loop: ${responseLoop.details}`);
          const loopMsg = `\n\n[Loop detected: ${responseLoop.details}. Stopping to prevent repetition.]`;
          yield { event: 'message.delta', data: { text: loopMsg } };
          fullAssistantText += loopMsg;
        }
      }
      break; // Done — no tool calls, finish normally
    }

    // ── Tool call loop detection (R20.2b graduated) ───────────────────────────
    let loopBroken = false;
    for (const tc of pendingToolCalls) {
      const toolLoop = loopDetector.recordToolCall(tc.name, tc.input);

      if (toolLoop.severity === 'warning') {
        logger.info(`[AgentRunner-v2] Tool repeat warning: ${toolLoop.details}`);
      } else if (toolLoop.severity === 'inject') {
        logger.warn(`[AgentRunner-v2] Tool loop (inject): ${toolLoop.details}`);
        const loopMsg = `\n\n[Loop detected: ${toolLoop.details}. Try a different approach or parameters.]`;
        yield { event: 'message.delta', data: { text: loopMsg } };
        fullAssistantText += loopMsg;
        messages.push({ role: 'assistant', content: iterationText || '' });
        messages.push({
          role: 'user',
          content: `[SYSTEM] ⚠️ LOOP WARNING: You called tool "${tc.name}" ${toolLoop.identicalCount}x with identical input. The tool calls have been BLOCKED for this iteration. Try: (1) different parameters, (2) a different tool, or (3) respond directly without tools.`,
        });
        loopBroken = true;
        break;
      } else if (toolLoop.severity === 'circuit_breaker') {
        logger.warn(`[AgentRunner-v2] Tool loop CIRCUIT BREAKER: ${toolLoop.details}`);
        const breakMsg = `\n\n[Circuit breaker: ${toolLoop.details}. Stopping tool execution.]`;
        yield { event: 'message.delta', data: { text: breakMsg } };
        fullAssistantText += breakMsg;
        messages.push({ role: 'assistant', content: iterationText || '' });
        messages.push({
          role: 'user',
          content: `[SYSTEM] ⛔ CIRCUIT BREAKER: You called tool "${tc.name}" ${toolLoop.identicalCount}x with identical input. This is NOT working. You MUST respond to the user NOW with what you have. Do NOT call any more tools.`,
        });
        consecutiveLoopBreaks = 99;
        loopBroken = true;
        break;
      }

      // Secondary duplicate detector
      const dupCheck = progressChecker.recordToolCall(tc.name, tc.input);
      if (dupCheck.shouldStop) {
        logger.warn(`[AgentRunner-v2] Duplicate tool detected: ${dupCheck.details}`);
        yield { event: 'message.delta', data: { text: `\n\n⚠️ ${dupCheck.recommendation}` } };
        fullAssistantText += `\n\n⚠️ ${dupCheck.recommendation}`;
        loopBroken = true;
        break;
      }
    }

    if (loopBroken) {
      consecutiveLoopBreaks++;
      if (consecutiveLoopBreaks >= 2) {
        logger.warn(`[AgentRunner-v2] Hard stop: ${consecutiveLoopBreaks} consecutive loop breaks`);
        break;
      }
      loopDetector.reset();
      continue;
    }
    consecutiveLoopBreaks = 0;

    // ── Execute tools ─────────────────────────────────────────────────────────

    // P1: Check abort before expensive tool execution
    if (signal?.aborted) {
      persistPartialResponse('aborted-before-tools');
      yield { event: 'message.delta', data: { text: '\n\n[Run cancelled by user.]' } };
      break;
    }

    // Build assistant message with tool_calls
    const assistantMsg: LLMMessage & { tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } = {
      role: 'assistant',
      content: iterationText || '',
      tool_calls: pendingToolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
    messages.push(assistantMsg as LLMMessage);

    const toolResultMessages: LLMMessage[] = [];

    for (const tc of pendingToolCalls) {
      const tool = toolsByName.get(tc.name);
      let resultContent: string;

      if (!tool) {
        resultContent = `ERROR: Tool "${tc.name}" not found in registry.`;
        yield { event: 'tool.finish', data: { id: tc.id, name: tc.name, output: resultContent, error: true } };
      } else {
        try {
          const toolOutput = await tool.execute(tc.input, { sessionId, agentId: agentConfig.id });
          resultContent = formatToolResult(toolOutput);
          if (!toolOutput.success) {
            logger.warn(`[AgentRunner-v2] Tool "${tc.name}" failed: ${resultContent.slice(0, 200)}`);
          }
          yield { event: 'tool.finish', data: { id: tc.id, name: tc.name, output: resultContent, success: toolOutput.success } };
        } catch (toolErr) {
          resultContent = `ERROR: Tool execution threw an exception: ${(toolErr as Error).message}`;
          yield { event: 'tool.finish', data: { id: tc.id, name: tc.name, output: resultContent, error: true } };
        }
      }

      // Anti-fabrication enforcement
      const isError = resultContent.startsWith('ERROR:');
      const isEmpty = detectEmptyToolResult(tc.name, resultContent);
      let enforced = resultContent;

      if (isError) {
        enforced = `${resultContent}\n\n[SYSTEM] ⛔ TOOL "${tc.name}" FAILED. Report the exact error above to the user. Do NOT guess, infer, or reconstruct what the output might have been.`;
      } else if (isEmpty) {
        enforced = `${resultContent}\n\n[SYSTEM] ⛔ TOOL "${tc.name}" returned EMPTY/NO results. Tell the user you found no results. Do NOT fabricate results.`;
      }

      const toolMsg: LLMMessage = {
        role: 'tool',
        content: enforced,
        tool_call_id: tc.id,
        name: tc.name,
      };
      // Tag for R20.2c in-flight pruning
      (toolMsg as unknown as Record<string, unknown>)._iter = iteration;
      toolResultMessages.push(toolMsg);
    }

    messages.push(...toolResultMessages);

    // ── R20.3c: Tool error acknowledgment ─────────────────────────────────────
    const failedTools = toolResultMessages.filter(m => {
      const content = typeof m.content === 'string' ? m.content : '';
      return content.includes('[SYSTEM] ⛔ TOOL') || content.startsWith('ERROR:');
    });
    if (failedTools.length > 0) {
      const failedNames = failedTools.map(m => m.name ?? 'unknown').join(', ');
      messages.push({
        role: 'user',
        content: `[SYSTEM] ⚠️ TOOL ERROR ACKNOWLEDGMENT REQUIRED: ${failedTools.length} tool(s) failed (${failedNames}). Before calling any new tools, you MUST acknowledge the error and explain what went wrong. Do NOT blindly retry the same tool with the same parameters.`,
      });
    }

    // ── R20.2c: In-flight context pruning ─────────────────────────────────────
    const PRUNE_AGE_ITERATIONS = 3;
    const PRUNE_MIN_CHARS = 1000;
    const PRUNE_HEAD_CHARS = 200;
    const PRUNE_TAIL_CHARS = 200;

    if (iteration >= PRUNE_AGE_ITERATIONS) {
      const pruneThreshold = iteration - PRUNE_AGE_ITERATIONS;
      for (const msg of messages) {
        const iterTag = (msg as unknown as Record<string, unknown>)._iter;
        if (
          msg.role === 'tool' &&
          typeof iterTag === 'number' &&
          iterTag <= pruneThreshold &&
          typeof msg.content === 'string' &&
          msg.content.length > PRUNE_MIN_CHARS
        ) {
          const head = msg.content.slice(0, PRUNE_HEAD_CHARS);
          const tail = msg.content.slice(-PRUNE_TAIL_CHARS);
          msg.content = `${head}\n\n[… ${msg.content.length - PRUNE_HEAD_CHARS - PRUNE_TAIL_CHARS} chars trimmed — tool output from iteration ${iterTag} …]\n\n${tail}`;
        }
      }
    }

    // ── Max iterations consolidation ──────────────────────────────────────────
    if (iteration === maxIterations - 1) {
      logger.warn(`[AgentRunner-v2] Max iterations (${maxIterations}) — consolidating`);
      messages.push({
        role: 'user',
        content: '[SYSTEM] You have reached the tool execution limit. Do NOT call any more tools. Consolidate EVERYTHING you have gathered so far into a final, complete response for the user.',
      });
      const consolidationAdapter = resolveAdapter(fallbackChain[0]);
      if (consolidationAdapter) {
        try {
          const finalOpts: AdapterOptions = {
            model: agentConfig.modelId, temperature: agentConfig.temperature,
            maxTokens: agentConfig.maxTokens, systemPrompt, signal,
          };
          for await (const evt of consolidationAdapter.streamTurn(messages, finalOpts)) {
            if (evt.type === 'text') {
              fullAssistantText += evt.text;
              yield { event: 'message.delta', data: { text: evt.text } };
            }
          }
        } catch (e) {
          logger.warn('[AgentRunner-v2] Consolidation call failed: %s', (e as Error).message);
        }
      }
      break;
    }
  } // end native tool loop

  // ── 10. Persist final assistant message ──────────────────────────────────────
  const PERSIST_STRIP_PATTERN = /⚠️?\s*(Summarize progress|continue in a new iteration)[^]*/gi;
  fullAssistantText = fullAssistantText.replace(PERSIST_STRIP_PATTERN, '').trim();
  const cost = estimateTokenCost(agentConfig.providerId, agentConfig.modelId, totalTokensIn, totalTokensOut);

  // R22-P1 Bug 2: skip if already persisted via persistPartialResponse (abort/error)
  if (!alreadyPersisted) {
    try {
      sessionManager.addMessage(sessionId, {
        role: 'assistant', content: fullAssistantText,
        agent_id: agentConfig.id, agent_name: agentConfig.name ?? '',
        agent_emoji: agentConfig.emoji ?? '', sender_type: 'agent',
        tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost,
      });
      alreadyPersisted = true;
    } catch (dbErr) {
      logger.error('[AgentRunner-v2] Failed to persist assistant message: %s', (dbErr as Error).message);
    }
  }

  // ── 11. Finish event ────────────────────────────────────────────────────────
  // R22-P1 Bug 2: signal that we already persisted so channel-responder
  // error/throw fallback paths don't double-persist on generator cleanup errors.
  yield { event: 'message.finish', data: { tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost, __persisted: true } };
  if (ENABLE_MESSAGE_BUS) {
    messageBus.publish(sessionId, 'message.finish', { tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost });
  }

  // ── 12. Background memory extraction ────────────────────────────────────────
  try {
    backgroundMemoryExtract(agentConfig.id, sessionId, userMessage, fullAssistantText);
  } catch { /* non-fatal */ }

  // ── 13. Session consolidation timer ─────────────────────────────────────────
  try { touchSession(agentConfig.id, sessionId); } catch { /* non-fatal */ }
}
