# FleetGraph Full Requirements Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the current FleetGraph requirement gaps, ship global scoped chat plus manager-first missed-standup notifications, and produce submission-grade evidence for professor review.

**Architecture:** Keep one FleetGraph graph for proactive and on-demand flows. Add a real scope resolver for global chat, a manager-scoped accountability data path through Ship REST endpoints, a notification center in the app shell, and true human-in-the-loop pause/resume for consequential actions. Use targeted API, graph, and UI tests during development; collect real LangSmith traces and deployed acceptance evidence at the end.

**Tech Stack:** TypeScript, Express, React, React Query, LangGraph, LangSmith, OpenAI, PostgreSQL, WebSocket realtime.

---

## Working decisions

1. Global chat stays compliant with requirements by being globally reachable, but never unscoped.
2. Scope priority:
   - current issue/project/sprint document
   - current screen entity context
   - workspace summary scope with explicit label
3. Missed standup notification audience:
   - first notify manager
   - manager decides whether to text/follow up
   - developer sees item too, but manager alert is primary proactive signal
4. FleetGraph must consume Ship data through REST endpoints only.
5. Human-in-the-loop must run through LangGraph checkpoint/resume, not route-level side execution.
6. During implementation, skip browser e2e for AI chat per repo temp note. Prefer API tests, graph tests, component tests, and existing non-e2e chat-safe suites. Run professor-style manual acceptance only after integration.

## Success bar

- Chat launcher visible on every screen.
- Every FleetGraph request has a concrete scope.
- Manager receives missed-standup notification within 5 minutes of SLA breach.
- Notification icon shows unread FleetGraph manager alerts.
- `confirm_action` runs pause/resume through LangGraph checkpointer.
- Shared LangSmith traces exist for clean, inform_only, confirm_action, and error branches.
- `FLEETGRAPH.md` contains real trace links, corrected responsibility text, corrected cost math, and exact test cases.

## Parallel agent split

### Agent 1: Global Scoped Chat

**Ownership:** all chat availability and scope-resolution UI.

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Modify: `web/src/contexts/CurrentDocumentContext.tsx`
- Modify: `web/src/pages/App.tsx`
- Create: `web/src/hooks/useFleetGraphScope.ts`
- Create: `web/src/hooks/useFleetGraphScope.test.ts`
- Modify: `web/src/components/fleetgraph/FleetGraphChat.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphPanel.tsx`

**Deliverables:**
- Replace current issue/project/sprint-only floating chat gate with a real scope resolver.
- Support these scope modes:
  - `issue`
  - `project`
  - `sprint`
  - `workspace`
- Surface the active scope in launcher header and chat transcript.
- If user is on a weak-context screen, prefill workspace scope and offer quick scope switch.
- Keep chat embedded and contextual, not general-purpose freeform assistant.

**Implementation steps:**
1. Add `useFleetGraphScope()` that derives scope from `CurrentDocumentContext`, route pathname, selected workspace, and optional selected project/program.
2. Extend `CurrentDocumentContext` only if current data is insufficient for project/sprint derivation.
3. Update floating chat so button is always visible in app shell.
4. Add visible scope chip: `Issue`, `Sprint`, `Project`, or `Workspace`.
5. Add explicit empty-state messaging for screens with only workspace scope.
6. Thread resolved scope into on-demand and chat requests.
7. Add unit tests for route-to-scope mapping and fallback behavior.
8. Add component test proving launcher stays available on non-document screens.

**Verification:**
- `pnpm --filter @ship/web test -- useFleetGraphScope`
- `pnpm --filter @ship/web test -- FleetGraphChat`
- manual:
  - Documents page -> issue scope
  - Team page -> workspace scope
  - Project page -> project scope

### Agent 2: Manager Missed-Standup Signal

**Ownership:** proactive signal semantics, data contracts, graph heuristics.

**Files:**
- Modify: `api/src/routes/accountability.ts`
- Create: `api/src/routes/accountability-manager.test.ts`
- Modify: `api/src/fleetgraph/data/types.ts`
- Modify: `api/src/fleetgraph/data/fetchers.ts`
- Modify: `api/src/fleetgraph/graph/nodes.ts`
- Modify: `shared/src/types/fleetgraph.ts`
- Modify: `FLEETGRAPH.md`

**Deliverables:**
- Add manager-scoped accountability endpoint in Ship REST surface.
- Define manager notification rule:
  - if direct report misses standup by 5 minutes past due window
  - create proactive candidate for manager
- Make signal evidence explicit:
  - missing employee
  - due time
  - manager user id
  - sprint/project context

**Implementation steps:**
1. Add read-only REST endpoint for manager accountability, for example `/api/accountability/manager-action-items`.
2. Build endpoint from standard Ship auth + org relationships, not direct FleetGraph DB reads.
3. Extend FleetGraph fetchers to call the new REST endpoint through `ShipApiClient`.
4. Replace current current-user-only missing-standup signal for proactive manager alerts.
5. Add new signal type if needed:
   - `manager_missing_standup`
   or keep `missing_standup` with audience metadata.
