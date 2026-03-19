/**
 * engine/llm-compactor.ts — LLM-powered context compaction
 *
 * When context window overflows, uses a cheap model to:
 * 1. Summarize the conversation so far
 * 2. Extract durable facts, decisions, preferences
 * 3. Return structured output for storage in agent_memory
 *
 * Falls back to heuristic extraction if no LLM is available.
 * Uses smart-router to pick the cheapest qualified model.
 */

import { logger } from '../lib/logger.js';
import type { ProviderRepository } from '../db/index.js';
import { getSystemModel } from './smart-router.js';
import { streamChat, type ChatMessage, type StreamDelta } from './chat-engine.js';
import { resolveProviderBaseUrl, resolveProviderType } from '../config/defaults.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CompactionResult {
  summary: string;
  facts: Array<{ type: string; key: string; value: string }>;
  method: 'llm' | 'heuristic';
  model?: string;
  tokensUsed?: number;
}

// ─── LLM Compaction ─────────────────────────────────────────────────────────────

const COMPACTION_PROMPT = `You are a memory compaction system. Given a conversation history, produce a JSON response with:

1. "summary": A concise summary (2-4 sentences) of what was discussed and accomplished.
2. "facts": An array of durable facts extracted from the conversation. Each fact has:
   - "type": one of "decision", "preference", "correction", "fact", "entity", "goal", "procedure", "event"
   - "key": short identifier (snake_case)
   - "value": the fact content (1-2 sentences max)

Important extraction rules:
- For PREFERENCES: capture both positive ("prefers X") and negative ("dislikes Y", "never wants Z").
  Use type "correction" with value starting "[AVOID]" for negative preferences.
- For DECISIONS: capture what was decided AND why (rationale matters for future context).
- For ENTITIES: names, project names, tools, services mentioned as important.
- Skip: greetings, filler, already-known information, temporary states, routine acknowledgments.

Respond with ONLY valid JSON, no markdown fences, no extra text.`;

/**
 * Compact messages using LLM summarization.
 * Returns null if LLM is unavailable (caller should fall back to heuristic).
 */
export async function llmCompact(
  messages: Array<{ role: string; content: string }>,
  providers: ProviderRepository,
): Promise<CompactionResult | null> {
  // Pick cheapest model that meets standard quality (compaction = standard tier)
  const modelResult = getSystemModel('compaction', providers);
  if (!modelResult) {
    logger.info('[LLMCompactor] No model available for compaction');
    return null;
  }

  if (!modelResult.meetsFloor) {
    logger.warn('[LLMCompactor] %s', modelResult.qualityWarning);
    // Still proceed — better than nothing, but log the warning
  }

  // Build conversation text (truncate to ~4K tokens worth)
  const MAX_CHARS = 16_000;
  let conversationText = '';
  for (const msg of messages) {
    const line = `[${msg.role}]: ${msg.content}\n`;
    if (conversationText.length + line.length > MAX_CHARS) break;
    conversationText += line;
  }

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: COMPACTION_PROMPT },
    { role: 'user', content: conversationText },
  ];

  // Resolve provider config
  const providerConfig = providers.getUnmasked(modelResult.providerId) ?? providers.list().find(p => p.id === modelResult.providerId);
  if (!providerConfig) return null;

  const providerType = resolveProviderType(modelResult.providerId, providerConfig.type);
  const baseUrl = resolveProviderBaseUrl(modelResult.providerId, providerConfig.baseUrl);

  try {
    // Collect full response
    let fullText = '';
    let tokensIn = 0;
    let tokensOut = 0;

    for await (const delta of streamChat(chatMessages, {
      providerType: providerType,
      model: modelResult.modelId,
      baseUrl,
      apiKey: ('rawApiKey' in providerConfig ? (providerConfig as Record<string, unknown>).rawApiKey as string : providerConfig.apiKey) ?? '',
      maxTokens: 2000,
      temperature: 0.1,
    })) {
      if (delta.type === 'delta' && delta.content) {
        fullText += delta.content;
      }
      if (delta.type === 'done') {
        tokensIn = delta.tokensIn ?? 0;
        tokensOut = delta.tokensOut ?? 0;
      }
    }

    if (!fullText.trim()) return null;

    // Parse JSON response
    const parsed = parseCompactionResponse(fullText);
    if (!parsed) {
      logger.warn('[LLMCompactor] Failed to parse LLM response, falling back');
      return null;
    }

    return {
      summary: parsed.summary,
      facts: parsed.facts,
      method: 'llm',
      model: modelResult.modelId,
      tokensUsed: tokensIn + tokensOut,
    };
  } catch (err) {
    logger.warn('[LLMCompactor] LLM call failed: %s', (err as Error).message);
    return null;
  }
}

// ─── Response Parsing ───────────────────────────────────────────────────────────

function parseCompactionResponse(text: string): {
  summary: string;
  facts: Array<{ type: string; key: string; value: string }>;
} | null {
  // Try multiple extraction strategies (LLMs are inconsistent with format)

  // Strategy 1: Direct JSON parse (clean response)
  const result = tryParseJson(text.trim());
  if (result) return result;

  // Strategy 2: Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const result2 = tryParseJson(fenceMatch[1].trim());
    if (result2) return result2;
  }

  // Strategy 3: Find first { ... } block (LLM added preamble/epilogue)
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    const result3 = tryParseJson(braceMatch[0]);
    if (result3) return result3;
  }

  logger.warn('[LLMCompactor] All parse strategies failed. Raw response (first 200 chars): %s', text.slice(0, 200));
  return null;
}

/** Attempt to parse JSON and validate the compaction schema. */
function tryParseJson(text: string): {
  summary: string;
  facts: Array<{ type: string; key: string; value: string }>;
} | null {
  try {
    const json = JSON.parse(text);

    if (typeof json.summary !== 'string') return null;
    if (!Array.isArray(json.facts)) return null;

    const validTypes = new Set(['decision', 'preference', 'fact', 'entity', 'goal', 'procedure', 'correction', 'event']);
    const facts = json.facts
      .filter((f: Record<string, unknown>) => f && typeof f.type === 'string' && typeof f.key === 'string' && typeof f.value === 'string')
      .filter((f: Record<string, unknown>) => validTypes.has(f.type as string))
      .slice(0, 20);

    return { summary: json.summary.slice(0, 1000), facts };
  } catch {
    return null;
  }
}
