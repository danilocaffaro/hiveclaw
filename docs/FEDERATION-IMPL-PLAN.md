# Federation — Implementation Plan

> Step-by-step implementation with file paths, dependencies, and test coverage.
> Each step produces a buildable, testable increment.
> Designed for Clark to validate before coding begins.

---

## Phase 1: Core Federation Link (~6h)

### Step 1.1 — DB Schema + Repository (~1h)

**Files:**
- `apps/server/src/db/federation.ts` — **CREATE** — `FederationRepository` class
  - CRUD for `federation_links` table
  - CRUD for `federation_pairing` table
  - `createPairingToken(squadId, agentIds, expiresInMinutes)` → token
  - `consumePairingToken(token)` → link data or null
  - `createLink(peerInstanceId, peerName, peerUrl, direction, squadId, tokenHash)` → link
  - `updateLinkStatus(linkId, status)` → void
  - `listLinks()` → FederationLink[]
  - `deleteLink(linkId)` → cascades shadow agents
- `apps/server/src/db/schema.ts` — **MODIFY** — Add 2 new tables + 3 ALTER TABLE on agents
- `apps/server/src/db/index.ts` — **MODIFY** — Register `FederationRepository`

**Schema (SQL):**
```sql
-- New table
CREATE TABLE IF NOT EXISTS federation_links (
  id TEXT PRIMARY KEY,
  peer_instance_id TEXT NOT NULL,
  peer_instance_name TEXT NOT NULL,
  peer_url TEXT,
  direction TEXT CHECK(direction IN ('host', 'guest')),
  shared_squad_id TEXT NOT NULL,
  connection_token_hash TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'disconnected', 'revoked')),
  last_seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shared_squad_id) REFERENCES squads(id)
);

-- New table
CREATE TABLE IF NOT EXISTS federation_pairing (
  token_hash TEXT PRIMARY KEY,
  squad_id TEXT NOT NULL,
  contributed_agent_ids TEXT DEFAULT '[]',
  expires_at DATETIME NOT NULL,
  accepted INTEGER DEFAULT 0,
  accepted_link_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (squad_id) REFERENCES squads(id)
);

-- Extend agents table (safe ALTERs with IF NOT EXISTS check)
-- federation_link_id TEXT REFERENCES federation_links(id)
-- is_shadow INTEGER DEFAULT 0
-- remote_agent_id TEXT
```

**Tests:** DB-01 through DB-10 (10 tests)

---

### Step 1.2 — Federation Protocol Types (~30min)

**Files:**
- `apps/server/src/engine/federation/federation-protocol.ts` — **CREATE**
  - TypeScript interfaces for all message types:
    - `FederationHello`, `FederationWelcome`
    - `AgentManifest`, `AgentManifestEntry`
    - `MessageSync`, `AgentInvoke`, `AgentDelta`, `AgentFinish`
    - `SquadEvent`, `FederationPing`, `FederationPong`
  - `FederationMessage` union type
  - `validateMessage(data: unknown): FederationMessage | null` — schema validation
  - `serializeMessage(msg: FederationMessage): string` — JSON stringify with type guard

**Tests:** WS-12 (validation), plus type-level tests

---

### Step 1.3 — Federation Manager (~2h)

**Files:**
- `apps/server/src/engine/federation/federation-manager.ts` — **CREATE**
  - Singleton: `getFederationManager()`
  - **Host side:**
    - `handleConnection(ws, token)` → validate, create link, send welcome
    - `handleMessage(linkId, msg)` → route by type
    - `invokeRemoteAgent(linkId, agentId, messages, context)` → AsyncGenerator<AgentEvent>
    - `syncMessage(linkId, message)` → send message.sync to peer
    - `broadcastSquadEvent(linkId, event)` → send squad.event
  - **Guest side:**
    - `connectToHost(peerUrl, token, localAgents)` → establish WS, send hello
    - `handleInvoke(requestId, agentId, messages)` → run local agent, stream deltas back
  - **Shared:**
    - `heartbeat()` → ping/pong every 30s
    - `reconnect(linkId)` → auto-reconnect with backoff
    - `getLink(linkId)` → link status
    - `revokeLink(linkId)` → close WS, delete shadows, update status

**Dependencies:** federation-protocol.ts, federation.ts (DB), ws library (already installed)

**Tests:** WS-03 through WS-11, INV-01 through INV-03, INV-06, INV-07, INV-09

---

### Step 1.4 — Shadow Agent Manager (~30min)

