# HiveClaw vs OpenClaw — Benchmark Test Plan

> **Objetivo:** Provar empiricamente que HiveClaw é ≥ OpenClaw para realização de tarefas.
> **Metodologia:** Mesma tarefa, mesmo modelo, mesmo Mac, medição automatizada.
> **Versões:** HiveClaw 1.1.0 (engine v2) vs OpenClaw (latest, Telegram channel)

---

## Regras do Benchmark

1. **Mesmo modelo**: `claude-sonnet-4.6` via mesma API key (anthropic direto, sem proxy)
2. **Mesma máquina**: Mac mini SP (ambos rodam local)
3. **Sessão limpa**: Nova sessão/conversa para cada teste
4. **Sistema limpo**: Sem memory/context carryover entre testes
5. **Timer automatizado**: `time` wrapper + timestamps no DB/log
6. **3 rodadas por teste**: Mediana como resultado final
7. **Avaliação**: Automática quando possível (diff, checksum), humana quando necessário (1-5 score)
8. **Definição de "travou"**: >5 minutos sem output = DNF (Did Not Finish)

---

## Categorias e Testes

### Categoria 1: Tool Execution (Core Loop)

O que testa: a capacidade básica de receber instrução → escolher tool → executar → retornar resultado.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 1.1 | **Read + Summarize**: "Leia o arquivo X (500 linhas) e dê um resumo de 3 parágrafos" | Tempo + qualidade (1-5) | Timer + review humano |
| 1.2 | **Write file**: "Crie um arquivo Python com uma classe FastAPI TODO CRUD (endpoints, models, error handling)" | Tempo + funcionalidade | Timer + `python3 -m py_compile` + checklist de endpoints |
| 1.3 | **Edit file**: "No arquivo Y, troque todas as variáveis snake_case para camelCase nas linhas 10-50" | Tempo + corretude | Timer + diff contra expected output |
| 1.4 | **Web search + synthesis**: "Pesquise os 5 maiores frameworks de AI agents em 2026 e compare em tabela com prós/contras" | Tempo + qualidade | Timer + review humano (1-5 por completude e accuracy) |
| 1.5 | **Bash execution chain**: "Verifique quantos processos node estão rodando, quanto RAM cada um usa, e mate o que usa mais (dry-run)" | Tempo + corretude | Timer + verificação do comando gerado |

**HiveClaw tools**: `read`, `write`, `edit`, `web_search`, `bash`
**OpenClaw tools**: `read`, `write`, `edit`, `web_search`, `exec`

---

### Categoria 2: Multi-Step Reasoning (Agentic Loop)

O que testa: iterações múltiplas, tool chaining, capacidade de manter contexto entre steps.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 2.1 | **Debug task**: Dado um arquivo com 3 bugs injetados (syntax error, logic error, off-by-one), pedir "encontre e corrija todos os bugs" | Bugs encontrados (0-3) + tempo | Contagem + timer |
| 2.2 | **Research → Code → Test**: "Pesquise a API do IBGE, crie um script que baixa população dos 10 maiores municípios, e execute" | Tempo + resultado correto | Timer + output check |
| 2.3 | **File analysis pipeline**: "Analise todos os .ts em src/engine/tools/, conte linhas por arquivo, identifique o maior, e sugira refactoring" | Steps completados + qualidade | Contagem de tools usados + review |
| 2.4 | **Conditional logic**: "Se o servidor HiveClaw estiver rodando, colete CPU/RAM. Se não, inicie e depois colete." | Corretude do branch | Verificação manual do path tomado |

---

### Categoria 3: Memory & Context

O que testa: persistência de informação entre turnos, recall, entity tracking.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 3.1 | **Fact retention**: Informar 5 fatos arbitrários, conversar sobre outro assunto por 5 turnos, depois perguntar os fatos | Fatos lembrados (0-5) | Contagem |
| 3.2 | **Preference learning**: "Prefiro código sem comentários" → 5 turnos depois pedir código → verificar se aplica | Aplicou preferência (S/N) | Review |
| 3.3 | **Session continuity**: Enviar tarefa em 2 partes com 2 minutos de gap: "Vou te dar requisitos..." depois "Agora implementa" | Completou corretamente (S/N) | Review |
| 3.4 | **Entity tracking (multi-turn)**: Mencionar 3 projetos com nomes, datas e status, depois perguntar "qual projeto está atrasado?" | Resposta correta (S/N) | Verificação |

**Vantagem esperada HiveClaw**: Memory system (agent_memory, core_memory_blocks, memories, episodes, working_memory). OpenClaw depende do contexto da conversa.

---

### Categoria 4: Channel Integration

O que testa: capacidade de receber input e entregar output via messaging.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 4.1 | **Telegram roundtrip**: Enviar mensagem → receber resposta → verificar entrega | Tempo end-to-end | Timestamp send vs receive |
| 4.2 | **Rich response**: Pedir tabela formatada + code block + emoji | Renderização correta (1-5) | Screenshot + review |
| 4.3 | **Long response handling**: Pedir output de ~3000 chars | Entrega completa (S/N) + split handling | Contagem de chars recebidos |
| 4.4 | **Error resilience**: Enviar mensagem durante restart do backend | Comportamento (perdeu/recuperou/respondeu) | Observação |

