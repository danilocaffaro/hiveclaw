// ============================================================
// Agent Runner — The core agentic loop for HiveClaw
// ============================================================

import type { LLMMessage, LLMOptions, StreamChunk } from './providers/types.js';
import type { ToolDefinition as LLMToolDefinition } from './providers/types.js';
import { getProviderRouter } from './providers/index.js';
import { getSessionManager } from './session-manager.js';
import type { Tool } from './tools/types.js';
import { formatToolResult } from './tools/types.js';
import { getToolRegistry } from './tools/index.js';
import { AgentMemoryRepository } from '../db/agent-memory.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { LoopDetector } from './loop-detector.js';
import { ProgressChecker } from './progress-checker.js';
import { touchSession } from './session-consolidator.js';
import { checkTokenStatus } from './token-monitor.js';
import { handleThreshold, ensureSessionChainSchema } from './session-rotator.js';
import { getWorkspaceRoot } from '../config/security.js';
import { DEFAULT_PORT } from '../config/defaults.js';

// ─── Anti-Fabrication: Empty Result Detection ────────────────────────────────
// Tools where empty results mean "FAILED to find" → hard blocker injected
const EMPTY_IS_FAILURE = new Set(['web_search', 'webfetch', 'browser']);
// Tools where empty results mean "valid negative" (no match found = useful info)
// grep, glob, bash, read, write, edit, memory, etc. → no blocker needed

/**
 * Detect whether a tool result is "empty" in a way that means failure.
 * Only triggers for tools in EMPTY_IS_FAILURE set.
 */
function detectEmptyToolResult(toolName: string, resultContent: string): boolean {
  if (!EMPTY_IS_FAILURE.has(toolName)) return false;

  try {
    const parsed = JSON.parse(resultContent);

    // web_search: { results: [] } or count === 0
    if (toolName === 'web_search') {
      if (Array.isArray(parsed.results) && parsed.results.length === 0) return true;
      if (parsed.count === 0) return true;
    }

    // webfetch: empty body or very short (<50 chars of actual content)
    if (toolName === 'webfetch') {
      const text = typeof parsed === 'string' ? parsed : (parsed.result ?? parsed.text ?? '');
      if (typeof text === 'string' && text.trim().length < 50) return true;
    }

    // browser: empty snapshot or no content
    if (toolName === 'browser') {
      const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      if (text.trim().length < 50) return true;
    }

    return false;
  } catch {
    // Not JSON — check raw string
    const trimmed = resultContent.trim();
    if (trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') return true;
    // webfetch might return very short HTML artifacts
    if (EMPTY_IS_FAILURE.has(toolName) && trimmed.length < 50) return true;
    return false;
  }
}

// ─── SSE Event Types ──────────────────────────────────────────────────────────

export interface SSEEvent {
  event:
    | 'message.start'
    | 'message.delta'
    | 'message.finish'
    | 'agent.start'
    | 'tool.start'
    | 'tool.finish'
    | 'squad.skip'
    | 'error';
  data: unknown;
}

// ─── Agent Config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  emoji?: string;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number; // per-agent override (default: TOOL_LIMITS.MAX_TOOL_ITERATIONS)
  tools?: string[]; // tool names to enable (undefined = all tools)
  fallbackProviders?: string[]; // ordered fallback provider IDs
}

// ─── Tool Registry ────────────────────────────────────────────────────────────

function getToolsForAgent(allowedNames?: string[]): { tools: Tool[]; byName: Map<string, Tool> } {
  const registry = getToolRegistry();
  const allTools = Array.from(registry.values());
  const enabledTools = allowedNames
    ? allTools.filter((t) => allowedNames.includes(t.definition.name))
    : allTools;
  const byName = new Map<string, Tool>(enabledTools.map((t) => [t.definition.name, t]));
  return { tools: enabledTools, byName };
}

function toolsToLLMDefinitions(tools: Tool[]): LLMToolDefinition[] {
  return tools.map((t) => ({
    name: t.definition.name,
    description: t.definition.description,
    parameters: t.definition.parameters as Record<string, unknown>,
  }));
}

// ─── Message Conversion ───────────────────────────────────────────────────────

