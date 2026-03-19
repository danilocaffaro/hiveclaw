# ENGINE-V2-BLUEPRINT.md — Migration to Provider-Native Tool Loop

> **Author:** Alice 🐕 + Adler 🦊 | **Date:** 2026-03-18
> **Updated:** 2026-03-19 (Adler review — 3 adjustments applied)
> **Status:** PLANNING (no code changes)
> **Consensus:** 100% (Alice + Adler)

---

## Problem Statement

HiveClaw's `agent-runner.ts` implements a manual agentic loop that reimplements
what LLM providers (Anthropic, OpenAI) already handle natively. This causes:

1. **Fragile tool calling** — manual parsing, executing, and re-injecting tool results
2. **Mutable shared state** — `messages[]`, `fullAssistantText`, `iterationText`, `pendingToolCalls` shared across iterations
3. **Provider quirk leakage** — Copilot's "Summarize progress" truncation, different finish_reason semantics
4. **Tool errors not forced** — LLM can ignore failed tool results (provider-native loop prevents this)

## Target Architecture

### Phase 1: Provider Adapter Layer (~3-5 days)

Each provider gets its own adapter that handles quirks internally:

```
┌─────────────────────────┐
│    agent-runner.ts v2    │  ← thin orchestrator
│  (stateless per turn)    │
└────────────┬────────────┘
             │
    ┌────────▼────────┐
    │ Provider Adapter │  ← handles tool loop natively
    │   (per-provider) │
    ├─────────────────┤
    │ AnthropicAdapter │  → uses Messages API with tool_use
    │ CopilotAdapter   │  → see Copilot Strategy below
    │ OpenAIAdapter    │  → uses Responses API / function calling
    │ OllamaAdapter    │  → uses chat completion with tools
    └─────────────────┘
```

Each adapter:
- Accepts `(systemPrompt, messages, tools, config)` 
- Returns `AsyncGenerator<AgentEvent>` (text, tool_call, tool_result, finish, error)
- Handles its own tool execution loop internally (or delegates to provider)
- Normalizes all events to a common format
- Owns its quirks (truncation detection, token exchange, etc.)

**Done when:** Clark runs 30 sessions with Anthropic + OpenAI without quirk
leakage errors. Provider-specific behaviors are invisible to agent-runner v2.

### Phase 2: Native Tool Loop (~5-7 days)  ← moved up per Adler review

> **Rationale (Adler 🦊):** This phase resolves structural problems #1, #2, #5 —
> the most critical bugs. Immutable Pipeline (Phase 3) is quality improvement,
> not bug correction. If timeline compresses, we want the critical fixes shipped first.

For providers that support it (Anthropic, OpenAI), let the provider manage the
tool_use → tool_result → continue cycle:

```
User message
    │
    ▼
Provider.chat(messages, tools)
    │
    ├─→ tool_use("bash", {cmd: "ls"})
    │       │
    │       ▼ (we execute locally)
    │   tool_result: "file1.ts\nfile2.ts"
    │       │
    │       ▼ (send back to provider)
    ├─→ tool_use("read", {path: "file1.ts"})
    │       │
    │       ▼
    │   tool_result: "export const..."
    │       │
    │       ▼
    └─→ end_turn: "I found two files..."
```

The provider handles:
- When to use tools vs respond
- How to process tool results
- Context management within the turn
- Error handling for tool failures

We handle:
- Actually executing the tools (sandboxing, timeouts)
- Streaming events to the UI
- Persisting the conversation log
- Safety guardrails (loop detection as a safety net, not primary control)

**Done when:** Truncation pattern rate = 0 in 50 long sessions (zero occurrences
of the `⚠️ Summarize progress...` pattern). Manual agentic `for` loop removed for
providers that support native tool_use.

### Phase 3: Immutable Message Pipeline (~2-3 days)  ← moved down per Adler review

Replace mutable `messages[]` with an immutable conversation log:

```typescript
interface ConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly toolResults?: ReadonlyArray<ToolResult>;
  readonly timestamp: number;
}

// Each iteration builds a NEW array from the log, never mutates in place
function buildContextWindow(log: ConversationTurn[], budget: number): Message[] {
  // Apply pruning, trimming, and budget constraints
  // Return a fresh array for the provider call
}
```

Benefits:
- No more `iterationText = ''` reset bugs
- No more text leaking between iterations
- Each provider call gets a clean, budget-fitted context
- Easy to add caching/replay

**Done when:** Zero `iterationText = ''` resets in code. Lint rule prohibiting
direct mutation of `messages[]`. All message array construction goes through
`buildContextWindow()`.

## Copilot Strategy (resolved — spike test completed)

> **Spike test date:** 2026-03-18 21:20 | **Result:** Opção A confirmed ✅

### Findings

The Copilot proxy (api.enterprise.githubcopilot.com) supports native tool_use
**via streaming only**. Non-streaming (`stream: false`) returns `finish_reason:
tool_calls` but **does NOT include the `tool_calls` array** in the message object.

Since HiveClaw uses `streamChat()` (always streaming), this is fully compatible.

### Spike Results (4/4 PASS)

| Test | Result | Details |
|------|--------|---------|
| Basic cycle | ✅ | tool_use → tool_result → final response, clean |
| Large output (14KB) | ✅ | Zero truncation, zero ⚠️ pattern |
| 3 parallel tool calls | ✅ | Tokyo + London + web search, all resolved in one turn |
| Tool error result | ✅ | ENOENT error acknowledged, no crash/fabrication |

### Decision: Opção A — Native tool_use via streaming

CopilotAdapter uses the same native tool loop as AnthropicAdapter and OpenAIAdapter.
No encapsulated manual loop needed. Sprint 80 truncation detection becomes a safety
net (kept but expected to never trigger).

**Critical constraint:** CopilotAdapter MUST use `stream: true` — non-streaming
tool_calls are broken on the Copilot proxy.

### Eliminated risk from original blueprint

| Original risk | Status |
|--------------|--------|
| "Copilot proxy behavior unknown for native loop" | **RESOLVED** — empirically validated |
| "Copilot adapter may need manual loop internally" | **ELIMINATED** — native loop works |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Provider API differences | Adapter pattern isolates quirks |
| Ollama may not support native tool loop | Keep manual loop as fallback for basic providers |
| Lost granular control over iterations | Safety guardrails (time wall, loop detection) still apply as outer guards |
| Migration breaks existing agents | Feature flag: `engine_v2: true` per agent, gradual rollout |
| Copilot proxy behavior changes | Spike-validated streaming tool_use; Sprint 80 detection kept as safety net |

## Migration Strategy

1. **Keep agent-runner.ts v1 intact** — no modifications
2. **Build v2 as `agent-runner-v2.ts`** alongside
3. **Feature flag** in agent config: `engineVersion: 1 | 2`
4. **Default new agents to v2**, existing agents stay v1
5. **Remove v1 after 30 days** of stable v2 operation

## Acceptance Criteria (per phase)

| Phase | Done when... |
|-------|-------------|
| 1 — Adapters | Clark runs 30 sessions with Anthropic + OpenAI without quirk leakage |
| 2 — Native Tool Loop | Truncation rate = 0 in 50 long sessions; zero `⚠️ Summarize progress` occurrences |
| 3 — Immutable Pipeline | Zero `iterationText = ''` resets; lint rule prohibiting direct `messages[]` mutation |
| Migration | 100% of agents on v2 for 30 days without regression |

## Effort Estimate (reordered)

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 1: Provider Adapters | 3-5 days | None |
| Phase 2: Native Tool Loop | 5-7 days | Phase 1 |
| Phase 3: Immutable Pipeline | 2-3 days | Phase 1 |
| Testing + Migration | 3-5 days | All phases |
| **Total** | **13-20 days** | — |