**HiveClaw**: Telegram adapter (grammy), WhatsApp (Baileys), Discord, Slack
**OpenClaw**: Telegram, WhatsApp, Discord, Slack, Signal, iMessage

---

### Categoria 5: Multi-Agent / Coordination

O que testa: capacidade de coordenar múltiplos agentes para tarefa complexa.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 5.1 | **Squad task**: "Pesquise trending topics em AI, crie um blogpost, e faça review de qualidade" (3 roles) | Tempo + qualidade final (1-5) | Timer + review humano |
| 5.2 | **Delegation**: Tarefa que requer 2 skills diferentes (code + research) — verificar se delega ou faz tudo solo | Delegou corretamente (S/N) | Observação |
| 5.3 | **Parallel execution**: 3 tarefas independentes simultâneas | Tempo total vs sequencial | Timer comparativo |

**HiveClaw**: Squads (squad_members, routing strategies), multi-agent native
**OpenClaw**: Sub-agents (sessions_spawn), persistent sessions

---

### Categoria 6: Reliability & Edge Cases

O que testa: robustez sob condições adversas.

| # | Teste | Métrica | Como medir |
|---|-------|---------|------------|
| 6.1 | **Large file handling**: Write → Read arquivo de 2000 linhas | Completo e correto (S/N) | Diff |
| 6.2 | **Token pressure**: Sessão com 30+ turnos, verificar qualidade da resposta no turno 31 | Qualidade (1-5) | Review comparativo |
| 6.3 | **Error recovery**: Pedir tool call que vai falhar (ex: ler arquivo inexistente), verificar recovery | Recuperou gracefully (S/N) | Observação |
| 6.4 | **Concurrent sessions**: 3 conversas simultâneas, verificar isolamento | Sem cross-contamination (S/N) | Verificação de conteúdo |
| 6.5 | **Tool call com payload grande**: Pedir geração de HTML ~10KB via tool call | Completou sem travar (S/N) | Timer + output check |

---

## Scoring

### Por teste:
| Resultado | Pontos |
|-----------|--------|
| Win claro (>20% melhor em tempo OU qualidade significativamente superior) | **3** |
| Empate funcional (ambos completam com qualidade similar, ±20% tempo) | **1** cada |
| Fail / DNF | **0** |

### Por categoria:
Soma dos pontos dos testes da categoria. Peso igual entre categorias.

### Score final:
```
Total = Σ(pontos por categoria) / máximo possível × 100
```

---

## Execução Automatizada

### Script harness (proposta):

```bash
#!/bin/bash
# benchmark-run.sh — executa um teste em ambas as plataformas

TEST_ID=$1
PROMPT=$2

echo "=== Test $TEST_ID ==="

# HiveClaw
echo "[HiveClaw] Starting..."
HC_START=$(date +%s%3N)
HC_RESPONSE=$(curl -s -X POST http://localhost:4070/sessions/$HC_SESSION/message \
  -H 'Content-Type: application/json' \
  -d "{\"content\": \"$PROMPT\"}" | head -c 10000)
HC_END=$(date +%s%3N)
HC_TIME=$((HC_END - HC_START))

# OpenClaw (via Telegram API or direct session)
echo "[OpenClaw] Starting..."
OC_START=$(date +%s%3N)
# OpenClaw send via sessions_send or message tool
OC_END=$(date +%s%3N)
OC_TIME=$((OC_END - OC_START))

echo "HiveClaw: ${HC_TIME}ms | OpenClaw: ${OC_TIME}ms"
```

---

## Previsão Honesta (Alice's Take)

| Categoria | HiveClaw vantagem | OpenClaw vantagem | Empate provável |
|-----------|------------------|-------------------|-----------------|
| 1. Tool Execution | | | ✅ (ambos têm tools equivalentes) |
| 2. Multi-Step Reasoning | | | ✅ (mesmo LLM, mesma capacidade) |
| 3. Memory & Context | ✅ (5 tabelas de memória) | | |
| 4. Channel Integration | | ✅ (mais canais, mais maduro) | |
| 5. Multi-Agent | ✅ (squads nativo) | | |
| 6. Reliability | | ✅ (mais battle-tested) | |

**Nota honesta**: Categories 1-2 vão empatar porque ambos usam o mesmo LLM. A diferença real está em memory (HiveClaw ganha), channels (OpenClaw ganha em breadth), multi-agent (HiveClaw mais integrado), e reliability (OpenClaw mais estável em produção).

O Sherlock acertou: a comparação justa de HiveClaw é contra **CrewAI/AutoGen**, não contra OpenClaw. São camadas complementares. Mas se o objetivo é provar ≥, este roteiro cobre.

---

## Next Steps

1. [ ] Criar sessão limpa em ambas plataformas com mesmo modelo
2. [ ] Preparar test fixtures (arquivos de input, expected outputs)
3. [ ] Rodar Categoria 1 primeiro (baseline, mais fácil de automatizar)
4. [ ] Registrar resultados em `docs/BENCHMARK-RESULTS.md`
5. [ ] Review humano das categorias subjetivas
