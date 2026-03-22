# FleetGraph Demo Script

Structured walkthrough for the reviewer. Each section demonstrates a different graph path with the exact steps to reproduce, what to observe, and which trace to reference.

Total time: ~12 minutes.

## Before You Start

```bash
# Ensure server is running with tracing
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=<key>
pnpm dev
```

Confirm FleetGraph is healthy:
```bash
curl http://localhost:3000/api/fleetgraph/status
# → {"running":true,"lastSweepAt":"...","sweepIntervalMs":240000,"alertsActive":N}
```

---

## Part 1: The Clean Path (No LLM, No Tokens)

**Goal:** Show that FleetGraph exits early when there is nothing wrong.

**Graph path:** `trigger_context → fetch_core_context → fetch_parallel_signals → heuristic_filter → log_clean_run`

**What makes this path different:** The LLM is never called. Node 5 (`reason_about_risk`) is skipped entirely. Cost: $0, latency: ~350ms.

### Steps

1. Open Ship to a healthy issue page (recently updated, active assignee, no overdue items)
2. Open FleetGraph panel (bolt icon in header)
3. Click "Analyze" to trigger on-demand analysis
4. **Observe:** Response returns in <500ms with "No issues detected" or equivalent
5. **Observe:** No alert card appears (no candidates)

### What the reviewer should verify