> **Note:** Phases 2 and 3 depend on Phase 1 but are independent of each other.
> Phase 2 is prioritized because it resolves critical bugs (#1, #2, #5).
> Phase 3 can be done in parallel or after Phase 2.

## R20 Hardening as Bridge

The R20 fixes (token cache, retry, context pruning, graduated loop detection,
session mutex, error acknowledgment) serve as a **bridge** to Engine v2:

- They make v1 more robust for the 2-4 weeks until v2 is ready
- They establish patterns that v2 will formalize (pruning → immutable pipeline, graduated detection → safety guardrails)
- They can be removed once v2 subsumes their functionality

## OpenClaw Reference Architecture (Adler's insight)

> **Source:** Reverse-engineered from `/opt/homebrew/lib/node_modules/openclaw/dist/`
> **Key insight (Adler 🦊):** "We are OpenClaw agents running Copilot with native
> tool_use in every conversation. What Engine v2 wants to implement already works —
> not as hypothesis, as observable fact. The right approach is to reverse engineer
> OpenClaw and replicate what they've already solved."

### How OpenClaw Handles the Tool Loop

OpenClaw does NOT have a manual agentic loop. Instead:

1. **SDK-level tool_use**: Uses Vercel AI SDK which handles `tool_use → tool_result →
   continue` natively for all providers (Anthropic, OpenAI, Copilot via proxy).

2. **Hook-based loop detection**: `wrapToolWithBeforeToolCallHook()` intercepts each
   tool call BEFORE execution:
   - Calls `detectToolCallLoop()` with 3 detectors: `genericRepeat`, `knownPollNoProgress`, `pingPong`
   - `warning` level: logs + emits warning (doesn't block)
   - `critical` level: throws error → blocks tool execution
   - Records outcome via `recordToolCallOutcome()` for no-progress detection

3. **Copilot token management**: `resolveCopilotApiToken()` with disk-based cache
   (`github-copilot.token.json`), `isTokenUsable()` with 5min margin,
   `deriveCopilotApiBaseUrlFromToken()` parsing `proxy-ep=` from token string.

4. **Graduated thresholds**: WARNING=10, CRITICAL=20, CIRCUIT_BREAKER=30
   (vs HiveClaw R20.2b: WARNING=3, INJECT=5, CIRCUIT_BREAKER=8)

### What to Port to HiveClaw Engine v2

| OpenClaw Pattern | HiveClaw Phase | Notes |
|-----------------|----------------|-------|
| SDK handles tool loop | Phase 2 | Use streaming + manual tool execution cycle |
| Hook-based detection | Phase 1 | Wrap tool execution with `beforeToolCall` |
| 3 detectors (repeat/poll/pingpong) | Phase 1 | Port `detectToolCallLoop()` |
| Outcome tracking | Phase 1 | Port `recordToolCallOutcome()` for no-progress |
| Token disk cache | Already done (R20.1a) | HiveClaw uses in-memory; could upgrade to disk |
| `proxy-ep=` baseUrl derivation | Phase 1 | Port `deriveCopilotApiBaseUrlFromToken()` |

### Key Files in OpenClaw (for reference)

```
dist/tool-loop-detection-B0_Mp2Go.js  — 3 detectors, graduated thresholds (14KB)
dist/reply-Deht_wOB.js:63660-63800   — beforeToolCall hook wiring
dist/github-copilot-token-2ggfYP8J.js — token cache + baseUrl derivation
```

### Implementation Approach Change (Adler)

Instead of inventing the CopilotAdapter from scratch:
1. **Extract** patterns from OpenClaw's working implementation
2. **Port** to HiveClaw's architecture (no SDK dependency — we use raw HTTP streaming)
3. **Validate** with the same 30/50 session acceptance criteria

This likely reduces Phase 2 effort estimate from 5-7 days to 3-5 days.

## Decision Required

- [ ] **Danilo**: Approve timeline (13-20 days) for Engine v2
- [ ] **Danilo**: Priority vs other features (R21+ backlog)
- [ ] **Danilo**: Feature flag approach acceptable?
