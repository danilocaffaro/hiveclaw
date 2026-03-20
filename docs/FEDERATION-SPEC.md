# HiveClaw Federation Spec — Shared Squads Between Instances

> Two HiveClaw instances form a bilateral link. Each contributes agents.
> Both sides see the full squad in their own UI. Messages and responses
> are synced in real-time over a persistent WebSocket.

## 1. Problem

The current external-agent system is **unilateral**: Host invites a remote
webhook agent that responds but has no UI visibility. The remote side is blind.

**Goal**: When Instance A invites Instance B into a squad, BOTH instances
see the full squad — local + remote agents — in their respective UIs, with
real-time message sync.

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Instance** | A running HiveClaw server with its own agents, DB, and UI |
| **Federation Link** | Persistent WebSocket between two instances |
| **Host** | The instance that created the squad |
| **Guest** | The instance that was invited |
| **Federated Squad** | A squad visible on both sides, with agents from both |
| **Shadow Agent** | A read-only agent entry representing a remote agent in the local DB |
| **Shadow Squad** | A local squad entry that mirrors a remote federated squad |

## 3. Architecture

```
┌──────────────────────┐          WebSocket           ┌──────────────────────┐
│  Instance A (Host)   │  ◄═══════════════════════►   │  Instance B (Guest)  │
│                      │    Federation Protocol        │                      │
│  Agents:             │                               │  Agents:             │
│    Coder (local)     │    ── agent.manifest ──►      │    Alice 🐕 (local)  │
│    Researcher (local)│  ◄── agent.manifest ──        │    Clark 🐙 (local)  │
│                      │                               │                      │
│  Shadow Agents:      │    ── message.sync ──►        │  Shadow Agents:      │
│    Alice 🐕 (shadow) │  ◄── message.sync ──         │    Coder (shadow)    │
│    Clark 🐙 (shadow) │                               │    Researcher (shadow│
│                      │    ── agent.response ──►      │                      │
│  Squad: "Dream Team" │  ◄── agent.response ──       │  Squad: "Dream Team" │
│  (federated)         │                               │  (shadow)            │
│                      │    ── squad.event ──►         │                      │
│  UI: sees ALL agents │  ◄── squad.event ──           │  UI: sees ALL agents │
└──────────────────────┘                               └──────────────────────┘
```

## 4. Federation Protocol (WebSocket Messages)

All messages are JSON with `{ type, payload, ts, nonce }`.

### 4.1 Handshake

```
Guest → Host:
{
  type: "federation.hello",
  payload: {
    instanceId: "uuid-of-guest",
    instanceName: "Danilo's HiveClaw",
    version: "1.3.2",
    token: "pairing-token-from-invite"
  }
}

Host → Guest:
{
  type: "federation.welcome",
  payload: {
    instanceId: "uuid-of-host",
    instanceName: "Friend's HiveClaw",
    linkId: "uuid-of-federation-link",
    squadId: "uuid-of-shared-squad"
  }
}
```

### 4.2 Agent Manifest Exchange

After handshake, both sides declare their contributed agents:

```
Both → Both:
{
  type: "agent.manifest",
  payload: {
    agents: [
      { id: "local-id", name: "Alice 🐕", emoji: "🐕", role: "lead",
        capabilities: ["reasoning", "web_search", "code"] },
      { id: "local-id-2", name: "Clark 🐙", emoji: "🐙", role: "ops",
        capabilities: ["code", "bash", "file_ops"] }
    ]
  }
}
```

The receiving side creates **shadow agents** — local DB entries with
`type: 'shadow'` and `federation_link_id` pointing to the link.

### 4.3 Message Sync

When a user sends a message to the federated squad:

```
Origin → Peer:
{
  type: "message.sync",
  payload: {
    squadId: "shared-squad-id",
    message: {
      id: "msg-uuid",
      role: "user",
      content: "Research the latest on AI agents",
      senderName: "Danilo",
      senderType: "human",
      timestamp: "2026-03-20T12:00:00Z"
    }
  }
}
```

### 4.4 Agent Invocation (Host → Guest)

When the squad router selects a remote agent:

```
Host → Guest:
{
  type: "agent.invoke",
  payload: {
    requestId: "req-uuid",
    agentId: "remote-agent-local-id",  // the ID as known on the guest side
    squadId: "shared-squad-id",
    messages: [ ... ],  // conversation context
    previousResponses: [ ... ],  // ECHO-FREE context
    turnNumber: 2,
    totalTurns: 4,
    toolMode: "remote"  // "remote" = agent uses own tools; "host" = relay tools
  }
}
```

