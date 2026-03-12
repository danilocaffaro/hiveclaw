# MEMORY-ARCHITECTURE.md — SuperClaw Pure Memory System
# "Total Recall" — The Best Context & Memory Solution on the Market

**Author:** Alice 🐕 | **Date:** 2026-03-12 | **Status:** IMPLEMENTED (v1.0 — Sprints 65-67)
**Research:** Gemini Search (grounded, w/ citations) + direct web_fetch

### Sources (verified via Gemini Search with Google grounding)

| # | Source | Type | Credibility | Key Insight |
|---|--------|------|-------------|-------------|
| 1 | **MemGPT paper** — arXiv:2310.08560 (Packer et al., UC Berkeley) | Academic Paper | ⭐⭐⭐⭐⭐ | OS-inspired hierarchical memory: core ↔ recall ↔ archival tiers |
| 2 | **Mem0 paper** — arXiv:2504.19413 (Chhikara et al., YC-backed) | Academic Paper | ⭐⭐⭐⭐ | +26% accuracy vs OpenAI Memory, 91% less latency, 90% fewer tokens on LOCOMO |
| 3 | **CoALA framework** — arXiv:2309.02427 (Sumers, Yao et al., Princeton/Stanford) | Academic Paper, TMLR | ⭐⭐⭐⭐⭐ | Cognitive architecture: procedural / semantic / episodic memory types |
| 4 | **Zep / Graphiti** — getzep.com, neo4j.com integration | Product + Benchmark | ⭐⭐⭐⭐ | Temporal knowledge graph, bi-temporal model, DMR 94.8% vs MemGPT 93.4%, LongMemEval +18.5% accuracy |
| 5 | **LangChain Memory Blog** — blog.langchain.com/memory-for-agents | Industry Blog | ⭐⭐⭐⭐ | Hot-path vs background extraction, LangGraph Memory Store namespaces |
| 6 | **Letta (evolved MemGPT)** — letta.com, github.com/letta-ai/letta (~45K⭐) | Open Source | ⭐⭐⭐⭐⭐ | Memory blocks, agent-editable core memory, compaction, archival memory |
| 7 | **Mem0 repo** — github.com/mem0ai/mem0 (~45K⭐, YC W24) | Open Source | ⭐⭐⭐⭐⭐ | Hybrid DB (vector+KV+graph), self-improving memory layer |
| 8 | **MemoryAgentBench** — arXiv (2025) | Academic Benchmark | ⭐⭐⭐⭐ | 4 competencies: accurate retrieval, test-time learning, long-range understanding, conflict resolution |
| 9 | **StructMemEval** — arXiv (2025) | Academic Benchmark | ⭐⭐⭐⭐ | Tests memory ORGANIZATION (ledgers, to-do lists), not just recall |
| 10 | **BEAM** — arXiv (2025) | Academic Benchmark | ⭐⭐⭐⭐ | Extremely long coherent conversations: extraction, multi-hop, temporal reasoning |
| 11 | **Evo-Memory** — arXiv (2025) | Academic Benchmark | ⭐⭐⭐⭐ | Streaming benchmark: retrieve, integrate, update knowledge over time |
| 12 | **LOCOMO benchmark** | Academic Benchmark | ⭐⭐⭐⭐⭐ | Single-hop, multi-hop, temporal, open-domain — gold standard for conversational memory |
| 13 | **Anthropic** — anthropic.com (context engineering) | Industry | ⭐⭐⭐⭐⭐ | "Context engineering" as discipline, proactive compaction |
| 14 | **Microsoft** — microsoft.com (agent continuations) | Industry | ⭐⭐⭐⭐⭐ | Agent Continuations: serializable call stack for pause/resume/checkpoint |

**Research method:** 4 Gemini Search queries with Google Search grounding (citations auto-verified), 6 direct web_fetch calls to arXiv, GitHub, and docs.

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

## 9. Research Insights (Gemini Search — March 2026)

### 9.1 New Competitors Discovered: Zep/Graphiti

