# HiveClaw — Backlog & Execution Plan

> **Atualizado:** 2026-03-15 20:06 BRT
> **Princípio:** Small Batches CI/CD — cada batch é deployável, testável, e entrega valor isolado.
> **Gate:** 0 TS errors + tests pass + QA visual antes de merge.

---

## 🔴 Bugs Abertos

| # | Bug | Severidade | Est. | Batch |
|---|-----|-----------|------|-------|
| B12 | Messages via API não aparecem na UI (SSE miss) | Medium | ✅ NOT A BUG | R1 |
| B13 | Squad runner self-reply bug | Medium | ✅ FIXED | R1 |
| B14 | User bubble text não selecionável/copiável | High | ✅ FIXED | R1 |
| B15 | Skills path mismatch (skills dir empty) | High | ✅ FIXED `4119c02` | R1 |
| B16 | Skill Scout hard-coded to Gemini only | Medium | ✅ FIXED `bfb690d` | R1 |

---

## 🔵 Features Abertas

| # | Feature | Prioridade | Est. | Batch |
|---|---------|-----------|------|-------|
| F15 | External user invite (modelo TC2) | 🔴 Critical | 12h | R4-R5 |
| F16 | Update system (versão + releases + DB migrations) | 🔴 Critical | 10h | R3 |
| F17 | RSP Browser funcional | 🟡 Medium | 6h | R6 |
| F18 | Agent live preview / workspace visibility | 🟡 Medium | 8h | R7 |
| F19 | Automation/Cron creator + viewer per agent | 🔴 High | 12h | R5-R6 |
| F20 | Tasks integradas ao Squad runner | 🟡 Medium | 6h | R6 |
| R14 | Agent-to-agent auth protocol | 🟡 Medium | 4h | R4 |

---

## 🏃 Execution Plan — Small Batches

### Batch R1 — Bug Blitz (4h)
> **Goal:** Zero known bugs. Clean slate before features.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R1.1 | **B14: Text selection fix** | User bubbles fully selectable + copy works on desktop & mobile | 1h |
| R1.2 | **B13: Squad self-reply** | Squad runner skips self when routing @mentions | 1h |
| R1.3 | **B12: API messages in UI** | SSE event emitted for API-injected messages; UI updates real-time | 2h |

**Deploy gate:** All 3 fixed → `pnpm test` pass → build → commit → deploy
**Commit:** `fix: B12+B13+B14 — bug blitz R1`

---

### Batch R2 — Foundation Cleanup (6h) ✅ DONE (commit `07703c2`)
> **Goal:** Codebase health before big features.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R2.1 | **Version source of truth** | Single `version` in root `package.json` (`0.2.0`), propagated to server + web at build time. `/api/version` endpoint returns `{ version, commit, buildDate }` | 1.5h |
| R2.2 | **DB Migration system** | `migrations/` folder with numbered SQL files. Server runs pending migrations on startup. `schema_version` table tracks applied. | 3h |
| R2.3 | **`/api/health` endpoint** | JSON: version, uptime, db status, memory, agent count | 30m |
| R2.4 | **GitHub Release v0.2.0** | Tag + changelog + Windows zip asset via `gh release create` | 1h |

**Deploy gate:** Migration system tested with real DB → tests pass → tagged release
**Commit:** `feat: R2 — version system + DB migrations + health endpoint`

---

### Batch R3 — Update System (4h) ✅ DONE (commit `18a7189`, release v0.2.0)
> **Goal:** Users know when there's an update and can act on it.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R3.1 | **Update check on startup** | Server calls GitHub API `/repos/.../releases/latest` on boot, compares semver. Logs result. Caches 24h. | 1.5h |
| R3.2 | **UI update banner** | Settings page shows "Update available: v0.3.0 → Download" when newer version exists. Non-intrusive. | 1.5h |
| R3.3 | **Self-update (source installs)** | Button in Settings: runs `git pull && pnpm install && pnpm build` + server restart. Source-only (not bundles). | 1h |

