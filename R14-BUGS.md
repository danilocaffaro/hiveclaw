# R14 — Bug Fixes from R13 QA

## Bugs Found (R13 QA — API + UI)

### CRITICAL (P0)
1. **FTS index corruption** ✅ FIXED in R13 (commit `d2056f0`)
   - All new messages failed silently with `constraint failed`
   - Auto-repair on startup added to `schema.ts`

### HIGH (P1)
2. **Sidebar shows "No messages yet" for sessions with messages**
   - Clark session has 5+ messages but sidebar preview stuck on empty
   - Root cause: sidebar only updates from initial load, not SSE events
   - Fix: wire SSE `message.finish` events to update sidebar last_message

3. **Memory noise: tool_fact pollution**
   - Clark has 122/138 memories as `fact` type, mostly `tool_fact_*` garbage
   - Extracts code snippets, ANSI escape codes, SQL fragments from tool outputs
   - Fix: filter tool outputs in memory extraction (skip `source:auto_extract_tool` with `relevance < 0.8`, or add content quality check)

### MEDIUM (P2)
4. **Invite API returns 500 on invalid role** ✅ FIXED in R13 (commit `d2056f0`)
   - Now returns 400 with validation message

5. **Clark still says "SuperClaw Pure" in responses**
   - Operational awareness / system prompt may reference old name
   - Fix: update Clark's core memory blocks + system prompt

6. **Engine Providers panel says "No providers configured"** (misleading)
   - Top section shows "⚠️ No providers configured" even though API keys are set below
   - The "Engine Providers" section expects a different provider registration mechanism
   - Fix: hide confusing top warning when any local API key is connected

## Resolved (Not Bugs)
- Auth endpoint: test used `/auth/status` but correct is `/auth/me`
- Squad strategy: test checked `strategy` but field is `routingStrategy`
- Automation DELETE: returns 200 (not 204) — app convention, not a bug

## QA Summary
| Tier | Scenarios | Pass | Rate |
|------|-----------|------|------|
| API (Tier 1) | 49 | 47 | 96% |
| UI Visual (Tier 2) | 13 | 13 | 100% |
| **Total** | **62** | **60** | **97%** |

## R14 Scope (estimated 4h)
- [ ] B2: Sidebar last_message not updating (1.5h)
- [ ] B3: Memory extraction quality filter (1h)
- [ ] B5: Clark rebrand cleanup — core memory + system prompt (0.5h)
- [ ] B6: Provider panel "no providers" warning (0.5h)
- [ ] Memory garbage cleanup — bulk delete tool_fact entries (0.5h)