**Zep** (missed in initial research) is a significant competitor using a **temporal knowledge graph** (Graphiti engine) with:
- **Bi-temporal model**: tracks event_time (when it happened) AND ingestion_time (when stored)
- **3 subgraphs**: Episode (raw events) → Semantic Entity (extracted entities + embeddings) → Community (clusters + summaries)
- **Hybrid search**: semantic embeddings + BM25 keyword + graph traversal — **zero LLM calls during retrieval**
- **Benchmark**: DMR 94.8% (vs MemGPT 93.4%), LongMemEval +18.5% accuracy, -90% latency

**Impact on our design:** We should add **temporal metadata** (event timestamps, validity intervals) to our L4 graph. We already have `created_at` but need `event_at` and `valid_until`.

### 9.2 Benchmarks Landscape (2025-2026)

7 major benchmarks now exist for agent memory:
| Benchmark | Focus | Key Insight for Us |
|-----------|-------|--------------------|
| **LOCOMO** | Single-hop, multi-hop, temporal, open-domain | Gold standard. Mem0 wins (+26% vs OpenAI) |
| **LongMemEval** | Enterprise scenarios, temporal reasoning | Zep wins (+18.5%). Complex temporal = hard |
| **MemoryAgentBench** | Retrieval, learning, long-range, conflicts | Tests conflict resolution — we need contradiction detection |
| **StructMemEval** | Memory ORGANIZATION (ledgers, to-dos) | Simple RAG fails. Structured memory matters |
| **BEAM** | Extremely long conversations, multi-hop | Tests the exact scenario we're solving |
| **DMR** | Context integration for conversations | Zep 94.8% vs MemGPT 93.4% |
| **Evo-Memory** | Streaming: retrieve, integrate, update over time | Tests continuous learning — our background extraction |

### 9.3 FTS5 vs Vector Search Verdict

Gemini Search consensus from multiple sources:
- **FTS5 alone is insufficient** for production agent memory — lacks semantic understanding
- **Vector search alone misses keyword precision** — mathematical similarity ≠ contextual relevance
- **Hybrid FTS5 + Vector = optimal** — FTS5 for fast keyword filtering, vector for semantic re-ranking
- **However:** For v1.0, FTS5 gives us 80% of value at 0% external dependency cost
- **sqlite-vec** (by Alex Garcia) is the SQLite-native vector extension — perfect for v1.1

**Our plan is correct:** FTS5 now (Sprint 65), sqlite-vec later (v1.1).

### 9.4 Post-Compaction Task Resumption (Validated)

Research confirms our L3 Working Memory is a genuine innovation:
- **MemGPT/Letta**: Has archival recall but no explicit task state save
- **Zep**: Knowledge graph survives, but no "what was I doing" state
- **Mem0**: Facts persist, but no task continuation
- **Microsoft "Agent Continuations"**: Closest concept — serializes entire call stack (tools, goals, partial responses) as JSON for pause/resume. This validates our approach.
- **Anthropic "Context Engineering"**: Recommends proactive compaction + structured note-taking into external scratchpad — exactly our L1 scratchpad + L3 working memory

**Conclusion:** Our L3 Working Memory is validated by the direction Microsoft and Anthropic are heading, but neither ships it as a product feature yet.

### 9.5 Revised Architecture Adjustments

Based on research, 3 additions to our original design:

1. **Add temporal metadata to L4** — `event_at DATETIME` (when the fact/event actually happened, not just when stored). Enables temporal reasoning ("what did we decide LAST WEEK?")

2. **Add `valid_until` to memories** — Zep's bi-temporal model shows facts expire. Our `expires_at` already partially covers this, but we should make it explicit for facts (e.g., "current sprint is 65" becomes invalid when sprint 66 starts)

3. **Plan for hybrid search in v1.1** — FTS5 pre-filter → sqlite-vec semantic re-rank. Architecture should be pluggable so adding vector search doesn't require schema changes

---

## 10. Why This Beats Every Competitor

