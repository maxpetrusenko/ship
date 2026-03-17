# FleetGraph Professor Checklist

Verification checklist for FleetGraph MVP demo and grading. Each item includes the expected behavior and how to verify it.

## Deployment

- **Backend:** `ship-api-prod.eba-xsaqsg9h.us-east-1.elasticbeanstalk.com`
- **Frontend:** `ship.awsdev.treasury.gov`
- **FleetGraph API base:** `{backend}/api/fleetgraph`

### Test account

| Field | Value |
|-------|-------|
| Email | `[PLACEHOLDER: insert test account email]` |
| Password | `[PLACEHOLDER: insert test account password]` |
| Workspace | `[PLACEHOLDER: insert workspace name]` |

## Seeded scenarios

The following scenarios should be pre-seeded in the demo environment for reproducible verification:

1. **Healthy sprint:** An active sprint where all issues are progressing, standups are current, and no approvals are stale. Running FleetGraph on this sprint should produce a `clean` branch with no alerts.

2. **Stale issue:** An in-progress issue that has not been updated in 5+ business days. Running FleetGraph on this issue should produce a `medium` or `high` severity stale_issue alert.

3. **Missing standup:** A sprint with a team member who has overdue standup accountability. The proactive sweep should generate a `missing_standup` alert targeting the sprint owner (manager).

4. **Approval bottleneck:** A review item pending for 3+ business days. On-demand analysis should detect the bottleneck and potentially recommend a `confirm_action` to nudge the reviewer.

5. **Scope drift:** A sprint with issues moved back from `done` to `in_progress`. Should trigger a `scope_drift` alert with `high` severity.

## Checklist

### Chat and scope (Global Chat)

- [ ] **Chat visible on every screen with scope label.**
  Verification: Navigate to an issue page, sprint page, project page, and dashboard. On each page, the FleetGraph chat launcher should be visible. The scope chip should display the current context (e.g., "Issue: SHIP-42", "Sprint: Week 12", "Workspace: Acme").

- [ ] **Workspace fallback scope works.**
  Verification: Navigate to a page with no specific entity context (dashboard, settings). Open FleetGraph chat. The scope chip should show "Workspace: [name]". Ask "What needs attention?" and verify the response references cross-sprint data.

- [ ] **Chat maintains conversation history.**
  Verification: On a sprint page, ask FleetGraph a question. Then ask a follow-up that references the first answer. The second response should demonstrate awareness of the prior exchange.

- [ ] **Entity switch fences conversation.**
  Verification: Start a chat on Sprint A. Navigate to Sprint B. Open chat again. The conversation should start fresh (no carry-over from Sprint A context).

### Proactive detection

- [ ] **Manager missed-standup alert within 5 minutes.**
  Verification: With a seeded missing-standup scenario, start the server and wait for the proactive sweep (max 4 minutes + processing). The sprint owner (manager) should receive a `fleetgraph:alert` WebSocket event. The alert should name which team member(s) are missing standup coverage.

- [ ] **Stale issue detection.**
  Verification: Seed an issue with no updates for 4+ business days. Wait for the proactive sweep. A `stale_issue` alert with `medium` severity should appear.

- [ ] **Scope drift detection.**
  Verification: Move an issue back from `done` to `in_progress` in a sprint. Wait for the next sweep. A `scope_drift` alert with `high` severity should appear.

### Notification center (in progress)

- [ ] **Bell badge increments on realtime event.**
  Verification: When a new `fleetgraph:alert` WebSocket event arrives, the bell icon badge count should increment without page reload. (Note: Bell UI is pending; verify WebSocket event delivery via browser DevTools Network/WS tab.)

- [ ] **Notification center opens from shell.**
  Verification: Click the bell icon in the app header. A dropdown should list recent FleetGraph alerts sorted by severity. (Note: Bell UI is pending Agent 1/3 work; verify alerts endpoint returns data via `GET /api/fleetgraph/alerts`.)

### Human-in-the-loop

- [ ] **confirm_action truly pauses/resumes via checkpointer.**
  Verification: Trigger a scenario that produces a `confirm_action` branch (stalled approval with identifiable reviewer). Verify that a pending approval appears in `fleetgraph_approvals` with status `pending`. Approve it via `POST /api/fleetgraph/alerts/:id/resolve` with `outcome: "approve"`. Verify the action executes and the approval status changes to `executed`.

- [ ] **Expired approval returns 410.**
  Verification: Create a pending approval with a past `expiresAt`. Attempt to approve it. The response should be 410 with `"Approval has expired"`.

- [ ] **Duplicate approve returns 409.**
  Verification: Approve a pending approval. Attempt to approve the same approval again. The response should be 409 with `"Approval already processed"`.

- [ ] **Failed execution rolls back to execution_failed.**
  Verification: Trigger an approve on an approval whose target entity does not exist or whose action would fail. The approval status should change to `execution_failed` and the response should be 502.

### Traces and evidence

- [ ] **Trace links in FLEETGRAPH.md are real LangSmith URLs.**
  Verification: Open each trace link in the Test Cases table. Each should open a valid LangSmith trace showing the complete node execution path, input/output at each node, and token usage.

- [ ] **Test cases use real evidence.**
  Verification: In LangSmith traces, check that `coreContext` and `parallelSignals` contain real Ship data (entity IDs, timestamps, assignee names), not mock data.

- [ ] **At least 2 different branch paths traced.**
  Verification: The trace set includes at minimum one `clean` trace and one `inform_only` or `confirm_action` trace, demonstrating different graph paths.

### API health

- [ ] **Public deployment link verified.**
  Verification: `GET {backend}/api/fleetgraph/status` returns `{"running": true, ...}` with a recent `lastSweepAt` timestamp.

- [ ] **Alerts endpoint returns data.**
  Verification: `GET {backend}/api/fleetgraph/alerts` (authenticated) returns an array of alerts with `total >= 0`.

- [ ] **On-demand endpoint works.**
  Verification: `POST {backend}/api/fleetgraph/on-demand` with a valid entity returns a response with `runId`, `branch`, and optionally `traceUrl`.

- [ ] **Chat endpoint works.**
  Verification: `POST {backend}/api/fleetgraph/chat` with a valid entity and question returns a response with `conversationId`, `message`, and optionally `traceUrl`.

### Test suite

- [ ] **All unit tests pass.**
  Verification: `pnpm test` completes with 0 failures. Expected: 476+ tests across 29+ files.

- [ ] **All E2E tests pass.**
  Verification: `pnpm test:e2e` (via e2e-test-runner) completes with 0 failures. Expected: 14+ FleetGraph-specific E2E tests.

## Demo script

For a live demo, walk through in this order:

1. **Status check:** Show `GET /api/fleetgraph/status` returning `running: true`.
2. **Proactive sweep:** Show the server logs printing `[FleetGraph] Sweep complete` with timing.
3. **On-demand analysis:** Open an issue page with a stale issue. Open FleetGraph chat. Show the analysis with cited evidence.
4. **Chat follow-up:** Ask a follow-up question. Show conversation threading.
5. **Scope switch:** Navigate to the sprint page. Open chat. Show the scope chip updating.
6. **Approval flow:** Show a `confirm_action` scenario. Show the approval card. Approve it. Show the action executing.
7. **LangSmith traces:** Open the LangSmith project dashboard. Walk through one `clean` trace and one `inform_only` or `confirm_action` trace, pointing out node transitions, LLM reasoning, and token usage.
