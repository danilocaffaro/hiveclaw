# MEMORY-ARCHITECTURE.md — SuperClaw Pure Memory System
# "Total Recall" — The Best Context & Memory Solution on the Market

**Author:** Alice 🐕 | **Date:** 2026-03-12 | **Status:** PROPOSED
**Research:** MemGPT/Letta (OS-inspired tiers), Mem0 (graph + vector), CoALA framework (cognitive architecture), LangChain Memory Store, Spacebot (typed graph)

---

## 1. The Problem (Why This Matters)

### 1.1 Core User Pain Point
> "Agent starts getting senile at ~200K tokens" — Reddit r/OpenAI, top complaint

### 1.2 The Real Failures We Must Solve

| Failure Mode | Example | Root Cause |
|-------------|---------|-----------|
| **Post-compaction amnesia** | Agent doesn't know what it was doing | Compaction destroys context, no rescue mechanism |
| **"I don't know/remember"** | Agent claims no knowledge without searching | No mandatory memory lookup before admitting ignorance |
| **Cross-session blindness** | New session = blank slate | Sessions isolated, no shared memory |
| **Token waste on memory** | Injecting ALL memories into every prompt | No relevance filtering, no budget |
| **Stale facts** | Remembers old preference, ignores correction | No contradiction detection on recall |

### 1.3 Design Principles

1. **NEVER forget without extracting** — Before any message is compacted/deleted, extract durable facts
2. **NEVER say "I don't know" without searching** — Mandatory 3-layer memory lookup before admitting ignorance
3. **Token-smart** — Memory injection has a budget (% of context window), not unlimited
4. **Background processing** — Extraction runs AFTER response, not blocking the user
5. **Resumability** — After compaction, agent can reconstruct what it was doing

---

## 2. Architecture: 5-Layer Memory Hierarchy

Inspired by MemGPT (OS virtual memory) + Mem0 (graph + vector) + CoALA (cognitive types).

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CONTEXT WINDOW (LLM)                         │
│  System Prompt + Memory Block + Recent Messages + Working Memory     │
│                                                                      │
│  Budget: system 15% │ memory 20% │ history 55% │ working 10%        │
└──────────┬───────────────────┬──────────────────────┬────────────────┘
           │ always injected    │ recent N messages     │ tool results
           │                    │                       │
┌──────────▼──────────┐ ┌──────▼──────────────┐ ┌──────▼──────────────┐
│ L1: CORE MEMORY     │ │ L2: CONVERSATION    │ │ L3: WORKING MEMORY  │
│ (always in prompt)  │ │ BUFFER              │ │ (current task state)│
│                     │ │                     │ │                     │
│ • persona block     │ │ • Last N messages   │ │ • Active goals      │
│ • human block       │ │ • Smart window      │ │ • Current plan      │
│ • relationship      │ │   (recency-weighted)│ │ • Pending actions   │
│ • active project    │ │ • 55% token budget  │ │ • Continuation ctx  │
│                     │ │                     │ │ • Tool call state   │
│ ~2K tokens max      │ │ ~55K tokens max     │ │ ~2K tokens max      │
│ Editable by agent   │ │ Auto-managed        │ │ Auto-saved on       │
│                     │ │                     │ │ compaction           │
└─────────────────────┘ └──────────┬──────────┘ └─────────────────────┘
                                   │ on compaction
                          ┌────────▼──────────┐
                          │ COMPACTION ENGINE  │
                          │ (LLM-based, cheap) │
                          │                    │
                          │ 1. Summarize convo │
                          │ 2. Extract facts   │
                          │ 3. Save to L4/L5   │
                          │ 4. Save work state │
                          │    to L3           │
                          └───────┬──┬─────────┘
                                  │  │
                    ┌─────────────▼  ▼─────────────────┐