**Deploy gate:** Tested with mock release → banner appears → self-update works on Mac Mini
**Commit:** `feat: R3 — update check + UI banner + self-update`

---

### Batch R4 — Multi-User Foundation (8h) ✅ DONE (commit `341ff45`)
> **Goal:** Other humans can access your HiveClaw. Auth + invite basics.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R4.1 | **`users` table + auth** | Table: `id, name, email, role (owner/admin/member/guest), pin_hash, token, created_at`. Owner auto-created from first setup. Token-based session auth (cookie). | 2h |
| R4.2 | **Invite link generation** | `POST /api/invites` → generates `https://host/invite/{code}` with expiry (7 days), max uses, role assignment, agent access list. Stored in `invites` table. | 2h |
| R4.3 | **Invite accept flow** | `/invite/{code}` → landing page: enter name + optional PIN → creates user → redirects to chat. No email required for guests. | 2.5h |
| R4.4 | **Agent access control** | Each invite/user has `allowed_agents[]`. Guest only sees/chats with permitted agents. Owner sees all. | 1.5h |

**Deploy gate:** Owner creates invite → shares link → guest joins → can chat with allowed agent → owner sees guest in user list
**Commit:** `feat: R4 — multi-user auth + invite links`

---

### Batch R5 — Invite UX + Management (4h) ✅ DONE (commit `5841e66`)
> **Goal:** TC2-quality invite experience. Owner can manage users.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R5.1 | **Invite modal redesign** | New "Invite People" button in sidebar or settings. Generate link → share via copy/WhatsApp/email. Shows active invites with status. Replaces current InviteAgentModal. | 2h |
| R5.2 | **User management panel** | Settings → Users tab: list all users, their role, last active, revoke access, change permissions. | 1.5h |
| R5.3 | **Guest chat experience** | Guest lands directly in chat (no setup wizard, no settings). Clean UI: agent avatar + chat only. Branding from owner config. | 30m |

**Deploy gate:** Full invite → join → chat → manage → revoke cycle works
**Commit:** `feat: R5 — invite UX + user management panel`

---

### Batch R6 — Automation Engine (8h)
> **Goal:** Agents have scheduled tasks, crons, heartbeats — visible in UI.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R6.1 | **Scheduler engine** | `scheduler.ts`: cron-like engine using `node-cron` or simple interval system. `automations` table: `id, agent_id, name, type (cron/interval/trigger), schedule, action (message/tool/workflow), enabled, last_run, next_run`. Runs in-process. | 3h |
| R6.2 | **Automation CRUD API** | `POST/GET/PATCH/DELETE /api/automations`. Per-agent scoping. Validate cron expressions. | 1.5h |
| R6.3 | **Automation UI — Create/Edit** | Per-agent "Automations" tab (or in agent settings). Create: name, schedule (dropdown presets + custom cron), action type (send message to agent / run tool / trigger workflow). Visual preview of schedule. | 2h |
| R6.4 | **Automation UI — List/Monitor** | Dashboard view: all automations across agents. Status (active/paused/error), last run, next run, run history with output. Filter by agent. | 1.5h |

**Deploy gate:** Create automation "check news every 2h" → scheduler fires → agent responds → visible in history
**Commit:** `feat: R6 — automation engine + scheduler + UI`

---

### Batch R7 — Squad Intelligence (6h)
> **Goal:** Tasks and squad runner work together. Agents coordinate via tasks.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R7.1 | **Squad → Task auto-creation** | When squad starts, each agent step creates a task (status: todo). As agent executes, moves to doing → done. Visible in SprintPanel. | 2h |
| R7.2 | **Task context injection** | Agent receives active tasks in system prompt. Can update task status/notes via tool. | 2h |
| R7.3 | **Task-based squad coordination** | Squad runner checks task board: if agent A's task is done, agent B starts. Dependencies expressible. | 2h |