| Feature | Us (proposed) | Letta | Mem0 | Zep/Graphiti | ChatGPT | OpenClaw |
|---------|--------------|-------|------|-------------|---------|----------|
| Editable core memory blocks | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| LLM-based compaction | ✅ | ✅ | N/A | N/A | ✅ | ❌ |
| Post-compaction task resumption | ✅ (L3) | ❌ | ❌ | ❌ | ⚠️ partial | ❌ |
| Graph memory with edges | ✅ | ❌ | ✅ | ✅✅ (temporal KG) | ❌ | ❌ |
| Temporal reasoning (bi-temporal) | ⚠️ v1.1 | ❌ | ❌ | ✅ (event+ingest time) | ❌ | ❌ |
| Full-text archival search | ✅ (FTS5) | ✅ | ❌ | ✅ (BM25) | ❌ | ❌ |
| Vector/semantic search | ⚠️ v1.1 | ✅ | ✅ | ✅ (hybrid) | ❌ | ❌ |
| Background extraction | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Token budget management | ✅ | ✅ | ✅ | N/A (API) | ✅ | ❌ |
| Mandatory recall before "idk" | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Contradiction detection | ✅ | ❌ | ✅ | ✅ (temporal) | ❌ | ❌ |
| Self-hosted / local | ✅ | ✅ | ⚠️ | ❌ (Neo4j) | ❌ | ✅ |
| Zero external deps (no Redis/PG) | ✅ (SQLite) | ❌ (PG) | ❌ (Qdrant) | ❌ (Neo4j) | N/A | ✅ |

### Key Differentiators:
1. **L3 Working Memory** — Nobody else saves task continuation state before compaction. Validated by Microsoft's Agent Continuations concept but not shipped by anyone yet.
2. **Mandatory recall cascade** — Nobody else enforces "search before saying I don't know"
3. **All SQLite** — Letta needs Postgres, Mem0 needs Qdrant/Chroma, Zep needs Neo4j. We run on a single file.
4. **Token budget system** — Explicit % allocation prevents memory from eating the context
5. **Temporal metadata (v1.1)** — Following Zep/Graphiti's bi-temporal model for temporal reasoning

### Honest Gaps (vs Zep/Graphiti):
- **No vector search in v1** — FTS5 only (adding sqlite-vec in v1.1)
- **No bi-temporal model in v1** — Basic timestamps (adding event_at/valid_until in v1.1)
- **No community/cluster subgraph** — Zep auto-clusters related entities. We do manual edges.

---

## 11. Token Cost Analysis

| Operation | Model Tier | Tokens | Cost (USD) | Frequency |
|-----------|-----------|--------|-----------|-----------|
| Memory injection (L4 top-K) | none (DB lookup) | 0 LLM | $0 | Every message |
| FTS5 search (L5) | none (SQLite) | 0 LLM | $0 | On demand |
| Compaction extraction | cheap (haiku) | ~800 | $0.0001 | Every ~50 msgs |
| Background extraction | cheap (haiku) | ~350 | $0.00005 | Every 5 msgs |
| **Total monthly** (100 msgs/day) | | | **~$0.05** | |

**Practically free.** The entire memory system costs less than a single premium LLM call per month.

---

## 13. Migration from Current State

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

---

## 14. Chat History Indexing & Search — Deep Dive

Research: 4 Gemini Search queries focused on indexing frameworks, chunking strategies, retrieval models, and SQLite-specific implementation.

### 14.1 The 3-Tier Retrieval Model

Based on 2025 research consensus, the optimal search architecture for chat history combines 3 tiers:

```
┌─────────────────────────────────────────────────────┐
│            QUERY (user question or recall need)       │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  TIER 1: BM25 / FTS5        │  ← v1.0
        │  Keyword-based, fast, exact  │
        │  Strengths: precision,       │
        │    identifiers, code snippets│
        │  sqlite FTS5 + porter + uni  │
        └──────────────┬──────────────┘
                       │ candidates (top-50)
        ┌──────────────▼──────────────┐
        │  TIER 2: VECTOR / SEMANTIC   │  ← v1.1
        │  Embedding-based similarity  │
        │  Strengths: paraphrases,     │
        │    intent, "what did I mean?"│
        │  sqlite-vec + embeddings     │
        └──────────────┬──────────────┘
                       │ re-ranked (top-10)
        ┌──────────────▼──────────────┐
        │  TIER 3: GRAPH TRAVERSAL     │  ← v1.0
        │  Follow edges in agent_memory│
        │  Strengths: related facts,   │
        │    contradictions, context    │
        │  Our L4 memory graph         │
        └──────────────┬──────────────┘
                       │ enriched results
                       ▼
              FINAL CONTEXT FOR LLM
```

