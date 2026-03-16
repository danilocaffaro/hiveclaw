# HiveClaw — Plan v2 (Post-R11)

> **Context:** R1-R11 complete. 240 tests. v0.2.0 deployed. Automation engine working E2E.
> **Goal:** Define what's next for HiveClaw to reach v1.0 quality.

## Current State
- 4 agents (Clark, Forge, Bolt, Hawk)
- 1 squad (Dream Team — sequential strategy)
- 7 test automations (cleanup needed)
- 26 sessions, 553 messages
- 3 TODOs in code (minor)
- Forge/Bolt have empty `provider` field (partial config)

## Proposed Sprint Plan

### R12 — Cleanup & Hygiene (2h)
1. **Delete 7 test automations** from debug sessions
2. **Fix Forge/Bolt provider config** — both show empty provider field
3. **Remove 3 TODO/FIXME comments** or implement them
4. **Verify all 4 agents can actually respond** — send test message to each
5. **Clean orphaned sessions** from automation debugging

### R13 — QA E2E (8h)
Adler mapped 57 scenarios. Execute them systematically:
- Chat (send, receive, scroll, history)
- Agents (create, edit, delete, switch)
- Squad (create, run, observe)
- Automations (create, schedule, trigger, disable)
- Settings (providers, models, update check)
- Multi-user (invite, join, guest chat, revoke)
- Mobile (responsive, PWA, touch)
- Memory (core blocks, 10-layer, persistence)

Target: **>95% pass rate**. Any failures become R14 bugs.

### R14 — QA Bug Fixes (4-8h)
Fix whatever R13 finds. Estimate depends on results.

### R15 — Agent-to-Agent Communication (6h)
Currently messages via API arrive as `role:user` — agents can't distinguish human vs agent messages.
1. **Auth token per agent** — agent identity in message headers
2. **`sender_type: agent` in DB** — already supported, just not populated via API
3. **Squad inter-agent routing** — agent A can @mention agent B
4. **Agent-to-agent session type** — separate from human sessions

### R16 — Production Polish (6h)
1. **Error boundaries** — React error boundaries for all panels
2. **Loading states** — skeleton screens instead of blank panels
3. **Offline indicator** — when server is down
4. **Graceful degradation** — if provider is offline, show message not crash
5. **Log rotation** — server logs don't grow unbounded
6. **Rate limiting** — basic throttle on API endpoints

### R17 — v1.0 Release (4h)
1. **Comprehensive README** with screenshots
2. **GitHub Release v1.0.0** with full changelog
3. **Updated landing page** with v1.0 features
4. **Windows + Mac bundles**
5. **Tag + announce**

## Timeline
```
R12 Cleanup ────── 2h
R13 QA E2E ─────── 8h
R14 Bug Fixes ──── 4-8h
R15 Agent Auth ─── 6h
R16 Polish ──────── 6h
R17 v1.0 Release ─ 4h
                   ─────
              Total: ~30-34h
```

## Questions for Squad
1. Is R12 cleanup scope complete? Any other tech debt?
2. For R13 QA — should we prioritize mobile or desktop scenarios?
3. R15 agent-to-agent — is the approach right? Alternative designs?
4. R16 polish — what's missing from user-facing quality?
5. Anything else that should be v1.0 vs icebox?

---

*PO: Alice 🐕 | Awaiting squad consensus before execution*
