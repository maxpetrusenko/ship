# FleetGraph Verification Guide

How to verify that FleetGraph's graph behavior, decision paths, and deterministic/LLM boundaries work as designed. Each section maps directly to a testable claim.

## 1. Node-by-Node: Deterministic vs LLM

FleetGraph has 14 nodes. **Exactly one** uses the LLM. The rest are pure deterministic logic.

| # | Node | Uses LLM? | What it does | Source |
|---|------|-----------|--------------|--------|
| 1 | `trigger_context` | No | Copies entityType, entityId, sets runStartedAt timestamp | `graph/nodes.ts:438` |
| 2 | `fetch_core_context` | No | GET Ship REST API for entity + children + metadata | `graph/nodes.ts:456` |
| 3 | `fetch_parallel_signals` | No | Fan-out GET: activity, accountability, approvals, history | `graph/nodes.ts:484` |
| 4 | `heuristic_filter` | No | Rule-based candidate generation (thresholds + arithmetic) | `graph/nodes.ts:515` |
| 5 | `reason_about_risk` | **Yes** | gpt-4o-mini: assess risk, recommend action, cite evidence | `graph/nodes.ts:669` |
| 6 | `prepare_notification` | No | No-op waypoint (future: Slack formatting) | `graph/nodes-terminal.ts:63` |
| 7 | `deliver_alert` | No | INSERT to fleetgraph_alerts + WebSocket broadcast | `graph/nodes-terminal.ts:91` |
| 8 | `prepare_action` | No | INSERT to fleetgraph_approvals (pending, 72h TTL) | `graph/nodes-terminal.ts:132` |
| 9 | `human_gate` | No | LangGraph `interrupt()` — pauses graph at checkpoint | `graph/nodes-terminal.ts:206` |
| 10 | `execute_action` | No | PATCH/POST Ship REST API (reassign, state, priority, flag, comment) | `graph/nodes-terminal.ts:232` |
| 11 | `log_clean_run` | No | INSERT audit log: no candidates found | `graph/nodes-terminal.ts:282` |
| 12 | `log_dismissal` | No | INSERT audit log: user dismissed | `graph/nodes-terminal.ts:320` |
| 13 | `log_snooze` | No | INSERT audit log: user snoozed | `graph/nodes-terminal.ts:348` |
| 14 | `error_fallback` | No | INSERT structured error log, end gracefully | `graph/nodes-terminal.ts:370` |

**Key insight:** Node 4 (`heuristic_filter`) does all signal detection with pure JavaScript: date arithmetic, threshold comparison, regex pattern matching, token overlap scoring. Zero LLM tokens are spent to decide *whether* something is a risk. The LLM (node 5) only runs *after* the heuristic confirms there are candidates worth reasoning about, or when a user asks a chat question.

**Chat bypass:** Node 5 also contains a deterministic fast path (`buildDeterministicChatAssessment` at `nodes.ts:367`) that answers accountability questions (overdue items, action items) without the LLM. It matches via regex: `/(overdue|action items|pending items|accountability|what needs my attention)/i`.

## 2. Decision Tree (Three Conditional Edges)

All routing lives in `graph/edges.ts` (62 lines). Three functions, three branch points.

### Edge 1: afterHeuristic (after node 4)

```
state.branch === 'error'?
  └─ Yes → error_fallback (node 14)
state.chatQuestion present?
  └─ Yes → reason_about_risk (node 5)  ← chat always gets LLM answer
state.branch === 'clean'?
  └─ Yes → log_clean_run (node 11)     ← no LLM, no tokens
Candidates exist:
  └─ → reason_about_risk (node 5)      ← heuristic found drift signals
```

**Why chat overrides clean:** Even if heuristics find nothing, a user asking "why is this sprint behind?" deserves an LLM-reasoned answer scoped to their context. The chat question forces LLM routing.

### Edge 2: afterReason (after node 5)

```
state.assessment missing?
  └─ Yes → error_fallback (node 14)
assessment.branch === 'confirm_action'?
  └─ Yes → prepare_action (node 8)     ← write proposed, needs human approval
Otherwise:
  └─ → prepare_notification (node 6)   ← inform only, no write
```

### Edge 3: afterGate (after node 9)

```
state.gateOutcome === 'approve'?
  └─ Yes → execute_action (node 10)    ← approved write dispatched
state.gateOutcome === 'snooze'?
  └─ Yes → log_snooze (node 13)        ← deferred, reactivates after expiry
Otherwise:
  └─ → log_dismissal (node 12)         ← dismissed, no action
```

## 3. Five Distinct Graph Paths

Each path produces different terminal behavior. The table below shows the exact node sequence for each.

