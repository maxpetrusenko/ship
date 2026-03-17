# Agent Responsibility Scoping: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Engineer-ready specification for FleetGraph signal detection, responsibility boundaries, notification routing, context assembly, role-based behavior, noise control, and edge cases.

## Reconciliation Note

- Canonical proactive MVP excludes workspace-wide missing-standup and inferred-accountability sweeps until Ship adds admin-capable endpoints for them
- Approval bottlenecks use Ship's real approval states: `null` means pending, plus `approved`, `changed_since_approved`, and `changes_requested`
- Canonical route names are `POST /api/weeks/:id/request-plan-changes` and `POST /api/weeks/:id/request-retro-changes`

## 1. Signal Detection Specifications

### 1.1 Missing Standups

**Detection logic:**

```typescript
async function detectMissingStandups(
  workspaceId: string,
  currentSprintNumber: number,
  todayStr: string // YYYY-MM-DD
): Promise<MissingStandupSignal[]> {
  // Step 1: Get all users who have issues assigned in the current sprint
  const activeUsers = await fetch(
    `GET /api/issues?sprint_id=${currentSprintId}&state=in_progress,todo,in_review`
  );
  const assigneeIds = unique(activeUsers.map(i => i.assignee_id).filter(Boolean));

  // Step 2: For each assignee, check standup status
  // Uses: GET /api/standups/status (checks standalone standups by date property)
  // Underlying query checks:
  //   - documents WHERE document_type = 'standup'
  //     AND (properties->>'author_id')::uuid = userId
  //     AND (properties->>'date') = todayStr

  // Step 3: Filter to business days only (skip weekends)
  if (!isBusinessDay(todayStr)) return [];

  // Step 4: Emit signal for each assignee with no standup today
  return assigneesWithoutStandup.map(userId => ({
    signalType: 'missing_standup',
    entityType: 'sprint',
    entityId: currentSprintId,
    affectedUserId: userId,
    severity: computeStandupSeverity(daysSinceLastStandup),
    evidence: { lastStandupDate, issueCount, sprintNumber }
  }));
}
```

**Ship API endpoints:**
- `GET /api/weeks` -- enumerate active sprints (returns `current_sprint_number`)
- `GET /api/standups/status` -- per-user standup due status
- `GET /api/standups?date_from=X&date_to=Y` -- standup history in range
- `GET /api/issues?sprint_id=X` -- issues in sprint (derive active assignees)

**Threshold values:**

| Parameter | Default | Configurable | Notes |
|---|---|---|---|
| `standupExpectedAfterHour` | 10:00 workspace TZ | per-workspace | Only alert after this hour |
| `businessDaysOnly` | `true` | per-workspace | Skip weekends |
| `gracePeriodMinutes` | 120 | per-workspace | Buffer after expected window |

**False positive mitigation:**
- Skip users with zero active issues in the sprint (no work to report on)
- Skip weekends and holidays (workspace configurable)
- Skip if standup was posted within the grace period
- Skip if the sprint has not started yet (sprint_number > currentSprintNumber)

**Trigger vs. non-trigger examples:**

| Ship State | Triggers? | Why |
|---|---|---|
| User has 3 in_progress issues, no standup today, 11:00 AM | Yes | Active work, past expected window |
| User has 3 in_progress issues, standup posted 9:00 AM | No | Standup exists for today |
| User has 0 issues in sprint, no standup | No | Not participating in this sprint |
| Saturday, user has issues, no standup | No | Not a business day |
| Sprint has not started (future sprint_number) | No | Sprint is in planning, not active |

### 1.2 Stale In-Progress Issues

**Detection logic:**

```typescript
async function detectStaleIssues(
  workspaceId: string,
  sprintId: string
): Promise<StaleIssueSignal[]> {
  // Step 1: Get all in_progress issues for the sprint
  const issues = await fetch(
    `GET /api/issues?sprint_id=${sprintId}&state=in_progress`
  );

  // Step 2: For each issue, fetch history
  const signals: StaleIssueSignal[] = [];

  for (const issue of issues) {
    const history = await fetch(`GET /api/issues/${issue.id}/history`);

    // Step 3: Find last meaningful change
    // "Meaningful" = state change, assignee change, or content edit
    // Exclude: priority changes, estimate changes (metadata only)
    const meaningfulFields = ['state', 'title', 'assignee_id', 'belongs_to'];
    const lastMeaningful = history
      .filter(h => meaningfulFields.includes(h.field))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const daysSinceProgress = businessDaysBetween(
      lastMeaningful?.created_at ?? issue.started_at ?? issue.updated_at,
      now()
    );

    // Step 4: Emit signal if stale
    if (daysSinceProgress >= STALE_THRESHOLD_BUSINESS_DAYS) {
      signals.push({
        signalType: 'stale_in_progress',
        entityType: 'issue',
        entityId: issue.id,
        affectedUserId: issue.assignee_id,
        severity: daysSinceProgress >= 5 ? 'high' : 'medium',
        evidence: {
          daysSinceProgress,
          lastChange: lastMeaningful,
          issueTitle: issue.title,
          assigneeName: issue.assignee_name,
        }
      });
    }
  }
  return signals;
}
```

**Ship API endpoints:**
- `GET /api/issues?sprint_id=X&state=in_progress` -- candidate issues
- `GET /api/issues/:id/history` -- change history per issue
- `GET /api/issues/:id` -- full issue detail (started_at, updated_at timestamps)

**Threshold values:**

| Parameter | Default | Configurable | Notes |
|---|---|---|---|
| `staleThresholdBusinessDays` | 3 | per-workspace | Conservative default |
| `meaningfulFields` | `['state', 'title', 'assignee_id', 'belongs_to']` | global | What counts as progress |
| `highSeverityDays` | 5 | per-workspace | Escalation threshold |

**False positive mitigation:**
- Use `document_history` table (field-level changes), not just `updated_at`
- Exclude metadata-only changes (priority shuffle, estimate tweaks)
- If issue has sub-issues (`GET /api/issues/:id/children`), check children for recent activity too
- Respect `in_review` state separately (that signals hand-off, not stall)

**Trigger vs. non-trigger examples:**

| Ship State | Triggers? | Why |
|---|---|---|
| Issue in_progress, last state change 5 days ago, no other edits | Yes | Stale beyond threshold |
| Issue in_progress, state unchanged 4 days, but title edited yesterday | No | Meaningful activity exists |
| Issue in_progress, 3 days stale, has active sub-issue updated today | No | Child activity counts |
| Issue in_review, 3 days stale | No | Different state, different signal |
| Issue in_progress, created 1 day ago, no history | No | Below threshold |