6. Update heuristic filter to create candidate targeted at manager.
7. Update citations and summary rules so LLM names the missing report and due timing.
8. Add graph tests for:
   - no missed standup -> clean
   - missed standup under 5 min -> no alert
   - missed standup at 5+ min -> candidate created

**Verification:**
- `pnpm --filter @ship/api test -- accountability-manager`
- `pnpm --filter @ship/api test -- fleetgraph/graph/nodes.test.ts`
- manual API proof with manager auth + seeded report relationship

### Agent 3: Notification Center + Manager Follow-up UX

**Ownership:** notification icon, unread state, manager-first alert surface.

**Files:**
- Modify: `web/src/pages/App.tsx`
- Create: `web/src/components/fleetgraph/FleetGraphNotificationBell.tsx`
- Create: `web/src/components/fleetgraph/FleetGraphNotificationCenter.tsx`
- Create: `web/src/components/fleetgraph/FleetGraphNotificationBell.test.tsx`
- Modify: `web/src/hooks/useFleetGraph.ts`
- Modify: `web/src/hooks/useRealtimeEvents.tsx`
- Modify: `shared/src/types/fleetgraph.ts`
- Optional create: `api/src/routes/fleetgraph-notifications.ts`

**Deliverables:**
- Bell icon in app shell.
- Unread badge count for FleetGraph alerts relevant to current user.
- Dropdown/panel listing unread notifications with timestamp, severity, entity, and CTA.
- Manager-focused CTA copy:
  - open employee context
  - send follow-up
  - dismiss
  - snooze

**Implementation steps:**
1. Decide whether alert source remains `/api/fleetgraph/alerts` or gets dedicated unread endpoint.
2. Add unread filtering to shared contracts if needed.
3. Add `FleetGraphNotificationBell` to top app shell near existing accountability entry points.
4. Subscribe bell state to realtime `fleetgraph:alert`.
5. Add optimistic unread clearing when manager opens center.
6. Reuse existing toast infra for immediate in-app pop when missed-standup manager alert lands.
7. Link notification row to relevant issue/sprint/project or person page.
8. If SMS texting is future-only, phrase CTA as "Follow up with developer" and route to person/project context; do not fake actual SMS send.

**Verification:**
- component test for unread badge increment/decrement
- manual realtime test with websocket event
- manual keyboard access check for bell + panel

### Agent 4: Real Human-in-the-Loop Resume

**Ownership:** checkpointer-backed graph execution correctness.

**Files:**
- Modify: `api/src/fleetgraph/runtime/index.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/fleetgraph/graph/builder.ts`
- Modify: `api/src/fleetgraph/graph/edges.ts`
- Modify: `api/src/fleetgraph/graph/nodes-terminal.ts`
- Modify: `api/src/routes/fleetgraph.test.ts`
- Create: `api/src/fleetgraph/runtime/resume.test.ts`

**Deliverables:**
- On-demand and chat use the same compiled graph runtime as scheduler.
- `confirm_action` actually pauses before `human_gate`.
- approval resolve path resumes graph with `gateOutcome`.
- route layer stops executing consequential action directly.
- returned branch matches graph reality.

**Implementation steps:**
1. Export a shared runtime graph invoker from FleetGraph runtime instead of `createFleetGraph()` inside request handlers.
2. Ensure on-demand/chat invoke with same checkpointer and `thread_id`.
3. Persist approval + checkpoint linkage before pause.
4. Update resolve route to resume graph with `gateOutcome` rather than calling `executeShipAction` inline.
5. Fix response branch source so API returns:
   - `confirm_action` when approval required
   - `inform_only` when alert only
6. Add regression test proving:
   - confirm_action request creates approval
   - graph pauses
   - approve resumes to execute action
   - dismiss resumes to dismissal terminal
7. Confirm error branch still logs and returns safely.

**Verification:**
- `pnpm --filter @ship/api test -- fleetgraph.test.ts`
- `pnpm --filter @ship/api test -- resume.test.ts`
- manual local run with live DB and checkpoint rows

### Agent 5: Requirements Integrator

**Ownership:** full-requirements sweep, docs, traces, deployment proof, final grading prep.

**Files:**
- Modify: `FLEETGRAPH.md`
- Modify: `PRESEARCH.md` if scope/trigger rationale changed
- Modify: `docs/FleetGraph/README.md`
- Modify: `docs/FleetGraph/COST_TRACKING.md`
- Modify: `docs/FleetGraph/PROVENANCE_AUDIT.md`
- Create: `docs/fleetgraph-professor-checklist.md`
- Create: `docs/fleetgraph-trace-links.md`

**Deliverables:**
- Corrected responsibility text.
- Correct trigger model text.
- Real shared LangSmith trace links in docs.
- Updated test cases with exact seeded state and resulting trace.
- Correct cost analysis from real token data.
- Deployment proof and timed missed-standup runbook.

**Implementation steps:**
1. Rewrite responsibility section so proactive missing-standup claims match actual manager-scoped implementation.
2. Add explicit "chat available globally, always scoped" wording.
3. Replace placeholder `Requires live run` table entries with actual trace URLs.
4. Add one trace each for:
   - clean
   - inform_only
   - confirm_action
   - error
