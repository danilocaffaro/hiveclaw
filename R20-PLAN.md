# R20 — Engine Hardening Sprint

> **Consensus:** Alice 🐕 + Adler 🦊 — 100% agreement on 12 structural problems
> **Date:** 2026-03-18
> **Strategy:** Quick wins first (builds momentum), then medium fixes, then architecture planning

---

## Phase 1: Quick Wins (~2-3h) — R20.1

| # | Problem | Fix | Severity |
|---|---------|-----|----------|
| 7 | Copilot token exchange on every iteration | Cache token + reuse until 5min before expiry | 🔴 |
| 10 | `toolCallId` vs `tool_call_id` naming inconsistency | Normalize to `tool_call_id` across all layers | 🟡 |
| 11 | `console.log/error` in providers/index.ts | Replace with `logger.*` | 🟡 |

**Deliverable:** Commit with all 3 fixes + tests passing

---

## Phase 2: Medium Fixes (~6-8h) — R20.2

| # | Problem | Fix | Severity |
|---|---------|-----|----------|
| 12 | No retry with backoff | Add exponential backoff retry within same provider (429/503/network) | 🟡 |
| 6 | Primitive tool loop detection | Add response-level loop detection + graduated thresholds (warn→stop) | 🟡 |
| 9 | No context pruning for tool outputs | Soft-trim old tool outputs (keep head+tail, replace middle with summary) | 🟡 |
| 3 | Reactive context management | Add proactive token budget check BEFORE each LLM call, not just at smartCompact threshold | 🔴 |

**Deliverable:** Commit per sub-batch + tests passing

---

## Phase 3: Structural Fixes (~8-12h) — R20.3

| # | Problem | Fix | Severity |
|---|---------|-----|----------|
| 8 | Zero concurrency control | Add per-session mutex — second message waits for first to finish | 🔴 |
| 4 | Multi-provider quirk leakage | Create provider normalization layer — each provider adapter handles its own quirks | 🔴 |
| 2 | Tool errors not forced as context | Add mandatory error acknowledgment check before allowing next tool call | 🔴 |

**Deliverable:** Commit per fix + tests passing

---

## Phase 4: Architecture Blueprint (planning only) — R20.4

| # | Problem | Approach |
|---|---------|----------|
| 1 | Manual agentic loop | Plan migration to provider-native tool_use/function_calling loop |
| 5 | Mutable shared state | Plan immutable message pipeline (each iteration gets fresh copy) |

**Deliverable:** `ENGINE-V2-BLUEPRINT.md` — detailed migration plan with phases, risks, and rollback strategy. No code changes.

---

## Execution Order

```
R20.1a → Copilot token cache (highest impact per effort)
R20.1b → Normalize toolCallId
R20.1c → Logger cleanup in providers
--- commit + test + deploy ---
R20.2a → Retry with backoff
R20.2b → Tool loop detection v2
R20.2c → Context pruning for tool outputs
R20.2d → Proactive token budget
--- commit + test + deploy ---
R20.3a → Per-session mutex
R20.3b → Provider normalization layer
R20.3c → Tool error acknowledgment
--- commit + test + deploy ---
R20.4  → Engine v2 blueprint (document only)
```

## Gate
- 0 TS errors
- 270+ tests pass (add new tests for each fix)
- Visual QA not required (backend-only changes)
- No DB schema changes