**Files:**
- `apps/server/src/engine/federation/shadow-agent.ts` — **CREATE**
  - `createShadowAgents(linkId, manifest: AgentManifestEntry[])` → creates DB entries
  - `removeShadowAgents(linkId)` → deletes all shadows for a link
  - `updateShadowAgent(linkId, remoteAgentId, updates)` → sync name/emoji/role changes
  - `getShadowAgents(linkId)` → list shadow agents for a link
  - `isShadowAgent(agentId)` → boolean check

**Tests:** WS-05, DB-06, DB-07

---

### Step 1.5 — WebSocket Endpoint + Pairing API (~1.5h)

**Files:**
- `apps/server/src/api/federation.ts` — **CREATE** — REST routes:
  - `POST /api/federation/pair` → create pairing token
  - `GET /api/federation/pair/:token/info` → validate, return invite info
  - `POST /api/federation/accept` → consume token, return WS URL
  - `GET /api/federation/links` → list links
  - `GET /api/federation/links/:id/status` → connection state
  - `DELETE /api/federation/links/:id` → revoke
- `apps/server/src/index.ts` — **MODIFY** — Register federation routes + attach WS handler
  - Attach federation WS at path `/federation/ws` (alongside existing node RPC at `/rpc`)

**Tests:** API-01 through API-10, WS-01, WS-02, SEC-01, SEC-05

---

### Step 1.6 — Wire Everything + Smoke Test (~30min)

- Register `FederationRepository` in DB init
- Register federation API routes in server
- Attach WS endpoint to HTTP server
- Single integration test: create pairing → accept → WS connected → manifests exchanged → shadow agents visible

**Tests:** Full Phase 1 integration test

---

## Phase 2: Squad Integration (~4h)

### Step 2.1 — Squad Runner: Shadow Agent Dispatch (~1.5h)

**Files:**
- `apps/server/src/engine/squad-runner.ts` — **MODIFY**
  - `isExternalAgent()` → also check `isShadowAgent()` for federation routing
  - New function: `runFederatedAgent()` — similar to `runExternalAgent()` but uses federation manager
    - Gets link from shadow agent's `federation_link_id`
    - Calls `federationManager.invokeRemoteAgent(linkId, remoteAgentId, messages, context)`
    - Yields SSE events from the async generator
    - Persists response on host side
  - Update routing in `runRoundRobin`, `runSpecialist`, `runDebate`, `runSequential`

**Tests:** SQ-01 through SQ-05, INV-08

---

### Step 2.2 — Message Sync (~1h)

**Files:**
- `apps/server/src/engine/channel-responder.ts` — **MODIFY**
  - After user message is persisted, check if session's squad is federated
  - If yes, call `federationManager.syncMessage(linkId, message)`
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - `handleMessage` for `message.sync` type:
    - Persist synced message in local session
    - Broadcast via SSE to local frontend

**Tests:** SQ-06, SQ-07

---

### Step 2.3 — Response Streaming Bridge (~1h)

**Files:**
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - `invokeRemoteAgent()` converts `agent.delta` WS messages to SSE events
  - Bridges to `broadcastSSE()` for real-time frontend updates
- `apps/server/src/api/sse.ts` — **MODIFY** (if needed)
  - Ensure SSE events include `agentId`, `agentName`, `agentEmoji` for remote agents

**Tests:** INV-02, INV-03, UI-10, UI-11

---

### Step 2.4 — Squad Event Sync (~30min)

**Files:**
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - Handle `squad.event` messages (agent_added, agent_removed, routing_changed)
  - Update local shadow agents and squad config accordingly
- `apps/server/src/api/squads.ts` — **MODIFY**
  - When squad is modified, emit `squad.event` to federation if linked

**Tests:** SQ-08, SQ-09

---

## Phase 3: Guest-Side Interaction (~3h)

### Step 3.1 — Guest Message Routing (~1.5h)

**Files:**
- `apps/server/src/engine/channel-responder.ts` — **MODIFY**
  - Detect when user sends message to a shadow squad (guest side)
  - Instead of running squad locally, route message to host via federation
  - `federationManager.syncMessage(linkId, userMessage)` with `origin: 'guest'`
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - Host receives guest's user message → runs squad normally
  - All responses synced back via existing `agent.delta`/`agent.finish` flow

**Tests:** SQ-10

---

### Step 3.2 — Guest Agent Invocation Handler (~1h)

**Files:**
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - `handleInvoke()`: when host invokes a guest's agent
    - Load agent config from local DB
    - Run agent via `runAgentV2()` locally
    - Stream `agent.delta` and `agent.finish` back to host via WS

**Tests:** INV-04, INV-05

---

### Step 3.3 — Reconnection & Resilience (~30min)

**Files:**
- `apps/server/src/engine/federation/federation-manager.ts` — **MODIFY**
  - `reconnect()` with exponential backoff (5s → 15s → 60s → 120s max)
  - On reconnect: re-send `federation.hello`, re-exchange manifests
  - Replay missed messages (last N from session since disconnect)