- **Response time** is sub-second (no LLM wait)
- **Trace** ([Trace 1](https://smith.langchain.com/public/ef21d9c9-32ce-47eb-ae90-1516e32a9c55/r)): run tree shows nodes 1-4 and 11 only. Node 5 (`reason_about_risk`) is absent. Token count: 0.
- **Decision logic:** `heuristic_filter` found 0 candidates → `afterHeuristic()` returned `'log_clean_run'` → graph ended

### Why this matters

70% of proactive sweep runs take this path. The heuristic filter prevents unnecessary LLM calls, saving ~$0.0003 per clean run. Over 1,000 daily runs, this adds up.

---

## Part 2: Stale Issue Detection (Inform-Only Path)

**Goal:** Show deterministic signal detection followed by LLM reasoning.

**Graph path:** `trigger_context → fetch_core_context → fetch_parallel_signals → heuristic_filter → reason_about_risk → prepare_notification → deliver_alert`

**What makes this path different:** The heuristic detects a signal (stale issue), then the LLM reasons about it and produces an inform-only alert. No write is proposed. No human gate.

### Steps

1. Ensure a test issue exists that is `in_progress` with `updated_at` older than 3 days
   - Or backdate an issue: `UPDATE documents SET updated_at = NOW() - INTERVAL '5 days' WHERE id = '<issue-id>';`
   - Clear digest: `DELETE FROM fleetgraph_entity_digests WHERE entity_id = '<issue-id>';`
2. Trigger on-demand: POST `/api/fleetgraph/on-demand` with `entityType: "issue"`, `entityId: "<issue-id>"`
3. **Observe:** Response includes `branch: "inform_only"` and an alert with `signalType: "stale_issue"`
4. **Observe:** Alert card appears in the FleetGraph panel with medium or high severity
5. **Observe:** `traceUrl` is included in the response

### What the reviewer should verify

- **Trace** ([Trace 2](https://smith.langchain.com/public/b673cff5-b2a0-4c0e-9808-7f5b2a6f5991/r)): run tree shows nodes 1-5, 6, 7. Node 5 has LLM input/output visible.
- **Heuristic filter output:** In the trace, node 4 output shows `candidates` array with a `stale_issue` entry. The `staleDays` field matches the computed value.
- **LLM reasoning:** Node 5 output shows `assessment.branch = "inform_only"` with a `summary` explaining why the issue is stale and a `recommendation` for what to do.
- **No approval created** — this path does not enter the human gate

### The deterministic/LLM boundary

```
Node 4 (deterministic):  "This issue has been in_progress for 5 days with no activity"
                          → Creates stale_issue candidate with severity=medium
                          → Sets branch to route toward LLM

Node 5 (LLM):            "The issue 'Add user auth' has stalled for 5 days.
                           The assignee hasn't updated it since March 15.
                           Consider reassigning or checking in with the assignee."
                          → Produces human-readable explanation with citations
```

---

## Part 3: Scope Drift with Proposed Action (Confirm-Action Path)

**Goal:** Show the full risk-to-action pipeline, including the human gate.

**Graph path:** `trigger_context → fetch_core_context → fetch_parallel_signals → heuristic_filter → reason_about_risk → prepare_action → human_gate`

**What makes this path different:** The LLM detects scope drift AND recommends a consequential write (e.g., flag issue, add comment). The graph pauses at the human gate. Nothing is written until the user approves.

### Steps

1. Create scope drift conditions on a test issue:
   - Edit an issue's content to something completely off-topic (e.g., replace "implement login flow" with "grocery list")
   - Or add dangerous content (e.g., "DROP TABLE users")
   - Clear digest: `DELETE FROM fleetgraph_entity_digests WHERE entity_id = '<issue-id>';`
2. Trigger on-demand analysis on that issue
3. **Observe:** Response includes `branch: "confirm_action"` and a `proposedAction`
4. **Observe:** An approval card appears with Approve/Dismiss buttons and a countdown timer (72h)
5. Click "Approve" on the approval card
6. **Observe:** The proposed action executes (e.g., issue is flagged, comment is added)
7. **Observe:** The approval status changes to "approved"

### What the reviewer should verify

- **Trace** ([Trace 4](https://smith.langchain.com/public/fe7c0509-e23a-429f-ab9b-4f5562a49ab7/r)): run tree shows nodes 1-5, 8, 9. Node 5 output has `assessment.branch = "confirm_action"` with `proposedAction` object.
- **Human gate:** Node 9 shows `interrupt()` was called. The graph is paused. No write happened yet.
- **After approve:** A second trace (or resumed run) shows node 10 (`execute_action`) executing the Ship API write.
- **CAS guard:** Try approving the same alert twice rapidly — second request gets 409 Conflict.

### The safety guarantee

```
Heuristic (node 4):   "Scope drift detected: content completely changed"
LLM (node 5):         "The content was replaced with unrelated text. Recommend flagging."
                       → branch: confirm_action, proposedAction: { type: 'flag_issue' }
Prepare (node 8):     Approval created in DB with 72h expiry
Human gate (node 9):  Graph STOPS. Nothing written to Ship.
                       ↓
                       User clicks Approve
                       ↓
Execute (node 10):    PATCH /api/issues/:id { priority: 'urgent' }
```

---

## Part 4: Error Fallback (Graceful Failure)

**Goal:** Show that the graph fails safely when something goes wrong.

**Graph path:** `trigger_context → fetch_core_context → fetch_parallel_signals → heuristic_filter → error_fallback`

### Steps

1. Reference [Trace 6](https://smith.langchain.com/public/0d0cd646-6fae-46b6-9a89-3041652ae47d/r) — this is a captured error trace from a pre-fix constraint violation
2. **Observe:** The graph entered `error_fallback` (node 14) and logged a structured error
3. **Observe:** No alert was created. No speculative notification was sent.

### What the reviewer should verify

- **Trace:** Run tree shows nodes 1-4 then 14. Error details visible in node 14 output.
- **No side effects:** No alert in `fleetgraph_alerts`, no approval, no WebSocket event
- **Structured error:** `FleetGraphErrorLog` includes `failedNode`, `errorClass`, `retryable`, `followUpAction`

---

## Part 5: Workspace Chat (Scope Auto-Detection)

**Goal:** Show that chat works from any page with automatic scope detection.

**Graph path:** `trigger_context → fetch_core_context → fetch_parallel_signals → heuristic_filter → reason_about_risk → prepare_notification → deliver_alert`

### Steps

1. Navigate to a page with no specific entity (dashboard, settings)
2. Open FleetGraph chat
3. **Observe:** Scope chip shows "Workspace: [name]"
4. Type: "What needs my attention right now?"
5. **Observe:** Response lists overdue accountability items across sprints
6. Navigate to a specific issue page
7. **Observe:** Scope chip changes to "Issue: [title]"
8. Type: "Is this issue at risk?"
9. **Observe:** Response is scoped to that specific issue, with entity-specific context

### What the reviewer should verify

- **Trace** ([Trace 7](https://smith.langchain.com/public/fca2d39f-65d7-4c94-bc45-ca80e4a5ef2d/r)): input shows `entityType: "workspace"`, no specific entity
- **Scope switching:** Same chat thread, different scope per page — the chip updates
- **Deterministic bypass:** If the question matches accountability patterns, the response may skip the LLM entirely (check trace for `buildDeterministicChatAssessment`)

---

## Part 6: Proactive Sweep (Background Detection)

**Goal:** Show that FleetGraph finds problems without anyone asking.

### Steps

1. Seed some stale issues or scope drift conditions (see Part 2/3 setup)
2. Clear digests: `DELETE FROM fleetgraph_entity_digests;`
3. Wait for one sweep cycle (~4 minutes) or check `GET /api/fleetgraph/status` for `lastSweepAt`
4. **Observe:** New alerts appear in the notification center (bell icon) without any user action
5. **Observe:** Alert badge count increments
6. Click the bell → see the alert cards with context, severity, and CTAs

### What the reviewer should verify

- **No user trigger:** Alerts appeared purely from the scheduled sweep
- **Dedup:** Same fingerprint does not create duplicate alerts (refresh and check)
- **Sweep latency:** `lastSweepAt` updates every ~4 minutes, well under the 5-minute detection SLA

---

## Summary: What Each Part Proves

| Part | Proves | Key differentiator |
|------|--------|-------------------|
| 1. Clean path | Heuristic exits early, no LLM, $0 cost | Graph skips node 5 entirely |
| 2. Stale issue | Deterministic detection → LLM reasoning | Heuristic finds signal, LLM explains it |
| 3. Scope drift + action | Full risk pipeline with human gate | Graph pauses for approval, write gated |
| 4. Error fallback | Graceful failure, no speculative alerts | Structured error log, no side effects |
| 5. Workspace chat | Scope auto-detection, multi-turn context | Same graph, different scope per page |
| 6. Proactive sweep | Autonomous detection without user | Scheduled background monitoring |

## Quick Reference: All Live Traces

| # | Scenario | Branch | Trace link |
|---|----------|--------|------------|
| 1 | Clean on-demand | `clean` | [Open](https://smith.langchain.com/public/ef21d9c9-32ce-47eb-ae90-1516e32a9c55/r) |
| 2 | Stale issue (inform) | `inform_only` | [Open](https://smith.langchain.com/public/b673cff5-b2a0-4c0e-9808-7f5b2a6f5991/r) |
| 3 | Scope drift (proactive) | `inform_only` | [Open](https://smith.langchain.com/public/af30a432-29aa-48d8-8163-4336ae600300/r) |
| 4 | Scope drift + action | `confirm_action` | [Open](https://smith.langchain.com/public/fe7c0509-e23a-429f-ab9b-4f5562a49ab7/r) |
| 5 | On-demand analysis | `inform_only` | [Open](https://smith.langchain.com/public/dd7d8b27-769f-4819-bec9-6080fa7692d0/r) |
| 6 | Error fallback | `error` | [Open](https://smith.langchain.com/public/0d0cd646-6fae-46b6-9a89-3041652ae47d/r) |
| 7 | Workspace chat | `inform_only` | [Open](https://smith.langchain.com/public/fca2d39f-65d7-4c94-bc45-ca80e4a5ef2d/r) |
