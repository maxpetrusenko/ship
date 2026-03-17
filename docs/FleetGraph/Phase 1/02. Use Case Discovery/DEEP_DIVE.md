# Use Case Discovery: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready implementation specification for each of the 6 core FleetGraph use cases. For each use case: trigger condition, API fetch sequence, deterministic heuristic, LLM prompt template, Zod output schema, graph path, LangSmith trace shape, test scenario, and example user-facing output.

This document is the contract between presearch and implementation. After reading it, a developer should be able to build any use case end to end.

## Reconciliation Note

- Canonical proactive MVP use cases are stale issue drift, scope drift, approval bottlenecks, and project-level risk clustering
- Missing standup and inferred-accountability flows remain future admin-surface work or actor-scoped on-demand assists
- `/api/claude/context` is a useful reference pattern, but FleetGraph still needs broader issue, week, and project analysis context than that route currently provides

## Prerequisite Reading

| Document | What it provides |
|----------|-----------------|
| [Presearch 02 DEEP_DIVE](../../Presearch/02.%20Proactive%20and%20On-Demand%20Modes/DEEP_DIVE.md) | Background use case inventory (BG-1 through BG-15) |
| [Presearch 05 DEEP_DIVE](../../Presearch/05.%20Required%20Node%20Types/DEEP_DIVE.md) | Node contracts, FleetGraphState shape, graph structure |
| [Phase 1 / 03 Trigger Model](../03.%20Trigger%20Model%20Decision/README.md) | Hybrid trigger model (event + 4-minute sweep) |

## Shared Infrastructure

All 6 use cases share the same graph execution pipeline:

```
trigger_context -> fetch_core_context -> fetch_parallel_signals -> heuristic_filter -> reason_about_risk -> branch_decision -> [inform_only | confirm_action | no_issue]
```

What varies per use case:

1. **Which heuristic function** runs inside `heuristic_filter`
2. **Which prompt template** is sent to OpenAI inside `reason_about_risk`
3. **Which API endpoints** are called inside `fetch_core_context` and `fetch_parallel_signals`

No new nodes per use case. Config only.

---

## Shared Zod Schemas

These schemas are used across multiple use cases.

```typescript
import { z } from "zod";

// ---- Candidate signal (heuristic output) ----

export const CandidateSignalSchema = z.object({
  signalType: z.enum([
    "stale_blocked_issue",
    "missing_standup",
    "scope_drift",
    "risk_cluster",
    "approval_bottleneck",
    "context_query",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  entityId: z.string().uuid(),
  entityType: z.enum(["issue", "sprint", "project"]),
  evidence: z.record(z.unknown()),
  fingerprint: z.string(),
});

export type CandidateSignal = z.infer<typeof CandidateSignalSchema>;

// ---- Risk assessment (LLM output) ----

export const RiskAssessmentSchema = z.object({
  overallSeverity: z.enum(["none", "low", "medium", "high", "critical"]),
  explanation: z
    .string()
    .describe("2-3 sentence explanation of the risk finding"),
  recommendation: z
    .string()
    .describe("One concrete next action"),
  suggestedAction: z.object({
    type: z.enum(["no_action", "notify", "mutate"]),
    target: z.string().optional().describe("Entity ID to act on"),
    payload: z.record(z.unknown()).optional(),
  }),
  confidence: z.number().int().min(0).max(100),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// ---- On-demand context response (UC-6 specific) ----

export const ContextQueryResponseSchema = z.object({
  summary: z
    .string()
    .describe("1-2 sentence summary of what matters right now"),
  risks: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      detail: z.string(),
    })
  ),
  recommendations: z.array(
    z.object({
      action: z.string(),
      reason: z.string(),
      priority: z.enum(["do_now", "do_soon", "consider"]),
    })
  ),
  confidence: z.number().int().min(0).max(100),
});

export type ContextQueryResponse = z.infer<typeof ContextQueryResponseSchema>;
```

---

## UC-1: Blocked Issue Analysis

**Maps to:** BG-2 from Presearch
**Role:** Engineer
**Mode:** On-demand + Proactive

### Trigger Condition

**On-demand trigger:**
```typescript
// User navigates to an issue page where state is blocked/stale
const isOnDemandTrigger =
  mode === "on_demand" &&
  entityType === "issue";
```

**Proactive trigger (5-min sweep):**
```typescript
// Issue in active state with no updates for >24h
const isProactiveTrigger =
  issue.properties.state === "in_progress" ||
  issue.properties.state === "in_review";

const hoursSinceUpdate =
  (Date.now() - new Date(issue.updated_at).getTime()) / (1000 * 60 * 60);

const shouldFlag = isProactiveTrigger && hoursSinceUpdate > 24;
```

**Proactive sweep query:**
```sql
SELECT d.id, d.updated_at, d.properties->>'state' AS state
FROM documents d
WHERE d.workspace_id = $1
  AND d.document_type = 'issue'
  AND d.properties->>'state' IN ('in_progress', 'in_review')
  AND d.updated_at < NOW() - INTERVAL '24 hours'
  AND d.archived_at IS NULL
  AND d.deleted_at IS NULL
```

### API Fetch Sequence

**fetch_core_context** (all parallel via `Promise.all`):

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/issues/:id` | Issue detail: state, priority, assignee, timestamps, belongs_to |
| 2 | `GET /api/issues/:id/history` | State transitions, field changes, who changed what |
| 3 | `GET /api/issues/:id/children` | Sub-issue list with states |
| 4 | `GET /api/documents/:id/associations` | Parent, sprint, project, program links |

**fetch_parallel_signals** (parallel, after core context):

| # | Endpoint | Purpose | Condition |
|---|----------|---------|-----------|
| 5 | `GET /api/documents/:id/backlinks` | Who depends on this issue | Always |
| 6 | `GET /api/issues?sprint_id=X` | Sibling issues in same sprint | If issue has sprint association |
| 7 | `GET /api/issues/:id/iterations` | Claude iteration history | Always |

```typescript
// fetch_core_context
const [issue, history, children, associations] = await Promise.all([
  shipApi.get(`/api/issues/${entityId}`),
  shipApi.get(`/api/issues/${entityId}/history`),
  shipApi.get(`/api/issues/${entityId}/children`),
  shipApi.get(`/api/documents/${entityId}/associations`),
]);

// fetch_parallel_signals
const sprintAssoc = associations.find(
  (a: any) => a.relationship_type === "sprint"
);
const fetches: Record<string, Promise<unknown>> = {
  backlinks: shipApi.get(`/api/documents/${entityId}/backlinks`),
  iterations: shipApi.get(`/api/issues/${entityId}/iterations`),
};
if (sprintAssoc) {
  fetches.sprintIssues = shipApi.get(
    `/api/issues?sprint_id=${sprintAssoc.related_id}`
  );
}
```

### Heuristic Logic

```typescript
function detectStaleBlockedIssue(
  coreContext: { issue: any; history: any[]; children: any[]; associations: any[] },
  signals: { backlinks?: any[]; sprintIssues?: any[] }
): CandidateSignal | null {
  const { issue, history } = coreContext;
  const state = issue.properties?.state || issue.state;

  // Only flag active-but-stale issues
  if (!["in_progress", "in_review", "todo"].includes(state)) return null;

  const updatedAt = new Date(issue.updated_at);
  const now = new Date();
  const hoursSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);

  // Threshold: 24h for in_progress/in_review, 72h for todo
  const threshold = state === "todo" ? 72 : 24;
  if (hoursSinceUpdate < threshold) return null;

  // Check if there are dependents (backlinks) waiting on this
  const dependentCount = (signals.backlinks || []).length;

  // Check last meaningful state change
  const lastStateChange = history
    .filter((h: any) => h.field === "state")
    .sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

  const daysSinceUpdate = hoursSinceUpdate / 24;

  return {
    signalType: "stale_blocked_issue",
    severity:
      daysSinceUpdate > 5 || dependentCount > 2
        ? "high"
        : daysSinceUpdate > 3
        ? "medium"
        : "low",
    entityId: issue.id,
    entityType: "issue",
    evidence: {
      issueTitle: issue.title,
      ticketNumber: issue.ticket_number,
      state,
      assigneeName: issue.assignee_name,
      assigneeId: issue.properties?.assignee_id,
      daysSinceUpdate: Math.round(daysSinceUpdate * 10) / 10,
      dependentCount,
      lastStateChange: lastStateChange
        ? {
            from: lastStateChange.old_value,
            to: lastStateChange.new_value,
            at: lastStateChange.created_at,
            by: lastStateChange.changed_by?.name,
          }
        : null,
      childrenStates: (coreContext.children || []).map((c: any) => ({
        title: c.title,
        state: c.properties?.state || c.state,
      })),
    },
    fingerprint: hashSignal("stale_blocked_issue", issue.id, issue.updated_at),
  };
}
```

### LLM Prompt Template

```typescript
function buildBlockedIssuePrompt(
  mode: "proactive" | "on_demand"
): string {
  return `You are FleetGraph, a project intelligence agent for Ship.

You are analyzing a potentially blocked or stale issue.

Context:
- Mode: ${mode}
- The deterministic heuristic flagged this issue because it has been in an active state with no updates beyond the expected threshold
- You receive the issue detail, change history, sub-issues, sprint siblings, and dependency backlinks

Your job:
1. Determine WHY the issue appears stale. Is it genuinely blocked, deprioritized, or just not updated?
2. Identify WHO is waiting on this issue (downstream dependents, sprint goals)
3. Assess what CHANGED recently that might explain the stall (assignee change, priority change, scope expansion via sub-issues)
4. Recommend ONE concrete next step

Rules:
- Reference issue titles, people, and dates by name
- If the issue has sub-issues that are all blocked, that is the root cause
- If the assignee changed recently, the new assignee may need context
- severity=none means the heuristic was a false positive (issue is progressing normally despite timestamps)
- confidence below 60: recommend notify, never mutate
- Keep explanation under 3 sentences
- Keep recommendation to one action`;
}
```

### Expected Structured Output

Uses `RiskAssessmentSchema` (shared).

### Graph Path

```
trigger_context(mode=on_demand|proactive, entityType=issue)
  -> fetch_core_context(issue, history, children, associations)
  -> fetch_parallel_signals(backlinks, sprintIssues, iterations)
  -> heuristic_filter(detectStaleBlockedIssue)
  -> [candidates.length === 0 ? log_clean_run : reason_about_risk]
  -> branch_decision
  -> [inform_only -> prepare_notification | confirm_action -> prepare_action -> human_gate]