### 1.3 Scope Creep (Sprint Scope Drift)

**Detection logic:**

```typescript
async function detectScopeDrift(
  sprintId: string
): Promise<ScopeDriftSignal | null> {
  // Step 1: Get sprint with plan snapshot
  const sprint = await fetch(`GET /api/weeks/${sprintId}`);

  // Sprint properties contain:
  //   planned_issue_ids: string[] | null  -- snapshot at sprint activation
  //   snapshot_taken_at: string | null     -- when snapshot was taken

  if (!sprint.planned_issue_ids || !sprint.snapshot_taken_at) {
    return null; // No snapshot taken yet; sprint not activated
  }

  // Step 2: Get current sprint issues
  const currentIssues = await fetch(`GET /api/issues?sprint_id=${sprintId}`);
  const currentIds = new Set(currentIssues.map(i => i.id));
  const plannedIds = new Set(sprint.planned_issue_ids);

  // Step 3: Compute delta
  const addedAfterPlan = currentIssues.filter(i => !plannedIds.has(i.id));
  const removedFromPlan = sprint.planned_issue_ids.filter(id => !currentIds.has(id));

  // Step 4: Emit signal if delta is non-trivial
  if (addedAfterPlan.length === 0 && removedFromPlan.length === 0) {
    return null;
  }

  return {
    signalType: 'scope_drift',
    entityType: 'sprint',
    entityId: sprintId,
    severity: addedAfterPlan.length >= 3 ? 'high' : 'low',
    evidence: {
      plannedCount: sprint.planned_issue_ids.length,
      currentCount: currentIssues.length,
      addedIssues: addedAfterPlan.map(i => ({
        id: i.id, title: i.title, addedBy: i.created_by
      })),
      removedIssueIds: removedFromPlan,
      snapshotTakenAt: sprint.snapshot_taken_at,
    }
  };
}
```

**Ship API endpoints:**
- `GET /api/weeks` or `GET /api/weeks/:id` -- sprint payload with `planned_issue_ids` and `snapshot_taken_at`
- `GET /api/issues?sprint_id=X` -- current issues in sprint
- `takeSprintSnapshot()` -- internal function (in `weeks.ts`) that captures issue IDs when sprint activates

**Threshold values:**

| Parameter | Default | Configurable | Notes |
|---|---|---|---|
| `immediateOnAdd` | `true` | N/A | Signal fires as soon as delta exists |
| `highSeverityAddedCount` | 3 | per-workspace | Three or more additions = high severity |
| `ignoreRemovals` | `false` | per-workspace | Removals can indicate scope narrowing, which is fine |

**False positive mitigation:**
- Only fire after `snapshot_taken_at` is set (sprint has been activated)
- Differentiate between additions (scope creep) and removals (scope discipline)
- Check if added issues were moved from another sprint (carryover) vs. truly new scope
- If `carryover_from_sprint_id` is set on the issue, label it as carryover, not scope creep

**Trigger vs. non-trigger examples:**

| Ship State | Triggers? | Why |
|---|---|---|
| Sprint active, 2 new issues added since snapshot | Yes (low) | Scope changed after plan |
| Sprint active, 1 issue removed, 0 added | Yes (low) | Delta exists, but positive discipline |
| Sprint in planning, no snapshot taken | No | Snapshot required for comparison |
| Sprint active, 4 issues added, all with `carryover_from_sprint_id` | Yes (low) | Carryover noted in evidence, severity reduced |

### 1.4 Approval Bottlenecks

**Detection logic:**

```typescript
async function detectApprovalBottlenecks(
  workspaceId: string
): Promise<ApprovalBottleneckSignal[]> {
  // Step 1: Get all active sprints
  const { weeks } = await fetch(`GET /api/weeks`);

  const signals: ApprovalBottleneckSignal[] = [];

  for (const sprint of weeks) {
    // Sprint properties contain:
    //   plan_approval / review_approval:
    //     null = pending review
    //     { state: 'approved' | 'changed_since_approved' | 'changes_requested', ... }

    // Step 2: Check plan_approval
    const planApproval = sprint.plan_approval;
    const planPending =
      planApproval === null ||
      planApproval?.state === 'changed_since_approved' ||
      planApproval?.state === 'changes_requested';
    if (planPending) {
      const approvalState = planApproval?.state ?? null;
      const submittedAt = sprint.updated_at; // refine with linked weekly doc submitted_at when fetched
      const daysPending = businessDaysBetween(submittedAt, now());

      if (daysPending >= APPROVAL_THRESHOLD_BUSINESS_DAYS) {
        signals.push({
          signalType: 'approval_bottleneck',
          entityType: 'sprint',
          entityId: sprint.id,
          approvalType: 'plan_approval',
          approvalState,
          daysPending,
          severity: daysPending >= 4 ? 'high' : 'medium',
          evidence: {
            sprintNumber: sprint.sprint_number,
            approverReportsTo: sprint.owner_reports_to,
            programAccountableId: sprint.program_accountable_id,
          }
        });
      }
    }

    // Step 3: Check review_approval (same logic)
    const reviewApproval = sprint.review_approval;
    const reviewPending =
      reviewApproval === null ||
      reviewApproval?.state === 'changed_since_approved' ||
      reviewApproval?.state === 'changes_requested';
    if (reviewPending) {
      const approvalState = reviewApproval?.state ?? null;
      const daysPending = businessDaysBetween(sprint.updated_at, now());
      if (daysPending >= APPROVAL_THRESHOLD_BUSINESS_DAYS) {
        signals.push({
          signalType: 'approval_bottleneck',
          entityType: 'sprint',
          entityId: sprint.id,
          approvalType: 'review_approval',
          approvalState,
          daysPending,
          severity: daysPending >= 4 ? 'high' : 'medium',
          evidence: { /* similar */ }
        });
      }
    }
  }
  return signals;
}
```

**Ship API endpoints:**
- `GET /api/weeks` -- returns sprints with `plan_approval` and `review_approval` in properties
- `POST /api/weeks/:id/approve-plan` -- approval action (reference for understanding approval flow)
- `POST /api/weeks/:id/request-plan-changes` -- changes_requested action
- `POST /api/weeks/:id/request-retro-changes` -- retro changes_requested action
- Sprint properties also include `program_accountable_id` and `owner_reports_to` for routing

