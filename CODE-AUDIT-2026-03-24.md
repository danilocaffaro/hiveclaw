# HiveClaw Code Audit — 2026-03-24
**Auditor:** Alice 🐕 | **Codebase:** v1.3.5 commit `9cb9b9b` | **Files:** 292 (183 server + 109 web)

---

## 🔴 Critical (Fix ASAP)

### C1. SmartCompact Silent Failure — Root Cause Found
**File:** `agent-runner-v2.ts:408` + `session-manager.ts:458-720`
**Bug:** SmartCompact triggers correctly (3x logged with 92-96 msgs) but `compaction_log` is empty and messages stay at 97.
**Root cause:** Line 408: `catch { /* continue with full history */ }` — the entire smartCompact error is silently swallowed. The LLM compaction step (`llmCompact()`) likely fails (provider error, token limit, or timeout), and even though `session-manager.ts` logs warnings internally, the caller in `agent-runner-v2.ts` eats the exception and continues. The heuristic fallback also appears to not execute the DELETE + INSERT (steps 4-5) when the LLM step fails but the function hasn't reached that point yet.
**Fix:** Add `logger.warn` in the catch block. Then trace why `llmCompact()` fails — likely a provider auth issue or the message array is too large for the compaction model.

### C2. Agent Runner V1 Still Active in Production
**Files:** `channel-responder.ts:23`, `engine-service.ts:34`, `heartbeat-scheduler.ts:22`, `agent-worker.ts:8`, `federation-manager.ts:14`, `squad-runner.ts:21`
**Bug:** V1 `agent-runner.ts` (1206 LOC) is imported by **8 production files**. V2 exists but coexists alongside V1. The `channel-responder.ts` dynamically chooses V1 or V2 based on `engineVersion` flag, but existing agents migrated from V1 may still use the old runner.
**Risk:** V1 lacks total-context-aware compaction, improved truncation handling, and the `messageBudgetTokens` calculation. Any agent with `engine_version=1` silently uses the inferior runner.
**Fix:** Migrate all agents to `engine_version=2` and remove V1 imports. Keep V1 file for reference but break the import chain.

### C3. 15 Unguarded `void` Async Calls
**Files:** `automations.ts`, `heartbeat-scheduler.ts`, `agent-worker.ts`, `workflow-engine.ts`, `session-consolidator.ts`, `self-watchdog.ts`, `telegram-adapter.ts`
**Bug:** Fire-and-forget async calls without `.catch()`. If these reject, they become **unhandled promise rejections** which in Node.js 22 crash the process.
**Fix:** Add `.catch(err => logger.error(...))` to each, or use a `safeFire()` helper.

---

## 🟡 Medium (Next Sprint)

### M1. SQL Column Injection Vector
**Files:** `db/finetune.ts:131`, `db/artifacts.ts:88`, `db/squads.ts:65`, `db/agents.ts:82`, `db/external-agents.ts:204`, `db/users.ts:104`, `db/tasks.ts:83`, `db/workflow-repository.ts:205`
**Issue:** Dynamic `UPDATE` queries build column names from application logic: `UPDATE table SET ${updates.join(', ')} WHERE id = ?`. While values use parameterized `?`, the column names are interpolated strings. If any upstream code passes user input as a column name, it's exploitable.
**Risk:** Low (columns come from hardcoded field lists), but violates defense-in-depth.
**Fix:** Whitelist valid column names before interpolation: `if (!ALLOWED_COLUMNS.has(col)) throw`.

### M2. Ollama Adapter — Half the Robustness
**File:** `providers/adapters/ollama-adapter.ts` (190 LOC vs Anthropic 437, OpenAI 462)
**Issue:** Retry count=1 (vs 7 for Anthropic/OpenAI), error handling count=12 (vs 25). Missing: exponential backoff, streaming error recovery, request timeout (no AbortController).
**Fix:** Port retry/backoff pattern from OpenAI adapter.

### M3. Dual Message State (session-store + message-store)
**Files:** `session-store.ts` (messages[] flat), `message-store.ts` (Map<sessionId, Message[]>)
**Issue:** Messages exist in two stores written in parallel. Race conditions between SSE events can cause divergence. `session-store.messages[]` is the primary render source, `message-store` is secondary. Creates confusion and potential ghost messages.
**Fix:** Deprecate `session-store.messages[]` flat array; derive from `message-store` Map.

