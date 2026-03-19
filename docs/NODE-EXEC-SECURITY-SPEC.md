# NODE-EXEC-SECURITY-SPEC.md
## HiveClaw Phase 3 — Node Remote Execution Security Specification

**Status:** 📋 DRAFT — Awaiting Adler review  
**Author:** Alice 🐕  
**Date:** 2026-03-19  
**Triggered by:** Adler security flag on Phase 3 (blueprint Q&A)  
**Scope:** All remote command execution on paired nodes via `exec`, `camera_snap`, `screen_record`, `location_get`, and `notifications_list`  

---

## 1. Threat Model

### 1.1 Attack Vectors

| Vector | Risk | Mitigation |
|--------|------|------------|
| **Compromised agent** — LLM outputs malicious `exec` command | 🔴 Critical | Allowlist + blast radius tiers + approval for Tier 2+ |
| **Token theft** — node auth token stolen → impersonate node | 🔴 Critical | Token rotation, per-command HMAC, TLS-only |
| **Replay attack** — capture and replay a valid RPC command | 🟡 High | Nonce + timestamp window (30s max age) |
| **Privilege escalation** — exec runs as node user, gains root | 🟡 High | Drop to least-privilege user, no sudo in allowlist |
| **Data exfiltration** — `exec cat /etc/shadow` or similar | 🟡 High | Allowlist blocks arbitrary reads; Tier 3 requires owner approval |
| **MITM on WS** — intercept RPC over WebSocket | 🟡 High | TLS required; reject ws:// in production |
| **Denial of service** — flood node with exec commands | 🟠 Medium | Rate limit (10 cmd/min per node), concurrent limit (3) |
| **Lateral movement** — node exec used to pivot to other hosts | 🟡 High | Network isolation recommendation; no SSH/curl in default allowlist |

### 1.2 Trust Boundaries

```
┌─────────────────────┐     TLS/WSS      ┌─────────────────┐
│   HiveClaw Server   │ ←──────────────→ │   Node Client   │
│  (trusts agent      │                   │  (trusts server │
│   within policy)    │                   │   within policy)│
└─────────────────────┘                   └─────────────────┘
         ↑                                        ↑
    Agent request                          OS-level execution
    (untrusted input)                      (trusted boundary)
```

The node client is the **last line of defense**. Even if the server is compromised, the node client enforces its own allowlist and tier limits.

---

## 2. Blast Radius Tiers

Every command is classified into a tier based on potential damage. The tier determines the approval flow.

### 2.1 Tier Definitions

| Tier | Risk | Approval Required | Examples |
|------|------|-------------------|----------|
| **Tier 0: Read-only / Sensors** | 🟢 None | Automatic | `camera_snap`, `camera_list`, `screen_record` (screenshot), `location_get`, `notifications_list` |
| **Tier 1: Safe exec** | 🟢 Low | Automatic (if in allowlist) | `ls`, `pwd`, `whoami`, `date`, `cat <allowed-paths>`, `df`, `uptime`, `ps aux`, `echo`, `which` |
| **Tier 2: Side-effect exec** | 🟡 Medium | Agent-level approval (LLM confirms intent) | `mkdir`, `cp`, `mv`, `touch`, `chmod` (non-recursive), `brew install`, `npm install`, `open` (macOS) |
| **Tier 3: Destructive / Sensitive** | 🔴 High | **Owner approval required** (push notification + wait) | `rm`, `kill`, `pkill`, `shutdown`, `reboot`, `chmod -R`, `chown`, writing to `/etc`, `sudo`, `curl | sh` |
| **Tier 4: Blocked** | ⛔ Never | **Always rejected** | `rm -rf /`, `mkfs`, `dd if=/dev/zero`, `:(){ :|:& };:`, any command with `> /dev/sd*`, `format`, pipe to `sh`/`bash`/`eval` from untrusted source |

### 2.2 Classification Algorithm

```
1. Parse command into (binary, args, pipes, redirects)
2. If binary is in BLOCKED_COMMANDS → Tier 4 (reject)
3. If command contains dangerous patterns → Tier 4 (reject)
4. If binary is in DESTRUCTIVE_COMMANDS → Tier 3
5. If binary is in SIDE_EFFECT_COMMANDS → Tier 2
6. If binary is in SAFE_COMMANDS AND args pass allowlist → Tier 1
7. If not in any list → Tier 3 (unknown = assume dangerous)
8. Sensors (camera, screen, location) → Tier 0
```