**Approval state machine (from Ship):**

```
null = pending review
null -> approved (supervisor/accountable approves current submission)
null -> changes_requested (supervisor/accountable requests revisions)
approved -> changed_since_approved (owner edits after approval)
changes_requested -> changed_since_approved (owner revises content for re-review)
changed_since_approved -> approved | changes_requested
approved -> null (explicit revoke via unapprove route)
```

**Threshold values:**

| Parameter | Default | Configurable | Notes |
|---|---|---|---|
| `approvalThresholdBusinessDays` | 2 | per-workspace | Approvals block downstream work |
| `highSeverityDays` | 4 | per-workspace | Escalation trigger |

**False positive mitigation:**
- Only count business days
- If `changes_requested`, the bottleneck is on the owner (not the approver); route accordingly
- If the sprint has already ended, reduce severity (historical, no longer blocking)

**Trigger vs. non-trigger examples:**

| Ship State | Triggers? | Why |
|---|---|---|
| Plan submitted Monday, still pending on Thursday | Yes (medium) | 3 business days pending |
| Review approved yesterday | No | Already resolved |
| Plan in changes_requested for 1 day | No | Below threshold; owner has time to revise |
| Plan pending for 5 business days, sprint already ended | Yes (low) | Bottleneck was real, but urgency reduced |

### 1.5 RACI and Ownership Gaps

**Detection logic:**

```typescript
async function detectOwnershipGaps(
  workspaceId: string
): Promise<OwnershipGapSignal[]> {
  const signals: OwnershipGapSignal[] = [];

  // Step 1: Check projects
  // Project properties contain: owner_id, accountable_id, consulted_ids, informed_ids
  const projects = await fetch(`GET /api/projects`);

  for (const project of projects) {
    const gaps: string[] = [];

    if (!project.owner_id) gaps.push('missing_owner');
    if (!project.accountable_id) gaps.push('missing_accountable');
    if (project.owner_id === project.accountable_id && project.owner_id) {
      gaps.push('owner_is_accountable'); // Same person doing and approving
    }

    // Validate that owner/accountable are still active workspace members
    if (project.owner_id) {
      const members = await fetch(`GET /api/workspaces/${workspaceId}/members`);
      const ownerActive = members.some(m => m.id === project.owner_id && !m.isArchived);
      if (!ownerActive) gaps.push('owner_inactive');
    }

    if (gaps.length > 0) {
      signals.push({
        signalType: 'ownership_gap',
        entityType: 'project',
        entityId: project.id,
        severity: gaps.includes('missing_owner') || gaps.includes('missing_accountable')
          ? 'high' : 'low',
        evidence: { projectTitle: project.title, gaps }
      });
    }
  }

  // Step 2: Check sprints
  const { weeks } = await fetch(`GET /api/weeks`);

  for (const sprint of weeks) {
    if (!sprint.owner) {
      signals.push({
        signalType: 'ownership_gap',
        entityType: 'sprint',
        entityId: sprint.id,
        severity: 'high',
        evidence: { sprintNumber: sprint.sprint_number, gap: 'no_sprint_owner' }
      });
    }
  }

  // Step 3: Check unassigned issues in active sprints
  const unassigned = await fetch(
    `GET /api/issues?sprint_id=${currentSprintId}&assignee_id=unassigned`
  );
  if (unassigned.length > 0) {
    signals.push({
      signalType: 'ownership_gap',
      entityType: 'sprint',
      entityId: currentSprintId,
      severity: unassigned.length >= 3 ? 'medium' : 'low',
      evidence: {
        unassignedCount: unassigned.length,
        issues: unassigned.map(i => ({ id: i.id, title: i.title }))
      }
    });
  }

  return signals;
}
```

**Ship API endpoints:**
- `GET /api/projects` -- project list with RACI fields (`owner_id`, `accountable_id`, `consulted_ids`, `informed_ids`)
- `GET /api/workspaces/:id/members` -- active workspace members with roles
- `GET /api/weeks` -- sprint owner via `assignee_ids[0]` resolved to user
- `GET /api/issues?sprint_id=X&assignee_id=unassigned` -- unassigned issues filter
- `GET /api/team/grid` -- team grid with person docs, `reportsTo` field

**False positive mitigation:**
- Only flag active projects (not archived, `inferred_status !== 'archived'`)
- `owner_is_accountable` is informational (low severity), not blocking
- Unassigned issues in backlog sprints are expected; only flag active sprints

### 1.6 Risk Clusters

**Detection logic:**

```typescript
async function detectRiskClusters(
  workspaceId: string,
  allSignals: FleetGraphSignal[]
): Promise<RiskClusterSignal[]> {
  // Step 1: Group existing signals by project
  const signalsByProject = new Map<string, FleetGraphSignal[]>();

  for (const signal of allSignals) {
    // Resolve signal to project via sprint->project association
    const projectId = await resolveProjectId(signal);
    if (!projectId) continue;

    if (!signalsByProject.has(projectId)) {
      signalsByProject.set(projectId, []);
    }
    signalsByProject.get(projectId)!.push(signal);
  }

  // Step 2: Emit cluster signal when threshold met
  const clusters: RiskClusterSignal[] = [];

  for (const [projectId, signals] of signalsByProject) {
    if (signals.length < CLUSTER_THRESHOLD) continue;

    // Weight by severity
    const weightedScore = signals.reduce((sum, s) => {
      return sum + SEVERITY_WEIGHTS[s.severity];
    }, 0);

    if (weightedScore >= CLUSTER_WEIGHT_THRESHOLD) {
      clusters.push({
        signalType: 'risk_cluster',
        entityType: 'project',
        entityId: projectId,
        severity: weightedScore >= 10 ? 'high' : 'medium',
        evidence: {
          signalCount: signals.length,
          weightedScore,
          signalTypes: signals.map(s => s.signalType),
          signalSummaries: signals.map(s => summarizeSignal(s)),
        }
      });
    }
  }

  return clusters;
}

const SEVERITY_WEIGHTS = { none: 0, low: 1, medium: 2, high: 4 };
const CLUSTER_THRESHOLD = 2;        // Minimum distinct signals
const CLUSTER_WEIGHT_THRESHOLD = 4; // Minimum weighted score
```

**Ship API endpoints (for project resolution):**
- `GET /api/documents/:id/associations` -- resolve sprint->project via `relationship_type: 'project'`
- `GET /api/activity/project/:id` -- 30-day activity heatmap for project
- `GET /api/accountability/action-items` -- existing accountability inference

