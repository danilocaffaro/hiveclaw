# Federation — Test Plan

> Covers backend, WebSocket protocol, DB, squad integration, and UI/UX.
> Each test has an ID for tracking. Tests marked [UI] require browser/visual validation.
> Tests marked [E2E] require two running HiveClaw instances.

---

## 1. Database & Schema

| ID | Test | Type | Expected |
|----|------|------|----------|
| DB-01 | `federation_links` table created on server start | Unit | Table exists with all columns |
| DB-02 | `federation_pairing` table created on server start | Unit | Table exists, token is PK |
| DB-03 | `agents` table has new columns (`federation_link_id`, `is_shadow`, `remote_agent_id`) | Unit | `ALTER TABLE` applied, defaults correct |
| DB-04 | Create federation link record | Unit | Insert succeeds, all fields persisted |
| DB-05 | Update link status (`pending` → `active` → `disconnected`) | Unit | Status transitions work |
| DB-06 | Delete link cascades: shadow agents removed | Unit | Shadow agents with matching `federation_link_id` deleted |
| DB-07 | Create shadow agent with `is_shadow=1` | Unit | Agent created, appears in `agents` table, not in regular agent list |
| DB-08 | Pairing token creation with expiry | Unit | Token stored, `expires_at` correct |
| DB-09 | Pairing token expiry check | Unit | Expired tokens rejected |
| DB-10 | Pairing token consumed (accepted=1) can't be reused | Unit | Second accept returns error |

## 2. Federation Pairing API

| ID | Test | Type | Expected |
|----|------|------|----------|
| API-01 | `POST /api/federation/pair` creates pairing token | Integration | Returns `{ token, inviteUrl, expiresIn }` |
| API-02 | `POST /api/federation/pair` requires squad_id and agent_ids | Integration | 400 if missing |
| API-03 | `GET /api/federation/pair/:token/info` returns invite info | Integration | Returns squad name, agent names, expiry |
| API-04 | `GET /api/federation/pair/:token/info` rejects expired token | Integration | 410 Gone |
| API-05 | `POST /api/federation/accept` with valid token | Integration | Creates link, returns linkId + WS URL |
| API-06 | `POST /api/federation/accept` with expired token | Integration | 410 error |
| API-07 | `POST /api/federation/accept` with consumed token | Integration | 409 Conflict |
| API-08 | `GET /api/federation/links` lists active links | Integration | Returns array of links with peer info |
| API-09 | `DELETE /api/federation/links/:id` revokes link | Integration | Link status → `revoked`, shadow agents deleted |
| API-10 | `GET /api/federation/links/:id/status` shows connection state | Integration | Returns `connected`/`disconnected` + last_seen |

## 3. WebSocket Protocol

| ID | Test | Type | Expected |
|----|------|------|----------|
| WS-01 | Guest connects to `wss://host/federation/ws` with valid token | Integration | Connection established, `federation.welcome` received |
| WS-02 | Guest connects with invalid/expired token | Integration | Connection rejected (4001 close code) |
| WS-03 | `federation.hello` → `federation.welcome` handshake | Integration | Both sides receive instance info + linkId |
| WS-04 | `agent.manifest` exchanged after handshake | Integration | Both sides receive peer's agent list |
| WS-05 | Shadow agents created from manifest | Integration | DB entries with `is_shadow=1`, correct name/emoji/role |
| WS-06 | `federation.ping` / `federation.pong` heartbeat | Integration | Pong received within 5s, `last_seen` updated |
| WS-07 | 3 missed pongs → link marked `disconnected` | Integration | Status changes, UI notified via SSE |
| WS-08 | Auto-reconnect on connection drop | E2E | Guest reconnects within 30s, link resumes |
| WS-09 | Reconnect replays missed messages | E2E | Messages sent during disconnect delivered after reconnect |
| WS-10 | Connection with mismatched protocol version | Integration | Graceful rejection with version info |
| WS-11 | Rate limiting on federation messages | Integration | Excess messages throttled/rejected (429) |
| WS-12 | Message validation rejects malformed payloads | Integration | Invalid type/payload → error response, no crash |

## 4. Agent Invocation via Federation

| ID | Test | Type | Expected |
|----|------|------|----------|
| INV-01 | Host invokes remote agent → `agent.invoke` sent | Integration | Guest receives invoke with correct agentId, messages, context |
| INV-02 | Guest runs agent and streams `agent.delta` | Integration | Host receives text deltas in order |
| INV-03 | `agent.finish` marks turn complete | Integration | Host receives full text, usage stats |
| INV-04 | Agent response persisted on both sides | E2E | Message in host's session AND guest's shadow session |
| INV-05 | Tool execution on guest side (toolMode: "remote") | E2E | Agent uses its own tools, only result sent back |
| INV-06 | Invoke timeout (agent takes >2min) | Integration | Host receives timeout error, turn skipped gracefully |
| INV-07 | Invoke for disconnected remote agent | Integration | Host receives "agent offline" message, continues squad |
| INV-08 | Invoke with ECHO-FREE context (previousResponses) | Integration | Guest receives previous responses for anti-repetition |
| INV-09 | Multiple concurrent invocations | Integration | Each gets unique requestId, no cross-talk |
| INV-10 | Invoke cancelled mid-stream (user sends new message) | Integration | Cancel signal propagated, partial response handled |

## 5. Squad Integration