**Tests:** WS-08, WS-09, ERR-01 through ERR-04

---

## Phase 4: UI + Polish (~3h)

### Step 4.1 — Federation UI Components (~1.5h)

**Files:**
- `apps/web/src/components/settings/FederationPanel.tsx` — **CREATE**
  - List active federation links with status
  - Revoke button per link
  - Connection status indicator (green/orange/red dot)
- `apps/web/src/components/FederateSquadModal.tsx` — **CREATE**
  - Select agents to contribute
  - Generate invite link with copy button
  - Countdown timer, polling for acceptance
- `apps/web/src/components/JoinFederationModal.tsx` — **CREATE**
  - Paste invite link/token
  - Select local agents to contribute
  - Show connecting → connected → agent list

**Tests:** UI-01 through UI-05, UI-12

---

### Step 4.2 — Squad UI Updates (~1h)

**Files:**
- `apps/web/src/components/sidebar/SquadTreeItem.tsx` — **MODIFY**
  - Show "hybrid" badge for federated squads
- `apps/web/src/components/chat/MessageBubble.tsx` — **MODIFY**
  - Show "external" badge for shadow agent messages
- `apps/web/src/components/settings/AgentsTab.tsx` — **MODIFY**
  - Filter out shadow agents from DM agent list
  - Show shadow agents only in federated squad context
- Squad member list: local agents = normal, shadow agents = subtle badge/opacity

**Tests:** UI-06 through UI-11, UI-13, UI-14

---

### Step 4.3 — Notifications & Polish (~30min)

**Files:**
- `apps/web/src/components/chat/` — **MODIFY**
  - SSE event handling for federation agent deltas
  - Scroll-to-bottom on remote agent response
  - Typing indicator for remote agents

**Tests:** UI-15, UI-16

---

## Dependency Graph

```
Step 1.1 (DB) ──────────┐
Step 1.2 (Protocol) ─────┤
                          ├──► Step 1.3 (Manager) ──► Step 1.5 (API/WS) ──► Step 1.6 (Wire)
Step 1.4 (Shadow) ────────┘                                                       │
                                                                                   ▼
                                                                    Step 2.1 (Squad dispatch)
                                                                           │
                                                          ┌────────────────┼────────────────┐
                                                          ▼                ▼                ▼
                                                   Step 2.2         Step 2.3         Step 2.4
                                                   (Msg sync)       (Streaming)      (Events)
                                                          │                │
                                                          ▼                ▼
                                                   Step 3.1         Step 3.2
                                                   (Guest route)    (Guest invoke)
                                                          │
                                                          ▼
                                                   Step 3.3 (Reconnect)
                                                          │
                                                          ▼
                                             Step 4.1 → 4.2 → 4.3 (UI)
```

## Summary

| Phase | Steps | Files Created | Files Modified | New Tests | Hours |
|-------|-------|---------------|----------------|-----------|-------|
| 1 | 6 | 5 | 3 | ~45 | ~6h |
| 2 | 4 | 0 | 4 | ~15 | ~4h |
| 3 | 3 | 0 | 2 | ~12 | ~3h |
| 4 | 3 | 3 | 3 | ~16 | ~3h |
| **Total** | **16** | **8** | **12** | **~88** | **~16h** |

### New Files (8):
1. `apps/server/src/db/federation.ts`
2. `apps/server/src/engine/federation/federation-protocol.ts`
3. `apps/server/src/engine/federation/federation-manager.ts`
4. `apps/server/src/engine/federation/shadow-agent.ts`
5. `apps/server/src/api/federation.ts`
6. `apps/web/src/components/settings/FederationPanel.tsx`
7. `apps/web/src/components/FederateSquadModal.tsx`
8. `apps/web/src/components/JoinFederationModal.tsx`

### Modified Files (12):
1. `apps/server/src/db/schema.ts`
2. `apps/server/src/db/index.ts`
3. `apps/server/src/index.ts`
4. `apps/server/src/engine/squad-runner.ts`
5. `apps/server/src/engine/channel-responder.ts`
6. `apps/server/src/api/sse.ts`
7. `apps/server/src/api/squads.ts`
8. `apps/web/src/components/sidebar/SquadTreeItem.tsx`
9. `apps/web/src/components/chat/MessageBubble.tsx`
10. `apps/web/src/components/settings/AgentsTab.tsx`
11. (potentially) `apps/web/src/stores/agent-store.ts`
12. (potentially) `apps/web/src/stores/session-store.ts`

---

*Ready for Clark 🐙 validation before implementation begins.*