**Threshold values:**

| Parameter | Default | Notes |
|---|---|---|
| `clusterMinSignals` | 2 | At least 2 distinct signal types |
| `clusterWeightThreshold` | 4 | Weighted severity sum |
| `severityWeights` | `{ low: 1, medium: 2, high: 4 }` | Per-signal weight |

**Trigger vs. non-trigger examples:**

| Ship State | Triggers? | Why |
|---|---|---|
| Project has stale issue (medium) + missing standup (medium) | Yes | 2 signals, weight = 4 |
| Project has 1 low-severity ownership gap | No | Below both thresholds |
| Project has scope drift (low) + approval bottleneck (high) + stale issue (medium) | Yes (high) | Weight = 7, 3 signals |

## 2. Responsibility Boundary Enforcement

### 2.1 Action Classification Types

```typescript
/**
 * Actions FleetGraph can perform autonomously.
 * These are read-only or notification-only operations.
 */
enum AutonomousAction {
  /** Generate and store a risk assessment */
  GENERATE_RISK_ASSESSMENT = 'generate_risk_assessment',
  /** Save an insight record to FleetGraph storage */
  SAVE_INSIGHT = 'save_insight',
  /** Send an in-app notification via broadcastToUser */
  SEND_NOTIFICATION = 'send_notification',
  /** Prepare a draft recommendation (not applied) */
  PREPARE_DRAFT = 'prepare_draft',
  /** Refresh evidence on a previously surfaced insight */
  REFRESH_INSIGHT = 'refresh_insight',
  /** Log a clean sweep run (no signals found) */
  LOG_CLEAN_RUN = 'log_clean_run',
}

/**
 * Actions that require explicit human approval via the HITL gate.
 * FleetGraph may propose these but MUST NOT execute without confirmation.
 */
enum GatedAction {
  /** Change issue state (e.g., in_progress -> done) */
  CHANGE_ISSUE_STATE = 'change_issue_state',
  /** Reassign issue to a different user */
  REASSIGN_ISSUE = 'reassign_issue',
  /** Reassign sprint owner */
  REASSIGN_SPRINT_OWNER = 'reassign_sprint_owner',
  /** Approve or reject a plan/review */
  CHANGE_APPROVAL_STATE = 'change_approval_state',
  /** Add or remove issues from a sprint */
  MODIFY_SPRINT_SCOPE = 'modify_sprint_scope',
  /** Edit project, sprint, or issue content */
  EDIT_CONTENT = 'edit_content',
  /** Create a new issue on behalf of a user */
  CREATE_ISSUE = 'create_issue',
  /** Modify project RACI fields */
  MODIFY_OWNERSHIP = 'modify_ownership',
  /** Send notification to someone other than the directly responsible owner */
  BROADCAST_NOTIFICATION = 'broadcast_notification',
}

type FleetGraphAction = AutonomousAction | GatedAction;
```

### 2.2 Runtime Guard

```typescript
/**
 * Runtime guard that blocks unauthorized mutations.
 * Wraps every Ship API call made by FleetGraph.
 */
class ActionGuard {
  private static readonly ALLOWED_METHODS_AUTONOMOUS = new Set(['GET']);
  private static readonly ALLOWED_WRITE_PATHS_AUTONOMOUS = new Set([
    '/api/fleetgraph/insights',       // FleetGraph's own storage
    '/api/fleetgraph/logs',           // FleetGraph run logs
  ]);

  /**
   * Validates that an action is permitted given the current gate state.
   * Throws BoundaryViolationError if blocked.
   */
  static validate(
    action: FleetGraphAction,
    gateApproved: boolean,
    context: { traceId: string; entityId: string; actorUserId: string | null }
  ): void {
    const isAutonomous = Object.values(AutonomousAction).includes(action as AutonomousAction);

    if (isAutonomous) {
      // Autonomous actions always pass
      return;
    }

    // Gated action without approval
    if (!gateApproved) {
      const violation: BoundaryViolation = {
        action,
        traceId: context.traceId,
        entityId: context.entityId,
        actorUserId: context.actorUserId,
        timestamp: new Date().toISOString(),
        blocked: true,
      };

      // Log the violation
      logger.warn('FleetGraph boundary violation blocked', violation);

      // Persist to audit trail
      persistBoundaryViolation(violation);

      throw new BoundaryViolationError(
        `Action "${action}" requires human approval. ` +
        `Trace: ${context.traceId}`
      );
    }
  }

  /**
   * HTTP-level guard for Ship API calls.
   * Rejects any non-GET request that is not to FleetGraph's own endpoints.
   */
  static validateHttpCall(
    method: string,
    path: string,
    gateApproved: boolean
  ): void {
    if (this.ALLOWED_METHODS_AUTONOMOUS.has(method.toUpperCase())) {
      return; // GET requests are always allowed
    }

    if (this.ALLOWED_WRITE_PATHS_AUTONOMOUS.has(path)) {
      return; // FleetGraph's own endpoints are allowed
    }

    if (!gateApproved) {
      throw new BoundaryViolationError(
        `FleetGraph attempted ${method} ${path} without gate approval`
      );
    }
  }
}
```

### 2.3 Boundary Violation Logging

```typescript
interface BoundaryViolation {
  action: FleetGraphAction;
  traceId: string;
  entityId: string;
  actorUserId: string | null;
  timestamp: string;
  blocked: boolean;
  /** If false, the violation was logged but not blocked (should not happen in prod) */
}

/**
 * Persisted to a `fleetgraph_audit_log` table for compliance.
 * Also tagged in LangSmith trace metadata.
 */
async function persistBoundaryViolation(violation: BoundaryViolation): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_audit_log (trace_id, action, entity_id, actor_user_id, blocked, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [violation.traceId, violation.action, violation.entityId,
     violation.actorUserId, violation.blocked, violation.timestamp]
  );
}
```

## 3. Notification Routing Engine

### 3.1 Resolution Algorithm

