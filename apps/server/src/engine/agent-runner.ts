// ============================================================
// Agent Runner — The core agentic loop for SuperClaw
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

// ─── SSE Event Types ──────────────────────────────────────────────────────────

export interface SSEEvent {
  event:
    | 'message.start'
    | 'message.delta'
    | 'message.finish'
    | 'tool.start'
    | 'tool.finish'
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
import { TOOL_LIMITS } from '../config/defaults.js';

// ─── Core agentic loop ────────────────────────────────────────────────────────

export async function* runAgent(
  sessionId: string,
  userMessage: string,
  agentConfig: AgentConfig,
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

  // ── 2. Save user message ────────────────────────────────────────────────────
  try {
    sessionManager.addMessage(sessionId, { role: 'user', content: userMessage });
  } catch (err) {
    yield {
      event: 'error',
      data: { message: `Failed to persist user message: ${(err as Error).message}`, code: 'DB_ERROR' },
    };
    return;
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
    `platform=SuperClaw Pure`,
  ];
  const runtimeLine = `Runtime: ${runtimeParts.join(' | ')}`;
  const toolsList = toolNames.length > 0
    ? `\nAvailable tools: ${toolNames.join(', ')}. Use them proactively — you have real access to web, files, code execution, memory, and more. Never claim you lack capabilities that your tools provide.`
    : '';
  const runtimeContext = `\n\n## Runtime\n${runtimeLine}${toolsList}`;
  systemPrompt = systemPrompt + runtimeContext;

  // ── 3. Build messages array ─────────────────────────────────────────────────
  // Re-read messages after potential compaction
  const freshMessages = sessionManager.getMessages(sessionId);
  // History (without the system message — that goes into LLMOptions.systemPrompt)
  const historyMessages = historyToLLMMessages(freshMessages);

  // Working messages list — mutable during the agentic loop
  // freshMessages already includes the user message saved in step 2
  const messages: LLMMessage[] = [...historyMessages];

  // ── 5. Signal start ──────────────────────────────────────────────────────────
  yield { event: 'message.start', data: { sessionId, agentId: agentConfig.id } };

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
  const maxIterations = agentConfig.maxToolIterations ?? TOOL_LIMITS.MAX_TOOL_ITERATIONS;
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
          const reason = (chunk as unknown as { reason?: string; finishReason?: string }).reason ?? (chunk as unknown as { finishReason?: string }).finishReason ?? 'stop';
          finishReason = reason;

          if (reason === 'error') {
            yield {
              event: 'error',
              data: { message: 'Provider returned an error', code: 'PROVIDER_ERROR' },
            };
            return;
          }
        } else if (chunk.type === 'error') {
          // All providers exhausted or provider-level error
          const errMsg = (chunk as unknown as { error?: string }).error ?? 'Provider error';
          yield {
            event: 'error',
            data: { message: errMsg, code: 'PROVIDER_ERROR' },
          };
          return;
        }
      }
    } catch (err) {
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
      toolResultMessages.push({
        role: 'tool',
        content: resultContent,
        toolCallId: tc.id,
        name: tc.name,
      });
    }

    // Add tool results to working messages and continue loop
    messages.push(...toolResultMessages);

    // Guard: if we've hit the max, break before the next LLM call
    if (iteration === maxIterations - 1) {
      yield {
        event: 'message.delta',
        data: { text: '\n\n[Max tool iterations reached. Stopping.]' },
      };
      fullAssistantText += '\n\n[Max tool iterations reached. Stopping.]';
      break;
    }
  } // end agentic loop

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

  // ── 10. Background memory extraction (non-blocking) ───────────────────────
  // Extract durable facts from the user message + assistant response
  // Runs after the stream is done — never blocks the user
  try {
    backgroundMemoryExtract(
      agentConfig.id,
      sessionId,
      userMessage,
      fullAssistantText,
    );
  } catch (e) {
    logger.debug({ err: e }, '[agent-runner] Background memory extraction failed (non-fatal)');
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
          if (/(?:i prefer|i like|i always|i never|i want|favorite|please always|please never|don't like|i hate|i love|i dislike)\b/i.test(lo)) {
            const isNegated = /(?:i never|don't like|i hate|please never|i dislike|i don't want|never want|avoid|i can't stand)\b/i.test(lo);
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

          // Corrections
          if (/(?:actually|no,? that's wrong|correction|that's incorrect|not right|you're wrong|i meant)\b/i.test(lo)) {
            const key = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'correction', 1.0, undefined, {
              source: 'auto_extract', tags: ['from_user'],
            });
            extractedCount.corrections++;
          }

          // Goals
          if (/(?:i want to|my goal|i need to|aiming for|objective is|target is|mission is)\b/i.test(lo) && lo.length < 300) {
            const key = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'goal', 0.85, undefined, {
              source: 'auto_extract', tags: ['from_user'],
            });
            extractedCount.goals++;
          }

          // Named entities
          const nameMatch = line.match(/(?:my name is|i'm called|i am|call me)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i);
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

          // Decisions (from assistant response = confirmed decisions)
          if (/(?:decided to|will use|chosen approach|going with|opted for|confirmed|agreed on)\b/i.test(lo) && lo.length < 300) {
            const key = `decision_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            repo.set(agentId, key, line.trim().slice(0, 300), 'decision', 0.7, undefined, {
              source: 'auto_extract', tags: ['from_assistant'],
            });
            extractedCount.decisions++;
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