**v1.0 ships Tier 1 + Tier 3.** Tier 2 (vector) is a v1.1 addition — the architecture is designed for it to be pluggable.

### 14.2 FTS5 Configuration — Best Practices

Based on SQLite.org docs, sqlite.ai guides, and community expertise:

```sql
-- OPTIMAL tokenizer config for chat history (multilingual, with stemming)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  session_id UNINDEXED,     -- filter column, not searchable text
  agent_id UNINDEXED,       -- filter column
  role UNINDEXED,           -- filter column
  created_at UNINDEXED,     -- for recency scoring
  tokenize='porter unicode61 remove_diacritics 2'
);
```

**Why this config:**
- **`porter`** = stemming wrapper. "running" matches "run", "ran". Critical for recall.
- **`unicode61`** = base tokenizer. Handles accented chars, Portuguese (ç, ã, é), CJK.
- **`remove_diacritics 2`** = "café" matches "cafe". Important for Portuguese.
- **`UNINDEXED` columns** = metadata for filtering WITHOUT polluting the search index. Saves space and prevents false matches on IDs.

**Why NOT trigram:**
Trigram tokenizer enables substring matching ("ello" inside "hello") — useful for autocomplete, NOT for recall search. It generates 3x more tokens per document, significantly larger index. Trigram is overkill for chat history.

### 14.3 FTS5 Search Patterns for Chat History

```sql
-- Basic keyword search with BM25 ranking
SELECT m.id, m.content, m.session_id, m.created_at,
       rank AS bm25_score
FROM messages_fts
WHERE messages_fts MATCH ?
  AND session_id = ?                -- scope to session (optional)
ORDER BY rank                        -- BM25 (lower = better match)
LIMIT 20;

-- Snippet extraction (show matching context, not full message)
SELECT snippet(messages_fts, 0, '<b>', '</b>', '...', 32) AS context,
       session_id, created_at
FROM messages_fts
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT 10;

-- Recency-boosted BM25 (custom scoring)
-- Multiply BM25 by a recency decay factor
SELECT m.id, m.content,
       rank * (1.0 / (1.0 + (julianday('now') - julianday(created_at)))) AS score
FROM messages_fts
WHERE messages_fts MATCH ?
ORDER BY score
LIMIT 20;

-- Cross-session search (find info across ALL conversations)
SELECT m.id, m.content, m.session_id, m.created_at,
       rank AS bm25_score
FROM messages_fts
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT 20;

-- Phrase search (exact sequence)
SELECT * FROM messages_fts WHERE messages_fts MATCH '"sprint 65 memory"';

-- Boolean operators
SELECT * FROM messages_fts WHERE messages_fts MATCH 'memory AND compaction NOT regex';

-- Column-specific search (only search content, not metadata)
SELECT * FROM messages_fts WHERE content MATCH 'eidetic memory';
```

### 14.4 Chunking Strategy for Messages

Research shows 3 main chunking approaches for conversations:

| Strategy | How | Best For | Our Use? |
|----------|-----|----------|----------|
| **Turn-based** | Each message = 1 chunk | Short messages, chat-style | ✅ Primary |
| **Sliding window** | 5-7 turns with 2-3 turn overlap | Context-heavy, back-and-forth | ✅ For FTS snippets |
| **Topic-based** | Segment by topic change | Long sessions, multi-topic | ⚠️ v1.1 (needs embeddings) |

**Our approach for v1.0:**