```typescript
interface NotificationTarget {
  userId: string;
  personDocId: string | null;
  name: string;
  email: string;
  role: 'assignee' | 'sprint_owner' | 'project_owner' | 'accountable' | 'manager';
  reason: string;
}

interface EscalationChain {
  primary: NotificationTarget;
  escalation: NotificationTarget | null;
  escalationTrigger: EscalationTrigger | null;
}

type EscalationTrigger =
  | { type: 'repeated_signal'; sweepCount: number; threshold: number }
  | { type: 'no_action_after'; businessDays: number; threshold: number }
  | { type: 'multi_signal_cluster'; signalCount: number; threshold: number };

/**
 * Given a signal, determine who gets notified and when escalation happens.
 */
async function resolveNotificationTargets(
  signal: FleetGraphSignal,
  workspaceId: string
): Promise<EscalationChain> {
  switch (signal.entityType) {
    case 'issue': {
      // Primary: issue assignee
      const issue = await fetch(`GET /api/issues/${signal.entityId}`);
      const primary = await resolveUser(issue.assignee_id, workspaceId);

      // Escalation: project accountable (via issue -> sprint -> project -> accountable_id)
      const associations = await fetch(
        `GET /api/documents/${signal.entityId}/associations`
      );
      const projectAssoc = associations.find(a => a.relationship_type === 'project');
      let escalation: NotificationTarget | null = null;

      if (projectAssoc) {
        const project = await fetch(`GET /api/projects/${projectAssoc.related_id}`);
        if (project.accountable_id && project.accountable_id !== issue.assignee_id) {
          escalation = await resolveUser(project.accountable_id, workspaceId);
          escalation.role = 'accountable';
          escalation.reason = 'Project accountable for escalation';
        }
      }

      return {
        primary: { ...primary, role: 'assignee', reason: 'Issue assignee' },
        escalation,
        escalationTrigger: { type: 'repeated_signal', sweepCount: 0, threshold: 3 },
      };
    }

    case 'sprint': {
      // Primary: sprint owner
      // Sprint owner is resolved from properties.assignee_ids[0] -> user
      // The GET /api/weeks endpoint already resolves owner to { id, name, email }
      const sprint = await fetch(`GET /api/weeks/${signal.entityId}`);
      const primary = sprint.owner
        ? { userId: sprint.owner.id, name: sprint.owner.name, email: sprint.owner.email,
            personDocId: null, role: 'sprint_owner' as const,
            reason: 'Sprint owner' }
        : null;

      // Escalation: manager via reports_to field
      // Sprint response includes owner_reports_to (person doc -> properties.reports_to)
      let escalation: NotificationTarget | null = null;
      if (sprint.owner_reports_to) {
        escalation = await resolveUser(sprint.owner_reports_to, workspaceId);
        escalation.role = 'manager';
        escalation.reason = 'Manager via reports_to';
      }

      return {
        primary: primary!,
        escalation,
        escalationTrigger: { type: 'no_action_after', businessDays: 0, threshold: 1 },
      };
    }

    case 'project': {
      // Primary: project owner (RACI "R")
      const project = await fetch(`GET /api/projects/${signal.entityId}`);
      const primary = project.owner_id
        ? await resolveUser(project.owner_id, workspaceId)
        : null;

      // Escalation: project accountable (RACI "A")
      let escalation: NotificationTarget | null = null;
      if (project.accountable_id && project.accountable_id !== project.owner_id) {
        escalation = await resolveUser(project.accountable_id, workspaceId);
        escalation.role = 'accountable';
        escalation.reason = 'Project accountable (RACI A)';
      }

      return {
        primary: primary
          ? { ...primary, role: 'project_owner', reason: 'Project owner (RACI R)' }
          : FALLBACK_WORKSPACE_ADMIN,
        escalation,
        escalationTrigger: { type: 'multi_signal_cluster', signalCount: 0, threshold: 1 },
      };
    }
  }
}
```

### 3.2 Escalation Timing

```typescript
interface EscalationPolicy {
  /** How many consecutive sweeps the signal persists before escalating */
  sweepCountThreshold: number;
  /** How many business days of inaction before escalating */
  noActionBusinessDays: number;
  /** How many distinct signals on the same entity before escalating */
  multiSignalThreshold: number;
}

const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  sweepCountThreshold: 3,    // ~12 minutes at 4-min sweeps
  noActionBusinessDays: 1,   // Full business day of inaction
  multiSignalThreshold: 2,   // 2+ signals on same project -> director-level
};
```

### 3.3 De-escalation

```typescript
/**
 * When a signal resolves, actively de-escalate:
 * 1. Mark the alert as resolved in persisted state
 * 2. If escalation notification was sent, notify the escalation target that the issue resolved
 * 3. Clear the sweep counter
 */
async function handleSignalResolution(
  fingerprint: string,
  previousState: PersistedAlertState
): Promise<void> {
  // Update persisted state
  await updateAlertState(fingerprint, {
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    sweepCount: 0,
  });

  // If escalation was triggered, send resolution notice
  if (previousState.escalationSent && previousState.escalationTarget) {
    await sendNotification({
      targetUserId: previousState.escalationTarget.userId,
      eventType: 'fleetgraph:resolved',
      payload: {
        signalType: previousState.signalType,
        entityId: previousState.entityId,
        resolvedAt: new Date().toISOString(),
        message: `Previously flagged issue has been resolved.`,
      }
    });
  }
}
```

### 3.4 Delivery via Ship's Existing Broadcast

```typescript
/**
 * MVP delivery: reuse the existing broadcastToUser function
 * from api/src/collaboration/index.ts
 *
 * Signature: broadcastToUser(userId: string, eventType: string, data?: Record<string, unknown>)
 *
 * FleetGraph uses 'accountability:updated' event type for MVP compatibility.
 * Future: dedicated 'fleetgraph:insight' event type.
 */
async function deliverAlert(
  target: NotificationTarget,
  signal: FleetGraphSignal,
  assessment: FleetGraphAssessment
): Promise<void> {
  broadcastToUser(target.userId, 'accountability:updated', {
    source: 'fleetgraph',
    signalType: signal.signalType,
    entityType: signal.entityType,
    entityId: signal.entityId,
    severity: signal.severity,
    message: assessment.explanation,
    recommendation: assessment.recommendation,
    traceId: assessment.traceId,
  });
}
```

## 4. Context Assembly Per Entity Type

### 4.1 Issue Context

