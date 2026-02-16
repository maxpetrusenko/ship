#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/app/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"

if [[ -z "${VITE_FIREBASE_API_KEY:-}" || -z "${VITE_FIREBASE_PROJECT_ID:-}" || -z "${VITE_AI_API_BASE_URL:-}" ]]; then
  echo "Missing required env vars in app/.env" >&2
  exit 1
fi

API_KEY="$VITE_FIREBASE_API_KEY"
PROJECT_ID="$VITE_FIREBASE_PROJECT_ID"
AI_BASE_URL="${VITE_AI_API_BASE_URL%/}"
AI_URL="$AI_BASE_URL/api/ai/command"
TS="$(date +%s)"
BOARD_ID="qa-critical-$TS"
OUT_DIR="$ROOT_DIR/submission/test-artifacts"
mkdir -p "$OUT_DIR"

RAW_LOG="$OUT_DIR/critical-checks-$TS.log"
SUMMARY_JSON="$OUT_DIR/critical-checks-$TS.json"

touch "$RAW_LOG"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$RAW_LOG"
}

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

post_json() {
  local url="$1"
  local bearer="$2"
  local body="$3"
  curl -sS -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $bearer" \
    --data "$body"
}

create_temp_user() {
  local email="$1"
  local password="$2"
  curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$API_KEY" \
    -H "Content-Type: application/json" \
    --data "{\"email\":\"$email\",\"password\":\"$password\",\"returnSecureToken\":true}"
}

delete_temp_user() {
  local id_token="$1"
  curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$API_KEY" \
    -H "Content-Type: application/json" \
    --data "{\"idToken\":\"$id_token\"}" >/dev/null
}

PASSWORD="QATest!${TS}!Aa1"
USER_COUNT=5
declare -a ID_TOKENS=()

cleanup_temp_users() {
  for tok in "${ID_TOKENS[@]}"; do
    if [[ -n "$tok" ]]; then
      delete_temp_user "$tok" || true
    fi
  done
}

trap cleanup_temp_users EXIT

log "Creating $USER_COUNT temporary QA users"
for i in $(seq 1 "$USER_COUNT"); do
  EMAIL="qa.user${i}.$TS@example.com"
  USER_RESP="$(create_temp_user "$EMAIL" "$PASSWORD")"
  USER_TOKEN="$(echo "$USER_RESP" | jq -r '.idToken // empty')"
  if [[ -z "$USER_TOKEN" ]]; then
    echo "Failed to create temp user $EMAIL" >&2
    echo "$USER_RESP" >&2
    exit 1
  fi
  ID_TOKENS+=("$USER_TOKEN")
done

ID_TOKEN_1="${ID_TOKENS[0]}"
ID_TOKEN_2="${ID_TOKENS[1]}"

CID_1="cmd-a-$TS"
CID_2="cmd-b-$TS"
CMD_1="add yellow sticky note saying alpha-$TS"
CMD_2="create a blue rectangle at position 320,220"

log "Running simultaneous AI commands from two users"

BODY_1="$(jq -n --arg b "$BOARD_ID" --arg c "$CMD_1" --arg i "$CID_1" --arg n "QA User 1" '{boardId:$b,command:$c,clientCommandId:$i,userDisplayName:$n}')"
BODY_2="$(jq -n --arg b "$BOARD_ID" --arg c "$CMD_2" --arg i "$CID_2" --arg n "QA User 2" '{boardId:$b,command:$c,clientCommandId:$i,userDisplayName:$n}')"

START_MS="$(now_ms)"
(
  post_json "$AI_URL" "$ID_TOKEN_1" "$BODY_1" >"$OUT_DIR/resp-$CID_1.json"
) &
PID1=$!
(
  post_json "$AI_URL" "$ID_TOKEN_2" "$BODY_2" >"$OUT_DIR/resp-$CID_2.json"
) &
PID2=$!
wait "$PID1"
wait "$PID2"
END_MS="$(now_ms)"
ELAPSED_MS=$((END_MS - START_MS))

R1="$(cat "$OUT_DIR/resp-$CID_1.json")"
R2="$(cat "$OUT_DIR/resp-$CID_2.json")"

S1="$(echo "$R1" | jq -r '.status // "unknown"')"
S2="$(echo "$R2" | jq -r '.status // "unknown"')"

log "Simultaneous run complete in ${ELAPSED_MS}ms (statuses: $S1, $S2)"

log "Running 5-user concurrent AI command burst"
declare -a BURST_PIDS=()
declare -a BURST_CIDS=()
declare -a BURST_STATUSES=()

for i in $(seq 1 "$USER_COUNT"); do
  IDX=$((i - 1))
  CID_BURST="cmd-burst-$TS-$i"
  CMD_BURST="add green sticky note saying burst-$i-$TS"
  BODY_BURST="$(jq -n --arg b "$BOARD_ID" --arg c "$CMD_BURST" --arg i "$CID_BURST" --arg n "QA User $i" '{boardId:$b,command:$c,clientCommandId:$i,userDisplayName:$n}')"
  BURST_CIDS+=("$CID_BURST")
  (
    post_json "$AI_URL" "${ID_TOKENS[$IDX]}" "$BODY_BURST" >"$OUT_DIR/resp-$CID_BURST.json"
  ) &
  BURST_PIDS+=("$!")
done

for pid in "${BURST_PIDS[@]}"; do
  wait "$pid"
done

PASS_FIVE_USERS="true"
for cid in "${BURST_CIDS[@]}"; do
  status="$(jq -r '.status // "unknown"' "$OUT_DIR/resp-$cid.json")"
  BURST_STATUSES+=("$status")
  if [[ "$status" != "success" ]]; then
    PASS_FIVE_USERS="false"
  fi
done

log "Validating idempotency with duplicate clientCommandId"
IDEMP_RESP="$(post_json "$AI_URL" "$ID_TOKEN_1" "$BODY_1")"
IDEMP_OK="$(echo "$IDEMP_RESP" | jq -r '.idempotent // false')"

THROTTLE_CID="cmd-throttle-$TS"
THROTTLE_BODY="$(jq -n --arg b "$BOARD_ID" --arg c "create a SWOT template" --arg i "$THROTTLE_CID" --arg n "QA User 1" '{boardId:$b,command:$c,clientCommandId:$i,userDisplayName:$n}')"

log "Running throttled/disconnect retry simulation"
set +e
curl -sS -X POST "$AI_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ID_TOKEN_1" \
  --limit-rate 128 \
  --max-time 0.2 \
  --data "$THROTTLE_BODY" >"$OUT_DIR/resp-$THROTTLE_CID-timeout.json"
THROTTLE_EXIT="$?"
set -e

sleep 1
THROTTLE_RETRY_RESP="$(post_json "$AI_URL" "$ID_TOKEN_1" "$THROTTLE_BODY")"
THROTTLE_RETRY_STATUS="$(echo "$THROTTLE_RETRY_RESP" | jq -r '.status // "unknown"')"
THROTTLE_RETRY_IDEMP="$(echo "$THROTTLE_RETRY_RESP" | jq -r '.idempotent // false')"

log "Querying Firestore aiCommands for queue evidence"
CMD_DOCS_RAW="$(curl -sS -X GET \
  "https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents/boards/$BOARD_ID/aiCommands" \
  -H "Authorization: Bearer $ID_TOKEN_1")"

QUEUE_INFO="$(echo "$CMD_DOCS_RAW" | jq -c '
  (.documents // []) | map({
    name: (.name | split("/")[-1]),
    status: (.fields.status.stringValue // "unknown"),
    queueSequence: ((.fields.queueSequence.integerValue // "0") | tonumber),
    startedAt: ((.fields.startedAt.integerValue // "0") | tonumber),
    completedAt: ((.fields.completedAt.integerValue // "0") | tonumber)
  }) | sort_by(.queueSequence, .startedAt)
')"

PASS_SIMULTANEOUS="false"
if [[ "$S1" == "success" && "$S2" == "success" ]]; then
  PASS_SIMULTANEOUS="true"
fi

PASS_IDEMPOTENT="false"
if [[ "$IDEMP_OK" == "true" ]]; then
  PASS_IDEMPOTENT="true"
fi

PASS_THROTTLE_RETRY="false"
if [[ "$THROTTLE_EXIT" != "0" && ( "$THROTTLE_RETRY_STATUS" == "success" || "$THROTTLE_RETRY_IDEMP" == "true" ) ]]; then
  PASS_THROTTLE_RETRY="true"
fi

BURST_STATUSES_JSON="$(printf '%s\n' "${BURST_STATUSES[@]}" | jq -R . | jq -sc .)"

jq -n \
  --arg timestamp "$TS" \
  --arg boardId "$BOARD_ID" \
  --arg elapsedMs "$ELAPSED_MS" \
  --arg status1 "$S1" \
  --arg status2 "$S2" \
  --arg passFiveUsers "$PASS_FIVE_USERS" \
  --arg idempotent "$IDEMP_OK" \
  --arg throttleExit "$THROTTLE_EXIT" \
  --arg throttleRetryStatus "$THROTTLE_RETRY_STATUS" \
  --arg throttleRetryIdempotent "$THROTTLE_RETRY_IDEMP" \
  --argjson burstStatuses "$BURST_STATUSES_JSON" \
  --argjson queue "$QUEUE_INFO" \
  --arg passSimultaneous "$PASS_SIMULTANEOUS" \
  --arg passIdempotent "$PASS_IDEMPOTENT" \
  --arg passThrottleRetry "$PASS_THROTTLE_RETRY" \
  '{
    timestamp: ($timestamp | tonumber),
    boardId: $boardId,
    checks: {
      simultaneousAiCommands: { pass: ($passSimultaneous == "true"), statuses: [$status1, $status2], elapsedMs: ($elapsedMs|tonumber) },
      fiveAuthUsersBurst: { pass: ($passFiveUsers == "true"), statuses: $burstStatuses },
      idempotency: { pass: ($passIdempotent == "true"), duplicateResponseIdempotent: ($idempotent == "true") },
      throttleDisconnectRetry: {
        pass: ($passThrottleRetry == "true"),
        firstRequestCurlExit: ($throttleExit | tonumber),
        retryStatus: $throttleRetryStatus,
        retryIdempotent: ($throttleRetryIdempotent == "true")
      }
    },
    queueEvidence: $queue
  }' >"$SUMMARY_JSON"

log "Done. Summary: $SUMMARY_JSON"
cat "$SUMMARY_JSON"