/** Convert DB MessageInfo rows to LLMMessage array for the provider. */
function historyToLLMMessages(
  history: Array<{
    role: string;
    content: string;
    tool_name?: string;
    tool_input?: string;
    tool_result?: string;
  }>,
): LLMMessage[] {
  const out: LLMMessage[] = [];

  for (const msg of history) {
    // Skip system messages — we inject the system prompt separately via LLMOptions
    if (msg.role === 'system') continue;

    const role = msg.role as LLMMessage['role'];

    if (role === 'tool') {
      // Tool result message — map to Anthropic-style tool_result content block
      // or OpenAI-style function message (providers handle the mapping internally)
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

// ─── Pending Tool Call accumulator ───────────────────────────────────────────

interface PendingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ─── Cost estimation ─────────────────────────────────────────────────────────

import { estimateTokenCost } from '../config/pricing.js';
import { TOOL_LIMITS, ENABLE_MESSAGE_BUS } from '../config/defaults.js';
import { messageBus } from './message-bus.js';

// ─── Core agentic loop ────────────────────────────────────────────────────────

export async function* runAgent(
  sessionId: string,
  userMessage: string,
  agentConfig: AgentConfig,
  opts?: { skipPersistUserMessage?: boolean; sender?: { id?: string; name?: string; emoji?: string; type?: string } },
): AsyncGenerator<SSEEvent> {
  const sessionManager = getSessionManager();
  const router = getProviderRouter();

  // ── 1. Load history ─────────────────────────────────────────────────────────
  let sessionData: Awaited<ReturnType<typeof sessionManager.getSessionWithMessages>>;
  try {
    sessionData = sessionManager.getSessionWithMessages(sessionId);
  } catch (err) {
    yield {
      event: 'error',
      data: { message: `Session not found: ${sessionId}`, code: 'SESSION_NOT_FOUND' },
    };
    return;
  }

  // ── 2. Save user message (skip when called from squad runner — context injector is internal) ──
  if (!opts?.skipPersistUserMessage) {
    try {
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: userMessage,
        // Sprint C: propagate sender identity to DB
        ...(opts?.sender?.type === 'agent' ? {
          sender_type: 'agent' as const,
          agent_name: opts.sender.name ?? '',
          agent_emoji: opts.sender.emoji ?? '',
          agent_id: opts.sender.id ?? '',
        } : {
          sender_type: 'human' as const,
        }),
      });
    } catch (err) {
      yield {
        event: 'error',
        data: { message: `Failed to persist user message: ${(err as Error).message}`, code: 'DB_ERROR' },
      };
      return;
    }
  }

  // ── 2.5 Smart context compaction ────────────────────────────────────────────
  try {
    await sessionManager.smartCompact(sessionId, 80_000, agentConfig.id);
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] smartCompact failed, continuing with full history');
  }

  // ── 2.6 Inject agent memory context ─────────────────────────────────────────
  let systemPrompt = agentConfig.systemPrompt;
  try {
    const memoryRepo = new AgentMemoryRepository(getDb());
    // Sprint 65: Budget-aware context injection (core blocks + working memory + top-K)
    const memoryContext = memoryRepo.getContextStringBudgeted(agentConfig.id, sessionId);
    if (memoryContext) {
      systemPrompt = `${agentConfig.systemPrompt}${memoryContext}`;
    }
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] Memory injection failed, continuing without memory');
  }

  // ── 2.7 Prepare tools (needed for runtime context) ──────────────────────────
  const { tools: enabledTools, byName: toolsByName } = getToolsForAgent(agentConfig.tools);
  const toolDefs = toolsToLLMDefinitions(enabledTools);

  // ── 2.8 Inject runtime context (model, provider, capabilities, config) ───────
  const runtimeModel = agentConfig.modelId || 'unknown';
  const runtimeProvider = agentConfig.providerId || 'unknown';
  const toolNames = enabledTools.map(t => t.definition.name);
  const runtimeParts = [
    `agent=${agentConfig.id}`,
    `name=${agentConfig.name}`,
    `model=${runtimeModel}`,
    `provider=${runtimeProvider}`,
    `temperature=${agentConfig.temperature ?? 0.7}`,
    `tools=${toolNames.length}`,
    `date=${new Date().toISOString().split('T')[0]}`,
    `platform=HiveClaw`,
    `cwd=${process.cwd()}`,
    `workspace=${getWorkspaceRoot()}`,
  ];
  const runtimeLine = `Runtime: ${runtimeParts.join(' | ')}`;
  const toolsList = toolNames.length > 0
    ? `\nAvailable tools: ${toolNames.join(', ')}. Use them proactively — you have real access to web, files, code execution, memory, and more. Never claim you lack capabilities that your tools provide.`
    : '';
  const honesty = `\n\n## Tool Output Integrity (MANDATORY — ZERO TOLERANCE)
- When a tool returns an error, report the EXACT error to the user. Do NOT guess or reconstruct what the output might have been.
- When a tool returns EMPTY results (0 search results, empty page, no content), tell the user: "I searched but found no results" or "The page returned no content". NEVER invent, fabricate, or hallucinate results.
- If you cannot verify something, say "I could not verify this" — never present unverified information as fact.
- NEVER describe web page content, search results, screenshots, or file contents that were not actually returned by the tool.
- Prefer "I don't know / I couldn't find this" over a confident wrong answer.
- If a tool worked but returned unexpected results, describe what you ACTUALLY received, not what you expected.`;

  // ── Operational Awareness (equivalent to SOUL.md for OpenClaw agents) ────────
  // Gives agents environmental intelligence so they know what to do AND what not to do,
  // without artificial blocklists. Smart agents > restricted agents.
  const serverPort = process.env.PORT ?? DEFAULT_PORT;
  const operationalAwareness = `

## Operational Awareness
You are an agent running INSIDE the HiveClaw server process on port ${serverPort}.

### Environment
- **Server**: Fastify + better-sqlite3, port ${serverPort}, managed by launchd (\`ai.hiveclaw\`)
- **DB**: ~/.hiveclaw/hiveclaw.db (SQLite WAL mode — \`sqlite3\` CLI cannot see uncommitted writes, always query via API)
- **Repo**: ${process.cwd()}
- **Build**: \`pnpm build\` (must compile with 0 TS errors)
- **Tests**: \`pnpm test\` (vitest)
- **OS**: ${process.platform} ${process.arch}

### Self-Preservation Rules
You run inside the server. These actions would crash YOUR OWN PROCESS:
- \`pnpm start\` / \`pnpm dev\` → spawns a second server on :${serverPort} → EADDRINUSE crash
- \`kill\` / \`lsof -ti :${serverPort} | xargs kill\` → kills YOU
- \`launchctl unload ai.hiveclaw\` → stops YOU
- Restarting the server disconnects your session mid-execution

You CAN and SHOULD:
- Read/write/edit any file in the repo
- Run \`pnpm test\`, \`pnpm build\`, \`git\` commands
- Use \`curl localhost:${serverPort}/api/...\` to test API endpoints
- Install packages with \`pnpm add\`
- Use all your tools freely (bash, read, write, edit, grep, glob, memory, etc.)

### Verification First
- NEVER claim something works without verifying. Read actual files, run actual commands.
- NEVER fabricate file contents, command outputs, or test results.
- If you see something unexpected, investigate — don't assume.

### Squad Context
When working in a squad, other agents may have already addressed parts of the task.
Read their responses before duplicating work. Use @mentions to delegate or request help.`;

  const runtimeContext = `\n\n## Runtime\n${runtimeLine}${toolsList}${honesty}${operationalAwareness}`;
  systemPrompt = systemPrompt + runtimeContext;

  // R7.2: Inject active task context if this session has tasks
  try {
    const db = (await import('../db/index.js')).initDatabase();
    const activeTasks = db.prepare(
      "SELECT title, status, assigned_agent_id FROM tasks WHERE session_id = ? AND status NOT IN ('done') ORDER BY sort_order LIMIT 10"
    ).all(sessionId) as Array<{ title: string; status: string; assigned_agent_id: string | null }>;

    if (activeTasks.length > 0) {
      const taskLines = activeTasks.map(t => {
        const isMe = t.assigned_agent_id === agentConfig.id;
        const statusIcon = t.status === 'doing' ? '▶' : '○';
        return `${statusIcon} [${t.status.toUpperCase()}]${isMe ? ' ← YOUR TASK' : ''}: ${t.title}`;
      }).join('\n');
      systemPrompt += `\n\n## Active Squad Tasks\n${taskLines}`;
    }
  } catch { /* non-fatal */ }

  // ── 3. Build messages array ─────────────────────────────────────────────────
  // Re-read messages after potential compaction
  const freshMessages = sessionManager.getMessages(sessionId);
  // History (without the system message — that goes into LLMOptions.systemPrompt)
  const historyMessages = historyToLLMMessages(freshMessages);

  // Working messages list — mutable during the agentic loop
  // freshMessages already includes the user message saved in step 2 (unless skipped for squad)
  const messages: LLMMessage[] = [...historyMessages];

  // If user message was not persisted (squad context injection), still add it to LLM context
  if (opts?.skipPersistUserMessage && userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  // ── 4.5 Token monitoring & session rotation ─────────────────────────────────
  // Sprint 80: Eidetic Memory v2 — context-aware session management
  try {
    ensureSessionChainSchema();
    const modelId = agentConfig.modelId || 'unknown';
    const tokenStatus = checkTokenStatus(
      freshMessages.map(m => ({ role: m.role, content: m.content, tool_result: m.tool_result })),
      modelId,
    );

    if (tokenStatus.actionRequired) {
      logger.info('[AgentRunner] Token status: %s', tokenStatus.message);
      const newSessionId = await handleThreshold(tokenStatus, sessionId, agentConfig.id, modelId);

      if (newSessionId) {
        // Session was rotated — yield event and redirect
        yield {
          event: 'message.delta' as const,
          data: { text: '\n\n🔄 *Session auto-rotated for optimal performance. Memory preserved.*\n' },
        };
        yield {
          event: 'message.finish' as const,
          data: {
            sessionId: newSessionId,
            rotated: true,
            oldSessionId: sessionId,
          },
        };
        return;
      }
    }
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] Token monitoring failed, continuing normally');
  }

  // ── 5. Signal start ──────────────────────────────────────────────────────────
  const startEvent: SSEEvent = { event: 'message.start', data: { sessionId, agentId: agentConfig.id } };
  yield startEvent;
  if (ENABLE_MESSAGE_BUS) {
    messageBus.publish(sessionId, 'message.start', {
      agentId: agentConfig.id,
      agentName: agentConfig.name ?? '',
      agentEmoji: agentConfig.emoji ?? '',
    });
  }

  // ── 5.5 Loop detector ─────────────────────────────────────────────────────────
  const loopDetector = new LoopDetector();

  // Cumulative token / cost tracking
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let fullAssistantText = '';

  // ── 6. Build provider fallback chain ──────────────────────────────────────────
  const fallbackChain: string[] = [];
  // 1st priority: agent's preferred provider
  if (agentConfig.providerId) fallbackChain.push(agentConfig.providerId);
  // 2nd priority: agent's explicit fallback list
  if (agentConfig.fallbackProviders) {
    for (const fbId of agentConfig.fallbackProviders) {
      if (!fallbackChain.includes(fbId)) fallbackChain.push(fbId);
    }
  }
  // 3rd priority: router default
  const defaultProvider = router.getDefault();
  if (defaultProvider && !fallbackChain.includes(defaultProvider.id)) {
    fallbackChain.push(defaultProvider.id);
  }
  // 4th priority: all other registered providers
  for (const p of router.list()) {
    if (!fallbackChain.includes(p.id)) fallbackChain.push(p.id);
  }

  // ── Helper: persist accumulated assistant text before early returns ──────────
  // Called on error paths where the normal addMessage at the end is unreachable.
  // Skips if fullAssistantText is empty (nothing to save) or if the normal path
  // already saved it (ranToCompletion guard is managed by the caller).
  const persistPartialResponse = (reason: string) => {
    if (!fullAssistantText.trim()) return;
    try {
      sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: fullAssistantText,
        agent_id: agentConfig.id,
        agent_name: agentConfig.name ?? '',
        agent_emoji: (agentConfig as { emoji?: string }).emoji ?? '🤖',
        sender_type: 'agent',
        tokens_in: totalTokensIn,
        tokens_out: totalTokensOut,
        cost: 0,
      });
      logger.info('[AgentRunner] Persisted partial assistant response (%d chars) on %s', fullAssistantText.length, reason);
    } catch (e) {
      logger.error('[AgentRunner] Failed to persist partial response: %s', (e as Error).message);
    }
  };

  if (fallbackChain.length === 0) {
    yield {
      event: 'error',
      data: {
        message: `No LLM provider available (requested: ${agentConfig.providerId})`,
        code: 'NO_PROVIDER',
      },
    };
    return;
  }

  // ── 7. Agentic loop ──────────────────────────────────────────────────────────
  // The ProgressChecker is the PRIMARY stop mechanism — it detects stalls,
  // loops, and budget exhaustion intelligently.  The hard cap is a safety net
  // only, set very high so legitimate complex work is never interrupted.
  const maxIterations = agentConfig.maxToolIterations ?? TOOL_LIMITS.MAX_TOOL_ITERATIONS;
  const progressChecker = new ProgressChecker({
    duplicateThreshold: 5,    // Sprint 80: 3 → 5 (more tolerance for retries)
    timeBudgetMs: 1_800_000,  // Sprint 80: 30min wall (was 10min) — runaway protection only
    // stallThreshold REMOVED (Sprint 80): was incorrectly stopping legitimate multi-step work
    // tokenBudget REMOVED (Sprint 80): redundant, was killing useful work early
  });
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const llmOptions: LLMOptions = {
      model: agentConfig.modelId,
      temperature: agentConfig.temperature,
      maxTokens: agentConfig.maxTokens,
      systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    };

    // ── 7a. Stream from provider (with fallback) ───────────────────────────────
    const pendingToolCalls: PendingToolCall[] = [];
    let iterationText = '';
    let iterationTokensIn = 0;
    let iterationTokensOut = 0;
    let finishReason: StreamChunk['type'] extends 'finish' ? string : string = 'stop';

    try {
      const stream = router.chatWithFallback(messages, llmOptions, fallbackChain);

      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          iterationText += chunk.text;
          fullAssistantText += chunk.text;
          // ── 7b. Text delta event ─────────────────────────────────────────
          yield { event: 'message.delta', data: { text: chunk.text } };
          if (ENABLE_MESSAGE_BUS) {
            messageBus.publish(sessionId, 'message.delta', { text: chunk.text ?? '', agentId: agentConfig.id ?? '' });
          }

        } else if (chunk.type === 'tool_call') {
          // ── 7b. Tool call detected ───────────────────────────────────────
          const tc = chunk.toolCall ?? { id: chunk.id ?? '', name: chunk.name ?? '', arguments: '{}' };
          let toolInput: Record<string, unknown> = {};
          try { toolInput = JSON.parse(tc.arguments); } catch { /* use empty */ }
          if (!toolInput || typeof toolInput !== 'object') {
            toolInput = ((chunk as unknown as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>;
          }
          pendingToolCalls.push({
            id: tc.id || chunk.id || '',
            name: tc.name || chunk.name || '',
            input: toolInput,
          });
          yield {
            event: 'tool.start',
            data: { id: chunk.id, name: chunk.name, input: toolInput },
          };

        } else if (chunk.type === 'usage') {
          iterationTokensIn += chunk.inputTokens ?? 0;
          iterationTokensOut += chunk.outputTokens ?? 0;

        } else if (chunk.type === 'finish') {
          const finishData = chunk as unknown as { reason?: string; finishReason?: string; tokensIn?: number; tokensOut?: number };
          const reason = finishData.reason ?? finishData.finishReason ?? 'stop';
          finishReason = reason;

          // Real providers emit tokensIn/tokensOut in the finish chunk (via chat-engine 'done' event)
          // Ollama emits separate 'usage' chunks (handled above)
          if (finishData.tokensIn) iterationTokensIn += finishData.tokensIn;
          if (finishData.tokensOut) iterationTokensOut += finishData.tokensOut;

          if (reason === 'error') {
            persistPartialResponse('provider-finish-error');
            yield {
              event: 'error',
              data: { message: 'Provider returned an error', code: 'PROVIDER_ERROR' },
            };
            return;
          }
        } else if (chunk.type === 'error') {
          // All providers exhausted or provider-level error
          const errMsg = (chunk as unknown as { error?: string }).error ?? 'Provider error';
          persistPartialResponse('provider-chunk-error');
          yield {
            event: 'error',
            data: { message: errMsg, code: 'PROVIDER_ERROR' },
          };
          return;
        }
      }
    } catch (err) {
      persistPartialResponse('stream-exception');
      yield {
        event: 'error',
        data: {
          message: `Provider streaming error: ${(err as Error).message}`,
          code: 'STREAM_ERROR',
        },
      };
      return;
    }

    totalTokensIn += iterationTokensIn;
    totalTokensOut += iterationTokensOut;

    // ── Sprint 80: recordTokens is a no-op stub (token budget removed) ───────────────────────────────
    progressChecker.recordTokens(iterationTokensIn, iterationTokensOut); // no-op

    // ── Sprint 80: Only time wall check (30min) — stall detection removed ────────────────────────────
    const progressCheck = progressChecker.fullCheck(iteration);
    if (progressCheck.shouldStop) {
      logger.warn(`[AgentRunner] Time wall reached: ${progressCheck.details}`);
      // Sprint 80: consolidation call — never leave user with empty response
      messages.push({
        role: 'user',
        content: `[SYSTEM] ${progressCheck.recommendation} Do NOT call any more tools.`,
      });
      const consolidateOptions: LLMOptions = {
        model: agentConfig.modelId,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        systemPrompt,
        tools: undefined,
      };
      try {
        const cStream = router.chatWithFallback(messages, consolidateOptions, fallbackChain);
        for await (const chunk of cStream) {
          if (chunk.type === 'text') {
            fullAssistantText += chunk.text;
            yield { event: 'message.delta', data: { text: chunk.text } };
          }
        }
      } catch (e) {
        logger.warn('[AgentRunner] Time-wall consolidation failed: %s', (e as Error).message);
      }
      break;
    }
    // ── 7c. No tool calls → done ───────────────────────────────────────────────
    if (pendingToolCalls.length === 0) {
      // Check for response loop
      if (iterationText) {
        const responseLoop = loopDetector.recordResponse(iterationText);
        if (responseLoop.loopDetected) {
          logger.warn(`[AgentRunner] Loop detected in session ${sessionId}: ${responseLoop.details}`);
          yield {
            event: 'message.delta',
            data: { text: `\n\n[Loop detected: ${responseLoop.details}. Stopping to prevent repetition.]` },
          };
          fullAssistantText += `\n\n[Loop detected: ${responseLoop.details}. Stopping to prevent repetition.]`;
        }
      }
      break;
    }

    // ── 7d. Check for tool call loops before executing ──────────────────────────
    let loopBroken = false;
    for (const tc of pendingToolCalls) {
      const toolLoop = loopDetector.recordToolCall(tc.name, tc.input);
      if (toolLoop.loopDetected) {
        logger.warn(`[AgentRunner] Tool loop in session ${sessionId}: ${toolLoop.details}`);
        yield {
          event: 'message.delta',
          data: { text: `\n\n[Loop detected: ${toolLoop.details}. Breaking loop.]` },
        };
        fullAssistantText += `\n\n[Loop detected: ${toolLoop.details}. Breaking loop.]`;
        loopBroken = true;
        break;
      }
      // Sprint 79: ProgressChecker duplicate tool check
      const dupCheck = progressChecker.recordToolCall(tc.name, tc.input);
      if (dupCheck.shouldStop) {
        logger.warn(`[AgentRunner] Duplicate tool detected: ${dupCheck.details}`);
        yield {
          event: 'message.delta',
          data: { text: `\n\n⚠️ ${dupCheck.recommendation}` },
        };
        fullAssistantText += `\n\n⚠️ ${dupCheck.recommendation}`;
        loopBroken = true;
        break;
      }
    }
    if (loopBroken) break;

    // ── 7e. Execute tools ──────────────────────────────────────────────────────

    // Append assistant message with tool_calls to working messages
    // (OpenAI format: content + tool_calls array; Anthropic providers translate)
    const assistantMessageWithToolCalls: LLMMessage = {
      role: 'assistant',
      content: iterationText || '',
    };
    // Attach tool_calls so the provider can send them back to the LLM
    (assistantMessageWithToolCalls as unknown as Record<string, unknown>).tool_calls = pendingToolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.input) },
    }));
    messages.push(assistantMessageWithToolCalls);

    // Execute each tool call and collect results
    const toolResultMessages: LLMMessage[] = [];

    for (const tc of pendingToolCalls) {
      const tool = toolsByName.get(tc.name);
      let resultContent: string;

      if (!tool) {
        resultContent = `ERROR: Tool "${tc.name}" not found in registry.`;
        yield {
          event: 'tool.finish',
          data: {
            id: tc.id,
            name: tc.name,
            output: resultContent,
            error: true,
          },
        };
      } else {
        try {
          const toolOutput = await tool.execute(tc.input, {
            sessionId,
            agentId: agentConfig.id,
          });
          resultContent = formatToolResult(toolOutput);
          yield {
            event: 'tool.finish',
            data: {
              id: tc.id,
              name: tc.name,
              output: resultContent,
              success: toolOutput.success,
            },
          };
        } catch (toolErr) {
          resultContent = `ERROR: Tool execution threw an exception: ${(toolErr as Error).message}`;
          yield {
            event: 'tool.finish',
            data: {
              id: tc.id,
              name: tc.name,
              output: resultContent,
              error: true,
            },
          };
        }
      }

      // Append tool result as a "tool" role message
      // Anti-fabrication v2: detect BOTH errors AND empty results from tools where
      // empty means "failed to find" (web_search, webfetch, browser) vs tools where
      // empty means "valid negative" (grep, glob, bash, read).
      const isError = resultContent.startsWith('ERROR:');
      const isEmpty = detectEmptyToolResult(tc.name, resultContent);
      let enforced = resultContent;

      if (isError) {
        enforced = `${resultContent}\n\n[SYSTEM] ⛔ TOOL "${tc.name}" FAILED. Report the exact error above to the user. Do NOT guess, infer, or reconstruct what the output might have been. Say "I could not [action] because [error]".`;
      } else if (isEmpty) {
        enforced = `${resultContent}\n\n[SYSTEM] ⛔ TOOL "${tc.name}" returned EMPTY/NO results. This means the search/fetch found nothing — NOT that results exist but weren't shown. You MUST tell the user: "I searched for [query] but found no results" or "I could not access [url]". Do NOT fabricate, guess, or invent results that were not returned. Do NOT describe content you did not receive.`;
      }

      toolResultMessages.push({
        role: 'tool',
        content: enforced,
        toolCallId: tc.id,
        name: tc.name,
      });
    }

    // Add tool results to working messages and continue loop
    messages.push(...toolResultMessages);

    // Sprint 80: consolidation call instead of silent break at maxIterations
    if (iteration === maxIterations - 1) {
      logger.warn(`[AgentRunner] Max iterations (${maxIterations}) reached — requesting consolidation`);
      messages.push({
        role: 'user',
        content: '[SYSTEM] You have reached the tool execution limit. Do NOT call any more tools. Consolidate EVERYTHING you have gathered so far into a final, complete response for the user. Deliver what you have.',
      });
      const finalOptions: LLMOptions = {
        model: agentConfig.modelId,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
        systemPrompt,
        tools: undefined,
      };
      try {
        const finalStream = router.chatWithFallback(messages, finalOptions, fallbackChain);
        for await (const chunk of finalStream) {
          if (chunk.type === 'text') {
            fullAssistantText += chunk.text;
            yield { event: 'message.delta', data: { text: chunk.text } };
          }
        }
      } catch (e) {
        logger.warn('[AgentRunner] Consolidation call failed: %s', (e as Error).message);
      }
      break;
    }
  } // end agentic loop

  // Sprint 79: Log progress summary
  const progressSummary = progressChecker.getSummary();
  logger.info(`[AgentRunner] Loop summary for session ${sessionId}: ${JSON.stringify(progressSummary)}`);

  // ── 8. Persist assistant message ─────────────────────────────────────────────
  const cost = estimateTokenCost(
    agentConfig.providerId,
    agentConfig.modelId,
    totalTokensIn,
    totalTokensOut,
  );

  try {
    sessionManager.addMessage(sessionId, {
      role: 'assistant',
      content: fullAssistantText,
      agent_id: agentConfig.id,
      agent_name: agentConfig.name ?? '',
      agent_emoji: (agentConfig as { emoji?: string }).emoji ?? '',
      sender_type: 'agent',
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      cost,
    });
  } catch (dbErr) {
    // Non-fatal: log but don't fail the stream
    logger.error('[AgentRunner] Failed to persist assistant message: %s', (dbErr as Error).message);
  }

  // ── 9. Finish event ───────────────────────────────────────────────────────────
  yield {
    event: 'message.finish',
    data: {
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      cost,
    },
  };
  if (ENABLE_MESSAGE_BUS) {
    messageBus.publish(sessionId, 'message.finish', {
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      cost,
    });
  }

  // ── 10. Background memory extraction (non-blocking) ───────────────────────
  // Extract durable facts from the user message + assistant response + tool outputs
  // Runs after the stream is done — never blocks the user
  try {
    // Collect tool result content from the working messages (Sprint 76: Item 3)
    const toolOutputTexts: string[] = [];
    for (const m of messages) {
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 30 && m.content.length < 5000) {
        // Skip error outputs and trivial results
        if (!m.content.startsWith('ERROR:') && !/^\s*\{?\s*"(ok|success)"\s*:\s*(true|false)\s*\}?\s*$/.test(m.content)) {
          toolOutputTexts.push(m.content);
        }
      }
    }
    const toolOutputSummary = toolOutputTexts.length > 0
      ? toolOutputTexts.slice(0, 5).join('\n---\n').slice(0, 8000)  // cap to 5 outputs, 8KB
      : '';

    backgroundMemoryExtract(
      agentConfig.id,
      sessionId,
      userMessage,
      fullAssistantText,
      toolOutputSummary,
    );
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] Background memory extraction failed (non-fatal)');
  }

  // ── 11. Session-end consolidation timer (Sprint 76) ───────────────────────
  // Resets a 10-min inactivity timer. If idle fires, runs LLM extraction of
  // the full session and stores durable facts in agent_memory.
  try {
    touchSession(agentConfig.id, sessionId);
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] Session consolidator touch failed (non-fatal)');
  }
}