┌───────────────────▼─────┐        ┌───────────────────▼─────┐
│ L4: RECALL MEMORY       │        │ L5: ARCHIVAL MEMORY     │
│ (searchable graph)      │        │ (full history, FTS)     │
│                         │        │                         │
│ • Semantic memories     │        │ • ALL messages ever     │
│   (facts, decisions,    │        │ • Compaction summaries  │
│    entities, prefs,     │        │ • Full-text search      │
│    goals, events)       │        │ • Never deleted         │
│ • Graph edges           │        │ • Token-cheap recall    │
│   (related, updates,    │        │   (search → snippets)   │
│    contradicts, etc.)   │        │                         │
│ • Relevance scoring     │        │ SQLite FTS5 index       │
│ • Access tracking       │        │                         │
│                         │        │                         │
│ Queried on demand       │        │ Queried on demand       │
│ + top-K injected        │        │ (last resort recall)    │
└─────────────────────────┘        └─────────────────────────┘
```

---

## 3. Layer Details

### L1: Core Memory (Always in Prompt)
**Inspired by:** Letta's memory blocks

Structured blocks that are ALWAYS in the system prompt. Small, high-signal, editable by the agent itself.

```typescript
interface CoreMemory {
  persona: string;      // Who the agent is, personality, capabilities (~300 tokens)
  human: string;        // Who the user is, preferences, communication style (~300 tokens)
  relationship: string; // History and dynamics of agent-user relationship (~200 tokens)
  project: string;      // Currently active project context, goals, state (~500 tokens)
  scratchpad: string;   // Agent-writable free-form notes (~500 tokens)
}
// Total budget: ~2000 tokens (fixed, always present)
```

The agent has tools to **edit** these blocks:
- `core_memory_replace(block, old_text, new_text)` — surgical edit
- `core_memory_append(block, text)` — add to block

**Key insight from Letta:** The agent ACTIVELY maintains its own core memory. When it learns something important about the user, it updates the `human` block. When the project changes, it updates `project`.

### L2: Conversation Buffer (Recent Messages)
**Current implementation, improved.**

- Sliding window of recent messages
- Budget: 55% of context window (e.g., ~55K tokens for 100K window)
- When budget exceeded → trigger compaction

### L3: Working Memory (Task Continuation State)
**This is the KEY innovation for solving post-compaction amnesia.**

Before compaction runs, the system extracts and saves:
```typescript
interface WorkingMemory {
  active_goals: string[];        // What the agent is trying to achieve
  current_plan: string;          // Step-by-step plan in progress
  completed_steps: string[];     // What's done
  next_actions: string[];        // What's next (immediate)
  pending_context: string;       // Any context needed to continue
  open_questions: string[];      // Unanswered questions
  tool_state: Record<string, unknown>; // In-progress tool results
}
```

**This is injected into the prompt AFTER compaction**, so the agent can seamlessly resume.

Format in prompt:
```
## Current Task State (auto-saved before context compaction)
**Goals:** [list]
**Plan:** [description]
**Completed:** [list]  
**Next:** [list]
**Context:** [critical info]
```

### L4: Recall Memory (Searchable Knowledge Graph)
**Our current `agent_memory` + `memory_edges`, enhanced.**

Types (CoALA mapping):
| Type | CoALA Category | Example | Auto-extract? |
|------|---------------|---------|---------------|
| `fact` | Semantic | "User's timezone is GMT-3" | ✅ Yes |
| `entity` | Semantic | "SuperClaw = Next.js + Fastify monorepo" | ✅ Yes |
| `preference` | Semantic | "User prefers Portuguese" | ✅ Yes |
| `decision` | Semantic | "Chose TypeScript over Go for Pure" | ✅ Yes |
| `goal` | Semantic | "Ship SuperClaw Pure v1.0" | ✅ Yes |
| `event` | Episodic | "Sprint 64 completed, pushed 1b91f76" | ✅ Yes |
| `procedure` | Procedural | "To restart server: kill 4070, nohup..." | Agent-created |
| `correction` | Episodic | "User said 'no, that's wrong' about X" | ✅ Yes |

**New: Contradiction detection on write.** When a new fact is stored, check if existing facts with the same key exist. If so, create a `contradicts` edge and mark the old one with lower relevance.

### L5: Archival Memory (Full History + FTS)
**New layer. The "eidetic" guarantee.**

```sql
-- Every message ever sent, never deleted
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  tokenize='porter unicode61'
);

