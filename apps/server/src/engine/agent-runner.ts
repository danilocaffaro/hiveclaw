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

/** Very rough cost estimate (USD) — providers should ideally surface real pricing */
function estimateCost(
  providerId: string,
  modelId: string,
  tokensIn: number,
  tokensOut: number,
): number {
  // Pricing per 1M tokens (USD) — updated 2026-03
  const pricingMap: Record<string, { in: number; out: number }> = {
    // Anthropic
    'claude-opus-4-5': { in: 15.0, out: 75.0 },
    'claude-opus-4': { in: 15.0, out: 75.0 },
    'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
    'claude-sonnet-4': { in: 3.0, out: 15.0 },
    'claude-3-5-sonnet': { in: 3.0, out: 15.0 },
    'claude-3-5-sonnet-20241022': { in: 3.0, out: 15.0 },
    'claude-3-5-haiku': { in: 0.8, out: 4.0 },
    'claude-3-5-haiku-20241022': { in: 0.8, out: 4.0 },
    'claude-haiku-4-5': { in: 0.8, out: 4.0 },
    'claude-3-opus': { in: 15.0, out: 75.0 },
    // OpenAI
    'gpt-4o': { in: 2.5, out: 10.0 },
    'gpt-4o-2024-11-20': { in: 2.5, out: 10.0 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gpt-4-turbo': { in: 10.0, out: 30.0 },
    'gpt-4': { in: 30.0, out: 60.0 },
    'gpt-3.5-turbo': { in: 0.5, out: 1.5 },
    'o1': { in: 15.0, out: 60.0 },
    'o1-mini': { in: 3.0, out: 12.0 },
    'o1-pro': { in: 150.0, out: 600.0 },
    'o3': { in: 10.0, out: 40.0 },
    'o3-mini': { in: 1.1, out: 4.4 },
    'o4-mini': { in: 1.1, out: 4.4 },
    // Google
    'gemini-2.5-pro': { in: 1.25, out: 10.0 },
    'gemini-2.5-flash': { in: 0.15, out: 0.6 },
    'gemini-2.0-flash': { in: 0.1, out: 0.4 },
    'gemini-1.5-pro': { in: 1.25, out: 5.0 },
    'gemini-1.5-flash': { in: 0.075, out: 0.3 },
    // DeepSeek
    'deepseek-chat': { in: 0.27, out: 1.1 },
    'deepseek-reasoner': { in: 0.55, out: 2.19 },
    // Groq
    'llama-3.3-70b': { in: 0.59, out: 0.79 },
    'llama-3.1-8b': { in: 0.05, out: 0.08 },
    'mixtral-8x7b': { in: 0.24, out: 0.24 },
    // Mistral
    'mistral-large': { in: 2.0, out: 6.0 },
    'mistral-small': { in: 0.2, out: 0.6 },
    'codestral': { in: 0.3, out: 0.9 },
  };

  // Exact match first
  let pricing = pricingMap[modelId];

  // Fuzzy match: try partial/substring match
  if (!pricing) {
    const modelLower = modelId.toLowerCase();
    for (const [key, val] of Object.entries(pricingMap)) {
      if (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)) {
        pricing = val;
        break;
      }
    }
  }

  // Provider-level fallback
  if (!pricing) {
    const provLower = providerId.toLowerCase();
    if (provLower.includes('anthropic') || provLower.includes('claude')) {
      pricing = { in: 3.0, out: 15.0 }; // Sonnet as default
    } else if (provLower.includes('openai') || provLower.includes('gpt')) {
      pricing = { in: 2.5, out: 10.0 }; // GPT-4o as default
    } else if (provLower.includes('google') || provLower.includes('gemini')) {
      pricing = { in: 1.25, out: 10.0 }; // Gemini 2.5 Pro as default
    }
  }

  if (!pricing) return 0;

  return (tokensIn / 1_000_000) * pricing.in + (tokensOut / 1_000_000) * pricing.out;
}

// ─── Core agentic loop ────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 10;

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
    sessionManager.smartCompact(sessionId);
  } catch {
    // Non-fatal — continue with full history if compaction fails
  }

  // ── 2.6 Inject agent memory context ─────────────────────────────────────────
  let systemPrompt = agentConfig.systemPrompt;
  try {
    const memoryRepo = new AgentMemoryRepository(getDb());
    const memoryContext = memoryRepo.getContextString(agentConfig.id);
    if (memoryContext) {
      systemPrompt = `${agentConfig.systemPrompt}\n\n## Agent Memory\n${memoryContext}`;
    }
  } catch {
    // Non-fatal — continue without memory injection
  }

  // ── 3. Build messages array ─────────────────────────────────────────────────
  // Re-read messages after potential compaction
  const freshMessages = sessionManager.getMessages(sessionId);
  // History (without the system message — that goes into LLMOptions.systemPrompt)
  const historyMessages = historyToLLMMessages(freshMessages);

  // Working messages list — mutable during the agentic loop
  // freshMessages already includes the user message saved in step 2
  const messages: LLMMessage[] = [...historyMessages];

  // ── 4. Prepare tools ─────────────────────────────────────────────────────────
  const { tools: enabledTools, byName: toolsByName } = getToolsForAgent(agentConfig.tools);
  const toolDefs = toolsToLLMDefinitions(enabledTools);

  // ── 5. Signal start ──────────────────────────────────────────────────────────
  yield { event: 'message.start', data: { sessionId, agentId: agentConfig.id } };

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
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
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
          const toolInput = ((chunk as unknown as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>;
          pendingToolCalls.push({
            id: chunk.id ?? '',
            name: chunk.name ?? '',
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
      break;
    }

    // ── 7c. Execute tools ──────────────────────────────────────────────────────

    // Append assistant message with tool_calls to working messages
    // (OpenAI format: content + tool_calls array; Anthropic providers translate)
    const assistantMessageWithToolCalls: LLMMessage = {
      role: 'assistant',
      content: iterationText || '',
    };
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
    if (iteration === MAX_TOOL_ITERATIONS - 1) {
      yield {
        event: 'message.delta',
        data: { text: '\n\n[Max tool iterations reached. Stopping.]' },
      };
      fullAssistantText += '\n\n[Max tool iterations reached. Stopping.]';
      break;
    }
  } // end agentic loop

  // ── 8. Persist assistant message ─────────────────────────────────────────────
  const cost = estimateCost(
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