| Path | Node sequence | Terminal node | LLM called? | Tokens | Example scenario |
|------|--------------|---------------|-------------|--------|-----------------|
| **Clean** | 1→2→3→4→11 | `log_clean_run` | No | 0 | Healthy issue, recent activity, no thresholds breached |
| **Inform-only** | 1→2→3→4→5→6→7 | `deliver_alert` | Yes | ~1,900 | Stale issue detected (4 days inactive), LLM explains risk |
| **Confirm-action** | 1→2→3→4→5→8→9→{10,12,13} | `execute_action` or `log_dismissal` or `log_snooze` | Yes | ~1,900 | Scope drift + LLM recommends reassignment, human decides |
| **Error** | 1→2→3→4→14 or 1→2→3→4→5→14 | `error_fallback` | Maybe | 0 or partial | Ship API 500, OpenAI timeout, malformed response |
| **Chat (deterministic)** | 1→2→3→4→5*→6→7 | `deliver_alert` | No** | 0 | "What needs my attention?" → accountability items bypass |

*Node 5 entered but deterministic bypass triggered. **LangSmith trace still captured via `traceable()` wrapper.

## 4. Test Case Matrix

Each drift signal has a test case in `graph/nodes.test.ts` with explicit expected results. Cross-reference with live traces.

### Signal: stale_issue