```typescript
interface IssueContext {
  // Core issue data
  issue: {
    id: string;
    title: string;
    state: 'triage' | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
    priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
    assignee_id: string | null;
    assignee_name: string | null;
    estimate: number | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    created_by: string | null;
    ticket_number: number;
  };

  // Relationships
  belongs_to: Array<{ id: string; type: 'program' | 'project' | 'sprint' | 'parent' }>;
  children: IssueContext['issue'][];                  // Sub-issues
  associations: Array<{                               // From document_associations
    related_id: string;
    relationship_type: string;
    related_title: string;
    related_document_type: string;
  }>;

  // History
  history: Array<{
    field: string;
    old_value: string | null;
    new_value: string | null;
    created_at: string;
    changed_by: { id: string; name: string } | null;
    automated_by: string | null;
  }>;

  // Sprint context (if issue belongs to a sprint)
  sprint: {
    id: string;
    sprint_number: number;
    status: string;
    days_remaining: number;
    plan: string | null;
  } | null;

  // Project context (if issue belongs to a project)
  project: {
    id: string;
    title: string;
    owner_id: string | null;
    accountable_id: string | null;
  } | null;
}
```

**API calls to assemble:**

| Data | Endpoint | Notes |
|---|---|---|
| Issue detail | `GET /api/issues/:id` | Core payload |
| Children | `GET /api/issues/:id/children` | Sub-issues |
| History | `GET /api/issues/:id/history` | Field-level change log |
| Associations | `GET /api/documents/:id/associations` | Parent, project, sprint, program links |
| Sprint detail | `GET /api/weeks/:sprintId` | If sprint association exists |
| Project detail | `GET /api/projects/:projectId` | If project association exists |

### 4.2 Sprint/Week Context

```typescript
interface SprintContext {
  // Core sprint data
  sprint: {
    id: string;
    name: string;
    sprint_number: number;
    status: 'planning' | 'active' | 'completed';
    owner: { id: string; name: string; email: string } | null;
    owner_reports_to: string | null;
    days_remaining: number;
    plan: string | null;
    success_criteria: string[] | null;
    confidence: number | null;
  };

  // Plan snapshot for scope drift detection
  planSnapshot: {
    planned_issue_ids: string[] | null;
    snapshot_taken_at: string | null;
  };

  // Approval state
  approvals: {
    plan_approval: {
      state: 'approved' | 'changes_requested' | 'pending' | null;
      approved_by: string | null;
      approved_at: string | null;
      comment: string | null;
    } | null;
    review_approval: {
      state: 'approved' | 'changes_requested' | 'pending' | null;
    } | null;
    review_rating: number | null;  // OPM 5-level scale
  };

  // Issues in this sprint
  issues: Array<{
    id: string;
    title: string;
    state: string;
    priority: string;
    assignee_id: string | null;
    assignee_name: string | null;
    estimate: number | null;
    is_scope_addition: boolean;  // true if id NOT in planned_issue_ids
  }>;

  // Issue stats
  issueStats: {
    total: number;
    completed: number;
    in_progress: number;
    todo: number;
    cancelled: number;
    added_after_plan: number;
  };

  // Standups
  standups: Array<{
    id: string;
    date: string;
    author_id: string;
    author_name: string;
    content_summary: string;
  }>;

  // Activity
  activity: Array<{ date: string; count: number }>;

  // Program and project chain
  program: { id: string; name: string } | null;
  project: { id: string; title: string; owner_id: string | null; accountable_id: string | null } | null;
}
```

**API calls to assemble:**

| Data | Endpoint |
|---|---|
| Sprint detail + approvals | `GET /api/weeks/:id` or from `GET /api/weeks` list |
| Sprint issues | `GET /api/issues?sprint_id=X` |
| Standup context | `GET /api/claude/context?context_type=standup&sprint_id=X` |
| Review context | `GET /api/claude/context?context_type=review&sprint_id=X` |
| Sprint activity | `GET /api/activity/sprint/:id` |
| Standups for range | `GET /api/standups?date_from=X&date_to=Y` |

### 4.3 Project Context

```typescript
interface ProjectContext {
  // Core project data
  project: {
    id: string;
    title: string;
    inferred_status: 'active' | 'planned' | 'completed' | 'backlog' | 'archived';
    plan: string | null;
    target_date: string | null;
    // ICE scoring
    impact: number | null;
    confidence: number | null;
    ease: number | null;
    ice_score: number | null;
  };

  // RACI
  ownership: {
    owner_id: string | null;       // R: Responsible
    accountable_id: string | null; // A: Accountable (approver)
    consulted_ids: string[];       // C: Consulted
    informed_ids: string[];        // I: Informed
  };

  // Approvals
  approvals: {
    plan_approval: string | null;
    retro_approval: string | null;
    has_design_review: boolean | null;
  };

  // Active sprints under this project
  sprints: Array<{
    id: string;
    sprint_number: number;
    status: string;
    issue_count: number;
    completed_count: number;
    has_plan: boolean;
    has_retro: boolean;
    plan_approval: unknown;
    review_approval: unknown;
  }>;

  // Accountability action items
  actionItems: Array<{
    type: string;           // AccountabilityType
    targetId: string;
    message: string;
    days_overdue: number;
  }>;

  // Risk signals (from FleetGraph's own detection)
  activeSignals: FleetGraphSignal[];

  // Activity heatmap (30 days)
  activity: Array<{ date: string; count: number }>;

  // Team members involved (resolved from RACI + sprint owners + assignees)
  teamMembers: Array<{
    userId: string;
    name: string;
    role: string;
  }>;
}
```

**API calls to assemble:**

| Data | Endpoint |
|---|---|
| Project detail | `GET /api/projects/:id` |
| Project sprints | `GET /api/weeks` filtered by project association |
| Project activity | `GET /api/activity/project/:id` |
| Accountability items | `GET /api/accountability/action-items` |
| Retro context | `GET /api/claude/context?context_type=retro&project_id=X` |
| Workspace members | `GET /api/workspaces/:id/members` |

## 5. Role-Based Behavior

### 5.1 Role Detection

```typescript
type FleetGraphRole = 'engineer' | 'pm' | 'director';

/**
 * Infer the user's effective role from Ship data.
 * Ship does not have an explicit "role" field on users.
 * We infer from workspace membership role + relationship to entities.
 */
function inferRole(
  actorUserId: string,
  entity: { type: string; id: string },
  context: IssueContext | SprintContext | ProjectContext
): FleetGraphRole {
  // Director: user is accountable_id on the project, or has reports_to relationships
  if ('project' in context && context.project) {
    if (context.project.accountable_id === actorUserId) return 'director';
  }
  if ('ownership' in context) {
    if (context.ownership.accountable_id === actorUserId) return 'director';
  }

  // PM: user is sprint owner or project owner
  if ('sprint' in context && context.sprint?.owner?.id === actorUserId) return 'pm';
  if ('project' in context && context.project?.owner_id === actorUserId) return 'pm';

  // Engineer: user is issue assignee, or default
  return 'engineer';
}
```

