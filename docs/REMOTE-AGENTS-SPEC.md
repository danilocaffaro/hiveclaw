# Remote Agents Spec — HiveClaw Federation

> Inspired by TC2 (Team Chat 2): agents connect to a hub, each with their own
> runtime, and the hub routes messages between them.

## Problem

HiveClaw agents only exist within a single server instance. There's no way for:
- An external AI agent (e.g. Alice running on another HiveClaw) to participate in squads
- Two HiveClaw instances to share agents
- An agent running on OpenClaw to respond as a squad member in HiveClaw

## Design: Agent Federation Protocol

### Core Concept

A remote agent is a regular agent entry in the DB with `type: 'remote'` and a
`remote_url` field. When the engine needs to invoke this agent, instead of
running the local LLM loop, it sends the conversation context to the remote
endpoint and streams the response back.

### Architecture

```
┌──────────────┐     WebSocket/SSE      ┌──────────────────┐
│  HiveClaw A  │ ◄──────────────────►   │  HiveClaw B      │
│  (host)      │                        │  (Alice's server) │
│              │                        │                   │
│ Agent: Alice │  POST /federation/chat │  Receives context │
│ type: remote │ ─────────────────────► │  Runs local agent │
│ remote_url:  │  SSE stream back       │  Streams response │
│  https://... │ ◄───────────────────── │                   │
└──────────────┘                        └──────────────────┘
```

### Two Connection Models

#### Model 1: Webhook (Pull — Host initiates)
- Host HiveClaw POSTs to remote URL when agent is invoked
- Remote processes and streams SSE response
- Simple, works through firewalls if remote has public URL
- Requires remote to expose an endpoint

#### Model 2: WebSocket (Push — Remote connects to Host)
- Remote agent connects to host's WebSocket endpoint (like TC2)
- Host pushes messages when agent is needed
- Remote pushes responses back
- **Works behind NAT** — remote initiates the connection
- Better for always-on agents

### Recommendation: Start with Model 2 (WebSocket)

TC2-inspired. The remote agent connects to the host, not the other way around.
This means:
1. No need for the remote to have a public URL
2. No firewall/NAT issues
3. Persistent connection = lower latency
4. Host knows immediately if remote is online/offline

### Protocol

#### 1. Registration (one-time setup)

Host creates a remote agent:
```json
POST /api/agents
{
  "name": "Alice 🐕",
  "type": "remote",
  "emoji": "🐕",
  "role": "Team Lead / Ops",
  "connectionToken": "hc-remote-xxxxxxxxxxxx"
}
```

Returns a `connectionToken` that the remote uses to authenticate.

#### 2. Connection (remote → host)

Remote connects via WebSocket:
```
WS wss://host:4070/federation/connect
Headers:
  Authorization: Bearer hc-remote-xxxxxxxxxxxx
  X-Agent-Name: Alice
  X-Agent-Capabilities: text,tools,vision
```

Host authenticates, marks agent as `online`.

#### 3. Message Flow (host → remote → host)

When a squad routes to the remote agent:

**Host sends:**
```json
{
  "type": "invoke",
  "requestId": "req-abc123",
  "sessionId": "sess-xyz",
  "messages": [
    { "role": "system", "content": "You are Alice..." },
    { "role": "user", "content": "Research this topic" }
  ],
  "tools": ["web_search", "webfetch"],
  "context": {
    "squadId": "squad-1",
    "previousAgents": ["Coder"],
    "channelType": "telegram"
  }
}
```

**Remote streams back:**
```json
{ "type": "delta", "requestId": "req-abc123", "text": "I found..." }
{ "type": "delta", "requestId": "req-abc123", "text": " several sources..." }
{ "type": "tool_call", "requestId": "req-abc123", "tool": "web_search", "args": {"query": "..."} }
```

**Host executes tool and sends result:**
```json
{ "type": "tool_result", "requestId": "req-abc123", "tool": "web_search", "result": "..." }
```

**Remote continues:**
```json
{ "type": "delta", "requestId": "req-abc123", "text": "Based on the search..." }
{ "type": "finish", "requestId": "req-abc123", "reason": "stop" }
```

#### 4. Tool Execution Options

Two modes for tool execution:

**Mode A: Host-side tools (default)**
- Remote requests tool calls, host executes them locally
- Remote agent doesn't need tool access
- Host controls security (tier classification still applies)

**Mode B: Remote-side tools**
- Remote executes its own tools (has its own bash, filesystem, etc.)
- Only sends final results back
- Used when remote is a full HiveClaw instance with its own capabilities

#### 5. Heartbeat & Presence

```json
// Every 30s
{ "type": "ping" }
{ "type": "pong", "status": "idle" | "busy", "currentRequest": "req-abc123" }
```

Host marks agent offline after 3 missed pongs.

### Implementation Plan

#### Phase 1: Core Federation (MVP)
1. **DB**: Add `remote_url` and `connection_token` columns to `agents` table
2. **WebSocket endpoint**: `/federation/connect` with token auth
3. **Federation host**: `engine/federation/federation-host.ts`
   - Manages connected remote agents
   - Routes invoke requests
   - Handles tool relay
4. **Runner intercept**: In `channel-responder.ts`, detect `type: 'remote'`
   and route to federation host instead of local runner
5. **CLI/API**: `POST /api/agents` with `type: 'remote'` returns connection token

#### Phase 2: OpenClaw Bridge
1. **OpenClaw federation client**: Connects OpenClaw agent to HiveClaw as remote
2. Translates between OpenClaw message format and HiveClaw federation protocol
3. Alice can join any HiveClaw instance as a remote agent

#### Phase 3: Discovery & Trust
1. **Agent directory**: Agents can advertise capabilities
2. **Trust levels**: Full, limited (text only), read-only
3. **Multi-hop**: Agent A on Server 1 can invoke Agent B on Server 2 via Server 3

### Security

- Connection tokens are SHA-256 hashed in DB (like node auth tokens)
- TLS required for production (wss://)
- Rate limiting per remote agent
- Tool execution respects the same tier classification
- Remote agents can't escalate privileges beyond their assigned tools
- Connection audit log

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `engine/federation/federation-host.ts` | Create | WS server, connection manager, message relay |
| `engine/federation/federation-protocol.ts` | Create | Types, message schemas, serialization |
| `engine/federation/remote-agent-runner.ts` | Create | Runner that delegates to connected remote |
| `engine/channel-responder.ts` | Modify | Route `type: 'remote'` to remote runner |
| `db/agents.ts` | Modify | Add remote fields to schema |
| `db/schema.ts` | Modify | Migration for new columns |
| `api/federation.ts` | Create | REST endpoints for managing remote agents |
| `packages/federation-client/` | Create | npm package for connecting as remote agent |

### Estimated Effort

- Phase 1 (Core): ~4-6 hours (similar scope to node-client)
- Phase 2 (OpenClaw bridge): ~2-3 hours
- Phase 3 (Discovery): Future / v2.0

### Comparison with TC2

| Feature | TC2 | HiveClaw Federation |
|---------|-----|-------------------|
| Connection | WS | WS (same) |
| Auth | API key | Connection token (SHA-256) |
| Message format | TC2 protocol | HiveClaw federation protocol |
| Tool execution | Agent-side | Host-side or agent-side (configurable) |
| Discovery | Built-in | Phase 3 |
| Multi-instance | Native | Phase 1 target |

---

*This spec enables the "invite Alice to your HiveClaw" use case:
Alice's HiveClaw generates a federation client that connects to the
friend's HiveClaw as a remote agent. The friend's squad can then
include Alice alongside their local agents.*