**Deploy gate:** Start squad → tasks auto-created → agents execute → Kanban updates live → squad completes with all tasks done
**Commit:** `feat: R7 — squad-task integration`

---

### Batch R8 — RSP Browser + Agent Visibility (6h)
> **Goal:** See what agents are doing. Browser that actually works.

| Step | Item | Deliverable | Time |
|------|------|-------------|------|
| R8.1 | **RSP Browser via iframe** | Replace screenshot-based browser with sandboxed iframe for safe URLs. Fallback to screenshot for cross-origin. Navigation, back/forward work. | 2h |
| R8.2 | **Agent activity feed** | Real-time panel showing agent actions: "🔧 Running bash...", "🌐 Browsing github.com...", "💾 Saved memory...". SSE-powered. | 2h |
| R8.3 | **Agent workspace preview** | Show files agent has created/modified in current session. Click to view in CodePanel. | 2h |

**Deploy gate:** Navigate URL in RSP → loads in iframe. Agent runs task → activity feed shows steps live.
**Commit:** `feat: R8 — RSP browser + agent activity feed`

---

## 📊 Timeline Overview

```
Week 1 (Mar 16-22):
  R1 Bug Blitz ──────── 4h  → commit + deploy
  R2 Foundation ─────── 6h  → commit + tagged release v0.2.0
  R3 Update System ──── 4h  → commit + deploy
                              ─────────────────
                              Total: 14h

Week 2 (Mar 23-29):
  R4 Multi-User ─────── 8h  → commit + deploy
  R5 Invite UX ──────── 4h  → commit + deploy
                              ─────────────────
                              Total: 12h

Week 3 (Mar 30 - Apr 5):
  R6 Automations ────── 8h  → commit + deploy
  R7 Squad Tasks ────── 6h  → commit + deploy
                              ─────────────────
                              Total: 14h

Week 4 (Apr 6-12):
  R8 Browser + Vis ──── 6h  → commit + deploy
  QA E2E Sprint Q ───── 8h  → 57 scenarios
                              ─────────────────
                              Total: 14h
```

**Grand total: ~54h across 4 weeks (8 batches)**

---

## 🔄 CI/CD Protocol per Batch

```
1. Branch: work directly on main (small batches = low risk)
2. Code: implement batch items
3. Test:  pnpm test (229+ tests must pass)
4. Type:  pnpm build (0 TS errors)
5. QA:    visual check in browser (Safari + mobile)
6. Commit: descriptive message with batch ref
7. Deploy: launchctl unload/load (Mac Mini) + verify /api/health
8. Tag:   semver tag on milestone batches (R2, R4, R6)
9. Release: GitHub Release with changelog + Windows zip on tags
```

---

## 🗄️ Version Plan

| Version | Batch | Headline |
|---------|-------|----------|
| v0.1.0 | Current | Initial release — OAuth, Windows bundle, 10-layer memory |
| v0.2.0 | R2 | Version system + DB migrations + health endpoint |
| v0.3.0 | R4-R5 | Multi-user + invite links |
| v0.4.0 | R6 | Automation engine |
| v0.5.0 | R7-R8 | Squad tasks + agent visibility |
| v1.0.0 | Post-QA | Feature-complete, QA-certified |

---

## ❄️ Icebox (not scheduled)

| Item | Notes |
|------|-------|
| Docker + GHCR | Good but not blocking users |
| MCP Client UI | Backend exists, UI later |
| Homebrew formula | After v1.0 |
| `npm publish` / `npx hiveclaw` | After v1.0 |
| Light theme default + Radix Colors | After core features work |
| Swipe-to-reply (mobile) | Nice-to-have |
| Agent templates | Low effort, low urgency |
| Presentation API (reveal.js) | Wow factor, later |
| Starter Kit + Skill Intelligence | Big scope, post-v1.0 |
| Rename GitHub repo superclaw-pure → hiveclaw | ✅ DONE (`288a557`) |

---

*Next action: Execute R1 (Bug Blitz)*