### 5.2 Output Adaptation

```typescript
interface RoleOutputConfig {
  /** Which signals to prioritize in the response */
  signalPriority: SignalType[];
  /** How much context to include */
  contextDepth: 'issue' | 'sprint' | 'project';
  /** What kind of recommendations to generate */
  recommendationStyle: 'tactical' | 'planning' | 'strategic';
  /** Maximum number of signals to surface at once */
  maxSignals: number;
}

const ROLE_OUTPUT_CONFIGS: Record<FleetGraphRole, RoleOutputConfig> = {
  engineer: {
    signalPriority: ['stale_in_progress', 'missing_standup', 'scope_drift'],
    contextDepth: 'issue',
    recommendationStyle: 'tactical',
    maxSignals: 3,
    // Tone: "Issue #42 has been in-progress for 4 days with no updates.
    //        Consider: splitting it, flagging a blocker, or moving to review."
  },
  pm: {
    signalPriority: ['scope_drift', 'approval_bottleneck', 'missing_standup', 'stale_in_progress'],
    contextDepth: 'sprint',
    recommendationStyle: 'planning',
    maxSignals: 5,
    // Tone: "Week 12 has 3 issues added after plan lock. 2 standups missing this week.
    //        Plan approval still pending from Friday. Consider nudging the approver."
  },
  director: {
    signalPriority: ['risk_cluster', 'ownership_gap', 'approval_bottleneck'],
    contextDepth: 'project',
    recommendationStyle: 'strategic',
    maxSignals: 3,
    // Tone: "Project Alpha has 4 active risk signals across 2 sprints: stale work,
    //        scope drift, and a missing accountable. Recommend a check-in with the
    //        project owner this week."
  },
};
```

### 5.3 Response Format Per Role

**Engineer view:**
- Lead with the specific issue and its current state
- Show the concrete blocker or gap
- Suggest 2 to 3 tactical next actions (unblock, split, escalate, or close)
- Evidence: issue history, time-since-progress, related sub-issues

**PM view:**
- Lead with sprint health summary (issues done vs. planned, standup coverage)
- Show scope delta since plan lock
- Highlight approval bottlenecks affecting the sprint
- Suggest coordination actions (remind, rebalance, escalate)
- Evidence: sprint stats, scope diff, approval timeline

**Director view:**
- Lead with project-level risk brief
- Synthesize across sprints (multi-sprint trends)
- Highlight ownership and accountability gaps
- Suggest strategic actions (reassign attention, schedule review, hold)
- Evidence: risk cluster components, activity trends, RACI gaps

## 6. Noise Control Policy

### 6.1 Alert Fingerprinting

```typescript
/**
 * Each alert gets a deterministic fingerprint based on its structural identity.
 * Same fingerprint = same underlying condition. Used for dedup, dismiss, and snooze.
 */
function computeAlertFingerprint(signal: FleetGraphSignal): string {
  // Components that define the identity of a condition:
  const components = [
    signal.signalType,          // e.g., 'stale_in_progress'
    signal.entityType,          // e.g., 'issue'
    signal.entityId,            // e.g., 'uuid-of-issue'
    signal.affectedUserId ?? 'none',  // who is responsible
  ];

  // Hash to fixed-length fingerprint
  return crypto
    .createHash('sha256')
    .update(components.join('::'))
    .digest('hex')
    .substring(0, 16);
}
```

### 6.2 Dismiss/Snooze State Machine

```
                                 +---> DISMISSED (permanent for this fingerprint)
                                 |         |
    NEW ---> ACTIVE ---> NOTIFIED ---+     |  (entity state materially changes)
              ^                  |   |     v
              |                  |   +---> SNOOZED ---(expiry or state change)--->  ACTIVE
              |                  |
              |                  +---> RESOLVED (underlying condition no longer true)
              |                             |
              +-----------------------------+  (condition recurs)
```

```typescript
interface PersistedAlertState {
  fingerprint: string;
  signalType: string;
  entityId: string;
  status: 'active' | 'notified' | 'dismissed' | 'snoozed' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  sweepCount: number;
  notifiedAt: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  escalationSent: boolean;
  escalationTarget: NotificationTarget | null;
  entityDigest: string;  // Hash of relevant entity state for change detection
}
```

### 6.3 Cool-Down Periods

| Transition | Cool-down | Notes |
|---|---|---|
| NOTIFIED -> re-notify same target | 4 hours minimum | Do not re-ping for the same condition |
| SNOOZED -> ACTIVE | `snoozedUntil` expiry | Respect user's snooze duration |
| RESOLVED -> ACTIVE (recurrence) | 24 hours minimum | Prevent flapping alerts |
| Escalation notification | 1 business day after primary | Give primary target time to act |

### 6.4 Progressive Escalation Rules

```typescript
async function evaluateEscalation(
  alertState: PersistedAlertState,
  escalationChain: EscalationChain,
  policy: EscalationPolicy
): Promise<'hold' | 'escalate'> {
  // Rule 1: Repeated signal across sweeps
  if (alertState.sweepCount >= policy.sweepCountThreshold) {
    return 'escalate';
  }

  // Rule 2: No action after business day threshold
  if (alertState.notifiedAt) {
    const daysSinceNotify = businessDaysBetween(alertState.notifiedAt, now());
    if (daysSinceNotify >= policy.noActionBusinessDays) {
      return 'escalate';
    }
  }

  // Rule 3: Multi-signal cluster on same project
  // (handled at the risk_cluster level, not per-signal)

  return 'hold';
}
```

### 6.5 Entity Digest for Change Detection

```typescript
/**
 * Compute a digest of the entity state relevant to a specific signal.
 * If the digest changes, the alert condition has materially changed
 * and should be re-evaluated (even if dismissed).
 */
function computeEntityDigest(signal: FleetGraphSignal, entityData: unknown): string {
  let digestInput: string;

  switch (signal.signalType) {
    case 'stale_in_progress':
      // Digest changes when issue state, assignee, or latest history entry changes
      const issue = entityData as IssueContext['issue'];
      digestInput = `${issue.state}::${issue.assignee_id}::${issue.updated_at}`;
      break;

    case 'scope_drift':
      // Digest changes when the issue set changes
      const sprint = entityData as SprintContext;
      digestInput = sprint.issues.map(i => i.id).sort().join(',');
      break;

    case 'approval_bottleneck':
      // Digest changes when approval state changes
      const approvals = entityData as SprintContext['approvals'];
      digestInput = JSON.stringify(approvals);
      break;

    default:
      digestInput = JSON.stringify(entityData);
  }

  return crypto.createHash('sha256').update(digestInput).digest('hex').substring(0, 16);
}
```

