#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# HiveClaw vs OpenClaw — Focused Benchmark Harness
# Tests: Tool Reasoning (4) + Channels (3) + Reliability (3) + Large Payload (2)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HC_BASE="http://localhost:4070"
HC_AGENT_ID="9e277cc9-1278-47c2-b9ff-3ac177c3d42b"  # Bench 📊 — Sonnet 4.5 via Anthropic direct
RESULTS_DIR="$(dirname "$0")/../benchmark-results"
FIXTURES_DIR="$(dirname "$0")/../benchmark-fixtures"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/run_${TIMESTAMP}.jsonl"

mkdir -p "$RESULTS_DIR" "$FIXTURES_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

create_hc_session() {
  local agent_id="${1:-$HC_AGENT_ID}"
  curl -s -X POST "$HC_BASE/sessions" \
    -H 'Content-Type: application/json' \
    -d "{\"agent_id\": \"$agent_id\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])"
}

hc_send() {
  local session_id="$1"
  local content="$2"
  local timeout="${3:-120}"

  local start_s=$(date +%s)

  # POST /sessions/:id/message returns SSE stream
  local raw
  raw=$(curl -s --max-time "$timeout" -X POST "$HC_BASE/sessions/$session_id/message" \
    -H 'Content-Type: application/json' \
    -d "{\"content\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$content")}" 2>&1) || true

  local end_s=$(date +%s)
  local elapsed=$(( (end_s - start_s) * 1000 ))

  echo "$raw" > /tmp/hc_last_sse.txt

  # Check for error events
  if echo "$raw" | grep -q 'event: error'; then
    echo "$elapsed"
    return 1
  fi

  echo "$elapsed"
}

hc_get_last_assistant() {
  local session_id="$1"
  curl -s "$HC_BASE/sessions/$session_id" | \
    python3 -c "
import sys,json
d = json.load(sys.stdin)
msgs = d.get('data',{}).get('messages', [])
# Get last assistant message
for m in reversed(msgs):
    if m.get('role') == 'assistant':
        c = m.get('content','')
        if isinstance(c, str):
            # Try to parse as JSON array (content blocks)
            try:
                blocks = json.loads(c)
                if isinstance(blocks, list):
                    for b in blocks:
                        if isinstance(b, dict) and b.get('type') == 'text':
                            print(b.get('text','')[:2000]); break
                    break
            except: pass
            print(c[:2000])
        break
" 2>/dev/null
}

record() {
  local test_id="$1" platform="$2" time_ms="$3" status="$4" detail="$5"
  echo "{\"test\":\"$test_id\",\"platform\":\"$platform\",\"time_ms\":$time_ms,\"status\":\"$status\",\"detail\":$(python3 -c "import json; print(json.dumps('$detail'))")}" >> "$RESULTS_FILE"
}

log() { echo -e "\033[36m[$(date +%H:%M:%S)]\033[0m $*"; }

# ── Fixtures ─────────────────────────────────────────────────────────────────

generate_buggy_file() {
  cat > "$FIXTURES_DIR/buggy.py" << 'PYEOF'
"""User manager module — has 3 intentional bugs."""

def calculate_average(numbers: list[float]) -> float:
    """Bug 1: off-by-one — divides by len+1 instead of len."""
    total = sum(numbers)
    return total / (len(numbers) + 1)

def find_user(users: list[dict], name: str) -> dict | None:
    """Bug 2: logic error — compares email instead of name."""
    for user in users:
        if user.get("email") == name:
            return user
    return None

def format_report(items: list[str]) -> str
    """Bug 3: syntax error — missing colon above."""
    header = "=== Report ==="
    body = "\n".join(f"- {item}" for item in items)
    return f"{header}\n{body}"

if __name__ == "__main__":
    nums = [10, 20, 30]
    print(f"Average: {calculate_average(nums)}")  # Should be 20.0

    users = [{"name": "Alice", "email": "alice@test.com"}]
    print(f"Found: {find_user(users, 'Alice')}")  # Should find Alice

    print(format_report(["item1", "item2"]))
PYEOF
}