| Test case | Ship state | Expected result | Test location | Live trace |
|-----------|-----------|-----------------|---------------|------------|
| Recent activity → clean | Issue updated 12h ago, `lastActivityDays=0` | No candidate generated | `nodes.test.ts:33` | [Trace 1](https://smith.langchain.com/public/ef21d9c9-32ce-47eb-ae90-1516e32a9c55/r) |
| 4 days stale → medium | Issue `in_progress`, `lastActivityDays=4` | `stale_issue` candidate, severity=medium | `nodes.test.ts:55` | [Trace 2](https://smith.langchain.com/public/b673cff5-b2a0-4c0e-9808-7f5b2a6f5991/r) |
| 7 days stale → high | Issue `in_progress`, `lastActivityDays=7` | `stale_issue` candidate, severity=high | `nodes.test.ts:55` (threshold logic) | — |
| Done state → skipped | Issue `state=done`, stale dates | No candidate (done issues excluded) | `nodes.test.ts:90` | — |
| `lastActivityDays=0` guard | No activity data (default 0) | Falls back to `updatedAtDays` only | `nodes.test.ts:33` | — |

### Signal: scope_drift

| Test case | Ship state | Expected result | Test location | Live trace |
|-----------|-----------|-----------------|---------------|------------|
| Reopened issue | `scopeDrift=true` from history | `scope_drift` candidate, severity=high | `nodes.test.ts:120` | [Trace 3](https://smith.langchain.com/public/af30a432-29aa-48d8-8163-4336ae600300/r) |
| Refactor sprint softening | `scopeDrift=true` + sprint title contains "refactor" | `scope_drift` candidate, severity=medium (softened) | Inline in heuristic_filter | — |
| Dangerous content | Content contains `DROP TABLE` | `scope_drift` via `dangerous_content` layer | `scope-drift.ts:67` | — |
| 80%+ content removal | Content reduced to <20% of previous | `scope_drift` via `content_removal` layer | `scope-drift.ts:90` | — |
| Topic mismatch | Zero token overlap between content and titles | `scope_drift` via `topic_mismatch` layer | `scope-drift.ts:122` | — |
| On-demand with action | Scope drift + LLM recommends action | `confirm_action` branch, approval created | Route tests | [Trace 4](https://smith.langchain.com/public/fe7c0509-e23a-429f-ab9b-4f5562a49ab7/r) |

### Signal: missing_standup

| Test case | Ship state | Expected result | Test location | Live trace |
|-----------|-----------|-----------------|---------------|------------|
| Standup overdue | `missingStandup=true` | `missing_standup` candidate, severity=low | `nodes.test.ts` | — |
| Standup current | `missingStandup=false` | No candidate | `nodes.test.ts` | — |

### Signal: approval_bottleneck

| Test case | Ship state | Expected result | Test location | Live trace |
|-----------|-----------|-----------------|---------------|------------|
| 3 days pending | `pendingApprovalDays=3` | `approval_bottleneck`, severity=medium | `nodes.test.ts` | — |
| 5 days pending | `pendingApprovalDays=5` | `approval_bottleneck`, severity=high | `nodes.test.ts` | — |

### Signal: manager_missing_standup

| Test case | Ship state | Expected result | Test location | Live trace |
|-----------|-----------|-----------------|---------------|------------|
| 5+ min overdue | `managerActionItems` with `overdueMinutes=10` | `manager_missing_standup`, severity=medium | `nodes.test.ts:253` | — |
| 60+ min overdue | `managerActionItems` with `overdueMinutes=90` | `manager_missing_standup`, severity=high | `nodes.test.ts:253` | — |
| Under threshold | `overdueMinutes=2` | No candidate (below 5min threshold) | `nodes.test.ts:253` | — |

### Branch path tests (via route + graph integration)

| Test case | Trigger | Expected path | Expected terminal | Live trace |
|-----------|---------|--------------|-------------------|------------|
| Healthy issue on-demand | POST `/on-demand` with clean issue | 1→2→3→4→11 | `log_clean_run` | [Trace 1](https://smith.langchain.com/public/ef21d9c9-32ce-47eb-ae90-1516e32a9c55/r) |
| Stale issue proactive | Sweep detects 4-day stale | 1→2→3→4→5→6→7 | `deliver_alert` | [Trace 2](https://smith.langchain.com/public/b673cff5-b2a0-4c0e-9808-7f5b2a6f5991/r) |
| Scope drift proactive | Sweep detects content regression | 1→2→3→4→5→6→7 | `deliver_alert` | [Trace 3](https://smith.langchain.com/public/af30a432-29aa-48d8-8163-4336ae600300/r) |
| Scope drift + action | On-demand, LLM recommends write | 1→2→3→4→5→8→9 | `human_gate` (paused) | [Trace 4](https://smith.langchain.com/public/fe7c0509-e23a-429f-ab9b-4f5562a49ab7/r) |
| On-demand analysis | User opens FleetGraph on drifted issue | 1→2→3→4→5→{6→7 or 8→9} | Depends on LLM | [Trace 5](https://smith.langchain.com/public/dd7d8b27-769f-4819-bec9-6080fa7692d0/r) |
| Error fallback | Constraint violation (pre-fix) | 1→2→3→4→14 | `error_fallback` | [Trace 6](https://smith.langchain.com/public/0d0cd646-6fae-46b6-9a89-3041652ae47d/r) |
| Workspace chat | Chat from dashboard, no entity | 1→2→3→4→5→6→7 | `deliver_alert` | [Trace 7](https://smith.langchain.com/public/fca2d39f-65d7-4c94-bc45-ca80e4a5ef2d/r) |

## 5. Trace Verification

Each LangSmith trace shows the exact node execution path. Here is what to look for in each trace:

### Reading a trace

1. **Open the trace link** — public, no login required
2. **Look at the run tree** (left panel) — shows which nodes executed in order
3. **Check input/output** on each node — click a node to see its state snapshot
4. **Verify branch taken** — the terminal node name confirms which path the graph took
5. **Check token usage** — visible on the LLM node (node 5) if it was called

### Trace inventory by path type

| Path type | Trace | What it proves | Key thing to check |
|-----------|-------|---------------|-------------------|
| **Clean (no LLM)** | [Trace 1](https://smith.langchain.com/public/ef21d9c9-32ce-47eb-ae90-1516e32a9c55/r) | Heuristic exits early, 0 tokens, 349ms | Node 5 absent from run tree |
| **Inform-only (LLM)** | [Trace 2](https://smith.langchain.com/public/b673cff5-b2a0-4c0e-9808-7f5b2a6f5991/r) | LLM called, alert delivered, no write | Node 5 present, assessment.branch=inform_only |
| **Inform-only (LLM)** | [Trace 3](https://smith.langchain.com/public/af30a432-29aa-48d8-8163-4336ae600300/r) | Scope drift detected by heuristic, LLM confirms | Candidates include scope_drift signal |
| **Confirm-action** | [Trace 4](https://smith.langchain.com/public/fe7c0509-e23a-429f-ab9b-4f5562a49ab7/r) | LLM proposes write, approval created | assessment.branch=confirm_action, proposedAction present |
| **Error** | [Trace 6](https://smith.langchain.com/public/0d0cd646-6fae-46b6-9a89-3041652ae47d/r) | Graph caught error, logged structured fallback | error_fallback node in run tree |
| **Workspace chat** | [Trace 7](https://smith.langchain.com/public/fca2d39f-65d7-4c94-bc45-ca80e4a5ef2d/r) | Chat with workspace scope, accountability items | entityType=workspace in input |

## 6. Heuristic Filter Detail

The heuristic filter (node 4) is where deterministic signal detection happens. These are the exact rules, thresholds, and data sources.

### Thresholds (from `shared/src/types/fleetgraph.ts:96-98`)

```typescript
export const DEFAULT_THRESHOLDS = {
  staleIssueDays: 3,           // business days before flagging
  approvalBottleneckDays: 2,   // business days pending
  missingStandupSameDay: true, // flag same workday
  scopeDriftImmediate: true,   // flag on detection
};
```

### Severity escalation rules

| Signal | Medium | High |
|--------|--------|------|
| `stale_issue` | >= 3 days | >= 6 days (2x threshold) |
| `approval_bottleneck` | >= 2 days | >= 4 days (2x threshold) |
| `scope_drift` | Refactor sprint (softened) | Default |
| `missing_standup` | — | — (always low) |
| `manager_missing_standup` | >= 5 min overdue | >= 60 min overdue |

### Scope drift detection layers (from `scope-drift.ts`)

Scope drift uses three independent detection layers. Any one match triggers the signal.

| Layer | Method | Threshold | Example |
|-------|--------|-----------|---------|
| 1. Dangerous patterns | Regex match | Any match | `DROP TABLE`, `rm -rf`, `delete all` |
| 2. Content removal | Length comparison | 80%+ removed | Issue content gutted from 2000 to 100 chars |
| 3. Topic mismatch | Token overlap | Zero overlap | Issue content about "database migration" in sprint titled "UI redesign" |

### Candidate priority (from `candidate-priority.ts`)

When multiple signals fire on the same entity, they are sorted by priority (lower = higher priority):

| Signal | Priority | Rationale |
|--------|----------|-----------|
| `stale_issue` | 10 | Most actionable — clear assignee, clear fix |
| `missing_standup` | 20 | Time-sensitive accountability signal |
| `approval_bottleneck` | 30 | Blocking but less urgent than stale |
| `scope_drift` | 40 | Structural concern, needs investigation |
| `manager_missing_standup` | 50 | Derived signal, manager-targeted |

## 7. Human Gate Verification

The HITL gate is the most safety-critical path. Here is how to verify it works correctly.

### What to check

1. **Approval created before interrupt:** Node 8 (`prepare_action`) persists the approval to `fleetgraph_approvals` *before* node 9 (`human_gate`) pauses the graph. This ensures the UI can render the approval card immediately.

2. **CAS guard prevents double-execution:** `UPDATE fleetgraph_approvals SET status='approved' WHERE id=:id AND status='pending'` — if `rowCount === 0`, another request already resolved it → 409 Conflict returned.

3. **Server-side expiry enforcement:** `POST /alerts/:id/resolve` checks `expires_at < now()` → 410 Gone. Not just client-side countdown.

4. **Fail-closed on invalid payload:** `validateActionPayload()` throws before dispatch. Missing `assignee_id` on reassign = error, not silent failure.

### Test commands

```bash
# Run approval CAS guard test
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts -t "resolve" --reporter=verbose

# Run action validation tests
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/fleetgraph/data/fetchers.test.ts --reporter=verbose
```

## 8. Reproduction Steps

### Run the full test suite

```bash
# API tests (710 tests)
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run --reporter=dot

# Web tests (195 tests)
pnpm --filter @ship/web exec vitest run --reporter=dot

# Type-check all packages
pnpm --filter @ship/api type-check
pnpm --filter @ship/web type-check
pnpm --filter @ship/shared type-check
```

### Run FleetGraph-specific tests

```bash
# Heuristic filter + signal detection
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/fleetgraph/graph/nodes.test.ts --reporter=verbose

# Conditional edge routing
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/fleetgraph/graph/ --reporter=verbose

# Scheduler + sweep loop
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/fleetgraph/runtime/scheduler.test.ts --reporter=verbose

# Route integration (on-demand, chat, alerts, resolve)
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
  pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts --reporter=verbose
```

### Generate fresh traces

```bash
# Set env vars
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=<your-key>
export LANGCHAIN_PROJECT=fleetgraph-verification

# Start server
pnpm dev

# Trigger on-demand (clean path)
curl -X POST http://localhost:3000/api/fleetgraph/on-demand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"entityType":"issue","entityId":"<healthy-issue-id>","workspaceId":"<ws-id>"}'

# Trigger on-demand (drift path) — use an issue with stale activity
curl -X POST http://localhost:3000/api/fleetgraph/on-demand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"entityType":"issue","entityId":"<stale-issue-id>","workspaceId":"<ws-id>"}'

# Wait 4 minutes for proactive sweep traces
# Check LangSmith dashboard for new traces
```

## 9. Architecture Invariants

These are guarantees the system maintains. If any of these break, something is wrong.

| Invariant | Enforced by |
|-----------|-------------|
| LLM never called when heuristic finds 0 candidates (unless chat) | `afterHeuristic()` in `edges.ts:24` |
| No Ship write without human approval | `human_gate` interrupt + CAS guard |
| Expired approvals cannot be executed | Server-side expiry check in resolve route |
| Same alert fingerprint = same alert (upsert, not duplicate) | `upsertAlert()` with `ON CONFLICT (fingerprint)` |
| Same pending approval = upsert (not constraint violation) | `createApproval` with `ON CONFLICT (alert_id) WHERE status='pending'` |
| Failed action execution = approval marked `execution_failed` | `execute_action` error handling |
| Every graph run has an audit log entry | Terminal nodes all call `persistAuditEntry()` |
| Clean runs cost $0 | Node 5 skipped entirely on clean path |