```

### LangSmith Trace Shape

```
Run: fleet_graph:uc1_blocked_issue
  |-- trigger_context         [50ms]  mode=on_demand, entityType=issue, entityId=abc-123
  |-- fetch_core_context      [800ms] issue={title, state, assignee}, history=[12 entries], children=[2], associations=[3]
  |-- fetch_parallel_signals  [600ms] backlinks=[1], sprintIssues=[8], iterations=[0]
  |-- heuristic_filter        [5ms]   candidates=[{signalType: stale_blocked_issue, severity: medium}]
  |-- reason_about_risk       [2.1s]  model=gpt-4.1, tokens_in=1840, tokens_out=280
  |     |-- openai.responses.parse    RiskAssessment{severity: medium, confidence: 78}
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [3ms]   notification={title, body, recommendation}
  Total: ~3.6s
```

### Test Scenario

**Ship state setup:**
1. Create workspace with `sprint_start_date = 14 days ago`
2. Create project "Alpha" with owner
3. Create sprint (week 2) under project, `sprint_number = 2`
4. Create issue "Fix auth flow" in sprint:
   - `state: "in_progress"`
   - `assignee_id: user-A`
   - `updated_at: 3 days ago`
5. Create issue "Deploy pipeline" in sprint with association to "Fix auth flow" (backlink)
6. Add history entries: state changed from `todo` to `in_progress` 5 days ago by user-A

**Expected agent behavior:**
- Heuristic fires: `stale_blocked_issue`, severity `medium`, `daysSinceUpdate = 3.0`
- LLM receives: issue context, history, 1 dependent issue
- LLM output: severity `medium`, explanation references "Fix auth flow has been in progress for 3 days with no updates. Deploy pipeline depends on it.", recommendation "Check with user-A on blockers or reassign"
- Branch: `inform_only`
- Notification delivered to sprint owner

### Example User-Facing Output

**FleetGraph Panel (issue page, on-demand):**

```
----------------------------------------------
  BLOCKED ISSUE DETECTED
  Severity: Medium

  #42 Fix auth flow has been in_progress for
  3 days with no updates. Deploy pipeline
  (#43) is waiting on this issue.

  Last change: user-A moved from todo to
  in_progress on Mar 12.

  Recommended action:
  Check with user-A on blockers. If blocked
  externally, add a blocker note and reassign.

  [View trace] [Dismiss] [Snooze 24h]
----------------------------------------------
```

---

## UC-2: Missing Standup

**Maps to:** BG-1 from Presearch
**Role:** PM
**Mode:** Proactive

### Trigger Condition

```typescript
// 5-min sweep: check active sprints in workspace
// A standup is "missing" when:
//   1. The sprint is active (current week window)
//   2. It is a business day (Mon-Fri)
//   3. Current time is past the expected standup window (e.g., 11:00 AM workspace local)
//   4. No standup document exists for today for any assignee on the sprint

const isBusinessDay = [1, 2, 3, 4, 5].includes(new Date().getUTCDay());
const isPastStandupWindow = new Date().getUTCHours() >= 16; // 11 AM ET = 16 UTC
const hasStandupToday = standups.some(
  (s: any) => s.properties?.date === todayStr
);

const shouldFlag = isBusinessDay && isPastStandupWindow && !hasStandupToday;
```

**Sweep query to find candidate sprints:**
```sql
SELECT d.id, d.properties->>'sprint_number' AS sprint_number,
       d.properties->'assignee_ids' AS assignee_ids,
       w.sprint_start_date
FROM documents d
JOIN workspaces w ON d.workspace_id = w.id
WHERE d.workspace_id = $1
  AND d.document_type = 'sprint'
  AND (d.properties->>'sprint_number')::int = $2  -- current sprint number
```

### API Fetch Sequence

**fetch_core_context** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/weeks` | Active sprints with owner, issue counts |
| 2 | `GET /api/accountability/action-items` | Inference-based missing items for workspace |

**fetch_parallel_signals** (parallel, per sprint):

| # | Endpoint | Purpose |
|---|----------|---------|
| 3 | `GET /api/standups?date_from=WEEK_START&date_to=TODAY` | All standups in current week window |
| 4 | `GET /api/standups/status` | Per-user standup due status |
| 5 | `GET /api/issues?sprint_id=X` | Issues in sprint (to identify who should be posting) |

```typescript
// fetch_core_context
const [activeWeeks, actionItems] = await Promise.all([
  shipApi.get(`/api/weeks`),
  shipApi.get(`/api/accountability/action-items`),
]);

// fetch_parallel_signals (per active sprint)
const weekStart = computeWeekStart(activeWeeks.sprint_start_date, activeWeeks.current_sprint_number);
const today = new Date().toISOString().split("T")[0];

const signalFetches = activeWeeks.weeks.map((week: any) =>
  Promise.all([
    shipApi.get(`/api/standups?date_from=${weekStart}&date_to=${today}`),
    shipApi.get(`/api/issues?sprint_id=${week.id}`),
  ])
);
```

### Heuristic Logic

```typescript
function detectMissingStandup(
  coreContext: { activeWeeks: any; actionItems: any[] },
  signals: { standups: any[]; sprintIssues: any[] }
): CandidateSignal | null {
  const today = new Date();
  const dayOfWeek = today.getUTCDay();
  const todayStr = today.toISOString().split("T")[0];

  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  // Skip if before standup window (16:00 UTC = 11:00 AM ET)
  if (today.getUTCHours() < 16) return null;

  const { activeWeeks } = coreContext;
  const weeks = activeWeeks.weeks || [];

  for (const week of weeks) {
    // Get assignees from sprint issues
    const assigneeIds = new Set(
      (signals.sprintIssues || [])
        .filter((i: any) => i.properties?.assignee_id)
        .map((i: any) => i.properties.assignee_id)
    );

    // Check which assignees posted today
    const postedToday = new Set(
      (signals.standups || [])
        .filter((s: any) => s.properties?.date === todayStr)
        .map((s: any) => s.properties?.author_id)
    );

    const missingAssignees = [...assigneeIds].filter(
      (id) => !postedToday.has(id)
    );

    if (missingAssignees.length === 0) continue;

    // Count business days in sprint with missing standups
    const weekStart = computeWeekStart(
      activeWeeks.sprint_start_date,
      activeWeeks.current_sprint_number
    );
    const allBusinessDays = getBusinessDaysBetween(weekStart, todayStr);
    const coveredDays = new Set(
      (signals.standups || []).map((s: any) => s.properties?.date)
    );
    const totalMissing = allBusinessDays.filter(
      (d) => !coveredDays.has(d)
    ).length;

    return {
      signalType: "missing_standup",
      severity: totalMissing >= 3 ? "high" : "medium",
      entityId: week.id,
      entityType: "sprint",
      evidence: {
        sprintName: week.name,
        sprintNumber: week.sprint_number,
        todayDate: todayStr,
        missingAssigneeCount: missingAssignees.length,
        missingAssigneeIds: missingAssignees,
        totalMissingDaysThisWeek: totalMissing,
        businessDaysInSprint: allBusinessDays.length,
        coveredDays: coveredDays.size,
      },
      fingerprint: hashSignal("missing_standup", week.id, todayStr),
    };
  }

  return null;
}
```

### LLM Prompt Template

```typescript
function buildMissingStandupPrompt(): string {
  return `You are FleetGraph, a project intelligence agent for Ship.

You are analyzing a missing standup signal for a sprint.

Context:
- This is a proactive detection. The PM has not been notified yet.
- The heuristic detected that team members assigned to sprint work have not posted a standup today (or for multiple days).
- You receive the sprint detail, issue list, and standup history for the week.

Your job:
1. Assess whether this is a genuine coverage gap or expected (e.g., all issues are done, sprint is wrapping up)
2. Name which team members are missing standups
3. Evaluate whether missing standups correlate with stalled issues
4. Recommend whether to remind, escalate, or ignore

Rules:
- If all sprint issues are done/cancelled, severity=none (no work to report on)
- If one person missed today but posted every other day, severity=low
- If multiple people have missed multiple days, severity=high
- Reference people by name when available
- Keep explanation under 3 sentences`;
}
```

### Expected Structured Output

Uses `RiskAssessmentSchema` (shared).

### Graph Path

```
trigger_context(mode=proactive, entityType=sprint)
  -> fetch_core_context(activeWeeks, actionItems)
  -> fetch_parallel_signals(standups, sprintIssues)
  -> heuristic_filter(detectMissingStandup)
  -> [candidates empty ? log_clean_run : reason_about_risk]
  -> branch_decision
  -> inform_only -> prepare_notification
```

Missing standup is always `inform_only`. No mutations. PM decides whether to remind.

### LangSmith Trace Shape

```
Run: fleet_graph:uc2_missing_standup
  |-- trigger_context         [30ms]  mode=proactive, entityType=sprint, entityId=sprint-456
  |-- fetch_core_context      [400ms] activeWeeks={weeks: [1 sprint], current_sprint_number: 3}
  |-- fetch_parallel_signals  [500ms] standups=[2 entries], sprintIssues=[6 issues]
  |-- heuristic_filter        [3ms]   candidates=[{signalType: missing_standup, severity: medium}]
  |-- reason_about_risk       [1.8s]  model=gpt-4.1
  |     |-- openai.responses.parse    RiskAssessment{severity: medium, confidence: 85}
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [2ms]
  Total: ~2.7s
```

### Test Scenario

**Ship state setup:**
1. Workspace with `sprint_start_date` such that current sprint = week 3
2. Sprint "Week 3" with 2 assignees: user-A, user-B
3. Issues: 3 issues in sprint (2 assigned to user-A, 1 to user-B), all `in_progress`
4. Standups: user-A posted Monday and Tuesday. user-B posted Monday only. Today is Wednesday after 11 AM ET.
5. No standups for today

**Expected behavior:**
- Heuristic: `missing_standup`, severity `medium`, `missingAssigneeCount = 2` (both missing today), `totalMissingDaysThisWeek = 1` (user-B missed Tuesday)
- LLM: severity `medium`, "user-B has missed 2 standup days this week while their issue remains in progress. user-A missed today."
- Branch: `inform_only`

### Example User-Facing Output

**FleetGraph Panel (proactive alert in PM dashboard):**

```
----------------------------------------------
  MISSING STANDUP COVERAGE
  Severity: Medium | Week 3

  2 team members have not posted standups
  today. user-B has missed 2 of 3 business
  days this week while issue #18 remains
  in progress.

  Recommended action:
  Send a reminder to user-B. Consider
  whether the missing standups indicate
  a blocker on #18.

  [Remind team] [Dismiss] [Snooze until tomorrow]
----------------------------------------------
```

---

## UC-3: Scope Creep Detection

**Maps to:** BG-4 from Presearch
**Role:** PM
**Mode:** Proactive + On-demand

### Trigger Condition

**Event trigger:**
```typescript
// Fires when an issue is added to a sprint (document_association created)
// AND the sprint has a saved plan snapshot (planned_issue_ids is populated)
const isEventTrigger =
  event.type === "association_created" &&
  event.relationship_type === "sprint" &&
  sprint.properties.planned_issue_ids?.length > 0;
```

**Sweep trigger (5-min):**
```typescript
// Compare current sprint issues against snapshot
const currentIssueIds = sprintIssues.map((i: any) => i.id);
const plannedIds: string[] = sprint.properties.planned_issue_ids || [];
const snapshotDate = sprint.properties.snapshot_taken_at;

const addedAfterPlan = currentIssueIds.filter(
  (id: string) => !plannedIds.includes(id)
);
const removedFromPlan = plannedIds.filter(
  (id: string) => !currentIssueIds.includes(id)
);

const shouldFlag =
  snapshotDate &&
  plannedIds.length > 0 &&
  (addedAfterPlan.length > 0 || removedFromPlan.length > 0);
```

### API Fetch Sequence

**fetch_core_context** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/weeks/lookup?project_id=X&sprint_number=N` | Sprint detail with properties including planned_issue_ids, snapshot_taken_at |
| 2 | `GET /api/issues?sprint_id=X` | Current issue list for the sprint |
| 3 | `GET /api/projects/:id` | Project detail for context (plan, owner, RACI) |

**fetch_parallel_signals** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 4 | `GET /api/issues/:id` (per added issue) | Detail on each newly added issue |
| 5 | `GET /api/issues/:id/history` (per added issue) | When and by whom it was added |

```typescript
// fetch_core_context
const [sprintLookup, sprintIssues, project] = await Promise.all([
  shipApi.get(`/api/weeks/lookup?project_id=${projectId}&sprint_number=${sprintNumber}`),
  shipApi.get(`/api/issues?sprint_id=${sprintId}`),
  shipApi.get(`/api/projects/${projectId}`),
]);

// fetch_parallel_signals: fetch detail for each added issue
const plannedIds = sprintLookup.properties?.planned_issue_ids || [];
const currentIds = sprintIssues.map((i: any) => i.id);
const addedIds = currentIds.filter((id: string) => !plannedIds.includes(id));

const addedIssueDetails = await Promise.all(
  addedIds.map((id: string) =>
    Promise.all([
      shipApi.get(`/api/issues/${id}`),
      shipApi.get(`/api/issues/${id}/history`),
    ])
  )
);
```

### Heuristic Logic

```typescript
function detectScopeCreep(
  coreContext: { sprint: any; sprintIssues: any[]; project: any },
  signals: { addedIssueDetails: Array<[any, any[]]> }
): CandidateSignal[] {
  const { sprint, sprintIssues, project } = coreContext;
  const plannedIds: string[] = sprint.properties?.planned_issue_ids || [];
  const snapshotDate = sprint.properties?.snapshot_taken_at;

  if (!snapshotDate || plannedIds.length === 0) return [];

  const currentIds = sprintIssues.map((i: any) => i.id);
  const addedAfterPlan = currentIds.filter((id) => !plannedIds.includes(id));
  const removedFromPlan = plannedIds.filter((id) => !currentIds.includes(id));

  if (addedAfterPlan.length === 0 && removedFromPlan.length === 0) return [];

  // Build evidence for each added issue
  const addedEvidence = (signals.addedIssueDetails || []).map(
    ([issue, history]: [any, any[]]) => ({
      id: issue.id,
      title: issue.title,
      ticketNumber: issue.ticket_number,
      state: issue.properties?.state || issue.state,
      priority: issue.properties?.priority,
      assignee: issue.assignee_name,
      addedAt: issue.created_at,
      estimate: issue.properties?.estimate,
    })
  );

  // Calculate total estimate delta
  const addedEstimate = addedEvidence.reduce(
    (sum: number, i: any) => sum + (i.estimate || 0),
    0
  );

  return [
    {
      signalType: "scope_drift",
      severity:
        addedAfterPlan.length >= 3 || addedEstimate > 10
          ? "high"
          : addedAfterPlan.length >= 1
          ? "medium"
          : "low",
      entityId: sprint.id,
      entityType: "sprint",
      evidence: {
        sprintName: sprint.title,
        sprintNumber: sprint.properties?.sprint_number,
        projectName: project.title,
        snapshotDate,
        originalPlannedCount: plannedIds.length,
        currentIssueCount: currentIds.length,
        addedCount: addedAfterPlan.length,
        removedCount: removedFromPlan.length,
        addedIssues: addedEvidence,
        removedIssueIds: removedFromPlan,
        totalAddedEstimate: addedEstimate,
      },
      fingerprint: hashSignal(
        "scope_drift",
        sprint.id,
        addedAfterPlan.sort().join(",")
      ),
    },
  ];
}
```

### LLM Prompt Template

```typescript
function buildScopeCreepPrompt(): string {
  return `You are FleetGraph, a project intelligence agent for Ship.

You are analyzing scope changes in a sprint after its plan was locked.

Context:
- The sprint had a plan snapshot taken at a specific date
- New issues have been added to the sprint since that snapshot
- Some originally planned issues may have been removed

Your job:
1. Assess whether the scope change is reasonable (bug fix, blocker resolution) or concerning (feature creep, lack of focus)
2. Quantify the impact: how much additional effort was added (using estimates if available)
3. Note if any removed issues were high priority (de-scoping important work)
4. Recommend whether the PM should accept the change, de-scope something else, or flag to stakeholders

Rules:
- Adding 1 small issue (estimate <= 2) to fix a bug is normal. severity=low
- Adding 3+ issues or >10 estimate points is scope creep. severity=high
- If added issues have no estimates, flag that as an additional risk
- Reference issue titles and people by name
- Keep explanation under 3 sentences`;
}
```

### Expected Structured Output

Uses `RiskAssessmentSchema` (shared).

### Graph Path

```
trigger_context(mode=proactive|on_demand, entityType=sprint)
  -> fetch_core_context(sprint, sprintIssues, project)
  -> fetch_parallel_signals(addedIssueDetails)
  -> heuristic_filter(detectScopeCreep)
  -> reason_about_risk
  -> branch_decision
  -> inform_only -> prepare_notification
```

Scope creep is always `inform_only`. The PM decides whether to accept or de-scope.

### LangSmith Trace Shape

```
Run: fleet_graph:uc3_scope_creep
  |-- trigger_context         [30ms]  mode=proactive, entityType=sprint
  |-- fetch_core_context      [700ms] sprint={planned_issue_ids: [5 ids]}, sprintIssues=[7], project={title: "Alpha"}
  |-- fetch_parallel_signals  [900ms] addedIssueDetails=[2 issues with history]
  |-- heuristic_filter        [4ms]   candidates=[{signalType: scope_drift, severity: medium, addedCount: 2}]
  |-- reason_about_risk       [2.0s]  model=gpt-4.1
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [2ms]
  Total: ~3.6s
```

### Test Scenario

**Ship state setup:**
1. Sprint "Week 4" under project "Alpha" with `snapshot_taken_at = 3 days ago`
2. `planned_issue_ids = [issue-1, issue-2, issue-3, issue-4, issue-5]`
3. Current sprint issues: `[issue-1, issue-2, issue-3, issue-6, issue-7]` (issue-4 and issue-5 removed, issue-6 and issue-7 added)
4. issue-6: "Handle edge case in auth", estimate=3, state=todo, added yesterday
5. issue-7: "Add analytics dashboard", estimate=8, state=backlog, added 2 days ago

**Expected behavior:**
- Heuristic: `scope_drift`, severity `high` (total added estimate = 11)
- LLM: "2 issues were added to Week 4 after plan lock, adding 11 estimate points. issue-7 (analytics dashboard) is a large feature (8 points) that was not in the original plan."
- Recommendation: "Review whether analytics dashboard belongs in this sprint or should be deferred to Week 5"

### Example User-Facing Output

```
----------------------------------------------
  SCOPE CHANGE DETECTED
  Severity: High | Week 4 / Alpha

  2 issues added since plan lock (Mar 13).
  1 issue (#47 "Add analytics dashboard")
  accounts for 8 estimate points. 2 original
  issues were removed.

  Net delta: +11 estimate points added,
  plan integrity reduced.

  Recommended action:
  Review whether #47 belongs in this sprint.
  Consider deferring to Week 5 to protect
  delivery of originally planned work.

  [View delta] [Accept scope] [Dismiss]
----------------------------------------------
```

---

## UC-4: Project Risk Cluster

**Maps to:** BG-5 from Presearch
**Role:** Director
**Mode:** Proactive

### Trigger Condition

```typescript
// 5-min sweep: after running all per-sprint and per-issue heuristics,
// aggregate candidates by project. If a project has 2+ signals, flag it.
const candidatesByProject = groupBy(allCandidates, (c) =>
  resolveProjectId(c.entityId, c.entityType)
);

for (const [projectId, candidates] of Object.entries(candidatesByProject)) {
  if (candidates.length >= 2) {
    // Flag as risk cluster
  }
}
```

This heuristic runs AFTER all other heuristics in the sweep. It is a meta-heuristic that consumes the output of UC-1 through UC-3 and UC-5.

### API Fetch Sequence

**fetch_core_context** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/projects/:id` | Project detail: ICE, owner, RACI, plan, approval status |
| 2 | `GET /api/projects/:id/weeks` | All sprints under this project |
| 3 | `GET /api/projects/:id/issues` | All issues under this project |
| 4 | `GET /api/accountability/action-items` | Missing accountability items |

**fetch_parallel_signals** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 5 | `GET /api/activity/project/:id` | 30-day activity trend |
| 6 | `GET /api/claude/context?context_type=retro&project_id=X` | Cross-sprint view |

```typescript
const [project, weeks, issues, actionItems] = await Promise.all([
  shipApi.get(`/api/projects/${entityId}`),
  shipApi.get(`/api/projects/${entityId}/weeks`),
  shipApi.get(`/api/projects/${entityId}/issues`),
  shipApi.get(`/api/accountability/action-items`),
]);

const [activity, retroContext] = await Promise.all([
  shipApi.get(`/api/activity/project/${entityId}`),
  shipApi.get(`/api/claude/context?context_type=retro&project_id=${entityId}`),
]);
```

### Heuristic Logic

```typescript
function detectRiskCluster(
  projectId: string,
  projectContext: { project: any; weeks: any[]; issues: any[]; actionItems: any[] },
  priorCandidates: CandidateSignal[]
): CandidateSignal | null {
  // Filter prior candidates that belong to this project
  const projectCandidates = priorCandidates.filter((c) => {
    if (c.entityType === "project" && c.entityId === projectId) return true;
    // Check if issue/sprint belongs to this project
    return c.evidence.projectId === projectId ||
      c.evidence.projectName === projectContext.project.title;
  });

  // Also check for project-level weak signals not caught by other heuristics
  const { project, weeks, issues, actionItems } = projectContext;

  const weakSignals: string[] = [];

  // No plan written
  if (!project.plan) weakSignals.push("no_project_plan");

  // Plan approval pending or never requested
  if (project.plan && !project.plan_approval) weakSignals.push("plan_not_submitted_for_approval");

  // Owner missing
  if (!project.owner_id) weakSignals.push("no_owner");

  // Accountable missing
  if (!project.accountable_id) weakSignals.push("no_accountable");

  // High ratio of incomplete issues
  const doneCount = issues.filter((i: any) =>
    i.state === "done" || i.properties?.state === "done"
  ).length;
  const activeCount = issues.length - doneCount;
  if (issues.length > 5 && doneCount / issues.length < 0.2) {
    weakSignals.push("low_completion_rate");
  }

  // Missing accountability items targeting this project
  const projectActionItems = actionItems.filter(
    (a: any) => a.project_id === projectId
  );
  if (projectActionItems.length > 0) {
    weakSignals.push(`${projectActionItems.length}_missing_accountability_items`);
  }

  const totalSignalCount = projectCandidates.length + weakSignals.length;

  if (totalSignalCount < 2) return null;

  return {
    signalType: "risk_cluster",
    severity:
      totalSignalCount >= 5
        ? "critical"
        : totalSignalCount >= 3
        ? "high"
        : "medium",
    entityId: projectId,
    entityType: "project",
    evidence: {
      projectName: project.title,
      projectOwner: project.owner?.name,
      totalSignals: totalSignalCount,
      priorSignals: projectCandidates.map((c) => ({
        type: c.signalType,
        severity: c.severity,
        entity: c.entityId,
      })),
      weakSignals,
      issueStats: {
        total: issues.length,
        done: doneCount,
        active: activeCount,
      },
      sprintCount: weeks.length,
      missingAccountabilityCount: projectActionItems.length,
    },
    fingerprint: hashSignal(
      "risk_cluster",
      projectId,
      [...projectCandidates.map((c) => c.fingerprint), ...weakSignals].join(",")
    ),
  };
}
```

### LLM Prompt Template

```typescript
function buildRiskClusterPrompt(): string {
  return `You are FleetGraph, a project intelligence agent for Ship.

You are producing a risk brief for a project where multiple weak signals converged.

Context:
- Multiple independent signals flagged issues under the same project
- You receive the full project context: plan, ICE scores, RACI, sprint history, issue stats
- The director needs a concise brief, not a list of individual problems

Your job:
1. Synthesize the individual signals into a coherent risk narrative
2. Identify the root cause if signals share one (e.g., understaffing, unclear plan, blocked dependency)
3. Assess overall project health
4. Recommend ONE strategic action for the director

Rules:
- This is a director-level brief. Be concise and strategic, not tactical.
- If signals are unrelated, say so and rank them by severity
- If the project has no plan, that is likely the root cause of downstream problems
- severity=critical means the project is at risk of failing its goals
- confidence below 60: recommend review, not reassignment
- Keep explanation under 3 sentences
- Keep recommendation to one strategic action`;
}
```

### Expected Structured Output

Uses `RiskAssessmentSchema` (shared).

### Graph Path

```
trigger_context(mode=proactive, entityType=project)
  -> fetch_core_context(project, weeks, issues, actionItems)
  -> fetch_parallel_signals(activity, retroContext)
  -> heuristic_filter(detectRiskCluster)
  -> reason_about_risk
  -> branch_decision
  -> inform_only -> prepare_notification
```

Risk cluster is always `inform_only`. Director decides whether to escalate, reassign, or wait.

### LangSmith Trace Shape

```
Run: fleet_graph:uc4_risk_cluster
  |-- trigger_context         [30ms]  mode=proactive, entityType=project, entityId=proj-789
  |-- fetch_core_context      [1.2s]  project={title, ICE, RACI}, weeks=[3], issues=[12], actionItems=[2]
  |-- fetch_parallel_signals  [800ms] activity={30_day_counts}, retroContext={sprints, cross_issue_stats}
  |-- heuristic_filter        [8ms]   candidates=[{signalType: risk_cluster, severity: high, totalSignals: 4}]
  |-- reason_about_risk       [2.5s]  model=gpt-4.1, tokens_in=2400, tokens_out=320
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [3ms]
  Total: ~4.5s
```

### Test Scenario

**Ship state setup:**
1. Project "Beta" with `plan = null`, `owner_id = user-A`, `accountable_id = null`
2. 2 sprints under project, current sprint = Week 6
3. 8 issues total: 1 done, 2 cancelled, 5 in_progress
4. Prior sweep already flagged: 1x `stale_blocked_issue` on issue #22, 1x `missing_standup` on Week 6
5. Action items: "Write project plan" pending for user-A

**Expected behavior:**
- Heuristic: `risk_cluster`, severity `high`, totalSignals = 5 (2 prior + no_project_plan + no_accountable + low_completion_rate)
- LLM: "Project Beta has no written plan, no accountable person, and its only active sprint shows a stale blocked issue and missing standups. 5 of 8 issues remain in progress with a 12.5% completion rate."
- Recommendation: "Assign an accountable person and require a project plan before the next sprint starts."

### Example User-Facing Output

```
----------------------------------------------
  PROJECT RISK BRIEF
  Severity: High | Beta

  4 risk signals detected:
    * No project plan written
    * No accountable person assigned
    * Blocked issue #22 (3 days stale)
    * Missing standups in Week 6

  Root cause: Project Beta is operating
  without a plan or accountability structure.
  12.5% issue completion rate.

  Recommended action:
  Assign an accountable person and require
  a project plan before Week 7 starts.

  [View project] [Assign accountable] [Dismiss]
----------------------------------------------
```

---

## UC-5: Approval Bottleneck

**Maps to:** BG-3 from Presearch
**Role:** Manager
**Mode:** Proactive

### Trigger Condition

```typescript
// 5-min sweep: find sprints or projects where approval is pending >48h
// Approval states are stored in sprint/project properties:
//   plan_approval.state = "pending" / "approved" / "changes_requested"
//   review_approval.state = "pending" / "approved" / "changes_requested"

const isPlanPending =
  sprint.properties?.plan_approval?.state === "pending" &&
  hoursSince(sprint.properties.plan_approval.requested_at) > 48;

const isReviewPending =
  sprint.properties?.review_approval?.state === "pending" &&
  hoursSince(sprint.properties.review_approval.requested_at) > 48;

// Also check project-level approvals
const isProjectPlanPending =
  project.properties?.plan_approval?.state === "pending" &&
  hoursSince(project.properties.plan_approval.requested_at) > 48;

const shouldFlag = isPlanPending || isReviewPending || isProjectPlanPending;
```

**Sweep query:**
```sql
-- Find sprints with pending approvals older than 48h
SELECT d.id, d.properties
FROM documents d
WHERE d.workspace_id = $1
  AND d.document_type = 'sprint'
  AND (
    (d.properties->'plan_approval'->>'state' = 'pending')
    OR (d.properties->'review_approval'->>'state' = 'pending')
  )
```

### API Fetch Sequence

**fetch_core_context** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/weeks/:id` (via lookup) | Sprint detail with approval properties |
| 2 | `GET /api/projects/:id` | Project with RACI (to find accountable person) |
| 3 | `GET /api/weeks/lookup-person?user_id=X` | Resolve accountable person's document |

**fetch_parallel_signals** (parallel):

| # | Endpoint | Purpose |
|---|----------|---------|
| 4 | `GET /api/issues?sprint_id=X` | Sprint issues to assess whether plan/review is substantive |
| 5 | `GET /api/accountability/action-items` | Whether this is already tracked as a missing item |

```typescript
const [sprint, project] = await Promise.all([
  shipApi.get(`/api/weeks/lookup?project_id=${projectId}&sprint_number=${sprintNumber}`),
  shipApi.get(`/api/projects/${projectId}`),
]);

const accountableId = sprint.properties?.accountable_id ||
  project.properties?.accountable_id ||
  project.program_accountable_id;

const [accountablePerson, sprintIssues, actionItems] = await Promise.all([
  accountableId
    ? shipApi.get(`/api/weeks/lookup-person?user_id=${accountableId}`)
    : Promise.resolve(null),
  shipApi.get(`/api/issues?sprint_id=${sprint.id}`),
  shipApi.get(`/api/accountability/action-items`),
]);
```

### Heuristic Logic

```typescript
function detectApprovalBottleneck(
  coreContext: { sprint: any; project: any },
  signals: { sprintIssues: any[]; actionItems: any[]; accountablePerson: any }
): CandidateSignal | null {
  const { sprint, project } = coreContext;
  const props = sprint.properties || {};

  const bottlenecks: Array<{ type: string; daysPending: number; requestedAt: string }> = [];

  // Check plan approval
  if (props.plan_approval?.state === "pending" && props.plan_approval?.requested_at) {
    const daysPending = daysSince(props.plan_approval.requested_at);
    if (daysPending >= 2) {
      bottlenecks.push({
        type: "plan_approval",
        daysPending,
        requestedAt: props.plan_approval.requested_at,
      });
    }
  }

  // Check review approval
  if (props.review_approval?.state === "pending" && props.review_approval?.requested_at) {
    const daysPending = daysSince(props.review_approval.requested_at);
    if (daysPending >= 2) {
      bottlenecks.push({
        type: "review_approval",
        daysPending,
        requestedAt: props.review_approval.requested_at,
      });
    }
  }

  // Check project plan approval
  const projectProps = project.properties || {};
  if (projectProps.plan_approval?.state === "pending" && projectProps.plan_approval?.requested_at) {
    const daysPending = daysSince(projectProps.plan_approval.requested_at);
    if (daysPending >= 2) {
      bottlenecks.push({
        type: "project_plan_approval",
        daysPending,
        requestedAt: projectProps.plan_approval.requested_at,
      });
    }
  }

  if (bottlenecks.length === 0) return null;

  const worstBottleneck = bottlenecks.reduce((worst, b) =>
    b.daysPending > worst.daysPending ? b : worst
  );

  // Resolve who should be approving
  const accountableId =
    props.accountable_id ||
    projectProps.accountable_id;

  return {
    signalType: "approval_bottleneck",
    severity:
      worstBottleneck.daysPending > 5
        ? "critical"
        : worstBottleneck.daysPending > 3
        ? "high"
        : "medium",
    entityId: sprint.id,
    entityType: "sprint",
    evidence: {
      sprintName: sprint.title || `Week ${props.sprint_number}`,
      sprintNumber: props.sprint_number,
      projectName: project.title,
      bottlenecks,
      accountableId,
      accountableName: signals.accountablePerson?.title || "Unknown",
      issueCount: (signals.sprintIssues || []).length,
    },
    fingerprint: hashSignal(
      "approval_bottleneck",
      sprint.id,
      bottlenecks.map((b) => b.type).join(",")
    ),
  };
}
```

### LLM Prompt Template

```typescript
function buildApprovalBottleneckPrompt(): string {
  return `You are FleetGraph, a project intelligence agent for Ship.

You are analyzing a stalled approval for a sprint plan or review.

Context:
- One or more approvals have been pending beyond the 48-hour threshold
- You receive the sprint detail, project context, and accountable person info
- The manager needs to know who to nudge and whether the delay is blocking work

Your job:
1. Identify which approval is stalled and for how long
2. Name the accountable person who should be approving
3. Assess whether the delay is blocking downstream work (e.g., team can't start work without plan approval)
4. Recommend whether to escalate, remind, or delegate the review

Rules:
- Plan approval stalls block sprint execution. severity >= medium
- Review approval stalls after sprint ends are lower urgency. severity = medium unless >5 days
- If the accountable person is not set, that IS the problem
- Reference people and timelines by name
- Keep explanation under 3 sentences`;
}
```

### Expected Structured Output

Uses `RiskAssessmentSchema` (shared).

### Graph Path

```
trigger_context(mode=proactive, entityType=sprint)
  -> fetch_core_context(sprint, project)
  -> fetch_parallel_signals(accountablePerson, sprintIssues, actionItems)
  -> heuristic_filter(detectApprovalBottleneck)
  -> reason_about_risk
  -> branch_decision
  -> inform_only -> prepare_notification
```

Approval bottleneck is `inform_only`. Manager decides whether to approve, remind, or delegate.

### LangSmith Trace Shape

```
Run: fleet_graph:uc5_approval_bottleneck
  |-- trigger_context         [30ms]  mode=proactive, entityType=sprint
  |-- fetch_core_context      [600ms] sprint={plan_approval: {state: pending, requested_at: 3 days ago}}
  |-- fetch_parallel_signals  [500ms] accountablePerson={name: "Director Kim"}, sprintIssues=[5]
  |-- heuristic_filter        [3ms]   candidates=[{signalType: approval_bottleneck, severity: high}]
  |-- reason_about_risk       [1.9s]  model=gpt-4.1
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [2ms]
  Total: ~3.0s
```

### Test Scenario

**Ship state setup:**
1. Sprint "Week 5" under project "Gamma" with:
   - `plan_approval = { state: "pending", requested_at: "3 days ago", requested_by: user-A }`
   - `accountable_id = user-B`
2. Project "Gamma" with `accountable_id = user-B`
3. 5 issues in sprint, all `backlog` (work has not started because plan is not approved)

**Expected behavior:**
- Heuristic: `approval_bottleneck`, severity `high`, daysPending = 3
- LLM: "Week 5 plan approval has been pending for 3 days. Director Kim (user-B) is the accountable approver. 5 issues remain in backlog, work blocked until plan is approved."
- Recommendation: "Remind Director Kim to review the Week 5 plan or delegate to another reviewer."

### Example User-Facing Output

```
----------------------------------------------
  APPROVAL BOTTLENECK
  Severity: High | Week 5 / Gamma

  Plan approval pending for 3 days.
  Accountable: Director Kim.

  5 issues in backlog, waiting on plan
  approval before work can begin.

  Recommended action:
  Remind Director Kim to review the Week 5
  plan, or delegate review to another person.

  [Remind approver] [Dismiss] [Snooze 24h]
----------------------------------------------
```

---

## UC-6: On-Demand Context Query

**Maps to:** No presearch BG equivalent (unique to on-demand mode)
**Role:** Any role
**Mode:** On-demand only

### Trigger Condition

```typescript
// User clicks "FleetGraph" from any page in Ship
// The frontend sends the current page context:
const isContextQuery =
  mode === "on_demand" &&
  actorId !== null;

// entityType is inferred from the page:
//   Issue page -> entityType = "issue"
//   Week/Sprint page -> entityType = "sprint"
//   Project page -> entityType = "project"
```

### API Fetch Sequence

This use case runs ALL fetch paths because it does not know what signal is most relevant. It fetches everything and lets the heuristic + LLM decide.

**fetch_core_context** (branched by entityType, all parallel within branch):

For `entityType === "issue"`: same as UC-1
For `entityType === "sprint"`: same as UC-2/UC-3
For `entityType === "project"`: same as UC-4

**fetch_parallel_signals** (all applicable signals):

```typescript
async function fetchAllSignals(state: typeof FleetGraphState.State) {
  const fetches: Record<string, Promise<unknown>> = {};

  if (state.entityType === "issue") {
    fetches.backlinks = shipApi.get(`/api/documents/${state.entityId}/backlinks`);
    fetches.iterations = shipApi.get(`/api/issues/${state.entityId}/iterations`);
    const sprintAssoc = state.coreContext.associations?.find(
      (a: any) => a.relationship_type === "sprint"
    );
    if (sprintAssoc) {
      fetches.sprintIssues = shipApi.get(`/api/issues?sprint_id=${sprintAssoc.related_id}`);
      fetches.standups = shipApi.get(
        `/api/standups?date_from=${computeWeekStart(sprintAssoc)}&date_to=${today()}`
      );
    }
  }

  if (state.entityType === "sprint") {
    const sprintId = state.entityId;
    fetches.sprintIssues = shipApi.get(`/api/issues?sprint_id=${sprintId}`);
    const { from, to } = computeSprintDateRange(state.coreContext);
    fetches.standups = shipApi.get(`/api/standups?date_from=${from}&date_to=${to}`);
  }

  if (state.entityType === "project") {
    fetches.activity = shipApi.get(`/api/activity/project/${state.entityId}`);
    fetches.actionItems = shipApi.get(`/api/accountability/action-items`);
  }

  // Resolve all
  const results: Record<string, unknown> = {};
  const entries = Object.entries(fetches);
  const resolved = await Promise.all(entries.map(([, p]) => p));
  entries.forEach(([key], i) => { results[key] = resolved[i]; });

  return { signals: results };
}
```

### Heuristic Logic

For on-demand context queries, the heuristic runs ALL applicable checks and always produces at least one candidate (the context query itself) so the LLM always runs.

```typescript
function contextQueryHeuristic(
  state: typeof FleetGraphState.State
): CandidateSignal[] {
  const candidates: CandidateSignal[] = [];

  // Run all standard heuristics
  if (state.entityType === "issue") {
    const stale = detectStaleBlockedIssue(state.coreContext, state.signals);
    if (stale) candidates.push(stale);
  }

  if (state.entityType === "sprint") {
    const standup = detectMissingStandup(state.coreContext, state.signals);
    if (standup) candidates.push(standup);

    const drift = detectScopeCreep(state.coreContext, state.signals);
    candidates.push(...drift);

    const bottleneck = detectApprovalBottleneck(state.coreContext, state.signals);
    if (bottleneck) candidates.push(bottleneck);
  }

  if (state.entityType === "project") {
    // Risk cluster checks
    const cluster = detectRiskCluster(
      state.entityId,
      state.coreContext,
      candidates
    );
    if (cluster) candidates.push(cluster);
  }

  // Always add a context_query signal so the LLM runs even with no issues
  candidates.push({
    signalType: "context_query",
    severity: "low",
    entityId: state.entityId,
    entityType: state.entityType,
    evidence: {
      requestedBy: state.actorId,
      otherSignalCount: candidates.length,
    },
    fingerprint: hashSignal("context_query", state.entityId, Date.now().toString()),
  });

  return candidates;
}
```

### LLM Prompt Template

```typescript
function buildContextQueryPrompt(
  entityType: string,
  candidateCount: number
): string {
  const roleContext = candidateCount > 1
    ? "The user opened FleetGraph and there are active risk signals. Lead with those."
    : "The user opened FleetGraph. No active risks detected. Summarize current state and suggest productive next steps.";

  return `You are FleetGraph, a project intelligence agent for Ship.

A user asked "what matters here right now?" for a ${entityType}.

${roleContext}

You receive:
- Full context for the ${entityType}: details, history, associations
- Any risk signals detected by heuristics
- Supplementary data: standups, activity, accountability items

Your job:
1. Provide a 1-2 sentence summary of the current state
2. List any active risks (from heuristic candidates) with severity and detail
3. Provide 1-3 actionable recommendations ranked by priority

Output format: Use the ContextQueryResponse schema.

Rules:
- Lead with the most important finding
- If no risks: summarize progress and suggest what to focus on next
- Be specific: reference issue titles, people, dates, numbers
- do_now = requires immediate attention
- do_soon = should happen this sprint
- consider = worth thinking about
- Confidence reflects certainty about the recommendations, not about the data`;
}
```

### Expected Structured Output

Uses `ContextQueryResponseSchema` (defined in shared schemas above).

### Graph Path

```
trigger_context(mode=on_demand, entityType=issue|sprint|project)
  -> fetch_core_context(varies by entityType)
  -> fetch_parallel_signals(all applicable)
  -> heuristic_filter(contextQueryHeuristic)
  -> reason_about_risk (always runs for on-demand)
  -> branch_decision -> inform_only
  -> prepare_notification (formatted as context response)
```

On-demand context queries always reach the LLM. The context_query signal ensures candidates is never empty.

### LangSmith Trace Shape

```
Run: fleet_graph:uc6_context_query
  |-- trigger_context         [30ms]  mode=on_demand, entityType=sprint, actorId=user-X
  |-- fetch_core_context      [900ms] (sprint + issues + project)
  |-- fetch_parallel_signals  [700ms] (standups + sprintIssues + backlinks)
  |-- heuristic_filter        [10ms]  candidates=[{context_query}, {missing_standup, severity: medium}]
  |-- reason_about_risk       [2.8s]  model=gpt-4.1, tokens_in=2600, tokens_out=400
  |     |-- openai.responses.parse    ContextQueryResponse{summary, risks: [1], recommendations: [2]}
  |-- branch_decision         [1ms]   path=inform_only
  |-- prepare_notification    [3ms]   formatted as context panel
  Total: ~4.4s
```

### Test Scenario

**Ship state setup:**
1. User opens FleetGraph from Week 3 sprint page
2. Sprint "Week 3" under project "Delta": 4 issues, 2 in_progress, 1 done, 1 backlog
3. Standups: 3 of 4 business days covered this week (1 missing)
4. Plan approval: approved 5 days ago
5. No scope changes

**Expected behavior:**
- Heuristic: `context_query` (always) + `missing_standup` (severity low, 1 day)
- LLM: Summary "Week 3 is on track with 1 of 4 issues completed. 1 standup day missing this week."
- Risks: [{title: "Missing standup coverage", severity: low, detail: "1 business day without standup"}]
- Recommendations: [{action: "Post today's standup", priority: "do_now"}, {action: "Close issue #31 if review is complete", priority: "do_soon"}]

### Example User-Facing Output

**FleetGraph Panel (context mode):**

```
----------------------------------------------
  WHAT MATTERS NOW | Week 3 / Delta

  Week 3 is on track. 1 of 4 issues done,
  2 actively in progress. 1 standup day
  missing this week.

  Risks:
  [LOW] Missing standup: 1 business day
        without standup coverage

  Recommendations:
  [DO NOW]  Post today's standup
  [DO SOON] Close #31 if review is complete

  Confidence: 82%
  [View trace] [Refresh]
----------------------------------------------
```

---

## Stretch Use Cases (Brief Specs)

These map to BG-6 through BG-11 from the Presearch deep dive. Same architecture, same graph, one heuristic function and one prompt template each. No new infrastructure.

### BG-6: Capacity Overload

**Signal:** Team member has 8+ active issues across all sprints.

**Heuristic:**
```typescript
function detectCapacityOverload(
  teamGrid: any, // from GET /api/team/grid
  threshold: number = 8
): CandidateSignal[] {
  const overloaded: CandidateSignal[] = [];
  for (const member of teamGrid.users) {
    const activeIssueCount = Object.values(member.associations || {})
      .flatMap((sprint: any) => sprint.issues || [])
      .filter((i: any) => !["done", "cancelled"].includes(i.state))
      .length;

    if (activeIssueCount >= threshold) {
      overloaded.push({
        signalType: "capacity_overload" as any,
        severity: activeIssueCount >= 12 ? "critical" : "high",
        entityId: member.personId,
        entityType: "issue" as any, // person entity, but closest type
        evidence: { memberName: member.name, activeIssueCount, threshold },
        fingerprint: hashSignal("capacity_overload", member.personId, activeIssueCount.toString()),
      });
    }
  }
  return overloaded;
}
```

**Endpoint:** `GET /api/team/grid`
**Action:** `inform_only` (suggest reassignment)

### BG-7: Ownership Gap

**Signal:** Active project or sprint has no `owner_id`, or owner is archived.

**Heuristic:**
```typescript
function detectOwnershipGap(
  project: any
): CandidateSignal | null {
  if (!project.owner_id) {
    return {
      signalType: "ownership_gap" as any,
      severity: "high",
      entityId: project.id,
      entityType: "project",
      evidence: { projectName: project.title, reason: "no_owner_set" },
      fingerprint: hashSignal("ownership_gap", project.id, "no_owner"),
    };
  }
  return null;
}
```

**Endpoints:** `GET /api/projects/:id`, `GET /api/weeks/lookup-person?user_id=X`
**Action:** `confirm_action` (reassign ownership requires human approval)

### BG-8: Dependency Cascade

**Signal:** A blocked issue is itself depended on by other issues, creating a chain of depth >1.

**Heuristic:**
```typescript
function detectDependencyCascade(
  issue: any,
  backlinks: any[],
  issueCache: Map<string, any>
): CandidateSignal | null {
  if (backlinks.length === 0) return null;

  // Check if any backlinked issues are themselves depended on
  let depth = 1;
  let blastRadius = backlinks.length;

  for (const backlink of backlinks) {
    const downstreamBacklinks = issueCache.get(backlink.id)?.backlinks || [];
    if (downstreamBacklinks.length > 0) {
      depth = Math.max(depth, 2);
      blastRadius += downstreamBacklinks.length;
    }
  }

  if (depth < 2) return null;

  return {
    signalType: "dependency_cascade" as any,
    severity: blastRadius >= 5 ? "critical" : "high",
    entityId: issue.id,
    entityType: "issue",
    evidence: { issueTitle: issue.title, chainDepth: depth, blastRadius },
    fingerprint: hashSignal("dependency_cascade", issue.id, depth.toString()),
  };
}
```

**Endpoints:** `GET /api/documents/:id/backlinks`, `GET /api/documents/:id/associations`
**Action:** `inform_only` (escalation path) or `confirm_action` (reassign blocker)

### BG-9: Week Plan Quality

**Signal:** Plan submitted for approval is thin (few issues, empty content, no priorities set).

**Heuristic:**
```typescript
function detectThinPlan(
  sprint: any,
  sprintIssues: any[]
): CandidateSignal | null {
  const props = sprint.properties || {};
  const planContent = props.plan || "";
  const issueCount = sprintIssues.length;
  const issuesWithPriority = sprintIssues.filter(
    (i: any) => i.priority && i.priority !== "none"
  ).length;

  const isSubmittedForApproval = props.plan_approval?.state === "pending";
  if (!isSubmittedForApproval) return null;

  const issues: string[] = [];
  if (planContent.length < 50) issues.push("plan_too_short");
  if (issueCount < 2) issues.push("too_few_issues");
  if (issuesWithPriority < issueCount * 0.5) issues.push("priorities_not_set");

  if (issues.length === 0) return null;

  return {
    signalType: "thin_plan" as any,
    severity: issues.length >= 2 ? "high" : "medium",
    entityId: sprint.id,
    entityType: "sprint",
    evidence: { sprintName: sprint.title, qualityIssues: issues, issueCount, planLength: planContent.length },
    fingerprint: hashSignal("thin_plan", sprint.id, issues.join(",")),
  };
}
```

**Endpoints:** `GET /api/weeks/lookup`, `GET /api/issues?sprint_id=X`
**Action:** `inform_only` (nudge plan author)

### BG-10: Retro Not Filed

**Signal:** Sprint ended but no retro document exists or retro is empty.

**Heuristic:** Mirror of BG-1 pattern. Check if sprint end date has passed and `has_retro === false`.

**Endpoint:** `GET /api/weeks` (includes `has_retro` field)
**Action:** `inform_only` (remind week owner)

### BG-11: Stale Wiki Drift

**Signal:** Wiki document linked to active project has not been updated in 14+ days while project has recent activity.

**Heuristic:** Compare `document.updated_at` against project activity dates.

**Endpoints:** `GET /api/documents?document_type=wiki`, `GET /api/activity/project/:id`
**Action:** `inform_only` (nudge document owner)

---

## Test Case Matrix

| UC | Use Case | Ship State Setup | Trigger | Expected Heuristic | Expected LLM Severity | Expected Branch | LangSmith Trace Link Pattern |
|----|----------|-----------------|---------|-------------------|-----------------------|-----------------|------------------------------|
| 1a | Blocked issue (on-demand) | Issue in_progress, updated_at 3d ago, 1 backlink | User opens issue page | `stale_blocked_issue` medium | medium | inform_only | `fleet_graph:uc1_blocked_issue` |
| 1b | Blocked issue (proactive) | Issue in_review, updated_at 5d ago, 3 backlinks | 5-min sweep | `stale_blocked_issue` high | high | inform_only | `fleet_graph:uc1_blocked_issue` |
| 1c | Blocked issue (false positive) | Issue in_progress, updated_at 12h ago | User opens issue page | No candidates | n/a | no_issue (log_clean_run) | `fleet_graph:uc1_blocked_issue` |
| 2a | Missing standup | Active sprint, Wednesday 11AM+, 0 standups today | 5-min sweep | `missing_standup` medium | medium | inform_only | `fleet_graph:uc2_missing_standup` |
| 2b | Missing standup (all done) | Active sprint, all issues done | 5-min sweep | `missing_standup` detected | none (LLM overrides) | no_issue | `fleet_graph:uc2_missing_standup` |
| 2c | Missing standup (weekend) | Saturday, active sprint | 5-min sweep | No candidates | n/a | no_issue | `fleet_graph:uc2_missing_standup` |
| 3a | Scope creep (small) | Sprint with snapshot, 1 issue added (est=2) | Event: issue added | `scope_drift` medium | low | inform_only | `fleet_graph:uc3_scope_creep` |
| 3b | Scope creep (large) | Sprint with snapshot, 3 issues added (est=15) | 5-min sweep | `scope_drift` high | high | inform_only | `fleet_graph:uc3_scope_creep` |
| 3c | Scope creep (no snapshot) | Sprint without planned_issue_ids | Any | No candidates | n/a | no_issue | `fleet_graph:uc3_scope_creep` |
| 4a | Risk cluster (3 signals) | Project with stale issue + missing standup + no plan | 5-min sweep (meta) | `risk_cluster` high | high | inform_only | `fleet_graph:uc4_risk_cluster` |
| 4b | Risk cluster (5 signals) | Project with 5 converging signals | 5-min sweep (meta) | `risk_cluster` critical | critical | inform_only | `fleet_graph:uc4_risk_cluster` |
| 4c | Risk cluster (1 signal) | Project with only 1 issue | 5-min sweep | No risk_cluster | n/a | (other UC handles it) | n/a |
| 5a | Approval bottleneck (plan) | Sprint plan_approval pending 3 days | 5-min sweep | `approval_bottleneck` high | high | inform_only | `fleet_graph:uc5_approval_bottleneck` |
| 5b | Approval bottleneck (review) | Sprint review_approval pending 6 days | 5-min sweep | `approval_bottleneck` critical | critical | inform_only | `fleet_graph:uc5_approval_bottleneck` |
| 5c | Approval bottleneck (fresh) | Sprint plan_approval pending 12 hours | 5-min sweep | No candidates | n/a | no_issue | `fleet_graph:uc5_approval_bottleneck` |
| 6a | Context query (with risks) | User opens sprint page, 2 risks detected | User click | `context_query` + others | medium | inform_only | `fleet_graph:uc6_context_query` |
| 6b | Context query (clean) | User opens project page, no risks | User click | `context_query` only | low | inform_only | `fleet_graph:uc6_context_query` |
| 6c | Context query (issue page) | User opens stale issue page | User click | `context_query` + `stale_blocked_issue` | medium | inform_only | `fleet_graph:uc6_context_query` |

### Trace naming convention

All traces follow the pattern: `fleet_graph:uc{N}_{snake_case_name}`

Traces are tagged with:
- `workspace_id` for tenant filtering
- `mode` (proactive / on_demand)
- `entity_type` (issue / sprint / project)
- `signal_types` (comma-separated list of detected signals)
- `branch_path` (no_issue / inform_only / confirm_action)

---

## Utility Functions Referenced

These are shared across use cases and should live in `src/fleetgraph/utils/`:

```typescript
// src/fleetgraph/utils/time.ts
export function daysSince(isoDate: string): number;
export function hoursSince(isoDate: string): number;
export function subtractBusinessDays(date: Date, days: number): Date;
export function getBusinessDaysBetween(from: string, to: string): string[];
export function computeWeekStart(sprintStartDate: string, sprintNumber: number): string;
export function computeSprintDateRange(coreContext: Record<string, unknown>): { from: string; to: string };

// src/fleetgraph/utils/hash.ts
export function hashSignal(signalType: string, entityId: string, discriminator: string): string;

// src/fleetgraph/utils/context.ts
export function summarizeContext(coreContext: Record<string, unknown>): Record<string, unknown>;
export function summarizeSignals(signals: Record<string, unknown>): Record<string, unknown>;
export function extractProjectId(coreContext: Record<string, unknown>): string | null;
export function extractSprintIds(coreContext: Record<string, unknown>): string[];

// src/fleetgraph/utils/trace.ts
export function buildTraceLink(traceId: string): string;
export function buildNotificationTitle(assessment: RiskAssessment, candidates: CandidateSignal[]): string;
export function summarizeEvidence(evidence: Record<string, unknown>): string;
```

---

## Ship API Endpoint Reference

Quick reference for all endpoints used across use cases.

| Endpoint | Method | Used by UC | Returns |
|----------|--------|------------|---------|
| `/api/issues/:id` | GET | 1, 3, 6 | Issue detail with properties, timestamps, belongs_to |
| `/api/issues/:id/history` | GET | 1, 3 | State transitions, field changes |
| `/api/issues/:id/children` | GET | 1 | Sub-issue list with states |
| `/api/issues/:id/iterations` | GET | 1, 6 | Claude iteration history |
| `/api/issues` | GET | 1, 2, 3, 5, 6 | Filtered issue list (supports `sprint_id`, `state`, `assignee_id`) |
| `/api/documents/:id/associations` | GET | 1, 6 | Parent, sprint, project, program links |
| `/api/documents/:id/backlinks` | GET | 1, 6 | Documents that link to this one |
| `/api/weeks` | GET | 2, 5 | Active sprints with owner, issue counts, approval state |
| `/api/weeks/lookup` | GET | 3, 5 | Sprint by project_id + sprint_number |
| `/api/weeks/lookup-person` | GET | 5 | Resolve person document by user_id |
| `/api/standups` | GET | 2, 6 | Standups in date range (supports `date_from`, `date_to`) |
| `/api/standups/status` | GET | 2 | Per-user standup due status |
| `/api/projects/:id` | GET | 3, 4, 5 | Project detail: ICE, RACI, plan, approval |
| `/api/projects/:id/weeks` | GET | 4 | All sprints under project |
| `/api/projects/:id/issues` | GET | 4 | All issues under project |
| `/api/accountability/action-items` | GET | 2, 4, 5 | Inference-based missing accountability items |
| `/api/activity/project/:id` | GET | 4, 6 | 30-day activity counts |
| `/api/claude/context` | GET | 4 | Rich context (supports `context_type=review\|retro`, `sprint_id`, `project_id`) |
| `/api/team/grid` | GET | BG-6 | Team allocation grid |
| `/api/issues/:id` | PATCH | (execute_action) | Update issue state, assignee, priority, belongs_to |