-- Compaction summaries (the "what happened" log)
CREATE TABLE compaction_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,           -- LLM-generated summary
  extracted_facts INTEGER DEFAULT 0, -- count of facts extracted
  messages_compacted INTEGER DEFAULT 0,
  tokens_before INTEGER DEFAULT 0,
  tokens_after INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The agent can search archival memory:
- `archival_search(query, limit)` — FTS5 search across ALL messages ever
- `archival_read(session_id, offset, limit)` — paginated read of old messages

---

## 4. Smart Compaction (LLM-Based)

### Current Problem
Our `smartCompact()` uses **regex heuristics** — extracts file paths, "decided" keywords, etc. This is 10x worse than an LLM summary.

### New Compaction Flow

```
Trigger: conversation buffer > 55% of context window

1. EXTRACT (before deleting anything)
   │
   ├── LLM call (cheap tier: haiku/flash/mini) with prompt:
   │   "Given this conversation segment, extract:
   │    - Facts about the user/project
   │    - Decisions made
   │    - Active goals and their status
   │    - Current task state (what was being done, what's next)
   │    - Key entities mentioned
   │    Respond in JSON."
   │
   ├── Parse JSON → save each item to L4 (agent_memory)
   │   - Auto-detect contradictions with existing memories
   │   - Create edges (updates, related_to)
   │
   └── Extract working state → save to L3 (working_memory)

2. SUMMARIZE
   │
   └── LLM call (cheap tier): "Summarize this conversation in 2-3 paragraphs.
       Focus on: what was discussed, what was decided, what's pending."
       → Save to compaction_log

3. ARCHIVE
   │
   └── Copy old messages to messages_archive (if not already FTS-indexed)
       Insert into messages_fts

4. COMPACT
   │
   └── Delete old messages from active buffer
       Insert summary message as system message at boundary

5. REBUILD PROMPT
   │
   └── System prompt now includes:
       - L1 (core memory blocks) — always
       - L3 (working memory / task state) — if exists
       - L4 top-K (most relevant memories) — auto
       - Compaction notice: "Context was compacted. Use archival_search 
         to recall older conversations."
```

**Token cost of compaction:** ~500 input + ~300 output tokens on cheap model = ~$0.0001 per compaction. Negligible.

---

## 5. The "Never Say I Don't Know" Protocol

### Mandatory Memory Cascade

When the agent encounters a question it can't answer from current context:

```
Step 1: Check L1 (Core Memory) — already in prompt, 0 cost
         ↓ not found
Step 2: Check L4 (Recall Memory) — search agent_memory by query
         ↓ not found  
Step 3: Check L5 (Archival Memory) — FTS5 search across ALL history
         ↓ not found
Step 4: NOW the agent can say "I don't have information about this"
```

**Implementation:** This is NOT hard-coded logic. It's a **prompt instruction**:

```
## Memory Protocol (MANDATORY)
Before saying "I don't know" or "I don't remember":
1. Search your recall memory: memory_search(query)
2. Search archival history: archival_search(query)
3. Only after both return empty may you say you don't have the information.
NEVER skip these steps.
```