### 2.3 Command Lists (defaults, configurable per node)

```typescript
const BLOCKED_COMMANDS = new Set([
  'rm -rf /', 'mkfs', 'dd', 'format', ':()', 'fork bomb',
]);

const BLOCKED_PATTERNS = [
  /\|\s*(sh|bash|zsh|eval)\b/,     // pipe to shell
  />\s*\/dev\/sd/,                   // write to block device
  /sudo\s+rm\s+-rf/,                // sudo rm -rf
  /curl.*\|\s*(sh|bash)/,           // curl pipe to shell
  /wget.*\|\s*(sh|bash)/,           // wget pipe to shell
];

const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'kill', 'killall', 'pkill',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'sudo', 'su', 'chown', 'launchctl',
]);

const SIDE_EFFECT_COMMANDS = new Set([
  'mkdir', 'cp', 'mv', 'touch', 'chmod', 'ln',
  'brew', 'npm', 'pnpm', 'yarn', 'pip', 'pip3',
  'open', 'osascript', 'defaults',
  'git', 'curl', 'wget',
]);

const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'whoami', 'date', 'cal', 'cat', 'head', 'tail',
  'grep', 'find', 'wc', 'sort', 'uniq', 'diff',
  'df', 'du', 'uptime', 'uname', 'hostname',
  'ps', 'top', 'htop', 'free', 'vmstat',
  'echo', 'printf', 'which', 'type', 'file', 'stat',
  'env', 'printenv', 'id', 'groups',
  'screencapture', 'imagesnap', 'system_profiler',
]);
```

---

## 3. Approval Flow

### 3.1 Automatic (Tier 0 + Tier 1)

```
Agent → tool call: exec("ls -la /tmp")
Server → classify: Tier 1 (safe, in allowlist)
Server → send to node: { command: "ls -la /tmp", tier: 1 }
Node → verify tier + allowlist → execute → return result
Server → return to agent
```

No human in the loop. Sub-second latency.

### 3.2 Agent-Level Approval (Tier 2)

```
Agent → tool call: exec("mkdir /tmp/project")
Server → classify: Tier 2 (side effect)
Server → inject confirmation into agent context:
  "⚠️ Tier 2 command: mkdir /tmp/project on node Mac-Studio.
   This will create a directory. Confirm with reason."
Agent → confirms: "Creating temp directory for build artifacts"
Server → log approval (agent, reason, timestamp)
Server → send to node with agent_approval signature
Node → execute → return result
```

The agent provides a reason that gets logged. If the agent can't justify, the command is dropped.

### 3.3 Owner Approval (Tier 3)

```
Agent → tool call: exec("rm -rf /tmp/old-project")
Server → classify: Tier 3 (destructive)
Server → create approval request in DB (pending)
Server → notify owner via push notification / Telegram / SSE:
  "🔴 Node exec approval needed:
   Agent: Alice 🐕
   Node: Mac-Studio
   Command: rm -rf /tmp/old-project
   Tier: 3 (Destructive)
   Reply 'approve' or 'deny'"
Owner → "approve" (or timeout after 5min → auto-deny)
Server → log approval (owner, timestamp)
Server → send to node → execute → return result
Agent → receives result
```

### 3.4 Timeout Behavior

| Tier | Timeout | On timeout |
|------|---------|------------|
| Tier 0-1 | 30s exec timeout | Return error to agent |
| Tier 2 | 60s exec timeout | Return error to agent |
| Tier 3 | 5min approval wait + 60s exec | Auto-deny, notify agent "Owner did not approve in time" |

---

## 4. Audit Trail

Every command execution is logged to `node_commands` table with additional security columns:

```sql
CREATE TABLE node_commands (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  agent_id TEXT,                   -- which agent requested
  session_id TEXT,                 -- which session context
  command TEXT NOT NULL,
  command_type TEXT NOT NULL,       -- 'exec' | 'camera_snap' | 'screen_record' | 'location_get' | 'notifications_list'
  params TEXT,                     -- JSON
  tier INTEGER NOT NULL DEFAULT 0, -- 0-4
  approval_status TEXT DEFAULT 'auto', -- 'auto' | 'agent_approved' | 'owner_approved' | 'denied' | 'timeout'
  approval_by TEXT,                -- 'system' | agent_id | 'owner'
  approval_reason TEXT,            -- agent's justification (Tier 2) or owner message (Tier 3)
  approval_at DATETIME,
  status TEXT DEFAULT 'pending',   -- 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'denied'
  result TEXT,                     -- JSON (stdout, stderr, exit_code) or sensor data
  result_size_bytes INTEGER,       -- track output size
  started_at DATETIME,
  completed_at DATETIME,
  duration_ms INTEGER,
  error TEXT,
  ip_address TEXT,                 -- node IP at time of execution
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_node_commands_node ON node_commands(node_id, created_at);
CREATE INDEX idx_node_commands_agent ON node_commands(agent_id, created_at);
CREATE INDEX idx_node_commands_tier ON node_commands(tier);
CREATE INDEX idx_node_commands_status ON node_commands(status);
```

### 4.1 Audit API

```
GET /nodes/:id/audit                     — all commands for a node (paginated)
GET /nodes/:id/audit?tier=3              — filter by tier
GET /nodes/:id/audit?status=denied       — filter by status
GET /audit/exec?agent=alice&from=...&to= — cross-node audit by agent
```

### 4.2 Retention

- **Tier 0-1:** 30 days (auto-prune)
- **Tier 2:** 90 days
- **Tier 3-4:** Forever (never auto-prune)

### 4.3 Alert Triggers

| Event | Alert Channel |
|-------|---------------|
| Tier 3 command executed | Owner push notification |
| Tier 4 command blocked | Owner push notification + log warning |
| 5+ Tier 2 commands in 1 minute from same agent | Owner push notification (possible runaway) |
| Node disconnected during exec | Log warning |
| Command timeout | Log warning |
| Unknown binary (not in any list) classified as Tier 3 | Log info (for allowlist tuning) |

---

## 5. Communication Security

### 5.1 Transport

- **Production:** WSS (WebSocket over TLS) only. Reject `ws://` connections.
- **Development:** Allow `ws://` for localhost only (`127.0.0.1`, `::1`).
- **Certificate:** Use server's existing TLS cert (Let's Encrypt, Tailscale, etc.)

### 5.2 Authentication

```
Node → WS upgrade: Authorization: Bearer <node_auth_token>
Server → validate token against nodes.auth_token → accept/reject
```

- Tokens are 256-bit random hex strings (64 chars)
- Token is issued on pairing and stored hashed (SHA-256) in DB
- Node client stores raw token in `~/.hiveclaw-node/config.json` with `0600` perms
- Token rotation: `POST /nodes/:id/rotate-token` → new token issued, old invalidated, node must re-pair

### 5.3 Per-Command Integrity

Each RPC command includes:

```json
{
  "id": "cmd-uuid",
  "type": "exec",
  "command": "ls -la",
  "tier": 1,
  "timestamp": 1710855000,
  "nonce": "random-16-bytes",
  "hmac": "sha256(command + timestamp + nonce, node_auth_token)"
}
```

Node client verifies HMAC + timestamp window (30s) before executing. This prevents replay attacks even if WS traffic is somehow captured.

### 5.4 Result Limits

- **stdout/stderr:** Max 1MB per command (truncate with warning)
- **Media (camera/screen):** Max 10MB per result (compress before transfer)
- **Transfer:** Results sent as binary WebSocket frames with type prefix

---

## 6. Node-Side Enforcement

The node client is the final enforcement layer. Even if the server is fully compromised:

### 6.1 Node-Local Allowlist

The node client maintains its own copy of command lists (can be stricter than server):

```json
// ~/.hiveclaw-node/policy.json
{
  "allowExec": true,
  "allowCamera": true,
  "allowScreen": true,
  "allowLocation": false,
  "maxTier": 2,           // This node never runs Tier 3 without local approval
  "blockedBinaries": ["sudo", "su", "rm"],
  "allowedPaths": ["/tmp", "/Users/*/Projects"],
  "maxConcurrent": 3,
  "maxCommandsPerMinute": 10,
  "requireTLS": true
}
```

### 6.2 Local Approval Mode

For high-security nodes, the client can require local interactive approval:

```
[hiveclaw-node] ⚠️  Exec request from Alice 🐕:
  Command: brew install ripgrep
  Tier: 2
  
  [A]pprove  [D]eny  [A]lways allow 'brew install'
```