```
Individual Message Indexing (Turn-Based):
- Each message is 1 FTS5 row
- Metadata (session_id, agent_id, role, timestamp) as UNINDEXED columns
- This is the simplest, most granular approach
- Works perfectly for keyword recall ("when did we discuss X?")

Sliding Window for Context Retrieval:
- When FTS5 finds a match, we DON'T just return that message
- We return the message + N surrounding messages (context window)
- Implementation: SELECT messages WHERE session_id=? AND created_at 
  BETWEEN (match_time - 2min) AND (match_time + 2min)
- This gives the agent CONTEXT around the match, not just the hit
```

### 14.5 How ChatGPT / Claude / Gemini Do It (Research)

| Product | Chat History Search | Memory Persistence | Method |
|---------|--------------------|--------------------|--------|
| **ChatGPT** | Session context window + "Saved Memories" (explicit) + implicit chat history referencing | Cross-session via saved memories; implicit profile learning | Attention weighting + separate persistent store |
| **Claude** | "Search and reference chats" — active retrieval when prompted | NOT persistent (no user profile building); chat-by-chat | On-demand search, not passive learning |
| **Gemini** | Can search Google Chat history; RAG over past conversations | Workspace integration; cites sources from past chats | RAG + metadata retrieval + cited context |

**Key insight:** Claude's approach is closest to ours — active search on demand, not passive always-on injection. This validates our "mandatory recall cascade" (search before saying "I don't know") over ChatGPT's implicit memory (which can hallucinate memories).

### 14.6 sqlite-vec Integration Plan (v1.1)

Based on Alex Garcia's docs (alexgarcia.xyz) and community guides:

```sql
-- Virtual table for vector storage
CREATE VIRTUAL TABLE message_embeddings USING vec0(
  message_id TEXT PRIMARY KEY,
  embedding FLOAT[384]           -- all-MiniLM-L6-v2 = 384 dims
);
```

**Embedding model comparison:**

| Model | Dims | Size | Speed | Quality | Cost | Our Choice? |
|-------|------|------|-------|---------|------|-------------|
| `text-embedding-3-small` (OpenAI) | 1536 | API only | Fast | ⭐⭐⭐⭐⭐ | $0.02/1M tokens | ✅ v1.1 default |
| `nomic-embed-text` (local) | 768 | 274MB | Medium | ⭐⭐⭐⭐ | Free | ✅ v1.1 local option |
| `all-MiniLM-L6-v2` (local) | 384 | 80MB | Fast | ⭐⭐⭐ | Free | ⚠️ Smaller but lighter |
| ChromaDB default | 384 | embeds in Chroma | Medium | ⭐⭐⭐ | Free | ❌ External dep |

**sqlite-vec vs alternatives:**

| | sqlite-vec | ChromaDB | pgvector |
|---|---|---|---|
| **Dependency** | SQLite extension | Separate server | Postgres extension |
| **Setup** | `npm install sqlite-vec` | Docker + API | Postgres required |
| **Scale** | 100K-1M vectors | Millions | Millions |
| **Our use case** | ✅ Perfect (single-file) | ❌ External server | ❌ Postgres required |
| **Query speed** | ~5ms (100K vectors) | ~10ms | ~3ms |

**sqlite-vec is perfect for our scale.** A personal assistant with 100K messages = 100K vectors. sqlite-vec handles that in ~5ms. No external dependencies.

**Hybrid search pattern (v1.1):**
```sql
-- Step 1: FTS5 pre-filter (fast, keyword-based)
WITH fts_matches AS (
  SELECT rowid, rank AS fts_score
  FROM messages_fts
  WHERE messages_fts MATCH ?
  LIMIT 50
),
-- Step 2: Vector re-rank (semantic similarity)
vec_scores AS (
  SELECT message_id, distance
  FROM message_embeddings
  WHERE embedding MATCH ?          -- query embedding
    AND k = 50                     -- top-50 nearest
)
-- Step 3: Reciprocal Rank Fusion (RRF)
SELECT m.id, m.content,
  (COALESCE(1.0/(60+fts_rank), 0) + COALESCE(1.0/(60+vec_rank), 0)) AS rrf_score
FROM messages m
LEFT JOIN fts_matches f ON m.rowid = f.rowid
LEFT JOIN vec_scores v ON m.id = v.message_id
WHERE f.rowid IS NOT NULL OR v.message_id IS NOT NULL
ORDER BY rrf_score DESC
LIMIT 10;
```