5. Add timed latency proof for manager missed-standup notification under 5 minutes.
6. Recompute cost section from actual token logs gathered from `tokenUsage`.
7. Add professor review checklist with exact links, accounts, seeded scenarios, and rollback notes.
8. Add a short "what changed after review" section if professor feedback lands before final submission.

**Verification:**
- docs read-through
- all trace links open
- timed acceptance run recorded

## Cross-cutting execution order

### Phase 0: Requirement reset

**Owner:** Agent 5 starts first.

**Steps:**
1. Read `docs/FleetGraph/requirements.md`.
2. Rewrite acceptance checklist into a working ticket list.
3. Freeze final semantics for:
   - global chat scope model
   - manager missed-standup signal
   - HITL resume model
4. Post short decision summary in working thread before parallel coding starts.

### Phase 1: Parallel build

**Owners:** Agents 1, 2, 3, 4.

**Steps:**
1. Agent 4 lands runtime/HITL correctness first because branch semantics affect UI and docs.
2. Agent 2 lands manager-signal REST path and graph logic.
3. Agent 1 lands global scope resolver and launcher.
4. Agent 3 lands bell + notification center on top of Agent 2 contracts.
5. Merge in that order when conflicts appear:
   - Agent 4
   - Agent 2
   - Agent 1
   - Agent 3

### Phase 2: Integration hardening

**Owner:** Agent 5.

**Steps:**
1. Pull latest branch state.
2. Run targeted API tests and component tests.
3. Do local manual walkthrough:
   - workspace screen -> workspace-scoped chat available
   - issue screen -> issue-scoped chat available
   - missed standup -> manager notification appears
   - approval-required action -> graph pauses, approve resumes
4. Fix contract mismatches.

### Phase 3: Submission evidence

**Owner:** Agent 5.

**Steps:**
1. Run with real keys and LangSmith tracing enabled.
2. Seed or stage exact states for each required use case.
3. Capture shared trace links.
4. Update `FLEETGRAPH.md`.
5. Confirm deployment URL works publicly.
6. Perform one timed missed-standup run in deployed environment.
7. Capture screenshots for bell unread badge, manager alert, and approval card.

### Phase 4: Professor review / post-submission hardening

**Owner:** Agent 5.

**Steps:**
1. Review professor comments and map each to:
   - bug
   - missing evidence
   - scope clarification
2. Fix correctness bugs first.
3. Refresh traces after each behavior change.
4. Refresh docs after each requirement interpretation change.
5. Re-run manual acceptance checklist.

## Required technical changes

### 1. Fix current deductions first

- Stop creating ad hoc graphs in route handlers.
- Use one runtime graph with checkpointer for proactive and on-demand.
- Stop claiming workspace-wide missing-standup coverage until manager-scoped REST path exists.
- Stop returning stale `finalState.branch`.
- Stop leaving trace table rows as placeholders.

### 2. Add global scope model

Shared type suggestion:

- `scopeType: 'issue' | 'project' | 'sprint' | 'workspace'`
- `scopeId: string`
- `scopeLabel: string`

Request contract suggestion:

- keep existing `entityType/entityId` for graph internals
- add optional workspace-summary mode only if mapped clearly

### 3. Add notification model

Minimum persisted fields if unread center needs dedicated storage:

- `recipientUserId`
- `alertId`
- `readAt`
- `createdAt`
- `kind`

If existing `fleetgraph_alerts` plus workspace/user scoping is enough, avoid new table.

### 4. Add manager action affordances

Manager notification row should include:

- employee name
- overdue duration
- sprint/project title
- "Open context"
- "Dismiss"
- "Snooze"

Optional later:

- "Copy reminder text"

## Testing strategy

### Use during development

- API route tests
- graph node tests
- runtime resume tests
- React component tests
- manual local walkthroughs

### Avoid during dev for this task

- broad browser e2e for AI chat paths

### Final acceptance before handoff

1. `pnpm --filter @ship/api test`
2. targeted `@ship/web` component tests for FleetGraph files
3. manual websocket notification test
4. live traced run with real data
5. deployed timed missed-standup proof

## Handoff notes for next agent

- Start with Agent 5 Phase 0.
- Then dispatch Agents 4, 2, 1, 3 in parallel.
- Keep commits small and by ownership.
- Do not let docs outrun implementation.
- Do not let UI claim SMS texting if actual SMS does not exist.
- Do not add a generic chatbot mode; all launcher states must show scope.
- Keep FleetGraph data-source compliance honest: Ship REST for source data, FleetGraph tables only for FleetGraph persistence.

## Final acceptance checklist

- [ ] Chat visible on every screen
- [ ] Chat scope label always visible
- [ ] Workspace fallback scope works
- [ ] Manager missed-standup alert within 5 minutes
- [ ] Bell badge increments on realtime event
- [ ] Notification center opens from shell
- [ ] `confirm_action` truly pauses/resumes
- [ ] Trace links added to `FLEETGRAPH.md`
- [ ] Test-case table uses real evidence
- [ ] Public deployment link verified