This is optional and off by default (headless servers don't have TTY).

### 6.3 Sandboxing (Future)

- **macOS:** App Sandbox entitlements for camera/location access prompts
- **Linux:** Run exec in `unshare` namespace or `firejail` sandbox
- **Both:** `ulimit` constraints (CPU time, memory, file descriptors)

---

## 7. Out-of-Allowlist Behavior

When a command is **not in any list** (unknown binary):

```
1. Classify as Tier 3 (unknown = assume dangerous)
2. Log: "[Security] Unknown command 'foobar' classified as Tier 3"
3. Require owner approval (same as Tier 3 flow)
4. If approved:
   a. Execute
   b. Log result
   c. Suggest to owner: "Add 'foobar' to Tier X? [1=safe, 2=side-effect, skip]"
5. If denied:
   a. Return error to agent: "Command 'foobar' not in allowlist and owner denied"
   b. Log denial
```

This enables **learning mode**: the allowlist grows over time as the owner approves new commands. Each approval is logged for audit.

### 7.1 Dynamic Allowlist Updates

```
POST /nodes/:id/policy — update node policy (server-side)
PUT  policy.json        — update node policy (node-side, file watch)
```

Server pushes policy updates to connected nodes via WS. Node client hot-reloads `policy.json` on change (chokidar file watch, already a dep).

---

## 8. Rate Limiting & Circuit Breaking

| Limit | Value | Scope |
|-------|-------|-------|
| Commands per minute per node | 10 | Node-side + server-side |
| Concurrent commands per node | 3 | Node-side + server-side |
| Tier 3 approvals per hour | 5 | Server-side (prevent approval fatigue) |
| Failed commands before circuit break | 5 consecutive | Server-side per node |
| Circuit break recovery | 60s half-open → 1 test command | Server-side |
| Max exec duration | 120s | Node-side (hard kill) |

---

## 9. Implementation Checklist

### Server-side (`engine/nodes/`)

- [ ] `command-classifier.ts` — Tier classification engine
- [ ] `approval-flow.ts` — Tier 2 (agent) + Tier 3 (owner) approval
- [ ] `rpc-host.ts` — WebSocket RPC with HMAC verification
- [ ] `node-repository.ts` — CRUD + token hashing + audit queries
- [ ] `node-tool.ts` — Agent tool (20 → 21 tools)
- [ ] DB migration: `nodes` + `node_commands` tables
- [ ] Audit API routes (`api/nodes.ts`)

### Node client (`packages/node-client/`)

- [ ] `hiveclaw-node.mjs` — Standalone node client
- [ ] `policy.ts` — Local policy enforcement
- [ ] `executor.ts` — Safe command execution with ulimits
- [ ] `hmac.ts` — Per-command HMAC verification
- [ ] `camera.ts` / `screen.ts` — macOS sensor wrappers

### Tests

- [ ] Command classifier: all tiers, edge cases, blocked patterns
- [ ] Approval flow: auto, agent, owner, timeout, denial
- [ ] HMAC: valid, expired, tampered, replay
- [ ] Rate limiting: burst, sustained, recovery
- [ ] Node-local policy: allowlist, blocked binaries, path restrictions

---

## 10. Open Questions (for Adler review)

1. **Shell interpretation:** Should `exec` run through `sh -c` (supports pipes/redirects but harder to analyze) or direct `execFile` (no shell, safer but limited)? **Recommendation:** `execFile` for Tier 1, `sh -c` for Tier 2+ with pattern analysis.

2. **Multi-node commands:** Should agents be able to broadcast one command to all nodes? **Recommendation:** No in v1. One node per command call. Orchestration is the agent's job.

3. **File transfer:** Should nodes support `upload`/`download` (push file to node, pull file from node)? **Recommendation:** Yes, as Tier 2 commands, with path allowlist and size limits (50MB max).

4. **Camera/screen consent on macOS:** macOS prompts for camera access per-app. Should the node client pre-request these permissions on install? **Recommendation:** Yes, during `npx hiveclaw-node pair` setup wizard.

5. **Session binding:** Should a command be tied to a specific agent session, or can any session of the same agent use the same node? **Recommendation:** Any session of the agent. Node access is granted to the agent, not the session.