// ─── Background Memory Extraction ─────────────────────────────────────────────

/**
 * backgroundMemoryExtract — Extract durable facts from a conversation turn.
 *
 * Sprint 67: Runs AFTER response delivery. Pattern-based extraction of:
 * - User preferences ("I prefer...", "I like...", "always/never...")
 * - Decisions ("decided to...", "will use...", "chosen approach...")
 * - Named entities ("my name is...", "I'm...", project/product names)
 * - Corrections ("actually...", "no, that's wrong...", "correction:...")
 * - Goals ("I want to...", "goal is...", "aiming for...")
 *
 * Non-blocking, non-fatal. Fires and forgets.
 */
function backgroundMemoryExtract(
  agentId: string,
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
  toolOutputs: string = '',
): void {
  // Run async but don't await — fire-and-forget
  void (async () => {
    try {
      const repo = new AgentMemoryRepository(getDb());
      const extractedCount = { preferences: 0, decisions: 0, entities: 0, corrections: 0, goals: 0 };

      // ── Extract from user message ──────────────────────────────────────────
      if (userMessage && userMessage.length > 10) {
        for (const line of userMessage.split(/[.\n]+/).filter(l => l.trim().length > 8)) {
          const lo = line.toLowerCase().trim();

          // Preferences — split positive vs negative (anti-preferences)
          // Negative patterns: "I never", "I don't like", "I hate", "please never", "I dislike"
          // These are stored as type 'correction' (aversion) rather than 'preference' so the
          // agent treats them as constraints to avoid, not things to repeat.
          // Sprint BugFix: Added PT-BR patterns for i18n support
          if (/(?:i prefer|i like|i always|i never|i want|favorite|please always|please never|don't like|i hate|i love|i dislike|eu prefiro|eu gosto|eu sempre|eu nunca|eu quero|favorito|por favor sempre|por favor nunca|não gosto|eu odeio|eu amo|eu adoro|eu detesto|prefiro)\b/i.test(lo)) {
            const isNegated = /(?:i never|don't like|i hate|please never|i dislike|i don't want|never want|avoid|i can't stand|eu nunca|não gosto|eu odeio|por favor nunca|eu detesto|não quero|nunca quero|evitar|eu não suporto)\b/i.test(lo);
            const key = `pref_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            if (isNegated) {
              // Store as correction/aversion — prefix value so LLM context is unambiguous
              repo.set(agentId, key, `[AVOID] ${line.trim().slice(0, 295)}`, 'correction', 0.95, undefined, {
                source: 'auto_extract', tags: ['from_user', 'anti_preference'],
              });
            } else {
              repo.set(agentId, key, line.trim().slice(0, 300), 'preference', 0.9, undefined, {
                source: 'auto_extract', tags: ['from_user'],
              });
            }
            extractedCount.preferences++;
          }

          // Corrections (EN + PT-BR)
          if (/(?:actually|no,? that's wrong|correction|that's incorrect|not right|you're wrong|i meant|na verdade|está errado|isso está errado|correção|isso não está certo|não está certo|você está errado|eu quis dizer|errado|tá errado)\b/i.test(lo)) {
            const key = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'correction', 1.0, undefined, {
              source: 'auto_extract', tags: ['from_user'],
            });
            extractedCount.corrections++;
          }

          // Goals (EN + PT-BR)
          if (/(?:i want to|my goal|i need to|aiming for|objective is|target is|mission is|eu quero|meu objetivo|eu preciso|mirando em|objetivo é|meta é|missão é|minha meta|quero conseguir)\b/i.test(lo) && lo.length < 300) {
            const key = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'goal', 0.85, undefined, {
              source: 'auto_extract', tags: ['from_user'],
            });
            extractedCount.goals++;
          }

          // Named entities (EN + PT-BR)
          const nameMatch = line.match(/(?:my name is|i'm called|i am|call me|meu nome é|me chamo|eu sou o|eu sou a|pode me chamar de|me chamam de)\s+([A-Z\u00C0-\u017F][a-zA-Z\u00C0-\u017F]+(?:\s+[A-Z\u00C0-\u017F][a-zA-Z\u00C0-\u017F]+)?)/i);
          if (nameMatch) {
            repo.set(agentId, `entity_user_name`, nameMatch[1].trim(), 'entity', 1.0, undefined, {
              source: 'auto_extract', tags: ['from_user'],
            });
            extractedCount.entities++;
          }
        }
      }

      // ── Extract from assistant response (decisions, facts) ─────────────────
      if (assistantResponse && assistantResponse.length > 20) {
        for (const line of assistantResponse.split(/[.\n]+/).filter(l => l.trim().length > 15)) {
          const lo = line.toLowerCase().trim();

          // Decisions (from assistant response = confirmed decisions) (EN + PT-BR)
          if (/(?:decided to|will use|chosen approach|going with|opted for|confirmed|agreed on|decidi usar|vou usar|abordagem escolhida|optei por|confirmado|concordamos|decidimos|vamos com|escolhi)\b/i.test(lo) && lo.length < 300) {
            const key = `decision_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'decision', 0.85, undefined, {
              source: 'auto_extract', tags: ['from_assistant'],
            });
            extractedCount.decisions++;
          }
        }
      }

      // ── Extract from tool outputs (Sprint 76 Item 3) ───────────────────────
      // Only extract genuinely meaningful facts from tool outputs.
      // Quality gates: must be informational (not code/logs), reasonable length, no ANSI escapes
      if (toolOutputs && toolOutputs.length > 30) {
        const toolLines = toolOutputs.split(/\n/).filter(l => l.trim().length > 30 && l.trim().length < 200);
        let toolExtracted = 0;
        const MAX_TOOL_FACTS = 3; // cap per extraction to prevent pollution
        for (const line of toolLines) {
          if (toolExtracted >= MAX_TOOL_FACTS) break;
          const trimmed = line.trim();
          const lo = trimmed.toLowerCase();

          // Skip noise: ANSI codes, stack traces, code fragments, SQL, timestamps, CI output
          if (/\x1b\[|\.run\(|\.prepare\(|\.exec\(|INSERT INTO|SELECT |UPDATE |DELETE FROM|CREATE |DROP |TRIGGER|require\(|import |export |function |const |let |var |=> |\.js:|\.ts:|node_modules|Duration |Tests |Test Files /i.test(trimmed)) continue;
          // Skip if it looks like a code line (starts with common code patterns)
          if (/^[\s]*[{}\[\]();]|^\/\/|^#|^\*|^-{2,}|^={2,}|^\|/.test(trimmed)) continue;

          // Only extract truly informational lines about system state
          if (/(?:version|v\d+\.\d+\.\d+|status|running on port|installed successfully|configured|enabled|disabled)\b/i.test(lo)) {
            const key = `tool_fact_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, trimmed.slice(0, 200), 'fact', 0.75, undefined, {
              source: 'auto_extract_tool', tags: ['from_tool_output'],
            });
            toolExtracted++;
            extractedCount.goals++; // reuse counter
          }
        }
      }

      // ── Log extraction episode ─────────────────────────────────────────────
      const total = Object.values(extractedCount).reduce((a, b) => a + b, 0);
      if (total > 0) {
        repo.logEpisode({
          sessionId,
          agentId,
          type: 'extraction',
          content: `Auto-extracted ${total} memories: ${JSON.stringify(extractedCount)}`,
          eventAt: new Date().toISOString(),
          metadata: extractedCount,
        });
        logger.info('[MemoryExtract] Session %s: extracted %d items %j', sessionId, total, extractedCount);
      }
    } catch (err) {
      logger.warn('[MemoryExtract] Background extraction failed: %s', (err as Error).message);
    }
  })();
}

// ─── Helper: Serialize SSE events to wire format ──────────────────────────────

/**
 * serializeSSE — converts an SSEEvent to the raw `text/event-stream` wire format.
 *
 * Usage in an Express / Hono / Fastify handler:
 *   for await (const evt of runAgent(sessionId, msg, config)) {
 *     res.write(serializeSSE(evt));
 *   }
 */
export function serializeSSE(evt: SSEEvent): string {
  return `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}
