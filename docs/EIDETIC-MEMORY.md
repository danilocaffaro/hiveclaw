# Eidetic Memory v2 — Architecture Documentation

> HiveClaw's intelligent memory system. Preserves information with fidelity
> across sessions while keeping context efficient.

## Core Principle

> **Short-term memory = compacted for efficiency.**
> **Long-term memory = complete and faithful. Never lose the original.**

The longer ago something happened, the more important it is to have the
faithful, uncompacted record. Compaction serves working memory — not history.

---

## Memory Layers

### L1 — Core Memory (Permanent)

**Table:** `core_memory_blocks`
**Scope:** Per-agent, permanent
**Content:** Persona, identity, user notes, project context, scratchpad

Core memory is always injected into every LLM call. It defines *who the agent is*.

| Block    | Purpose                         |
|----------|---------------------------------|
| persona  | Agent identity and personality  |
| human    | Information about the user      |
| project  | Current project context         |
| scratchpad | Agent's working notes          |

---

### L2 — Buffer (Session Scope)

**Table:** `messages`
**Scope:** Current session
**Content:** Recent conversation messages

The active conversation window. Grows naturally as the conversation progresses.
Managed by the Token Monitor — when context approaches model limits, triggers
extraction and session rotation.

**Key behaviors:**
- Messages stay complete while they fit in the context window
- Tool outputs preserved in full for recent messages
- No aggressive compaction — richness is valued while it fits

---

### L3 — Working Memory (Cross-Session)

**Table:** `working_memory`
**Scope:** Per-agent + per-session, survives compaction
**Content:** Current task state — compacted for quick reference

Working memory captures the *state of what's being done*:
- Active goals
- Completed steps
- Next actions
- Open questions
- Pending context

This is the ONLY layer where compaction is expected. Working memory is
a summary — not a historical record.

---

### L4 — Graph Memory (Structured Knowledge)

**Table:** `agent_memory` + `memory_edges`
**Scope:** Per-agent, persistent
**Content:** Facts, decisions, entities, events, procedures, preferences

Structured knowledge extracted from conversations. Searchable, typed, scored.

| Type       | Example                                    |
|------------|--------------------------------------------|
| fact       | "SuperClaw Pure uses Fastify v5 + SQLite"  |
| decision   | "Branch strategy: direct to main"          |
| preference | "User prefers PT-BR"                       |
| entity     | "Alice — PO agent via OpenClaw"            |
| event      | "Sprint 77 completed 2026-03-13"           |
| procedure  | "Skills go to ~/.hiveclaw/skills/"         |
| goal       | "Implement Eidetic Memory v2"              |
| correction | "planejo, not planeio"                     |

**Graph edges** connect related memories (e.g., `Clark → created → ui-qa skill`).

---

### L5 — Archival Memory (Complete History)

**Tables:** `archival_memories` + `archival_memories_fts` + `messages_fts`
**Scope:** Per-agent, unlimited, never deleted
**Content:** Complete message history — NO compaction, full fidelity

This is the **sacred layer**. Every message, every tool output, every detail
is preserved exactly as it happened. Searchable via FTS5 (BM25 ranking).

**Principle:** L5 never compacts. It is the source of truth for everything
that ever happened. When in doubt, search L5.

---

## Context-Aware Session Management (Sprint 80)

### The Problem

Long conversations accumulate context. When context approaches the model's
token limit, the system must act — but NOT by destroying information.

### The Solution: Monitor → Extract → Verify → Rotate

```
Messages flow naturally into L2 (buffer)
         ↓
Token Monitor watches context size in real-time
         ↓
70% of model limit → Intensive Extraction begins
  • L5: Archive ALL messages completely (no compaction)
  • L4: LLM extracts structured facts
  • L3: Save working memory (compacted task state)
         ↓
85% of model limit → Fidelity Check
  • Verify: was everything extracted?
  • If fidelity < 0.8 → run second extraction pass
         ↓
90% of model limit → Session Rotation
  • Create new session linked to old one (session_chain)
  • Inject into new session:
    - L1 (core memory — identity)
    - L3 (working memory — current task)
    - L4 (relevant facts — semantic search)
  • User sees seamless continuation
  • Full history remains searchable via L5
         ↓
New session starts fresh — context is clean
All information is preserved across memory layers
```

### Token Monitor

**File:** `engine/token-monitor.ts`

Monitors context size using character-based estimation (chars/4).
Knows context limits for all major models:

| Model Family    | Context Limit |
|-----------------|---------------|
| Claude 4.x      | 200K tokens   |
| GPT-4o / o1     | 128-200K      |
| Gemini 1.5/2.0  | 1M tokens     |
| Ollama (llama)  | 8K tokens     |
| Mistral / Qwen  | 32K tokens    |

### Session Rotator

**File:** `engine/session-rotator.ts`

Orchestrates the extraction → verify → rotate pipeline.

**Session Chain:** rotated sessions are linked via the `session_chain` table.
Each chain has a `chain_id` and sessions are numbered sequentially.
The UI can present a chain as a single continuous conversation.

### Key Design Decisions

1. **Never compact L5.** Archival memory is the source of truth.
2. **Extract before rotating.** No data loss during rotation.
3. **Fidelity check is mandatory.** If extraction was incomplete, retry.
4. **Minimum 5min between rotations.** Prevent rapid cycling.
5. **Session chain is transparent.** User doesn't perceive the rotation.
6. **Working memory is the only compacted layer.** Everything else is full.

---

## Extraction Mechanisms

### Background Memory Extraction (per-turn)

**Location:** `agent-runner.ts` (section 7e)
**Trigger:** After every assistant response
**Method:** Regex patterns + tool output capture
**Target:** L4 (agent_memory)

Lightweight extraction that runs after each turn:
- Preferences ("I prefer", "I always use")
- Negations ("I never", "I hate") → tagged `[AVOID]`
- Decisions ("decided", "agreed", "will use")
- Tool outputs (up to 5, max 8KB each)

### Smart Compaction (threshold-based)

**Location:** `session-manager.ts` → `smartCompact()`
**Trigger:** When message count exceeds threshold
**Method:** LLM compaction (via `llm-compactor.ts`) + heuristic fallback
**Target:** L3 (working memory) + L4 (facts)

Runs when the buffer has too many messages. Tries LLM-based extraction
first, falls back to regex heuristic. Saves working memory before deleting.

### Session Consolidation (inactivity-based)

**Location:** `session-consolidator.ts`
**Trigger:** 10 minutes of inactivity
**Method:** LLM extraction of entire session
**Target:** L4 (agent_memory)

When a session goes quiet, the consolidator runs a full LLM pass to
extract durable facts. "What was important in this conversation?"

### Intensive Extraction (pre-rotation)

**Location:** `session-rotator.ts` → `intensiveExtraction()`
**Trigger:** 70% context threshold
**Method:** Full LLM extraction + complete archival
**Target:** L3 + L4 + L5

The most thorough extraction. Archives ALL messages to L5 (complete),
extracts structured facts to L4, and saves working memory to L3.

---

## Memory Retrieval

### Context Assembly (per-request)

For each LLM call, context is assembled from multiple layers:

```
System Prompt
  ├── L1: Core memory blocks (always present)
  ├── L3: Working memory (if available for this session)
  ├── L4: Top-K relevant memories (semantic search)
  └── Runtime context (model, tools, date)
```

### Archival Search

When the agent needs historical information:
1. `memory.search()` → searches L4 (graph memory) by LIKE match
2. `memory.archival_search()` → searches L5 (complete history) via FTS5 BM25

---

## Files

| File | Purpose |
|------|---------|
| `token-monitor.ts` | Real-time token counting + threshold detection |
| `session-rotator.ts` | Extraction + fidelity + rotation orchestration |
| `session-consolidator.ts` | Inactivity-based LLM consolidation |
| `session-manager.ts` | Session CRUD + smartCompact |
| `llm-compactor.ts` | LLM-powered summarization + fact extraction |
| `agent-runner.ts` | Main agentic loop — integrates all mechanisms |
| `progress-checker.ts` | Loop/stall/budget detection within a single turn |

---

## Changelog

- **Sprint 80** — Eidetic Memory v2: Token monitor, session rotator, fidelity check,
  archival preservation, session chain. Principle: never compact long-term memory.
- **Sprint 79** — Progress checker: intelligent loop/stall/budget detection.
- **Sprint 78** — Skill discovery: Gemini-powered weekly skill search.
- **Sprint 77** — 6 skills starter pack + DEFAULT_SKILLS.
- **Sprint 76** — Session consolidator (10min inactivity), tool output extraction,
  COMPACT_MIN_TOTAL 40→20.
- **Sprint 66** — Structured extraction in smartCompact.
- **Sprint 65** — Eidetic Memory Layer concept, core memory blocks.