### 4.5 Agent Response (Guest → Host)

Guest runs the agent locally and streams deltas:

```
Guest → Host:
{
  type: "agent.delta",
  payload: {
    requestId: "req-uuid",
    agentId: "agent-local-id",
    text: "Based on my research...",
    done: false
  }
}

// Final:
{
  type: "agent.finish",
  payload: {
    requestId: "req-uuid",
    agentId: "agent-local-id",
    fullText: "Based on my research, here are the key findings...",
    toolsUsed: ["web_search", "webfetch"],
    tokenUsage: { input: 2400, output: 850 }
  }
}
```

### 4.6 Squad Events

Sync squad-level events (member changes, routing changes, etc.):

```
{
  type: "squad.event",
  payload: {
    event: "agent_added" | "agent_removed" | "routing_changed" | "squad_renamed",
    data: { ... }
  }
}
```

### 4.7 Presence & Heartbeat

```
// Every 30s
{ type: "federation.ping", payload: { activeAgents: ["id1", "id2"] } }
{ type: "federation.pong", payload: { activeAgents: ["id3", "id4"] } }
```

## 5. DB Schema Changes

### New table: `federation_links`

```sql
CREATE TABLE federation_links (
  id TEXT PRIMARY KEY,
  peer_instance_id TEXT NOT NULL,
  peer_instance_name TEXT NOT NULL,
  peer_url TEXT,                        -- for reconnection
  direction TEXT CHECK(direction IN ('host', 'guest')),
  shared_squad_id TEXT NOT NULL,
  connection_token_hash TEXT NOT NULL,   -- SHA-256
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'disconnected', 'revoked')),
  last_seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (shared_squad_id) REFERENCES squads(id)
);
```

### New columns on `agents`

```sql
ALTER TABLE agents ADD COLUMN federation_link_id TEXT REFERENCES federation_links(id);
ALTER TABLE agents ADD COLUMN is_shadow INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN remote_agent_id TEXT;  -- ID on the remote side
```

Shadow agents: `is_shadow = 1`, `federation_link_id` set, `provider_preference = '__federation__'`.

### New table: `federation_pairing`

```sql
CREATE TABLE federation_pairing (
  token TEXT PRIMARY KEY,
  squad_id TEXT NOT NULL,
  contributed_agent_ids TEXT DEFAULT '[]',  -- JSON array of local agent IDs to share
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  accepted INTEGER DEFAULT 0,
  accepted_link_id TEXT,

  FOREIGN KEY (squad_id) REFERENCES squads(id)
);
```

## 6. Implementation Files

| File | Action | Description |
|------|--------|-------------|
| **`engine/federation/federation-link.ts`** | Create | WebSocket client/server for federation connections |
| **`engine/federation/federation-protocol.ts`** | Create | Message types, serialization, validation |
| **`engine/federation/federation-manager.ts`** | Create | Manages all active links, routes messages, handles reconnect |
| **`engine/federation/shadow-agent.ts`** | Create | Creates/updates/removes shadow agent entries |
| **`api/federation.ts`** | Create | REST API for pairing, link management, status |
| **`db/federation.ts`** | Create | Repository for `federation_links` + `federation_pairing` |
| **`db/schema.ts`** | Modify | Add federation tables + agent columns |
| **`engine/squad-runner.ts`** | Modify | Route to federation manager instead of external bridge for shadow agents |
| **`engine/channel-responder.ts`** | Modify | Detect federated squad sessions, route through federation |
| **`api/sse.ts`** | Modify | Bridge federation agent.delta events to SSE for frontend |
| **`apps/web/` (multiple)** | Modify | Show shadow agents in UI, federation status indicator |

## 7. Flows

### 7.1 Pairing Flow (one-time)

```
Host UI: "Create Federated Squad" or "Federate existing squad"
  → POST /api/federation/pair
  → Returns: { token, inviteUrl, expiresIn }
  → Host shares inviteUrl with Guest

Guest UI: "Join Federated Squad" → enters invite URL/token
  → POST /api/federation/accept { token }
  → Guest connects WS to Host
  → Handshake: hello → welcome
  → Agent manifests exchanged
  → Shadow agents created on both sides
  → Squad visible on both UIs ✅
```

### 7.2 Message Flow (runtime)

