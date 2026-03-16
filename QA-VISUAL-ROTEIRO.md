# QA Visual — Roteiro de Testes E2E via Browser Tool

**Sprint:** R14.5 — Visual QA by Squad
**Owner:** Hawk 🦅 (QA Lead) + Bolt ⚡ (Frontend)
**Gate:** 95% pass rate
**Tool:** Browser tool (Playwright) → navigate to `http://localhost:4070`

## Instruções para Agentes

Usar a tool `browser` com action `navigate` para `http://localhost:4070`.
Depois usar `screenshot` para capturar cada tela.
Usar `read` para verificar conteúdo textual.
Usar `click` + `type` para interações.

---

## Cenários de Teste

### Bloco 1 — Layout & Navigation (8 testes)

| # | Cenário | Steps | Expected |
|---|---------|-------|----------|
| V01 | Sidebar loads | navigate → read sidebar | Lista de agentes visível: Clark 🐙, Forge 🔨, Bolt ⚡, Hawk 🦅 |
| V02 | Agent click → session | click agent item | Chat area opens, header shows agent name + emoji |
| V03 | Header elements | read header | Agent name, model selector, Pro/Lite toggle visible |
| V04 | Right panel tabs | click each tab | 7 tabs respond: code, preview, browser, sprint, flows, console, memory |
| V05 | Settings gear | click settings icon | Modal opens with 15 tabs |
| V06 | Search bar | click search → type query | Search opens, results filter |
| V07 | New session button | click + icon | New session created |
| V08 | Sidebar session preview | send message → read sidebar | Last message preview updates (NOT "No messages yet") |

### Bloco 2 — Chat & Messaging (7 testes)

| # | Cenário | Steps | Expected |
|---|---------|-------|----------|
| V09 | Send message | type in input → send | User bubble appears (blue), agent responds (amber) |
| V10 | Message timestamps | read message area | Timestamps visible on messages |
| V11 | Tool call collapse | trigger tool use | Tool call shows collapsed, expandable |
| V12 | Streaming indicator | send message → observe | Typing indicator during SSE stream |
| V13 | Multi-message thread | send 2+ messages | Conversation flows correctly, no overlap |
| V14 | Long message render | send 500+ char message | Message wraps correctly, no overflow |
| V15 | Code block render | agent returns code | Syntax highlighted, copy button visible |

### Bloco 3 — Settings & Config (6 testes)

| # | Cenário | Steps | Expected |
|---|---------|-------|----------|
| V16 | Providers tab | open settings → Providers | Shows API key fields, connected status for Anthropic/GitHub Copilot |
| V17 | Agents tab | open settings → Agents | Lists 4 agents with edit buttons |
| V18 | Agent edit modal | click edit on agent | Modal opens with name, emoji, system prompt, model, core memory |
| V19 | Appearance tab | open settings → Appearance | Theme selector, font size, accent color |
| V20 | Models tab | open settings → Models | Available models listed |
| V21 | Security tab | open settings → Security | Auth toggle, invite codes section |

### Bloco 4 — Panels & Features (6 testes)

| # | Cenário | Steps | Expected |
|---|---------|-------|----------|
| V22 | Memory panel | open Memory tab | Memory Explorer with agent selector, search, entries list |
| V23 | Activity panel | open Console tab | Agent Activity Feed with SSE events |
| V24 | Browser panel | open Browser tab | URL input, iframe or placeholder |
| V25 | Automations panel | open Flows tab | Automations list (may be empty), create button |
| V26 | Sprint panel | open Sprint tab | Task board or empty state |
| V27 | Code panel | open Code tab | Code viewer or empty state |

### Bloco 5 — Error States & Edge Cases (5 testes)

| # | Cenário | Steps | Expected |
|---|---------|-------|----------|
| V28 | Empty session | open new session, don't send | Empty state message, no crash |
| V29 | Invalid API key | enter bad key in providers | Error message, not crash |
| V30 | Offline agent | (if possible) disable provider | Graceful error in chat |
| V31 | Rapid messages | send 3 messages quickly | No duplicate responses, queue works |
| V32 | Page refresh | send message → refresh page | Messages persist, session restores |

---

## Scoring

- **PASS**: Cenário funciona como expected
- **FAIL**: Bug encontrado — descrever com detalhes
- **SKIP**: Não testável via browser tool (justificar)

**Gate: 95% = ≥31 de 32 cenários PASS**

## Output Format

```
## QA Visual Results
| # | Result | Notes |
|---|--------|-------|
| V01 | ✅ PASS | Sidebar shows 4 agents |
| V02 | ❌ FAIL | Click doesn't open session — selector not found |
...

### Bugs Found
- BUG-V##: Description + severity + suggested fix

### Summary
- Pass: XX/32
- Fail: XX/32
- Skip: XX/32
- Rate: XX%
```
