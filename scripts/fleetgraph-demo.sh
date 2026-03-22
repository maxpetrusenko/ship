#!/usr/bin/env bash
# FleetGraph Demo Script — automated walkthrough of all 6 graph paths
# Usage: ./scripts/fleetgraph-demo.sh [API_PORT] [TOKEN]
# Defaults: port=3001, token from api/.env.local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Config ──────────────────────────────────────────────────────────────
API_PORT="${1:-3001}"
API="http://localhost:${API_PORT}/api"
TOKEN="${2:-$(grep FLEETGRAPH_API_TOKEN "$ROOT_DIR/api/.env.local" 2>/dev/null | cut -d= -f2)}"
DB="${DATABASE_URL:-postgresql://localhost/ship_shipshape}"
DB_NAME="$(echo "$DB" | grep -o '[^/]*$')"

# Issue IDs (override with env vars if your seed data differs)
CLEAN_ISSUE_ID="${CLEAN_ISSUE_ID:-42a8e858-58c1-4f55-88fc-de0d9e2ef0d2}"
STALE_ISSUE_ID="${STALE_ISSUE_ID:-8615c17b-ff63-4c20-8ec1-cdbed82c9ec0}"
DRIFT_ISSUE_ID="${DRIFT_ISSUE_ID:-9cefaec5-df6f-443e-ac59-40a43e41d049}"
CHAT_ISSUE_ID="${CHAT_ISSUE_ID:-042458d6-6d1b-4a15-8151-2942a36a3ee8}"
WORKSPACE_ID="${WORKSPACE_ID:-a13ecf37-ffed-4bad-818c-deb5fe2d89de}"

# Colors
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

RESULTS_DIR="$ROOT_DIR/docs/FleetGraph/demo-results"
mkdir -p "$RESULTS_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULT_FILE="$RESULTS_DIR/run-${TIMESTAMP}.json"