```
User on Host types message → Squad runner starts
  → Turn 1: Coder (local) → runs locally → response synced to Guest
  → Turn 2: Alice 🐕 (shadow) → federation.invoke → Guest runs Alice → streams back
  → Turn 3: Researcher (local) → runs locally → response synced to Guest
  → Turn 4: Clark 🐙 (shadow) → federation.invoke → Guest runs Clark → streams back
  → All responses visible on BOTH UIs via SSE + federation sync
```

User on Guest can ALSO send messages:
```
User on Guest types message → detected as federated squad
  → Message synced to Host via federation link
  → Host's squad runner orchestrates (it owns the routing strategy)
  → Responses stream back to both sides
```

### 7.3 Reconnection

```
WS drops → Guest auto-reconnects with saved peer_url + token
  → Re-sends federation.hello
  → Host validates token, resumes link
  → Missed messages replayed (last N from squad session)
```

## 8. Security

- **Pairing tokens**: Random 32 bytes, SHA-256 hashed in DB, expire in 10 minutes
- **Connection tokens**: Separate from pairing, generated on accept, long-lived, rotatable
- **TLS required** for production (wss://)
- **Agent isolation**: Shadow agents can't execute local tools — all tool execution happens on the agent's home instance
- **Message validation**: All federation messages validated against schema
- **Rate limiting**: Per-link rate limits on messages and invocations
- **Revocation**: Either side can revoke the link → shadows deleted, squad unfederated

## 9. Relation to Existing Infrastructure

### Replaces (for federated use cases)
- `external-agent-bridge.ts` → federation handles agent invocation directly
- `InviteAgentModal.tsx` (pairing flow) → new federation pairing flow

### Keeps (backward compatible)
- `external-agents` table/API → still works for simple webhook agents
- `InviteExternalModal.tsx` → still works for non-HiveClaw external agents
- `ExternalAgentsPanel.tsx` → still shows webhook-based external agents

### Reuses
- `rpc-host.ts` patterns → WebSocket management, HMAC, reconnect
- `squad-runner.ts` → orchestration logic (just needs new dispatch path for shadows)
- `broadcastSSE()` → frontend notification (bridge federation events → SSE)

## 10. Phase Plan

### Phase 1: Core Federation Link (~6h)
- DB schema (tables + migrations)
- Federation protocol types
- WebSocket server endpoint (`/federation/ws`)
- WebSocket client (for guest connecting to host)
- Federation manager (connection lifecycle)
- Pairing flow (create invite → accept → establish link)
- Agent manifest exchange → shadow agent creation

### Phase 2: Squad Integration (~4h)
- Squad runner: route shadow agents through federation
- Message sync: user messages replicated to peer
- Agent response streaming through federation link
- SSE bridge: federation deltas → frontend SSE
- Both UIs show full squad with all agents

### Phase 3: Guest-Side Interaction (~3h)
- Guest can send messages to federated squad
- Messages routed to host for orchestration
- Host streams responses back
- Bidirectional conversation

### Phase 4: UI + Polish (~3h)
- Federation status indicator in UI (connected/disconnected/reconnecting)
- "Federate Squad" button in squad settings
- "Join Federation" page/modal for accepting invites
- Shadow agent badges (visual distinction from local agents)
- Link management UI (revoke, reconnect, status)

**Total estimated: ~16 hours across 4 phases.**

## 11. Example: Alice Joins Friend's Squad

```
1. Friend opens HiveClaw UI → Squad "Dev Team" (Coder + Researcher)
2. Friend clicks "Federate Squad" → generates invite link
3. Friend sends link to Danilo via Telegram
4. Danilo opens his HiveClaw UI → "Join Federation" → pastes link
5. Danilo selects which agents to contribute: Alice 🐕, Clark 🐙
6. WebSocket link established
7. Friend's UI now shows: Coder, Researcher, Alice 🐕 (remote), Clark 🐙 (remote)
8. Danilo's UI now shows: Alice 🐕, Clark 🐙, Coder (remote), Researcher (remote)
9. Friend types: "Build a new feature for the dashboard"
10. Squad runner routes:
    - Coder (local) → runs on friend's server
    - Alice 🐕 (remote) → invoked via federation → runs on Danilo's server
    - Both see all responses in real-time
```

---

*This spec supersedes `REMOTE-AGENTS-SPEC.md` (webhook-only model).
The webhook external agent system remains for non-HiveClaw integrations.*