**Why prompt-based, not code-based:** The agent needs to formulate the right search query based on context. Hard-coding "always search before answering" would search on EVERY message, wasting tokens. The prompt instruction makes the agent judge WHEN it needs to search (i.e., when it's about to say "I don't know").

---

## 6. Token Budget Management

### The Smart Budget System

Context window is a finite resource. Every token has a cost. We need to be smart.

```
Total context window: 128K tokens (example)

┌─────────────────────────────────────────────────────┐
│ System prompt + Core Memory (L1)     │  15% = 19.2K │
│ Memory injection (L4 top-K)          │   5% =  6.4K │
│ Working Memory (L3)                  │   5% =  6.4K │
│ Conversation buffer (L2)            │  65% = 83.2K │
│ Working space (tool results, etc.)   │  10% = 12.8K │
└─────────────────────────────────────────────────────┘
```

### Smart Memory Injection (L4 → Prompt)

NOT all memories go into the prompt. Smart selection:

```typescript
function selectMemoriesForContext(
  agentId: string,
  currentMessages: Message[],
  tokenBudget: number,  // e.g., 6400 tokens
): MemoryEntry[] {
  // 1. Always include: active goals, current project context
  const pinned = getMemories(agentId, { type: ['goal', 'decision'], active: true });
  
  // 2. Relevance-scored: extract keywords from last 3 messages
  const recentKeywords = extractKeywords(currentMessages.slice(-3));
  const relevant = searchMemories(agentId, recentKeywords, { limit: 20 });
  
  // 3. Recency-boosted: recently accessed memories get priority
  const scored = relevant.map(m => ({
    ...m,
    score: m.relevance * recencyBoost(m.last_accessed) * accessBoost(m.access_count)
  }));
  
  // 4. Fit within budget
  const sorted = scored.sort((a, b) => b.score - a.score);
  let tokensUsed = tokenEstimate(pinned);
  const selected = [...pinned];
  
  for (const mem of sorted) {
    const memTokens = tokenEstimate(mem);
    if (tokensUsed + memTokens > tokenBudget) break;
    selected.push(mem);
    tokensUsed += memTokens;
  }
  
  return selected;
}
```

---

## 7. Background Memory Extraction

### The "Sleep-Time" Approach (Letta-inspired)

After the agent responds, a **background process** extracts durable memories:

```
User sends message → Agent responds (streaming) → Response complete
                                                        │
                                                        ▼
                                              Background job (async):
                                              ┌──────────────────────────┐
                                              │ Extract from last N msgs │
                                              │ using cheap LLM:         │
                                              │                          │
                                              │ • New facts              │
                                              │ • Entity updates         │
                                              │ • Preference changes     │
                                              │ • Decision records       │
                                              │ • Goal state changes     │
                                              │ • Corrections            │
                                              │                          │
                                              │ → Upsert to agent_memory│
                                              │ → Detect contradictions  │
                                              │ → Create edges           │
                                              └──────────────────────────┘
```

**Frequency:** Not every message. Every N messages (configurable, default 5) or when a "significant" message is detected (decision, correction, goal change).

**Token cost:** ~200 input + ~150 output on cheap model per extraction = ~$0.00005. At 5-message cadence, that's $0.00001 per message. Negligible.

---

## 8. Implementation Plan

### Phase 1: Foundation (Sprint 65)
- [ ] Unify `memories` tool table with `agent_memory` — single table
- [ ] Add `messages_fts` FTS5 virtual table + triggers on INSERT
- [ ] Add `compaction_log` table
- [ ] Add `working_memory` table (session-scoped task state)
- [ ] Core memory blocks schema + API (CRUD per agent)

### Phase 2: Smart Compaction (Sprint 66)
- [ ] Replace regex `smartCompact()` with LLM-based extraction
- [ ] Working memory save/restore on compaction
- [ ] Compaction summary → `compaction_log`
- [ ] Archive messages before deletion (FTS5 index)
- [ ] Budget-aware memory injection in `agent-runner.ts`

### Phase 3: Agent Memory Tools (Sprint 67)
- [ ] `core_memory_replace(block, old, new)` tool
- [ ] `core_memory_append(block, text)` tool  
- [ ] `recall_search(query)` tool — searches L4
- [ ] `archival_search(query)` tool — FTS5 search on L5
- [ ] Update system prompt template with memory protocol

### Phase 4: Background Extraction (Sprint 68)
- [ ] Background extraction job after response
- [ ] Significance detector (when to extract)
- [ ] Contradiction detection on write
- [ ] Memory decay (reduce relevance of old unaccessed memories)

### Phase 5: Vector Search — v1.1 (future)
- [ ] sqlite-vec embeddings for semantic search
- [ ] Hybrid retrieval: FTS5 + vector + graph
- [ ] This is a NICE-TO-HAVE, not required for v1

---

## 9. Why This Beats Every Competitor

| Feature | Us (proposed) | Letta | Mem0 | ChatGPT | OpenClaw |
|---------|--------------|-------|------|---------|----------|
| Editable core memory blocks | ✅ | ✅ | ❌ | ❌ | ❌ |
| LLM-based compaction | ✅ | ✅ | N/A | ✅ | ❌ |
| Post-compaction task resumption | ✅ (L3) | ❌ | ❌ | ⚠️ partial | ❌ |
| Graph memory with edges | ✅ | ❌ | ✅ | ❌ | ❌ |
| Full-text archival search | ✅ (FTS5) | ✅ | ❌ | ❌ | ❌ |
| Background extraction | ✅ | ✅ | ✅ | ✅ | ❌ |
| Token budget management | ✅ | ✅ | ✅ | ✅ | ❌ |
| Mandatory recall before "idk" | ✅ | ❌ | ❌ | ❌ | ❌ |
| Contradiction detection | ✅ | ❌ | ✅ | ❌ | ❌ |
| Self-hosted / local | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| Zero external deps (no Redis/PG) | ✅ (SQLite) | ❌ (PG) | ❌ (Qdrant) | N/A | ✅ |

### Key Differentiators:
1. **L3 Working Memory** — Nobody else saves task continuation state before compaction. This is our unique advantage.
2. **Mandatory recall cascade** — Nobody else enforces "search before saying I don't know"
3. **All SQLite** — Letta needs Postgres, Mem0 needs Qdrant/Chroma. We run on a single file.
4. **Token budget system** — Explicit % allocation prevents memory from eating the context

---

## 10. Token Cost Analysis

| Operation | Model Tier | Tokens | Cost (USD) | Frequency |
|-----------|-----------|--------|-----------|-----------|
| Memory injection (L4 top-K) | none (DB lookup) | 0 LLM | $0 | Every message |
| FTS5 search (L5) | none (SQLite) | 0 LLM | $0 | On demand |
| Compaction extraction | cheap (haiku) | ~800 | $0.0001 | Every ~50 msgs |
| Background extraction | cheap (haiku) | ~350 | $0.00005 | Every 5 msgs |
| **Total monthly** (100 msgs/day) | | | **~$0.05** | |

**Practically free.** The entire memory system costs less than a single premium LLM call per month.

---

## 11. Migration from Current State

What we have → What we need:

| Current | Target | Migration |
|---------|--------|-----------|
| `memories` table (tool) | DELETE — use `agent_memory` | Migrate existing rows, drop old table |
| `agent_memory` (8 types) | Add `procedure`, `correction` types | ALTER TABLE ADD CHECK |
| No FTS | `messages_fts` FTS5 | CREATE VIRTUAL TABLE + backfill |
| No working memory | `working_memory` table | CREATE TABLE |
| No core memory blocks | `core_memory_blocks` table | CREATE TABLE |
| Regex compaction | LLM compaction | Replace `smartCompact()` |
| `memory` tool (basic) | 4 tools (core_*, recall_*, archival_*) | Replace tool class |
| No archival search | FTS5 search tool | Add tool |
| Static memory injection | Budget-aware injection | Rewrite `getContextString()` |