### 14.7 Revised Implementation Phases (Updated)

| Phase | Sprint | Items | Search Capability | Status |
|-------|--------|-------|-------------------|--------|
| **Foundation** | 65 | Unify tables, FTS5, working memory, core blocks, episodes | Keyword search (BM25) | ✅ DONE |
| **Smart Compaction** | 66 | Working memory save before compaction, fact extraction, compaction log + episodes | + Archival search | ✅ DONE |
| **Agent Tools + Extract** | 67 | Memory tool rewrite (8 actions), visual_memory tool, background auto-extract | + Agent-invoked search + visual | ✅ DONE |
| **Hybrid Search** | v1.1 | sqlite-vec, embeddings, RRF fusion | + Semantic search | 🔮 Planned |
| **Visual Search** | v1.1 | CLIP embeddings, image similarity | + Visual semantic recall | 🔮 Planned |
| **Advanced** | v1.2 | Topic segmentation, community detection, temporal queries | + Topic-based recall | 🔮 Planned |

---

## 15. Implementation Status (Sprints 65-67)

### What's Implemented (v1.0)

| Layer | Feature | File | Status |
|-------|---------|------|--------|
| **L1 Core Memory** | `core_memory_blocks` table + CRUD + prompt injection | `db/agent-memory.ts` | ✅ |
| **L2 Conversation** | Sliding window + smart compaction | `engine/session-manager.ts` | ✅ |
| **L3 Working Memory** | `working_memory` table + save/restore around compaction | `db/agent-memory.ts` + `session-manager.ts` | ✅ |
| **L4 Knowledge Graph** | 10 types, 6 edges, bi-temporal, contradiction detection | `db/agent-memory.ts` | ✅ |
| **L5 Archival** | FTS5 on all messages, BM25, snippets, cross-session | `db/schema.ts` + `db/agent-memory.ts` | ✅ |
| **L6 Visual Memory** | Describe-then-Store tool, episode reference | `engine/tools/visual-memory.ts` | ✅ |
| **Background Extract** | Auto-extract preferences/decisions/entities/corrections/goals | `engine/agent-runner.ts` | ✅ |
| **Compaction Log** | `compaction_log` + `episodes` tables, audit trail | `db/agent-memory.ts` | ✅ |
| **Budget-Aware Injection** | Token-budgeted context (core → working → pinned → top-K) | `db/agent-memory.ts` | ✅ |
| **Mandatory Recall** | Tool description enforces search-before-"I don't know" | `engine/tools/memory.ts` | ✅ |

### API Endpoints (v1.0)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/memory/search/fts?q=&session_id=&snippets=` | FTS5 archival search |
| GET | `/memory/agents/:id/core` | Core memory blocks |
| PUT | `/memory/agents/:id/core/:block` | Set core block |
| GET | `/memory/agents/:id/temporal?date=` | Temporal queries |
| GET | `/memory/working/:sessionId` | Working memory state |
| PUT | `/memory/working/:sessionId` | Save working memory |
| GET | `/memory/episodes/:sessionId` | Episode history |
| GET | `/memory/compactions/:sessionId` | Compaction audit log |
| GET | `/memory/stats/:agentId` | Memory statistics |

### Agent Tools (v1.0)

| Tool | Actions |
|------|---------|
| `memory` | create, search, archival_search, list, delete, core_read, core_replace, core_append |
| `visual_memory` | store, recall, list |

### What's Planned (v1.1)

| Feature | Details |
|---------|---------|
| **sqlite-vec** | Vector embeddings for semantic search (384-1536 dims) |
| **Hybrid RRF** | FTS5 pre-filter → vector re-rank → graph enrichment |
| **LLM compaction** | Replace heuristic extraction with cheap model (haiku/flash) summarization |
| **CLIP embeddings** | Visual similarity search across stored images |
| **Embedding models** | `text-embedding-3-small` (API) or `nomic-embed-text` (local) |