generate_large_dataset() {
  python3 -c "
import json, random
data = []
for i in range(200):
    data.append({
        'id': i+1,
        'name': f'Company_{i+1:03d}',
        'revenue': round(random.uniform(100000, 50000000), 2),
        'employees': random.randint(10, 5000),
        'sector': random.choice(['tech','finance','health','retail','energy']),
        'country': random.choice(['BR','US','DE','JP','IN','UK','FR']),
        'founded': random.randint(1990, 2025),
        'public': random.choice([True, False]),
        'rating': round(random.uniform(1.0, 5.0), 1)
    })
json.dump(data, open('$FIXTURES_DIR/companies.json','w'), indent=2)
print(f'Generated {len(data)} companies')
"
}

# ═════════════════════════════════════════════════════════════════════════════
# TESTS
# ═════════════════════════════════════════════════════════════════════════════

run_all() {

log "═══ Generating fixtures... ═══"
generate_buggy_file
generate_large_dataset

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY A: TOOL REASONING (multi-step, tool selection, chaining)
# ─────────────────────────────────────────────────────────────────────────────

log "═══ A. TOOL REASONING ═══"

# A1 — Debug: find and fix 3 bugs
log "A1: Debug 3 bugs in buggy.py"
A1_SESSION=$(create_hc_session)
A1_PROMPT="Read the file $FIXTURES_DIR/buggy.py. It has exactly 3 bugs. Find all 3, explain each, and write the corrected file to $FIXTURES_DIR/buggy_fixed.py. Then run it to verify."
A1_TIME=$(hc_send "$A1_SESSION" "$A1_PROMPT" 180)

# Verify
A1_BUGS=0
if [ -f "$FIXTURES_DIR/buggy_fixed.py" ]; then
  # Check each fix
  grep -q 'len(numbers)' "$FIXTURES_DIR/buggy_fixed.py" && ! grep -q 'len(numbers) + 1' "$FIXTURES_DIR/buggy_fixed.py" && ((A1_BUGS++)) || true
  grep -q '"name"' "$FIXTURES_DIR/buggy_fixed.py" && ((A1_BUGS++)) || true
  grep -q 'def format_report.*:$' "$FIXTURES_DIR/buggy_fixed.py" && ((A1_BUGS++)) || true
  python3 -m py_compile "$FIXTURES_DIR/buggy_fixed.py" 2>/dev/null && A1_COMPILES="yes" || A1_COMPILES="no"
fi
record "A1_debug" "hiveclaw" "$A1_TIME" "${A1_BUGS}/3" "compiles=$A1_COMPILES"
log "  → HiveClaw: ${A1_TIME}ms, bugs fixed: ${A1_BUGS}/3, compiles: ${A1_COMPILES:-no}"

# A2 — Research → Code → Execute pipeline
log "A2: Research → Code → Execute (IBGE API)"
A2_SESSION=$(create_hc_session)
A2_PROMPT="Search the web for the IBGE API that provides Brazilian municipality population data. Then write a Python script at $FIXTURES_DIR/ibge_pop.py that fetches the population of the 10 largest Brazilian municipalities. Execute the script and show me the results."
A2_TIME=$(hc_send "$A2_SESSION" "$A2_PROMPT" 180)
A2_OUTPUT=$(python3 "$FIXTURES_DIR/ibge_pop.py" 2>/dev/null | head -1 || echo "FAILED")
record "A2_pipeline" "hiveclaw" "$A2_TIME" "$([ "$A2_OUTPUT" != "FAILED" ] && echo "pass" || echo "fail")" "$A2_OUTPUT"
log "  → HiveClaw: ${A2_TIME}ms, output: ${A2_OUTPUT}"

# A3 — Data analysis: read JSON, compute, write report
log "A3: Data analysis pipeline"
A3_SESSION=$(create_hc_session)
A3_PROMPT="Read $FIXTURES_DIR/companies.json (200 companies). Calculate: (1) average revenue per sector, (2) top 5 companies by revenue, (3) country with most companies, (4) correlation between employees and revenue. Write results to $FIXTURES_DIR/analysis_report.md as a formatted markdown report with tables."
A3_TIME=$(hc_send "$A3_SESSION" "$A3_PROMPT" 180)
A3_PASS="no"
[ -f "$FIXTURES_DIR/analysis_report.md" ] && [ "$(wc -l < "$FIXTURES_DIR/analysis_report.md")" -gt 10 ] && A3_PASS="yes"
record "A3_analysis" "hiveclaw" "$A3_TIME" "$A3_PASS" "lines=$(wc -l < "$FIXTURES_DIR/analysis_report.md" 2>/dev/null || echo 0)"
log "  → HiveClaw: ${A3_TIME}ms, report generated: $A3_PASS"

# A4 — Conditional logic + system inspection
log "A4: Conditional system inspection"
A4_SESSION=$(create_hc_session)
A4_PROMPT="Check if port 4070 is listening. If yes, check the process CPU and memory usage and write a health report to $FIXTURES_DIR/health.txt including PID, CPU%, MEM%, and uptime. If not listening, write 'SERVICE_DOWN' to the file."
A4_TIME=$(hc_send "$A4_SESSION" "$A4_PROMPT" 120)
A4_PASS="no"
[ -f "$FIXTURES_DIR/health.txt" ] && grep -qi 'pid\|cpu\|SERVICE_DOWN' "$FIXTURES_DIR/health.txt" && A4_PASS="yes"
record "A4_conditional" "hiveclaw" "$A4_TIME" "$A4_PASS" "$(head -1 "$FIXTURES_DIR/health.txt" 2>/dev/null)"
log "  → HiveClaw: ${A4_TIME}ms, pass: $A4_PASS"

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY B: CHANNEL INTEGRATION
# ─────────────────────────────────────────────────────────────────────────────

log "═══ B. CHANNELS ═══"

# B1 — API roundtrip latency (baseline, no channel overhead)
log "B1: API roundtrip latency (simple prompt)"
B1_SESSION=$(create_hc_session)
B1_TIME=$(hc_send "$B1_SESSION" "Reply with exactly: PONG" 30)
B1_RESP=$(hc_get_last_assistant "$B1_SESSION")
B1_PASS=$(echo "$B1_RESP" | grep -qi "pong" && echo "yes" || echo "no")
record "B1_roundtrip" "hiveclaw" "$B1_TIME" "$B1_PASS" "$B1_TIME ms"
log "  → HiveClaw: ${B1_TIME}ms, got PONG: $B1_PASS"

# B2 — Rich formatting (table + code + emoji)
log "B2: Rich formatting"
B2_SESSION=$(create_hc_session)
B2_PROMPT="Give me a markdown table comparing 5 programming languages (name, paradigm, year, use case) followed by a Python code block that prints 'hello' and end with 3 relevant emojis."
B2_TIME=$(hc_send "$B2_SESSION" "$B2_PROMPT" 60)
B2_RESP=$(hc_get_last_assistant "$B2_SESSION")
B2_TABLE=$(echo "$B2_RESP" | grep -c '|' || echo 0)
B2_CODE=$(echo "$B2_RESP" | grep -c '```' || echo 0)
record "B2_rich" "hiveclaw" "$B2_TIME" "table_rows=$B2_TABLE,code_blocks=$B2_CODE" ""
log "  → HiveClaw: ${B2_TIME}ms, table rows: $B2_TABLE, code blocks: $B2_CODE"

# B3 — Long response (3000+ chars)
log "B3: Long response handling"
B3_SESSION=$(create_hc_session)
B3_PROMPT="Write a detailed 3000-word essay about the history of artificial intelligence, from Turing to transformers. Include key dates, researchers, and breakthroughs. Output the full text, do not truncate."
B3_TIME=$(hc_send "$B3_SESSION" "$B3_PROMPT" 180)
B3_RESP=$(hc_get_last_assistant "$B3_SESSION")
B3_LEN=${#B3_RESP}
record "B3_long" "hiveclaw" "$B3_TIME" "chars=$B3_LEN" "$([ "$B3_LEN" -gt 3000 ] && echo "pass" || echo "short")"
log "  → HiveClaw: ${B3_TIME}ms, response length: ${B3_LEN} chars"

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY C: RELIABILITY & EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

log "═══ C. RELIABILITY ═══"

# C1 — Error recovery (read nonexistent file)
log "C1: Error recovery"
C1_SESSION=$(create_hc_session)
C1_PROMPT="Read the file /tmp/this_file_does_not_exist_xyz_99999.txt and tell me what's in it. If it doesn't exist, create it with the content 'Created by benchmark test' and confirm."
C1_TIME=$(hc_send "$C1_SESSION" "$C1_PROMPT" 60)
C1_PASS="no"
[ -f "/tmp/this_file_does_not_exist_xyz_99999.txt" ] && C1_PASS="yes"
rm -f /tmp/this_file_does_not_exist_xyz_99999.txt
record "C1_recovery" "hiveclaw" "$C1_TIME" "$C1_PASS" ""
log "  → HiveClaw: ${C1_TIME}ms, recovered and created file: $C1_PASS"

# C2 — Concurrent sessions (3 simultaneous, check isolation)
log "C2: Concurrent session isolation"
C2_S1=$(create_hc_session)
C2_S2=$(create_hc_session)
C2_S3=$(create_hc_session)

# Send 3 different prompts simultaneously
hc_send "$C2_S1" "The secret code is ALPHA-7. Remember it. Reply with only 'Stored ALPHA-7'." 60 > /tmp/bench_c2_1.txt &
PID1=$!
hc_send "$C2_S2" "The secret code is BRAVO-3. Remember it. Reply with only 'Stored BRAVO-3'." 60 > /tmp/bench_c2_2.txt &
PID2=$!
hc_send "$C2_S3" "The secret code is CHARLIE-9. Remember it. Reply with only 'Stored CHARLIE-9'." 60 > /tmp/bench_c2_3.txt &
PID3=$!
wait $PID1 $PID2 $PID3

# Now ask each session what its code is
hc_send "$C2_S1" "What is the secret code I gave you?" 60 > /dev/null
C2_R1=$(hc_get_last_assistant "$C2_S1")
hc_send "$C2_S2" "What is the secret code I gave you?" 60 > /dev/null
C2_R2=$(hc_get_last_assistant "$C2_S2")
hc_send "$C2_S3" "What is the secret code I gave you?" 60 > /dev/null
C2_R3=$(hc_get_last_assistant "$C2_S3")

C2_ISOLATED=0
echo "$C2_R1" | grep -qi "ALPHA" && ((C2_ISOLATED++)) || true
echo "$C2_R2" | grep -qi "BRAVO" && ((C2_ISOLATED++)) || true
echo "$C2_R3" | grep -qi "CHARLIE" && ((C2_ISOLATED++)) || true
record "C2_isolation" "hiveclaw" "0" "${C2_ISOLATED}/3" ""
log "  → HiveClaw: isolation score: ${C2_ISOLATED}/3"

# C3 — Session under token pressure (20 rapid-fire turns)
log "C3: Token pressure (20 turns then quality check)"
C3_SESSION=$(create_hc_session)
for i in $(seq 1 20); do
  hc_send "$C3_SESSION" "Turn $i: Tell me an interesting fact about the number $i. Keep it to one sentence." 30 > /dev/null
done
C3_TIME=$(hc_send "$C3_SESSION" "I gave you 20 facts about numbers 1-20. What fact did I ask about for number 7? Also, what is 142857 × 7?" 60)
C3_RESP=$(hc_get_last_assistant "$C3_SESSION")
C3_RECALL=$(echo "$C3_RESP" | grep -qi "7\|seven" && echo "yes" || echo "no")
C3_MATH=$(echo "$C3_RESP" | grep -q "999999" && echo "yes" || echo "no")
record "C3_pressure" "hiveclaw" "$C3_TIME" "recall=$C3_RECALL,math=$C3_MATH" ""
log "  → HiveClaw: ${C3_TIME}ms, recall: $C3_RECALL, math: $C3_MATH"

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORY D: LARGE PAYLOAD TOOL CALLS (the Clark bug scenario)
# ─────────────────────────────────────────────────────────────────────────────

log "═══ D. LARGE PAYLOAD ═══"

# D1 — Generate 10KB HTML via tool call
log "D1: Generate 10KB+ HTML file"
D1_SESSION=$(create_hc_session)
D1_PROMPT="Create a complete, production-quality HTML file at $FIXTURES_DIR/dashboard.html that contains:
- A responsive CSS dashboard layout (sidebar + main content)
- A data table with 50 rows of sample company data (name, revenue, employees, sector)
- Inline CSS (no external deps) with dark theme
- 3 summary stat cards at the top
- A footer with generation timestamp
The file should be at least 10KB. Write it in a SINGLE tool call."
D1_TIME=$(hc_send "$D1_SESSION" "$D1_PROMPT" 300)
D1_PASS="no"
D1_SIZE=0
if [ -f "$FIXTURES_DIR/dashboard.html" ]; then
  D1_SIZE=$(wc -c < "$FIXTURES_DIR/dashboard.html")
  [ "$D1_SIZE" -gt 10000 ] && D1_PASS="yes"
fi
record "D1_large_html" "hiveclaw" "$D1_TIME" "$D1_PASS" "size=${D1_SIZE}B"
log "  → HiveClaw: ${D1_TIME}ms, file size: ${D1_SIZE}B, pass: $D1_PASS"

# D2 — Generate large JSON + transform + write (multi-step with big payloads)
log "D2: Large JSON generate → transform → write"
D2_SESSION=$(create_hc_session)
D2_PROMPT="Do these 3 steps:
1. Write a JSON file at $FIXTURES_DIR/large_dataset.json with an array of 100 objects, each having: id, firstName, lastName, email, department (5 departments), salary (40000-150000), startDate (2015-2025), skills (array of 3 strings from a pool of 20 tech skills). Make the data realistic.
2. Read that file back, compute the average salary per department, and find the top 3 most common skills.
3. Write the analysis to $FIXTURES_DIR/large_analysis.json as {departments: [{name, avgSalary, count}], topSkills: [{skill, count}]}.
Execute all steps now."
D2_TIME=$(hc_send "$D2_SESSION" "$D2_PROMPT" 300)
D2_PASS="no"
if [ -f "$FIXTURES_DIR/large_dataset.json" ] && [ -f "$FIXTURES_DIR/large_analysis.json" ]; then
  D2_DS_SIZE=$(wc -c < "$FIXTURES_DIR/large_dataset.json")
  D2_AN_VALID=$(python3 -c "
import json
d = json.load(open('$FIXTURES_DIR/large_analysis.json'))
ok = 'departments' in d and 'topSkills' in d and len(d['departments']) >= 3
print('yes' if ok else 'no')
" 2>/dev/null || echo "no")
  [ "$D2_AN_VALID" = "yes" ] && D2_PASS="yes"
fi
record "D2_large_json" "hiveclaw" "$D2_TIME" "$D2_PASS" "dataset=${D2_DS_SIZE:-0}B"
log "  → HiveClaw: ${D2_TIME}ms, dataset: ${D2_DS_SIZE:-0}B, analysis valid: ${D2_AN_VALID:-no}"

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

log ""
log "═══════════════════════════════════════════"
log "  RESULTS: $RESULTS_FILE"
log "═══════════════════════════════════════════"
cat "$RESULTS_FILE" | python3 -c "
import sys, json
tests = [json.loads(l) for l in sys.stdin]
print(f'  Tests run: {len(tests)}')
passed = sum(1 for t in tests if t['status'] in ('yes','pass','3/3'))
print(f'  Passed: {passed}/{len(tests)}')
total_ms = sum(t['time_ms'] for t in tests)
print(f'  Total time: {total_ms}ms ({total_ms/1000:.1f}s)')
print()
for t in tests:
    icon = '✅' if t['status'] in ('yes','pass','3/3') else '⚠️' if 'partial' in str(t['status']) else '❌'
    print(f'  {icon} {t[\"test\"]:20s} {t[\"time_ms\"]:>6d}ms  {t[\"status\"]}  {t.get(\"detail\",\"\")}')
"

}

# ── Run ──────────────────────────────────────────────────────────────────────
run_all