## 7. Edge Cases and Failure Modes

### 7.1 No Owner Assigned to a Project

**Behavior:**
- `detectOwnershipGaps` emits a `missing_owner` signal with `severity: 'high'`
- Notification routing falls back to workspace admin (the `FALLBACK_WORKSPACE_ADMIN` constant)
- The insight card explains: "This project has no owner. FleetGraph cannot route signals to a responsible person."
- Risk cluster calculation still includes the project; ownership gap counts toward the cluster score

**Implementation:**

```typescript
// In resolveNotificationTargets for project-level signals:
if (!project.owner_id && !project.accountable_id) {
  // Fallback: find workspace admins
  const members = await fetch(`GET /api/workspaces/${workspaceId}/members`);
  const admins = members.filter(m => m.role === 'admin');

  if (admins.length > 0) {
    return {
      primary: {
        userId: admins[0].id,
        name: admins[0].name,
        role: 'admin_fallback',
        reason: 'No project owner or accountable. Routing to workspace admin.',
      },
      escalation: null,
      escalationTrigger: null,
    };
  }

  // No admins found: log to trace, do not notify
  logger.warn('No notification target available', { projectId: project.id });
  return NO_TARGET;
}
```

### 7.2 Workspace Has Only One Member

**Behavior:**
- Escalation chain collapses: primary and escalation target are the same person
- Escalation is suppressed (no point notifying the same person twice)
- All signals still fire, but `escalationTarget` is `null`
- Risk clusters still aggregate

**Implementation:**

```typescript
if (escalationChain.primary.userId === escalationChain.escalation?.userId) {
  escalationChain.escalation = null;
  escalationChain.escalationTrigger = null;
}
```

### 7.3 Sprint Has No Issues

**Behavior:**
- `detectStaleIssues` returns empty (no candidates)
- `detectScopeDrift` returns `null` (nothing to compare)
- `detectMissingStandups` returns empty (no assignees derived from issues)
- `detectOwnershipGaps` may still fire if sprint has no owner
- Net: mostly silent sprint. The one useful signal is "sprint has no issues" if the sprint is active.

**Implementation:**

```typescript
// Special case: active sprint with zero issues
if (isSprintActive(sprint) && sprint.issue_count === 0) {
  signals.push({
    signalType: 'ownership_gap',
    entityType: 'sprint',
    entityId: sprint.id,
    severity: 'medium',
    evidence: {
      gap: 'empty_active_sprint',
      message: `Week ${sprint.sprint_number} is active but has no issues. ` +
               `This may indicate planning was not completed.`
    }
  });
}
```

### 7.4 All Issues Are in "Done" State

**Behavior:**
- `detectStaleIssues` returns empty (only checks `in_progress`)
- `detectMissingStandups` may still fire if standup window has not passed
- Sprint is effectively complete; FleetGraph should recognize this
- On-demand mode: respond with a sprint health summary showing 100% completion
- No risk signals expected; clean run logged

**Implementation:**

```typescript
// In heuristic_filter node:
if (sprintContext.issueStats.completed === sprintContext.issueStats.total &&
    sprintContext.issueStats.total > 0) {
  // Sprint fully complete. Only check for missing review/retro.
  return filterToPostCompletionChecks(candidates);
}
```

### 7.5 User Is Not on the Project They're Viewing

**Behavior:**
- On-demand mode still works (user can ask about any visible entity)
- Notification routing does NOT target the viewing user (they are not responsible)
- Context assembly proceeds normally using the entity's data
- Role inference defaults to the most neutral role (`engineer`)
- Recommendations are framed as informational, not action-oriented

**Implementation:**

```typescript
// In on-demand trigger_context node:
const isProjectMember = [
  projectContext.ownership.owner_id,
  projectContext.ownership.accountable_id,
  ...projectContext.ownership.consulted_ids,
  ...projectContext.ownership.informed_ids,
].includes(actorUserId);

// Adjust output framing
const outputMode = isProjectMember ? 'actionable' : 'informational';
```

### 7.6 Ship API Call Fails Mid-Run

**Behavior (from PRESEARCH):**
- Proactive mode: skip alerting on uncertain data, retry on next sweep
- On-demand mode: answer with partial context, clearly labeled incomplete
- All failures traced in LangSmith with the `error_fallback` branch

**Implementation:**

```typescript
async function fetchWithFallback<T>(
  endpoint: string,
  fallbackValue: T,
  traceId: string
): Promise<{ data: T; partial: boolean }> {
  try {
    const data = await fetch(endpoint);
    return { data, partial: false };
  } catch (error) {
    logger.error(`FleetGraph fetch failed: ${endpoint}`, { error, traceId });

    // Tag in LangSmith trace
    traceMetadata.addTag('fetch_error', endpoint);

    return { data: fallbackValue, partial: true };
  }
}
```

### 7.7 Alert State Corruption or Cold Start

**Behavior:**
- If `fleetgraph_alert_state` table is empty (cold start), all signals are treated as new
- Dedupe starts fresh; users may see one-time re-notification of existing conditions
- Entity digest cache is rebuilt from scratch on next sweep
- This is acceptable: over-alerting once is better than silently missing real drift

### 7.8 Concurrent Sweep and On-Demand Run

**Behavior:**
- Both runs operate on their own copy of `FleetGraphState`
- Alert state writes use optimistic concurrency (last-write-wins on `lastSeenAt`)
- If both produce the same alert, the second write updates `lastSeenAt` harmlessly
- Notification dedup prevents double-delivery (cool-down period check)

### 7.9 Sprint Number Calculation Edge Cases

The sprint number is derived from `workspace.sprint_start_date` + 7-day duration. Edge cases:

```typescript
// From weeks.ts: sprint date calculation
const daysSinceStart = Math.floor(
  (today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24)
);
const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;
```

- If `workspace.sprint_start_date` is in the future: `currentSprintNumber` could be <= 0. Floor to 1.
- If workspace is brand new with no sprints created: sweep finds nothing, logs clean run.
- Timezone: all dates are normalized to UTC midnight to prevent drift.