### M4. 3 Concurrent SSE Paths
**Files:** `useGlobalSSE` (page.tsx:127), `useSessionEvents` (ChatArea.tsx:62), inline SSE parser in `session-store.ts:sendMessage()`
**Issue:** Three separate EventSource/SSE mechanisms coexist. `useGlobalSSE` is the wildcard agent status stream. `useSessionEvents` is a per-session stream (behind feature flag `ENABLE_MESSAGE_BUS=false`). The inline parser in `sendMessage` handles message-level SSE. All three can be active simultaneously, causing duplicate processing and memory pressure.
**Fix:** Consolidate into single SSE multiplexer.

### M5. session-store God Object (731 LOC, 31 set() calls)
**File:** `stores/session-store.ts`
**Issue:** Handles sessions, messages, streaming state, tool tracking, squad workflow, SSE parsing — all in one Zustand store. 731 lines with 31 `set()` calls. Hard to reason about state transitions.
**Fix:** Split into `session-store` (CRUD), `streaming-store` (SSE + streaming state), `sse-store` (event parsing).

### M6. Unused API Routes with No Frontend
**Routes:** `/api/presentations` (0 refs), `/api/finetune` (0 refs), `/api/embeddings` (0 refs)
**Issue:** Server-side routes with full CRUD but zero frontend consumers. Dead attack surface.
**Fix:** Gate behind feature flag or remove from router registration.

### M7. Empty Catch Blocks — Silent Failures
**File:** `lib/tunnel.ts` (8 empty catches), `channel-responder.ts` (6 empty catches)
**Issue:** Errors are swallowed without logging. `tunnel.ts` alone has 8 `catch {}` blocks. When tunnels fail to connect or gist publishing fails, there's no trace.
**Fix:** At minimum add `logger.debug()` in each catch.

---

## 🟢 Low (Backlog)

### L1. Dead V1 Runner Code (1206 LOC)
`agent-runner.ts` is 1206 lines. Once C2 migration is done, this can be archived.

### L2. Unused Imports in Engine Files
15+ unused imports detected across `tools/*.ts`, `embeddings.ts`, `canvas-host.ts`, `agent-runner.ts`, `turn-manager.ts`. Tree-shaking handles this for builds but clutters code review.

### L3. `as any` Usage (9 instances)
Mostly in tests (5) and DB queries (4). Low risk but should be typed properly.

### L4. Magic Numbers
`MAX_DELAY_MS = 15000` duplicated across 3 adapter files. Should be a shared constant.

### L5. Federation TODO
`federation-manager.ts:733` — "need stored token for reconnection". Reconnection after server restart won't work without persisted WS token.

### L6. Workflow Engine TODO
`workflow-engine.ts:88` — "implement model routing". Phase 2 of workflows is incomplete.

---

## 📊 Health Summary

| Category | Score | Notes |
|----------|-------|-------|
| **Error Handling** | 5/10 | Too many swallowed errors (SmartCompact, tunnel, void async) |
| **Type Safety** | 8/10 | Only 9 `as any`, good TS discipline |
| **Security** | 7/10 | No hardcoded secrets, but SQL column injection vector exists |
| **Code Hygiene** | 6/10 | Dead V1 code, unused imports, 3 unused API routes |
| **Architecture** | 6/10 | Dual message state, 3 SSE paths, God Object store |
| **Test Coverage** | 8/10 | 469 server tests, all passing |
| **Overall** | 6.5/10 | Solid beta — error handling is the #1 improvement area |

---

## 🎯 Recommended Fix Order

1. **C1** SmartCompact — add logging + fix LLM compaction failure → directly fixes context explosion
2. **C2** Migrate all agents to V2 → removes V1 code path risk
3. **C3** Guard void async calls → prevents process crashes
4. **M7** Add logging to empty catches → improves debuggability for all future issues
5. **M1** SQL column whitelist → defense-in-depth
6. **M2** Ollama adapter hardening → if Ollama is used as fallback