| ID | Test | Type | Expected |
|----|------|------|----------|
| SQ-01 | Squad with shadow agents routes correctly | Integration | Squad runner dispatches to federation for shadow agents |
| SQ-02 | Round-robin includes shadow agents in rotation | Integration | Shadow agents take turns like local agents |
| SQ-03 | Specialist routing can pick a shadow agent | Integration | Coordinator can select remote agent for task |
| SQ-04 | Debate mode includes shadow agents | Integration | Remote agents participate in debate rounds |
| SQ-05 | Sequential mode chains through shadow agents | Integration | Output from local → remote → local flows correctly |
| SQ-06 | `message.sync` sends user message to peer | E2E | User message appears on both UIs |
| SQ-07 | All agent responses visible on both sides | E2E | Every turn's text appears in both UI sessions |
| SQ-08 | `squad.event` syncs agent add/remove | E2E | Adding local agent updates peer's shadow list |
| SQ-09 | Squad deletion removes federation link | Integration | Link revoked, shadows cleaned up |
| SQ-10 | Guest-side user sends message → routed to host | E2E | Host's squad runner orchestrates, results flow to both |

## 6. UI / Navigation Tests

| ID | Test | Type | Expected |
|----|------|------|----------|
| UI-01 | [UI] "Federate Squad" button visible in squad settings | Browser | Button appears for existing squads |
| UI-02 | [UI] Click "Federate Squad" → invite modal opens | Browser | Modal shows: select agents to share, generate link |
| UI-03 | [UI] Invite modal generates link with copy button | Browser | Link copied to clipboard, countdown timer shown |
| UI-04 | [UI] "Join Federation" entry point accessible | Browser | Via settings or direct URL with invite token |
| UI-05 | [UI] "Join Federation" → paste invite → select agents → connect | Browser | Shows connecting state → success with agent list |
| UI-06 | [UI] Federated squad shows "hybrid" badge | Browser | Squad card has visual indicator (icon/badge/label) |
| UI-07 | [UI] Shadow agents show "external" badge in squad member list | Browser | Different visual from local agents (icon, opacity, label) |
| UI-08 | [UI] Shadow agent tooltip shows origin instance | Browser | "From: Friend's HiveClaw" or similar |
| UI-09 | [UI] Federation status indicator (connected/disconnected) | Browser | Green dot = connected, orange = reconnecting, red = disconnected |
| UI-10 | [UI] Real-time message streaming from remote agent | Browser | Text appears character-by-character in chat, same as local |
| UI-11 | [UI] Agent name/emoji correct for remote agents in chat | Browser | Shows remote agent's name and emoji, not generic |
| UI-12 | [UI] Revoke federation link from UI | Browser | Confirmation dialog → link removed → shadows deleted → squad reverts to local-only |
| UI-13 | [UI] DM section does NOT show shadow agents | Browser | Shadow agents only appear in federated squads |
| UI-14 | [UI] Sidebar squad list shows hybrid badge | Browser | Squad entry in sidebar has visual distinction |
| UI-15 | [UI] Chat input works normally for federated squad | Browser | User can type and send, message synced to both sides |
| UI-16 | [UI] New message notification from remote agent | Browser | SSE event triggers chat update, scroll, notification |

## 7. Error & Edge Cases

| ID | Test | Type | Expected |
|----|------|------|----------|
| ERR-01 | Host server restarts → guest reconnects | E2E | Auto-reconnect, link resumes, no data loss |
| ERR-02 | Guest server restarts → host marks disconnected | E2E | Host shows "disconnected", retries stop gracefully |
| ERR-03 | Both servers restart → pairing survives | E2E | Both reconnect from saved peer_url + token |
| ERR-04 | Network partition (60s) → recovery | E2E | Heartbeat detects, marks disconnected, auto-recovers |
| ERR-05 | One side upgrades HiveClaw version | E2E | Protocol version check, graceful handling of mismatch |
| ERR-06 | Shadow agent deleted manually from DB | Unit | Federation re-syncs on next manifest exchange |
| ERR-07 | Squad deleted while federation active | Integration | Link revoked, peer notified, shadows cleaned |
| ERR-08 | 100+ messages in federated squad | E2E | No memory leak, messages paginate correctly |
| ERR-09 | Large agent response (>50KB) via federation | Integration | Streamed correctly, no truncation |
| ERR-10 | Concurrent users on both sides sending messages | E2E | No race conditions, messages ordered correctly |

## 8. Security

| ID | Test | Type | Expected |
|----|------|------|----------|
| SEC-01 | Pairing token is SHA-256 hashed in DB | Unit | Raw token not stored |
| SEC-02 | Connection token validated on every WS message | Integration | Invalid token → disconnect |
| SEC-03 | Shadow agents can't execute local tools | Integration | No bash/file access for shadow agents |
| SEC-04 | Rate limiting per federation link | Integration | >100 msgs/min → throttled |
| SEC-05 | Revoked link prevents reconnection | Integration | WS connection rejected after revoke |
| SEC-06 | Federation messages validated against schema | Integration | Malformed payloads rejected |
| SEC-07 | No token/key leakage in SSE events or logs | Integration | Tokens masked in all external outputs |

---

## Test Execution Plan

### Phase 1 — Unit/Integration (automated, vitest)
- DB-01 through DB-10
- API-01 through API-10
- WS-01 through WS-12
- INV-01 through INV-10
- SQ-01 through SQ-09
- SEC-01 through SEC-07

**Coverage target**: 80+ tests, all in CI

### Phase 2 — E2E (two instances, manual + scripted)
- SQ-06, SQ-07, SQ-10
- INV-04, INV-05
- ERR-01 through ERR-10
- WS-08, WS-09

**Setup**: Two HiveClaw instances on different ports (4070, 4071)

### Phase 3 — UI (browser, manual or Playwright)
- UI-01 through UI-16

**Setup**: Browser pointed at each instance, visual verification

---

**Total: 89 test cases**
- 44 Unit/Integration (automated)
- 16 E2E (two instances)
- 16 UI (browser)
- 7 Security (automated)
- 6 Error/Edge (E2E)