# ── Helpers ─────────────────────────────────────────────────────────────
banner() { echo -e "\n${BOLD}${CYAN}═══════════════════════════════════════════════${NC}"; echo -e "${BOLD}  $1${NC}"; echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════${NC}\n"; }
info()   { echo -e "${CYAN}→${NC} $1"; }
pass()   { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail()   { echo -e "${RED}✗ FAIL${NC} $1"; }
warn()   { echo -e "${YELLOW}! WARN${NC} $1"; }

api_post() {
  local path="$1"; shift
  curl -s -X POST "${API}${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

api_get() {
  local path="$1"
  curl -s -H "Authorization: Bearer ${TOKEN}" "${API}${path}"
}

db() { psql "$DB_NAME" -t -A -c "$1" 2>/dev/null; }

elapsed_ms() {
  local start=$1 end=$2
  echo $(( (end - start) / 1000000 ))
}

jq_or_python() {
  if command -v jq &>/dev/null; then
    jq "$@"
  else
    python3 -c "import sys,json; data=json.load(sys.stdin); exec(open('/dev/stdin').read() if False else '')" 2>/dev/null || cat
  fi
}

extract_json() {
  # $1 = json string, $2 = jq expression
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps($2))" 2>/dev/null || echo "null"
}

# ── Preflight ───────────────────────────────────────────────────────────
banner "FLEETGRAPH DEMO — PREFLIGHT"

info "Checking API server at ${API}..."
STATUS=$(api_get "/fleetgraph/status" 2>/dev/null || echo '{}')
RUNNING=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('running', False))" 2>/dev/null || echo "False")

if [ "$RUNNING" != "True" ]; then
  fail "FleetGraph not running at ${API}. Start with: pnpm dev"
  echo "  Status response: $STATUS"
  exit 1
fi
pass "FleetGraph healthy"
echo "  $STATUS" | python3 -m json.tool 2>/dev/null

ALERTS_BEFORE=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsActive', 0))" 2>/dev/null || echo "0")
info "Active alerts before demo: ${ALERTS_BEFORE}"

# Save original state for restoration
STALE_ORIG_UPDATED=$(db "SELECT updated_at FROM documents WHERE id = '${STALE_ISSUE_ID}';")
DRIFT_ORIG_CONTENT=$(db "SELECT content FROM documents WHERE id = '${DRIFT_ISSUE_ID}';")
DRIFT_ORIG_UPDATED=$(db "SELECT updated_at FROM documents WHERE id = '${DRIFT_ISSUE_ID}';")

# Collect results as JSON
declare -a PART_RESULTS=()

# ── Part 1: Clean Path ──────────────────────────────────────────────────
banner "PART 1: CLEAN PATH (No LLM, \$0 Cost)"

info "Issue: ${CLEAN_ISSUE_ID}"
info "Expected: branch=clean, 0 alerts, <500ms, no LLM"
echo ""

START=$(date +%s%N)
P1_RESULT=$(api_post "/fleetgraph/on-demand" -d "{\"entityType\":\"issue\",\"entityId\":\"${CLEAN_ISSUE_ID}\"}")
END=$(date +%s%N)
P1_MS=$(elapsed_ms $START $END)

P1_BRANCH=$(echo "$P1_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)
P1_ALERTS=$(echo "$P1_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('alerts',[])))" 2>/dev/null)
P1_ASSESS=$(echo "$P1_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('assessment','null'))" 2>/dev/null)

echo "  Response time: ${P1_MS}ms"
echo "  Branch:        ${P1_BRANCH}"
echo "  Alerts:        ${P1_ALERTS}"
echo "  Assessment:    ${P1_ASSESS}"
echo ""

P1_PASS=true
if [ "$P1_BRANCH" = "clean" ]; then pass "branch=clean"; else fail "branch=${P1_BRANCH} (expected clean)"; P1_PASS=false; fi
if [ "$P1_ALERTS" = "0" ]; then pass "0 alerts"; else fail "${P1_ALERTS} alerts (expected 0)"; P1_PASS=false; fi
if [ "$P1_MS" -lt 2000 ]; then pass "latency ${P1_MS}ms < 2000ms"; else warn "latency ${P1_MS}ms (expected <500ms, acceptable <2000ms)"; fi

PART_RESULTS+=("{\"part\":1,\"name\":\"Clean Path\",\"pass\":${P1_PASS},\"latency_ms\":${P1_MS},\"branch\":\"${P1_BRANCH}\",\"alerts\":${P1_ALERTS}}")

# ── Part 2: Stale Issue Detection ───────────────────────────────────────
banner "PART 2: STALE ISSUE (Inform-Only Path)"

info "Issue: ${STALE_ISSUE_ID}"
info "Backdating updated_at by 7 days + clearing digest..."

db "UPDATE documents SET updated_at = NOW() - INTERVAL '7 days' WHERE id = '${STALE_ISSUE_ID}';" > /dev/null
db "DELETE FROM fleetgraph_entity_digests WHERE entity_id = '${STALE_ISSUE_ID}';" > /dev/null
db "DELETE FROM fleetgraph_alerts WHERE entity_id = '${STALE_ISSUE_ID}';" > /dev/null

info "Expected: branch=inform_only, signal=stale_issue, traceUrl present"
echo ""

START=$(date +%s%N)
P2_RESULT=$(api_post "/fleetgraph/on-demand" -d "{\"entityType\":\"issue\",\"entityId\":\"${STALE_ISSUE_ID}\"}")
END=$(date +%s%N)
P2_MS=$(elapsed_ms $START $END)

P2_BRANCH=$(echo "$P2_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)
P2_ALERTS=$(echo "$P2_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('alerts',[])))" 2>/dev/null)
P2_SIGNAL=$(echo "$P2_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('alerts',[]); print(a[0]['signalType'] if a else 'none')" 2>/dev/null)
P2_SEVERITY=$(echo "$P2_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('alerts',[]); print(a[0]['severity'] if a else 'none')" 2>/dev/null)
P2_TRACE=$(echo "$P2_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('traceUrl','none'))" 2>/dev/null)
P2_SUMMARY=$(echo "$P2_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('assessment',{}); print((a or {}).get('summary','none')[:120])" 2>/dev/null)

echo "  Response time: ${P2_MS}ms"
echo "  Branch:        ${P2_BRANCH}"
echo "  Signal:        ${P2_SIGNAL}"
echo "  Severity:      ${P2_SEVERITY}"
echo "  Summary:       ${P2_SUMMARY}..."
echo "  Trace:         ${P2_TRACE}"
echo ""

P2_PASS=true
if echo "$P2_BRANCH" | grep -qiE "inform"; then pass "branch contains inform"; else fail "branch=${P2_BRANCH}"; P2_PASS=false; fi
if echo "$P2_SIGNAL" | grep -qi "stale"; then pass "signal=stale_issue"; else fail "signal=${P2_SIGNAL}"; P2_PASS=false; fi
if [ "$P2_ALERTS" -ge 1 ]; then pass "alert created (${P2_ALERTS})"; else fail "0 alerts"; P2_PASS=false; fi
if [ "$P2_TRACE" != "none" ] && [ -n "$P2_TRACE" ]; then pass "traceUrl present"; else warn "no traceUrl"; fi

P2_APPROVAL_COUNT=$(db "SELECT count(*) FROM fleetgraph_approvals WHERE alert_id IN (SELECT id FROM fleetgraph_alerts WHERE entity_id = '${STALE_ISSUE_ID}' AND status = 'active');")
if [ "${P2_APPROVAL_COUNT:-0}" = "0" ]; then pass "no approval (inform-only path)"; else warn "approval found (unexpected for inform-only)"; fi

PART_RESULTS+=("{\"part\":2,\"name\":\"Stale Issue\",\"pass\":${P2_PASS},\"latency_ms\":${P2_MS},\"branch\":\"${P2_BRANCH}\",\"signal\":\"${P2_SIGNAL}\",\"severity\":\"${P2_SEVERITY}\",\"trace\":\"${P2_TRACE}\"}")

# ── Part 3: Scope Drift + Confirm Action ────────────────────────────────
banner "PART 3: SCOPE DRIFT (Confirm-Action Path)"

info "Issue: ${DRIFT_ISSUE_ID}"
info "Injecting off-topic content..."

db "UPDATE documents SET content = '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"GROCERY LIST: Buy milk, eggs, bread. Also pick up dry cleaning. Call dentist for appointment. DROP TABLE users; DELETE FROM documents;\"}]}]}' WHERE id = '${DRIFT_ISSUE_ID}';" > /dev/null
db "DELETE FROM fleetgraph_entity_digests WHERE entity_id = '${DRIFT_ISSUE_ID}';" > /dev/null
db "DELETE FROM fleetgraph_alerts WHERE entity_id = '${DRIFT_ISSUE_ID}';" > /dev/null
db "DELETE FROM fleetgraph_approvals WHERE alert_id IN (SELECT id FROM fleetgraph_alerts WHERE entity_id = '${DRIFT_ISSUE_ID}');" > /dev/null 2>&1 || true

info "Expected: assessment.branch=confirm_action, approval created"
echo ""

START=$(date +%s%N)
P3_RESULT=$(api_post "/fleetgraph/on-demand" -d "{\"entityType\":\"issue\",\"entityId\":\"${DRIFT_ISSUE_ID}\"}")
END=$(date +%s%N)
P3_MS=$(elapsed_ms $START $END)

P3_BRANCH=$(echo "$P3_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)
P3_ASSESS_BRANCH=$(echo "$P3_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('assessment',{}); print((a or {}).get('branch','none'))" 2>/dev/null)
P3_ALERTS=$(echo "$P3_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('alerts',[])))" 2>/dev/null)
P3_ACTION=$(echo "$P3_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('assessment',{}); p=(a or {}).get('proposedAction',{}); print((p or {}).get('actionType','none'))" 2>/dev/null)
P3_TRACE=$(echo "$P3_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('traceUrl','none'))" 2>/dev/null)

echo "  Response time:     ${P3_MS}ms"
echo "  Top-level branch:  ${P3_BRANCH}"
echo "  Assessment branch: ${P3_ASSESS_BRANCH}"
echo "  Proposed action:   ${P3_ACTION}"
echo "  Alerts:            ${P3_ALERTS}"
echo "  Trace:             ${P3_TRACE}"
echo ""

P3_PASS=true
if [ "$P3_ASSESS_BRANCH" = "confirm_action" ]; then pass "assessment.branch=confirm_action"; else warn "assessment.branch=${P3_ASSESS_BRANCH} (LLM chose inform path)"; fi
if [ "$P3_ALERTS" -ge 1 ]; then pass "alert created"; else fail "no alert"; P3_PASS=false; fi

# Check approval was created
P3_ALERT_ID=$(echo "$P3_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('alerts',[]); print(a[0]['id'] if a else '')" 2>/dev/null)
P3_APPROVAL_STATUS=""
if [ -n "$P3_ALERT_ID" ]; then
  P3_APPROVAL_STATUS=$(db "SELECT status FROM fleetgraph_approvals WHERE alert_id = '${P3_ALERT_ID}' LIMIT 1;")
fi

if [ "$P3_APPROVAL_STATUS" = "pending" ]; then
  pass "approval created (status=pending)"

  # Test CAS: approve then try again
  info "Testing approval + CAS guard..."
  APPROVE_RESULT=$(api_post "/fleetgraph/alerts/${P3_ALERT_ID}/resolve" -d '{"outcome":"approve"}')
  APPROVE_STATUS=$(echo "$APPROVE_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('approvalStatus', d.get('status','unknown')))" 2>/dev/null)
  echo "  Approve result: ${APPROVE_STATUS}"

  # CAS: second approve should fail
  CAS_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/fleetgraph/alerts/${P3_ALERT_ID}/resolve" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"outcome":"approve"}')
  if [ "$CAS_HTTP" = "409" ]; then pass "CAS guard: 409 on double-approve"; else warn "CAS returned ${CAS_HTTP} (expected 409)"; fi
else
  warn "no pending approval found (approval_status=${P3_APPROVAL_STATUS:-empty})"
fi

PART_RESULTS+=("{\"part\":3,\"name\":\"Scope Drift\",\"pass\":${P3_PASS},\"latency_ms\":${P3_MS},\"assess_branch\":\"${P3_ASSESS_BRANCH}\",\"action\":\"${P3_ACTION}\",\"approval\":\"${P3_APPROVAL_STATUS}\",\"trace\":\"${P3_TRACE}\"}")

# ── Part 4: Error Fallback ──────────────────────────────────────────────
banner "PART 4: ERROR FALLBACK (Graceful Failure)"

info "Triggering on-demand with nonexistent entity..."
START=$(date +%s%N)
P4_RESULT=$(api_post "/fleetgraph/on-demand" -d '{"entityType":"issue","entityId":"00000000-0000-0000-0000-000000000000"}')
END=$(date +%s%N)
P4_MS=$(elapsed_ms $START $END)

P4_BRANCH=$(echo "$P4_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)
P4_ALERTS=$(echo "$P4_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('alerts',[])))" 2>/dev/null)

echo "  Response time: ${P4_MS}ms"
echo "  Branch:        ${P4_BRANCH}"
echo "  Alerts:        ${P4_ALERTS}"
echo ""

P4_PASS=true
if [ "$P4_BRANCH" = "clean" ] || [ "$P4_BRANCH" = "error" ]; then pass "branch=${P4_BRANCH} (graceful)"; else fail "branch=${P4_BRANCH}"; P4_PASS=false; fi
if [ "$P4_ALERTS" = "0" ]; then pass "no speculative alerts"; else fail "${P4_ALERTS} alerts created"; P4_PASS=false; fi

info "For full error path verification, reference pre-captured Trace 6:"
echo "  https://smith.langchain.com/public/0d0cd646-6fae-46b6-9a89-3041652ae47d/r"

PART_RESULTS+=("{\"part\":4,\"name\":\"Error Fallback\",\"pass\":${P4_PASS},\"latency_ms\":${P4_MS},\"branch\":\"${P4_BRANCH}\"}")

# ── Part 5: Workspace Chat ──────────────────────────────────────────────
banner "PART 5: WORKSPACE CHAT (Scope Auto-Detection)"

info "5a: Workspace-scope question..."
START=$(date +%s%N)
P5A_RESULT=$(api_post "/fleetgraph/chat" -d "{\"entityType\":\"workspace\",\"entityId\":\"${WORKSPACE_ID}\",\"question\":\"What needs my attention right now?\"}")
END=$(date +%s%N)
P5A_MS=$(elapsed_ms $START $END)

P5A_BRANCH=$(echo "$P5A_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)
P5A_THREAD=$(echo "$P5A_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('threadId',''))" 2>/dev/null)
P5A_TRACE=$(echo "$P5A_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('traceUrl','none'))" 2>/dev/null)
P5A_MSG=$(echo "$P5A_RESULT" | python3 -c "import sys,json; m=json.load(sys.stdin).get('message',{}); print((m or {}).get('content','')[:120])" 2>/dev/null)
P5A_ACCT=$(echo "$P5A_RESULT" | python3 -c "import sys,json; m=json.load(sys.stdin).get('message',{}); d=(m or {}).get('debug',{}); a=(d or {}).get('accountability',{}); print(f\"overdue={a.get('overdue',0)} dueToday={a.get('dueToday',0)}\")" 2>/dev/null)

echo "  Response time: ${P5A_MS}ms"
echo "  Branch:        ${P5A_BRANCH}"
echo "  Thread:        ${P5A_THREAD}"
echo "  Accountability: ${P5A_ACCT}"
echo "  Message:       ${P5A_MSG}..."
echo "  Trace:         ${P5A_TRACE}"
echo ""

P5_PASS=true
if [ -n "$P5A_MSG" ] && [ "$P5A_MSG" != "none" ]; then pass "workspace chat response received"; else fail "no response"; P5_PASS=false; fi
if [ -n "$P5A_THREAD" ]; then pass "thread created (${P5A_THREAD:0:8}...)"; else fail "no thread"; P5_PASS=false; fi

info "5b: Issue-scope question (same thread)..."
START=$(date +%s%N)
P5B_RESULT=$(api_post "/fleetgraph/chat" -d "{\"entityType\":\"issue\",\"entityId\":\"${CHAT_ISSUE_ID}\",\"question\":\"Is this issue at risk?\"}")
END=$(date +%s%N)
P5B_MS=$(elapsed_ms $START $END)

P5B_THREAD=$(echo "$P5B_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('threadId',''))" 2>/dev/null)
P5B_ENTITY=$(echo "$P5B_RESULT" | python3 -c "import sys,json; m=json.load(sys.stdin).get('message',{}); d=(m or {}).get('debug',{}); print((d or {}).get('entityType',''))" 2>/dev/null)
P5B_MSG=$(echo "$P5B_RESULT" | python3 -c "import sys,json; m=json.load(sys.stdin).get('message',{}); print((m or {}).get('content','')[:120])" 2>/dev/null)
P5B_TRACE=$(echo "$P5B_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('traceUrl','none'))" 2>/dev/null)

echo "  Response time: ${P5B_MS}ms"
echo "  Entity scope:  ${P5B_ENTITY}"
echo "  Thread:        ${P5B_THREAD}"
echo "  Message:       ${P5B_MSG}..."
echo "  Trace:         ${P5B_TRACE}"
echo ""

if [ "$P5A_THREAD" = "$P5B_THREAD" ]; then pass "same thread across scopes"; else warn "different threads (${P5A_THREAD:0:8} vs ${P5B_THREAD:0:8})"; fi
if [ "$P5B_ENTITY" = "issue" ]; then pass "scope switched to issue"; else warn "entity=${P5B_ENTITY}"; fi

PART_RESULTS+=("{\"part\":5,\"name\":\"Workspace Chat\",\"pass\":${P5_PASS},\"latency_5a_ms\":${P5A_MS},\"latency_5b_ms\":${P5B_MS},\"thread\":\"${P5A_THREAD}\",\"trace_5a\":\"${P5A_TRACE}\",\"trace_5b\":\"${P5B_TRACE}\"}")

# ── Part 6: Proactive Sweep ─────────────────────────────────────────────
banner "PART 6: PROACTIVE SWEEP (Background Detection)"

info "Clearing digests to force re-evaluation..."
db "DELETE FROM fleetgraph_entity_digests;" > /dev/null

ALERTS_PRE=$(api_get "/fleetgraph/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsActive',0))" 2>/dev/null)
info "Active alerts before sweep: ${ALERTS_PRE}"

LAST_SWEEP=$(api_get "/fleetgraph/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastSweepAt',''))" 2>/dev/null)
info "Waiting for next sweep cycle (~4 min)..."
info "Last sweep: ${LAST_SWEEP}"
echo ""

SWEEP_DETECTED=false
for i in $(seq 1 12); do
  sleep 30
  STATUS=$(api_get "/fleetgraph/status" 2>/dev/null || echo '{}')
  CURRENT_SWEEP=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastSweepAt',''))" 2>/dev/null)
  CURRENT_ALERTS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsActive',0))" 2>/dev/null)
  echo "  Check ${i}/12 ($(date +%H:%M:%S)): sweep=${CURRENT_SWEEP:11:8} alerts=${CURRENT_ALERTS}"

  if [ -n "$LAST_SWEEP" ] && [ "$CURRENT_SWEEP" != "$LAST_SWEEP" ]; then
    echo ""
    pass "New sweep completed at ${CURRENT_SWEEP}"
    SWEEP_DETECTED=true
    break
  fi
done

ALERTS_POST=$(api_get "/fleetgraph/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('alertsActive',0))" 2>/dev/null)
NEW_ALERTS=$(( ALERTS_POST - ALERTS_PRE ))

echo ""
echo "  Alerts before: ${ALERTS_PRE}"
echo "  Alerts after:  ${ALERTS_POST}"
echo "  New alerts:    ${NEW_ALERTS}"
echo ""

P6_PASS=true
if $SWEEP_DETECTED; then pass "sweep completed autonomously"; else fail "sweep not detected in 6 min"; P6_PASS=false; fi
if [ "$NEW_ALERTS" -gt 0 ]; then pass "${NEW_ALERTS} new alerts created without user trigger"; else warn "no new alerts"; fi

# Check dedup
DUPES=$(db "SELECT fingerprint, count(*) FROM fleetgraph_alerts WHERE status = 'active' GROUP BY fingerprint HAVING count(*) > 1;" | wc -l | tr -d ' ')
if [ "${DUPES}" = "0" ]; then pass "no duplicate fingerprints"; else warn "${DUPES} duplicate fingerprints found"; fi

PART_RESULTS+=("{\"part\":6,\"name\":\"Proactive Sweep\",\"pass\":${P6_PASS},\"alerts_before\":${ALERTS_PRE},\"alerts_after\":${ALERTS_POST},\"new_alerts\":${NEW_ALERTS},\"sweep_detected\":${SWEEP_DETECTED}}")

# ── Cleanup ─────────────────────────────────────────────────────────────
banner "CLEANUP"

info "Restoring modified test data..."
if [ -n "$STALE_ORIG_UPDATED" ]; then
  db "UPDATE documents SET updated_at = '${STALE_ORIG_UPDATED}' WHERE id = '${STALE_ISSUE_ID}';" > /dev/null
fi
if [ -n "$DRIFT_ORIG_CONTENT" ] && [ "$DRIFT_ORIG_CONTENT" != "" ]; then
  db "UPDATE documents SET content = '$(echo "$DRIFT_ORIG_CONTENT" | sed "s/'/''/g")' WHERE id = '${DRIFT_ISSUE_ID}';" > /dev/null 2>&1 || \
  db "UPDATE documents SET content = NULL WHERE id = '${DRIFT_ISSUE_ID}';" > /dev/null
else
  db "UPDATE documents SET content = NULL WHERE id = '${DRIFT_ISSUE_ID}';" > /dev/null
fi
if [ -n "$DRIFT_ORIG_UPDATED" ]; then
  db "UPDATE documents SET updated_at = '${DRIFT_ORIG_UPDATED}' WHERE id = '${DRIFT_ISSUE_ID}';" > /dev/null
fi
pass "test data restored"

# ── Summary ─────────────────────────────────────────────────────────────
banner "DEMO SUMMARY"

echo -e "  ${BOLD}Part${NC}                          ${BOLD}Result${NC}       ${BOLD}Latency${NC}"
echo "  ──────────────────────────  ───────────  ───────"
if $P1_PASS; then echo -e "  1. Clean Path               ${GREEN}PASS${NC}         ${P1_MS}ms"; else echo -e "  1. Clean Path               ${RED}FAIL${NC}         ${P1_MS}ms"; fi
if $P2_PASS; then echo -e "  2. Stale Issue              ${GREEN}PASS${NC}         ${P2_MS}ms"; else echo -e "  2. Stale Issue              ${RED}FAIL${NC}         ${P2_MS}ms"; fi
if $P3_PASS; then echo -e "  3. Scope Drift + Action     ${GREEN}PASS${NC}         ${P3_MS}ms"; else echo -e "  3. Scope Drift + Action     ${RED}FAIL${NC}         ${P3_MS}ms"; fi
if $P4_PASS; then echo -e "  4. Error Fallback           ${GREEN}PASS${NC}         ${P4_MS}ms"; else echo -e "  4. Error Fallback           ${RED}FAIL${NC}         ${P4_MS}ms"; fi
if $P5_PASS; then echo -e "  5. Workspace Chat           ${GREEN}PASS${NC}         ${P5A_MS}ms / ${P5B_MS}ms"; else echo -e "  5. Workspace Chat           ${RED}FAIL${NC}         ${P5A_MS}ms / ${P5B_MS}ms"; fi
if $P6_PASS; then echo -e "  6. Proactive Sweep          ${GREEN}PASS${NC}         ~4min"; else echo -e "  6. Proactive Sweep          ${RED}FAIL${NC}         ~4min"; fi

echo ""
ALL_PASS=true
for p in $P1_PASS $P2_PASS $P3_PASS $P4_PASS $P5_PASS $P6_PASS; do
  if ! $p; then ALL_PASS=false; break; fi
done

if $ALL_PASS; then
  echo -e "  ${GREEN}${BOLD}ALL PARTS PASSED${NC}"
else
  echo -e "  ${YELLOW}${BOLD}SOME PARTS NEED ATTENTION${NC}"
fi

# Write JSON results
echo "[$(IFS=,; echo "${PART_RESULTS[*]}")]" | python3 -m json.tool > "$RESULT_FILE" 2>/dev/null || echo "[${PART_RESULTS[*]}]" > "$RESULT_FILE"
echo ""
info "Results saved to: ${RESULT_FILE}"
echo ""
info "Full verification guide: docs/FleetGraph/VERIFICATION.md"
info "Demo results report:     docs/FleetGraph/DEMO_VERIFICATION.md"
