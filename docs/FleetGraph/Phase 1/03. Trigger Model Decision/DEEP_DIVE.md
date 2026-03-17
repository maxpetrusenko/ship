# Trigger Model Decision: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Engineering implementation guide for FleetGraph's hybrid trigger model.

Companion to `README.md` (decision rationale) and `PRESEARCH.md` (section 3).

---

## Table of Contents

1. [Event-Triggered Pipeline](#1-event-triggered-pipeline)
2. [Sweep Scheduler](#2-sweep-scheduler)
3. [Candidate Queue](#3-candidate-queue)
4. [Threshold Configuration](#4-threshold-configuration)
5. [Scale Analysis](#5-scale-analysis)
6. [Comparison: Poll vs Webhook vs Hybrid](#6-comparison-poll-vs-webhook-vs-hybrid)
7. [Monitoring and Observability](#7-monitoring-and-observability)

---

## 1. Event-Triggered Pipeline

### 1.1 Write Endpoints That Should Trigger FleetGraph

Every Ship REST write path that can change execution state should emit a `FleetGraphCandidate`. The following table is derived from the actual route files in `api/src/routes/`.

| Route File | Endpoint | Signal Type | Why It Matters |
|---|---|---|---|
| `issues.ts` | `POST /api/issues` | `issue_created` | New work entering a sprint after snapshot = scope drift |
| `issues.ts` | `PATCH /api/issues/:id` | `issue_updated` | State change, reassignment, priority shift, estimate change, sprint association change |
| `issues.ts` | `POST /api/issues/:id/accept` | `issue_state_change` | Issue leaving triage = planning signal |
| `issues.ts` | `POST /api/issues/:id/reject` | `issue_state_change` | Rejected triage item = capacity signal |
| `issues.ts` | `POST /api/issues/bulk` | `bulk_issue_update` | Batch state/sprint/assignee changes = planning event |
| `weeks.ts` | `POST /api/weeks` | `sprint_created` | New sprint = planning cycle start |
| `weeks.ts` | `PATCH /api/weeks/:id` | `sprint_updated` | Sprint metadata or property change |
| `weeks.ts` | `POST /api/weeks/:id/start` | `sprint_started` | Sprint activation = snapshot point |
| `weeks.ts` | `PATCH /api/weeks/:id/plan` | `sprint_plan_updated` | Plan content change = planning signal |
| `weeks.ts` | `POST /api/weeks/:id/standups` | `standup_submitted` | Standup posted = accountability signal |
| `weeks.ts` | `POST /api/weeks/:id/review` | `review_submitted` | Review created = sprint close signal |
| `weeks.ts` | `PATCH /api/weeks/:id/review` | `review_updated` | Review content change |
| `weeks.ts` | `POST /api/weeks/:id/carryover` | `issue_carryover` | Issue moved to next sprint = planning failure signal |
| `weeks.ts` | `POST /api/weeks/:id/approve-plan` | `approval_change` | Plan approved = bottleneck cleared |
| `weeks.ts` | `POST /api/weeks/:id/unapprove-plan` | `approval_change` | Approval revoked = re-review needed |
| `weeks.ts` | `POST /api/weeks/:id/approve-review` | `approval_change` | Review approved = sprint formally closed |
| `weeks.ts` | `POST /api/weeks/:id/request-plan-changes` | `approval_change` | Changes requested = approval bottleneck |
| `weeks.ts` | `POST /api/weeks/:id/request-retro-changes` | `approval_change` | Retro changes requested |
| `projects.ts` | `POST /api/projects` | `project_created` | New project = ownership check candidate |
| `projects.ts` | `PATCH /api/projects/:id` | `project_updated` | Project property change |
| `projects.ts` | `POST /api/projects/:id/retro` | `retro_submitted` | Project retro = review signal |
| `projects.ts` | `PATCH /api/projects/:id/retro` | `retro_updated` | Retro content change |
| `projects.ts` | `POST /api/projects/:id/approve-plan` | `approval_change` | Project plan approved |
| `projects.ts` | `POST /api/projects/:id/approve-retro` | `approval_change` | Project retro approved |
| `projects.ts` | `POST /api/projects/:id/sprints` | `sprint_created` | Sprint created under project |
| `standups.ts` | `POST /api/standups` | `standup_submitted` | Standalone standup posted |
| `standups.ts` | `PATCH /api/standups/:id` | `standup_updated` | Standup content edited |
| `documents.ts` | `PATCH /api/documents/:id` | `document_updated` | Generic document property change (visibility, resubmission) |
| `documents.ts` | `POST /api/documents/:id/convert` | `document_converted` | Issue converted to project/other type |

### 1.2 Event Normalization Type

Every write endpoint normalizes its change into one `FleetGraphCandidate` before entering the queue.

```ts
/** Normalized event emitted by any Ship write endpoint. */
interface FleetGraphCandidate {
  /** What kind of entity changed. */
  entityType: 'issue' | 'sprint' | 'project' | 'standup' | 'document';

  /** Primary key of the changed entity. */
  entityId: string;

  /** Workspace scope. */
  workspaceId: string;

  /** Classification of the change. */
  signalType:
    | 'issue_created'
    | 'issue_updated'
    | 'issue_state_change'
    | 'bulk_issue_update'
    | 'issue_carryover'
    | 'sprint_created'
    | 'sprint_started'
    | 'sprint_updated'
    | 'sprint_plan_updated'
    | 'standup_submitted'
    | 'standup_updated'
    | 'review_submitted'
    | 'review_updated'
    | 'retro_submitted'
    | 'retro_updated'
    | 'approval_change'
    | 'project_created'
    | 'project_updated'
    | 'document_updated'
    | 'document_converted';

  /** When the event occurred. */
  timestamp: number;

  /** Origin of this candidate. */
  source: 'event' | 'sweep';

  /** Freeform payload for signal-specific data. */
  metadata: Record<string, unknown>;
}
```

Example metadata shapes:

```ts
// issue_updated
{
  changedFields: ['state', 'assignee_id'],
  oldState: 'in_progress',
  newState: 'done',
  sprintId: '...',
  actorUserId: '...',
}

// approval_change
{
  approvalTarget: 'plan' | 'review' | 'retro',
  approvalState: 'approved' | 'changes_requested' | 'revoked',
  sprintId: '...',
  approvedBy: '...',
}

// issue_carryover
{
  sourceSprintId: '...',
  targetSprintId: '...',
  issueIds: ['...'],
}
```

### 1.3 Hook Points in Existing Code

Ship already uses `broadcastToUser(userId, 'accountability:updated', payload)` after many write operations. FleetGraph hooks should sit alongside those calls, not replace them.

**Implementation pattern:**

```ts
// api/src/fleetgraph/emitter.ts
import { EventEmitter } from 'node:events';

export const fleetGraphBus = new EventEmitter();
fleetGraphBus.setMaxListeners(50); // one per route file + scheduler

export function emitFleetGraphCandidate(candidate: FleetGraphCandidate): void {
  fleetGraphBus.emit('candidate', candidate);
}
```

**Hook insertion example (issues.ts PATCH handler, after line ~1030):**

```ts
// After: broadcastToUser(assigneeId, 'accountability:updated', { ... });
// Add:
emitFleetGraphCandidate({
  entityType: 'issue',
  entityId: id,
  workspaceId,
  signalType: isClosingIssue ? 'issue_state_change' : 'issue_updated',
  timestamp: Date.now(),
  source: 'event',
  metadata: {
    changedFields: changes.map(c => c.field),
    oldState: currentProps.state,
    newState: data.state,
    actorUserId: req.userId,
  },
});
```

### 1.4 Event Bus Design Decision

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `EventEmitter` (in-process) | Zero deps, instant delivery, easy to test | Lost on crash, no persistence | **MVP choice** |
| Database-backed queue | Durable, survives restart | Extra writes, latency, complexity | Post-MVP |
| Redis/BullMQ | Fast, durable, backpressure built in | External dependency | Post-MVP |
| Direct function call | Simplest possible | No decoupling, hard to test | Too rigid |

**MVP:** Use `EventEmitter`. The sweep scheduler already covers missed events. If the process crashes between event emission and graph invocation, the next 4-minute sweep catches it.

### 1.5 Debouncing

Rapid edits to the same entity (a user updating issue title, then state, then priority in quick succession) should not fire three separate graph invocations.

```ts
// api/src/fleetgraph/debouncer.ts

interface PendingCandidate {
  candidate: FleetGraphCandidate;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCandidate>();
const DEBOUNCE_MS = 3_000; // 3 seconds

function candidateKey(c: FleetGraphCandidate): string {
  return `${c.workspaceId}:${c.entityType}:${c.entityId}`;
}

/**
 * Debounce candidates by entity. If multiple events fire for the same
 * entity within DEBOUNCE_MS, only the latest one is forwarded to the
 * candidate queue. Metadata from earlier events is merged.
 */
export function debouncedEmit(
  candidate: FleetGraphCandidate,
  onReady: (merged: FleetGraphCandidate) => void
): void {
  const key = candidateKey(candidate);
  const existing = pending.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    // Merge metadata: accumulate changed fields
    const mergedMeta = {
      ...existing.candidate.metadata,
      ...candidate.metadata,
    };
    if (Array.isArray(existing.candidate.metadata.changedFields)
        && Array.isArray(candidate.metadata.changedFields)) {
      mergedMeta.changedFields = [
        ...new Set([
          ...existing.candidate.metadata.changedFields as string[],
          ...candidate.metadata.changedFields as string[],
        ]),
      ];
    }
    candidate = { ...candidate, metadata: mergedMeta };
  }

  const timer = setTimeout(() => {
    pending.delete(key);
    onReady(candidate);
  }, DEBOUNCE_MS);

  pending.set(key, { candidate, timer });
}
```

### 1.6 Event-Triggered Timing Diagram

```
User edits issue title              t=0ms
  |
  +-- POST response returns         t=50ms
  |
  +-- emitFleetGraphCandidate()     t=51ms
  |
  +-- debouncer starts 3s timer     t=51ms
  |
User changes issue state            t=800ms
  |
  +-- debouncer resets timer         t=801ms
  |
  +-- 3s elapses, no more edits     t=3801ms
  |
  +-- merged candidate -> queue     t=3802ms
  |
  +-- heuristic_filter (determ.)    t=3810ms
  |
  +-- if candidate: LLM reasoning   t=3900ms ... t=5500ms
  |
  +-- deliver_alert                 t=5600ms
  |
  Total: ~5.6s from first edit (well under 5 min SLA)
```

---

## 2. Sweep Scheduler

### 2.1 Interval and Rationale

The sweep runs every **240 seconds** (4 minutes).

Why 240s and not 300s:
- The assignment SLA is "< 5 minutes" from condition to alert
- A sweep that starts at t=0 must finish fetch + heuristic + LLM + delivery before t=300s
- 240s start + ~45s processing = ~285s worst case, leaving 15s margin

### 2.2 What the Sweep Enumerates

```
For each active workspace:
  For each active sprint (current sprint number +/- 1):
    1. Missing standup check
       - Enumerate workspace members assigned to this sprint
       - Query standup documents for today's date
       - Flag members with no standup after expected window

    2. Stale in-progress issues
       - Query issues with state='in_progress' in this sprint
       - Check document_history for last meaningful change
       - Flag issues exceeding the staleness threshold

    3. Sprint scope drift
       - Compare current sprint issue set against plan snapshot
       - Flag any issues added after sprint start

    4. Approval bottlenecks
       - Read plan_approval and review_approval from sprint properties
       - Flag approvals in 'pending' or 'changes_requested' exceeding threshold

    5. RACI/ownership gaps
       - Check sprint owner_id, project accountable_id
       - Flag sprints or projects with null ownership fields

    6. Risk clustering (aggregation pass)
       - Count signals per project
       - Flag projects with >= 3 independent weak signals
```

### 2.3 TypeScript Implementation

```ts
// api/src/fleetgraph/sweep.ts

import { pool } from '../db/client.js';
import type { FleetGraphCandidate } from './types.js';

/** Advisory lock key for sweep exclusion. Derived from 'fleetgraph-sweep'. */
const SWEEP_LOCK_KEY = 0x466C656574; // 'Fleet' as hex

interface SweepResult {
  candidates: FleetGraphCandidate[];
  durationMs: number;
  workspacesScanned: number;
  issuesScanned: number;
  errors: string[];
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let sweepRunning = false;

/**
 * Start the sweep scheduler. Idempotent.
 */
export function startSweepScheduler(
  onCandidates: (candidates: FleetGraphCandidate[]) => void,
  intervalMs: number = 240_000
): void {
  if (sweepInterval) return;

  // Run immediately on startup, then every intervalMs
  runSweep(onCandidates);

  sweepInterval = setInterval(() => {
    runSweep(onCandidates);
  }, intervalMs);

  console.log(`[FleetGraph] Sweep scheduler started (interval=${intervalMs}ms)`);
}

/**
 * Stop the sweep scheduler. Safe to call multiple times.
 */
export function stopSweepScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log('[FleetGraph] Sweep scheduler stopped');
  }
}

/**
 * Execute one sweep cycle. Uses pg_try_advisory_lock to prevent
 * concurrent sweeps in multi-instance deployments.
 */
async function runSweep(
  onCandidates: (candidates: FleetGraphCandidate[]) => void
): Promise<void> {
  if (sweepRunning) {
    console.log('[FleetGraph] Sweep already running, skipping');
    return;
  }

  sweepRunning = true;
  const startTime = Date.now();
  const result: SweepResult = {
    candidates: [],
    durationMs: 0,
    workspacesScanned: 0,
    issuesScanned: 0,
    errors: [],
  };

  const client = await pool.connect();

  try {
    // Try advisory lock. If another instance holds it, skip this cycle.
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [SWEEP_LOCK_KEY]
    );

    if (!lockResult.rows[0]?.acquired) {
      console.log('[FleetGraph] Another instance holds sweep lock, skipping');
      return;
    }

    try {
      // 1. Enumerate active workspaces
      const workspaces = await client.query(
        `SELECT id, sprint_start_date FROM workspaces
         WHERE deleted_at IS NULL`
      );

      for (const ws of workspaces.rows) {
        result.workspacesScanned++;

        try {
          const wsCandidates = await sweepWorkspace(client, ws.id, ws.sprint_start_date);
          result.candidates.push(...wsCandidates.candidates);
          result.issuesScanned += wsCandidates.issuesScanned;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`workspace=${ws.id}: ${msg}`);
        }
      }
    } finally {
      // Always release the advisory lock
      await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
    }

    result.durationMs = Date.now() - startTime;

    console.log(
      `[FleetGraph] Sweep complete: ${result.candidates.length} candidates, ` +
      `${result.workspacesScanned} workspaces, ${result.issuesScanned} issues, ` +
      `${result.durationMs}ms, ${result.errors.length} errors`
    );

    if (result.candidates.length > 0) {
      onCandidates(result.candidates);
    }
  } catch (err) {
    console.error('[FleetGraph] Sweep fatal error:', err);
  } finally {
    client.release();
    sweepRunning = false;
  }
}

/**
 * Sweep a single workspace. Returns candidates discovered.
 */
async function sweepWorkspace(
  client: import('pg').PoolClient,
  workspaceId: string,
  sprintStartDate: Date
): Promise<{ candidates: FleetGraphCandidate[]; issuesScanned: number }> {
  const candidates: FleetGraphCandidate[] = [];
  let issuesScanned = 0;
  const now = Date.now();

  // Calculate current sprint number
  const startDate = new Date(sprintStartDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysSinceStart = Math.floor(
    (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const currentSprintNumber = Math.floor(daysSinceStart / 7) + 1;

  // Get active sprints (current and previous, to catch late reviews)
  const sprintsResult = await client.query(
    `SELECT id, title, properties FROM documents
     WHERE workspace_id = $1
       AND document_type = 'sprint'
       AND (properties->>'sprint_number')::int BETWEEN $2 AND $3
       AND deleted_at IS NULL`,
    [workspaceId, Math.max(1, currentSprintNumber - 1), currentSprintNumber]
  );

  for (const sprint of sprintsResult.rows) {
    const props = sprint.properties || {};
    const sprintNumber = parseInt(props.sprint_number, 10);
    const isCurrentSprint = sprintNumber === currentSprintNumber;

    // --- Check 1: Missing standups (current sprint only) ---
    if (isCurrentSprint) {
      const missingStandups = await checkMissingStandups(
        client, workspaceId, sprint.id, today
      );
      candidates.push(...missingStandups.map(userId => ({
        entityType: 'sprint' as const,
        entityId: sprint.id,
        workspaceId,
        signalType: 'standup_submitted' as const,  // absence of standup
        timestamp: now,
        source: 'sweep' as const,
        metadata: { missingUserId: userId, date: today.toISOString().split('T')[0] },
      })));
    }

    // --- Check 2: Stale in-progress issues ---
    const staleIssues = await checkStaleIssues(client, workspaceId, sprint.id);
    issuesScanned += staleIssues.totalScanned;
    candidates.push(...staleIssues.stale.map(issue => ({
      entityType: 'issue' as const,
      entityId: issue.id,
      workspaceId,
      signalType: 'issue_updated' as const,
      timestamp: now,
      source: 'sweep' as const,
      metadata: {
        staleDays: issue.staleDays,
        sprintId: sprint.id,
        lastActivityAt: issue.lastActivityAt,
      },
    })));

    // --- Check 3: Sprint scope drift ---
    if (isCurrentSprint && props.started_at) {
      const driftIssues = await checkScopeDrift(
        client, workspaceId, sprint.id, props.started_at
      );
      candidates.push(...driftIssues.map(issueId => ({
        entityType: 'sprint' as const,
        entityId: sprint.id,
        workspaceId,
        signalType: 'issue_created' as const,
        timestamp: now,
        source: 'sweep' as const,
        metadata: { driftIssueId: issueId, sprintId: sprint.id },
      })));
    }

    // --- Check 4: Approval bottlenecks ---
    const approvalCandidates = checkApprovalBottlenecks(sprint, now);
    candidates.push(...approvalCandidates);
  }

  return { candidates, issuesScanned };
}

// --- Individual check implementations (stubs with SQL) ---

async function checkMissingStandups(
  client: import('pg').PoolClient,
  workspaceId: string,
  sprintId: string,
  today: Date
): Promise<string[]> {
  const todayStr = today.toISOString().split('T')[0];

  // Get all users assigned to issues in this sprint
  const assignedResult = await client.query(
    `SELECT DISTINCT (i.properties->>'assignee_id') AS user_id
     FROM documents i
     JOIN document_associations da ON da.document_id = i.id
     WHERE da.related_id = $1 AND da.relationship_type = 'sprint'
       AND i.document_type = 'issue' AND i.workspace_id = $2
       AND (i.properties->>'assignee_id') IS NOT NULL
       AND i.properties->>'state' NOT IN ('done', 'cancelled')`,
    [sprintId, workspaceId]
  );

  const assignedUserIds = assignedResult.rows.map(r => r.user_id).filter(Boolean);
  if (assignedUserIds.length === 0) return [];

  // Check which of those users have posted a standup today
  const postedResult = await client.query(
    `SELECT DISTINCT (properties->>'author_id') AS user_id
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'standup'
       AND (properties->>'date') = $2
       AND deleted_at IS NULL`,
    [workspaceId, todayStr]
  );

  const postedUserIds = new Set(postedResult.rows.map(r => r.user_id));
  return assignedUserIds.filter(uid => !postedUserIds.has(uid));
}

async function checkStaleIssues(
  client: import('pg').PoolClient,
  workspaceId: string,
  sprintId: string
): Promise<{ totalScanned: number; stale: Array<{ id: string; staleDays: number; lastActivityAt: string }> }> {
  const STALE_THRESHOLD_DAYS = 3; // configurable per workspace later

  const issuesResult = await client.query(
    `SELECT i.id, i.updated_at,
            COALESCE(
              (SELECT MAX(h.created_at) FROM document_history h WHERE h.document_id = i.id),
              i.updated_at
            ) AS last_activity_at
     FROM documents i
     JOIN document_associations da ON da.document_id = i.id
     WHERE da.related_id = $1 AND da.relationship_type = 'sprint'
       AND i.document_type = 'issue' AND i.workspace_id = $2
       AND i.properties->>'state' = 'in_progress'
       AND i.deleted_at IS NULL`,
    [sprintId, workspaceId]
  );

  const now = new Date();
  const stale = issuesResult.rows
    .map(row => {
      const lastActivity = new Date(row.last_activity_at);
      const diffMs = now.getTime() - lastActivity.getTime();
      const staleDays = businessDaysBetween(lastActivity, now);
      return { id: row.id, staleDays, lastActivityAt: row.last_activity_at };
    })
    .filter(item => item.staleDays >= STALE_THRESHOLD_DAYS);

  return { totalScanned: issuesResult.rows.length, stale };
}

async function checkScopeDrift(
  client: import('pg').PoolClient,
  workspaceId: string,
  sprintId: string,
  sprintStartedAt: string
): Promise<string[]> {
  // Find issues associated with this sprint that were added after sprint start
  const result = await client.query(
    `SELECT da.document_id AS issue_id
     FROM document_associations da
     JOIN documents i ON i.id = da.document_id
     WHERE da.related_id = $1 AND da.relationship_type = 'sprint'
       AND i.document_type = 'issue' AND i.workspace_id = $2
       AND da.created_at > $3
       AND i.deleted_at IS NULL`,
    [sprintId, workspaceId, sprintStartedAt]
  );

  return result.rows.map(r => r.issue_id);
}

function checkApprovalBottlenecks(
  sprint: { id: string; properties: Record<string, unknown> },
  now: number
): FleetGraphCandidate[] {
  const candidates: FleetGraphCandidate[] = [];
  const props = sprint.properties || {};

  const checkApproval = (
    approval: { state?: string; approved_at?: string } | undefined,
    target: string
  ) => {
    if (!approval) return;
    if (approval.state === 'pending' || approval.state === 'changes_requested') {
      const approvalAge = approval.approved_at
        ? businessDaysBetween(new Date(approval.approved_at), new Date(now))
        : Infinity;

      if (approvalAge >= 2) { // 2 business days threshold
        candidates.push({
          entityType: 'sprint',
          entityId: sprint.id,
          workspaceId: '', // filled by caller
          signalType: 'approval_change',
          timestamp: now,
          source: 'sweep',
          metadata: {
            approvalTarget: target,
            approvalState: approval.state,
            ageDays: approvalAge,
          },
        });
      }
    }
  };

  checkApproval(
    props.plan_approval as { state?: string; approved_at?: string } | undefined,
    'plan'
  );
  checkApproval(
    props.review_approval as { state?: string; approved_at?: string } | undefined,
    'review'
  );

  return candidates;
}
```

### 2.4 Crash Safety and Restartability

The sweep is stateless by design. If the process crashes mid-sweep:

1. The advisory lock is automatically released when the database connection closes
2. No partial state is persisted
3. The next sweep (on restart or from another instance) runs the full enumeration
4. Alert deduplication prevents double-delivery (see section 3.2)

No cleanup or recovery logic is needed. This is the primary advantage of keeping the sweep stateless.

### 2.5 Sweep Timing Diagram

```
t=0s     Sweep starts
         |
t=0.1s   pg_try_advisory_lock() -> acquired
         |
t=0.2s   Enumerate workspaces (1 query)
         |
t=0.5s   Workspace 1: enumerate active sprints (1 query)
         |
t=1.0s   Workspace 1, Sprint A: missing standups (2 queries)
t=1.5s   Workspace 1, Sprint A: stale issues (1 query)
t=2.0s   Workspace 1, Sprint A: scope drift (1 query)
t=2.1s   Workspace 1, Sprint A: approval bottlenecks (in-memory)
         |
t=3.0s   Workspace 1, Sprint B: repeat checks
         |
t=5.0s   All workspaces done. Release advisory lock.
         |
t=5.1s   Emit 12 candidates to queue
         |
t=5.2s   Deduplication removes 4 (already surfaced, unchanged)
         |
t=5.3s   8 candidates enter heuristic filter
         |
t=6.0s   3 pass heuristic -> invoke LLM
         |
t=12.0s  LLM returns assessments
         |
t=12.5s  Deliver 2 alerts (1 dismissed by severity threshold)
         |
         Total: ~12.5s (well within 240s budget)
```

---

## 3. Candidate Queue

### 3.1 Architecture

Both event-triggered and sweep-discovered candidates flow into a single in-memory queue before graph invocation.

```
  Event Triggers              Sweep Scheduler
       |                           |
       v                           v
  [debouncer]              [batch emission]
       |                           |
       +---------> Queue <---------+
                     |
                [deduplicator]
                     |
              [priority sorter]
                     |
              [graph invoker]
```

### 3.2 Deduplication

Before invoking the graph, deduplicate candidates against recently surfaced alerts.

```ts
// api/src/fleetgraph/deduplicator.ts

interface AlertFingerprint {
  entityType: string;
  entityId: string;
  signalType: string;
}

interface AlertRecord {
  fingerprint: string;
  lastSurfacedAt: number;
  lastEntityDigest: string;  // hash of relevant entity state
  snoozedUntil: number | null;
  dismissed: boolean;
}

/** In-memory for MVP. Move to DB table for persistence post-MVP. */
const alertHistory = new Map<string, AlertRecord>();

function fingerprintKey(fp: AlertFingerprint): string {
  return `${fp.entityType}:${fp.entityId}:${fp.signalType}`;
}

/**
 * Returns true if this candidate should be processed.
 * Returns false if it's a duplicate of an already-surfaced alert
 * for the same unchanged entity state.
 */
export function shouldProcess(
  candidate: FleetGraphCandidate,
  currentEntityDigest: string
): boolean {
  const key = fingerprintKey(candidate);
  const record = alertHistory.get(key);

  if (!record) return true;

  // Dismissed and entity state unchanged -> skip
  if (record.dismissed && record.lastEntityDigest === currentEntityDigest) {
    return false;
  }

  // Snoozed and not expired -> skip
  if (record.snoozedUntil && Date.now() < record.snoozedUntil) {
    return false;
  }

  // Entity state changed since last surface -> re-process
  if (record.lastEntityDigest !== currentEntityDigest) {
    return true;
  }

  // Same state, already surfaced within last sweep window -> skip
  const RESURFACE_COOLDOWN_MS = 240_000; // one sweep interval
  if (Date.now() - record.lastSurfacedAt < RESURFACE_COOLDOWN_MS) {
    return false;
  }

  return true;
}

export function recordSurfaced(
  candidate: FleetGraphCandidate,
  entityDigest: string
): void {
  const key = fingerprintKey(candidate);
  alertHistory.set(key, {
    fingerprint: key,
    lastSurfacedAt: Date.now(),
    lastEntityDigest: entityDigest,
    snoozedUntil: null,
    dismissed: false,
  });
}
```

### 3.3 Priority Ordering

Event-triggered candidates should be processed before sweep-discovered ones, because event-triggered signals have higher urgency (a human just did something).

```ts
// api/src/fleetgraph/queue.ts

const PRIORITY: Record<FleetGraphCandidate['source'], number> = {
  event: 0,   // highest
  sweep: 1,
};

const SIGNAL_BOOST: Partial<Record<FleetGraphCandidate['signalType'], number>> = {
  approval_change: -0.5,    // approvals are time-critical
  issue_state_change: -0.3, // state changes are immediate
  issue_carryover: -0.2,    // carryover is a planning event
};

function candidatePriority(c: FleetGraphCandidate): number {
  const base = PRIORITY[c.source];
  const boost = SIGNAL_BOOST[c.signalType] ?? 0;
  return base + boost;
}

/**
 * Sort candidates by priority (lower number = higher priority).
 * Within same priority, preserve insertion order (FIFO).
 */
export function sortByPriority(
  candidates: FleetGraphCandidate[]
): FleetGraphCandidate[] {
  return [...candidates].sort(
    (a, b) => candidatePriority(a) - candidatePriority(b)
  );
}
```

### 3.4 Backpressure Handling

If LLM calls are slow and candidates accumulate:

| Queue Size | Behavior |
|---|---|
| < 50 | Normal processing |
| 50-200 | Log warning, batch more aggressively |
| 200-500 | Drop sweep candidates, keep event candidates |
| > 500 | Drop all sweep candidates, throttle events to 1/entity |

```ts
const MAX_QUEUE_SIZE = 500;
const BACKPRESSURE_WARN = 50;
const BACKPRESSURE_DROP_SWEEP = 200;

export function applyBackpressure(
  queue: FleetGraphCandidate[]
): FleetGraphCandidate[] {
  if (queue.length <= BACKPRESSURE_WARN) return queue;

  if (queue.length > BACKPRESSURE_DROP_SWEEP) {
    // Keep only event-triggered candidates
    const eventOnly = queue.filter(c => c.source === 'event');

    if (eventOnly.length > MAX_QUEUE_SIZE) {
      // Deduplicate by entity, keep latest
      const byEntity = new Map<string, FleetGraphCandidate>();
      for (const c of eventOnly) {
        const key = `${c.entityType}:${c.entityId}`;
        byEntity.set(key, c); // last wins
      }
      return [...byEntity.values()];
    }

    return eventOnly;
  }

  // Between WARN and DROP_SWEEP: log but process all
  console.warn(`[FleetGraph] Queue backpressure: ${queue.length} candidates`);
  return queue;
}
```

### 3.5 MVP Queue Choice: In-Memory

For MVP, the queue is an in-memory array drained by the graph invoker. This is acceptable because:

- The sweep already acts as a catch-all for any lost events
- Alert state is persisted (dedup records survive in DB post-MVP)
- The queue is expected to be small (< 50 candidates per cycle)

Post-MVP, a database-backed queue (simple `fleetgraph_candidates` table) provides crash durability without adding Redis.

---

## 4. Threshold Configuration

### 4.1 Signal Thresholds

| Signal | Default Threshold | Unit | Business Logic |
|---|---|---|---|
| Missing standup | Same workday, after 11:00 AM workspace time | Calendar day | Only fires Mon-Fri. Checks if user has active sprint issues. Does not fire on weekends or holidays. |
| Stale in-progress issue | 3 business days | Business days | Counts Mon-Fri only. Ignores weekends. Measures from last `document_history` entry, not `updated_at`. |
| Approval bottleneck (plan) | 2 business days | Business days | Measures from `plan_approval.approved_at` or sprint creation if no approval action yet. |
| Approval bottleneck (review) | 2 business days | Business days | Measures from `review_approval.approved_at` or review submission. |
| Scope drift | Immediate | Event-driven | Fires as soon as an issue is associated with a started sprint. No time threshold. |
| Carryover pattern | 3 consecutive sprints | Sprint count | Only flagged during sweep. Counts distinct sprints where `carryover_from_sprint_id` is set. |
| Risk cluster | >= 3 independent signals | Signal count | Aggregation pass at end of sweep. Signals must be independent (not all from same root cause). |

### 4.2 Configuration Interface

```ts
// api/src/fleetgraph/config.ts

interface ThresholdConfig {
  /** When standup becomes overdue. Format: "HH:MM" in workspace timezone. */
  standupDueTime: string;

  /** Business days before an in-progress issue is considered stale. */
  staleIssueDays: number;

  /** Business days before a pending approval is considered a bottleneck. */
  approvalBottleneckDays: number;

  /** Minimum independent signals to trigger a risk cluster alert. */
  riskClusterMinSignals: number;

  /** Consecutive sprints for carryover pattern detection. */
  carryoverSprintThreshold: number;

  /** Workspace timezone for business-hour calculations. */
  timezone: string;

  /** Which days are business days. Default: [1,2,3,4,5] (Mon-Fri). */
  businessDays: number[];

  /** Quiet hours during which proactive alerts are suppressed.
   *  Format: { start: "HH:MM", end: "HH:MM" } in workspace timezone. */
  quietHours: { start: string; end: string } | null;
}

const DEFAULT_CONFIG: ThresholdConfig = {
  standupDueTime: '11:00',
  staleIssueDays: 3,
  approvalBottleneckDays: 2,
  riskClusterMinSignals: 3,
  carryoverSprintThreshold: 3,
  timezone: 'America/New_York',
  businessDays: [1, 2, 3, 4, 5],
  quietHours: null,
};

/**
 * Per-workspace overrides. MVP stores in workspace properties JSONB.
 * Post-MVP, a dedicated `fleetgraph_config` table.
 */
export async function getWorkspaceConfig(
  workspaceId: string
): Promise<ThresholdConfig> {
  const result = await pool.query(
    `SELECT properties->>'fleetgraph_config' AS config
     FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  const raw = result.rows[0]?.config;
  if (!raw) return { ...DEFAULT_CONFIG };

  const overrides = JSON.parse(raw) as Partial<ThresholdConfig>;
  return { ...DEFAULT_CONFIG, ...overrides };
}
```

### 4.3 Business Day Calculation

```ts
// api/src/fleetgraph/business-days.ts

/**
 * Count business days between two dates.
 * Excludes weekends (Sat=6, Sun=0 by default).
 * Does not account for holidays (add holiday calendar post-MVP).
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  businessDays: number[] = [1, 2, 3, 4, 5]
): number {
  const businessDaySet = new Set(businessDays);
  let count = 0;
  const current = new Date(from);
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);

  while (current < end) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (businessDaySet.has(current.getUTCDay())) {
      count++;
    }
  }

  return count;
}

/**
 * Check if a given timestamp falls within business hours
 * in the specified timezone.
 */
export function isBusinessHour(
  timestamp: Date,
  timezone: string,
  businessDays: number[] = [1, 2, 3, 4, 5]
): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(timestamp);
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value;
  const dayIndex = dayOfWeek.indexOf(weekdayStr || '');

  return businessDays.includes(dayIndex);
}
```

---

## 5. Scale Analysis

### 5.1 Per-Sweep Cost Model

Assumptions per project:
- 1 active sprint
- ~10 issues per sprint
- ~4 team members per sprint
- 1 plan approval + 1 review approval per sprint

| Operation | Queries per Sprint | Cost |
|---|---|---|
| Enumerate sprints | 1 | Negligible |
| Missing standup: get assignees | 1 | Negligible |
| Missing standup: check posted | 1 | Negligible |
| Stale issues: query + history | 1 (with subquery) | Light |
| Scope drift: compare associations | 1 | Negligible |
| Approval check | 0 (in-memory from sprint properties) | Free |
| **Total per sprint** | **5 queries** | |

### 5.2 Scale Tiers

#### 100 Projects

| Metric | Value |
|---|---|
| Active sprints | ~100 (1 per project, current only) |
| DB queries per sweep | ~500 (5 per sprint) |
| Sweep duration (estimated) | 2-5 seconds |
| Candidates flagged per sweep | ~10-30 (10-30% hit rate) |
| LLM invocations per sweep | ~5-15 (after heuristic filter) |
| LLM cost per sweep (GPT-4o) | ~$0.02-0.06 (500-1500 input tokens each) |
| LLM cost per day (360 sweeps) | ~$7-22 |
| DB load | Trivial. 500 simple SELECTs every 4 min. |

**Verdict:** Fully feasible. No optimizations needed.

#### 1,000 Projects

| Metric | Value |
|---|---|
| Active sprints | ~1,000 |
| DB queries per sweep | ~5,000 |
| Sweep duration (estimated) | 10-25 seconds |
| Candidates flagged per sweep | ~100-300 |
| LLM invocations per sweep | ~30-100 |
| LLM cost per sweep (GPT-4o) | ~$0.12-0.40 |
| LLM cost per day (360 sweeps) | ~$43-144 |
| DB load | Moderate. Need connection pooling. |

**Optimizations needed at this tier:**

1. **Entity digest cache**: Hash sprint/issue state at end of each sweep. Skip unchanged entities next cycle.
2. **Batch queries**: Instead of 5 queries per sprint, use `ANY($1)` to batch across all sprints in a workspace.
3. **Parallel workspace processing**: Process workspaces concurrently with `Promise.all` (bounded to 5).

```ts
// Batch query example: stale issues across ALL active sprints at once
const staleResult = await client.query(
  `SELECT i.id, i.properties->>'state' as state, da.related_id as sprint_id,
          COALESCE(
            (SELECT MAX(h.created_at) FROM document_history h WHERE h.document_id = i.id),
            i.updated_at
          ) AS last_activity_at
   FROM documents i
   JOIN document_associations da ON da.document_id = i.id
   WHERE da.related_id = ANY($1) AND da.relationship_type = 'sprint'
     AND i.document_type = 'issue' AND i.workspace_id = $2
     AND i.properties->>'state' = 'in_progress'
     AND i.deleted_at IS NULL`,
  [activeSprintIds, workspaceId]
);
```

#### 10,000 Projects

| Metric | Value |
|---|---|
| Active sprints | ~10,000 |
| DB queries per sweep (naive) | ~50,000 |
| Sweep duration (naive) | 2-5 minutes (exceeds budget) |
| LLM invocations per sweep | ~300-1,000 |
| LLM cost per sweep | ~$1.20-4.00 |
| LLM cost per day | ~$432-1,440 |

**This tier breaks the single-sweep model.** Required architectural changes:

| Change | Description |
|---|---|
| Partitioned sweeps | Sweep a subset of workspaces per cycle, rotating. Each workspace sweeps every 4 min but not all at once. |
| DB read replicas | Route sweep queries to read replica. |
| Change-data-capture (CDC) | Use PostgreSQL logical replication or LISTEN/NOTIFY to detect changes instead of polling. |
| LLM tiering | Use a cheaper model (GPT-4o-mini) for initial classification. Escalate to GPT-4o only for ambiguous cases. |
| Precomputed digests | Background job computes entity digests continuously. Sweep only checks digests. |
| Queue workers | Separate sweep workers from API workers. Scale independently. |

**Cost control at 10K:**

```
Partitioned sweep: 10,000 sprints / 10 partitions = 1,000 per cycle
Each partition: ~5s sweep + ~30s LLM = ~35s total
All 10 partitions round-robin: each workspace checked every 40s (!)
LLM calls: use digest cache aggressively -> 90% reduction -> ~$43-144/day
```

### 5.3 Cost Summary Table

| Tier | Sweep DB Queries | Sweep Duration | LLM Calls/Sweep | Daily LLM Cost | Architecture |
|---|---|---|---|---|---|
| 100 | 500 | 2-5s | 5-15 | $7-22 | Single process, in-memory queue |
| 1,000 | 5,000 (batched to ~500) | 10-25s | 30-100 | $43-144 | Digest cache, batch queries |
| 10,000 | 50,000 (partitioned) | 35s per partition | 300-1,000 (cached to 30-100) | $43-144 (with cache) | Partitioned sweep, read replicas, LLM tiering |

---

## 6. Comparison: Poll vs Webhook vs Hybrid

### 6.1 Engineering Tradeoffs

| Dimension | Pure Polling (5 min) | Pure Webhook / Event | Hybrid (Event + 4 min Sweep) |
|---|---|---|---|
| **Latency (event-driven signals)** | Up to 5 min | < 5 sec | < 5 sec |
| **Latency (absence signals)** | Up to 5 min | Cannot detect | Up to 4 min |
| **DB query cost** | High (re-scan everything every cycle) | Zero (push-based) | Low (sweep only checks time-based conditions; events are push) |
| **LLM cost** | High (unchanged entities re-evaluated unless cached) | Low (only changed entities) | Low (events handle changes; sweep handles absence) |
| **Missed events** | None (poll catches all) | Possible (lost events, race conditions) | None (sweep catches missed events) |
| **Complexity** | Low | Medium (event wiring per route) | Medium-high (both systems) |
| **Reliability** | High (stateless poll) | Medium (depends on bus health) | High (sweep is the safety net) |
| **Cold start behavior** | Works immediately | No alerts until events fire | Sweep catches existing conditions on first run |
| **Missing standup detection** | Possible | Impossible (no event for non-action) | Possible (sweep detects absence) |
| **Stale issue detection** | Possible | Impossible (staleness is absence of event) | Possible (sweep detects aging) |
| **Approval bottleneck** | Possible | Partial (detects approval actions, not aging) | Full (events for actions, sweep for aging) |
| **Scope drift** | Possible | Possible (event on issue-sprint association) | Immediate via event, sweep as backup |

### 6.2 Why Hybrid Wins for FleetGraph

FleetGraph monitors two fundamentally different classes of signals:

**Class A: Something happened** (event-driven)
- Issue state changed
- Approval granted or requested
- New issue added to sprint
- Standup posted

**Class B: Something should have happened but didn't** (absence detection)
- No standup posted by 11 AM
- In-progress issue with no activity for 3 days
- Approval pending for 2+ business days
- No review submitted by sprint end

Pure webhooks cannot detect Class B signals. Pure polling adds unnecessary latency for Class A signals. The hybrid model maps each class to its natural detection mechanism.

**Decision: Hybrid is the only architecture that covers both signal classes within the < 5 minute SLA.**

---

## 7. Monitoring and Observability

### 7.1 Metrics

Every sweep and event-triggered graph invocation should emit structured metrics.

```ts
// api/src/fleetgraph/metrics.ts

interface SweepMetrics {
  /** Duration of the sweep in milliseconds. */
  sweepDurationMs: number;

  /** Number of workspaces scanned. */
  workspacesScanned: number;

  /** Total issues evaluated. */
  issuesScanned: number;

  /** Candidates produced by this sweep. */
  candidatesProduced: number;

  /** Candidates that survived deduplication. */
  candidatesAfterDedup: number;

  /** Candidates that passed heuristic filter. */
  candidatesAfterFilter: number;

  /** LLM invocations triggered by this sweep. */
  llmInvocations: number;

  /** Alerts delivered to users. */
  alertsDelivered: number;

  /** Errors encountered during sweep. */
  errorCount: number;

  /** Timestamp of sweep start. */
  startedAt: number;
}

interface EventMetrics {
  /** Signal type that triggered the event. */
  signalType: string;

  /** Whether the candidate was debounced (merged with another). */
  debounced: boolean;

  /** Whether the candidate was deduplicated (already surfaced). */
  deduplicated: boolean;

  /** Whether heuristic filter passed. */
  passedFilter: boolean;

  /** LLM invocation duration in ms (0 if no LLM call). */
  llmDurationMs: number;

  /** End-to-end latency from event emission to alert delivery. */
  e2eLatencyMs: number;
}

export function logSweepMetrics(metrics: SweepMetrics): void {
  console.log('[FleetGraph:metrics:sweep]', JSON.stringify(metrics));
  // TODO: Post-MVP, emit to StatsD/Prometheus/Datadog
}

export function logEventMetrics(metrics: EventMetrics): void {
  console.log('[FleetGraph:metrics:event]', JSON.stringify(metrics));
}
```

### 7.2 LangSmith Tagging

Every graph run must be tagged for filterability in LangSmith traces.

```ts
// When invoking the graph:
const runConfig = {
  configurable: {
    // LangSmith tags for filtering
    tags: [
      `trigger:${candidate.source}`,           // 'trigger:event' or 'trigger:sweep'
      `signal:${candidate.signalType}`,         // 'signal:issue_updated'
      `entity:${candidate.entityType}`,         // 'entity:issue'
      `workspace:${candidate.workspaceId}`,     // for workspace-level filtering
    ],
    metadata: {
      triggerSource: candidate.source,
      signalType: candidate.signalType,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      workspaceId: candidate.workspaceId,
      sweepCycleId: sweepCycleId,               // groups candidates from same sweep
      candidateTimestamp: candidate.timestamp,
    },
  },
};
```

### 7.3 Alert Conditions

| Alert | Condition | Severity | Action |
|---|---|---|---|
| Sweep duration exceeded | `sweepDurationMs > 120_000` (2 min) | Warning | Investigate slow queries, consider batching |
| Sweep duration critical | `sweepDurationMs > 200_000` (3.3 min) | Critical | Risk of missing SLA, trigger incident review |
| Queue backing up | Queue size > 50 for 3 consecutive sweeps | Warning | Check LLM latency, consider backpressure |
| Queue overflow | Queue size > 200 | Critical | Sweep candidates being dropped |
| Sweep lock contention | Advisory lock not acquired 3 times in a row | Warning | Multiple instances contending, check deployment |
| LLM error rate | > 10% of invocations failing | Warning | Check OpenAI status, API key, rate limits |
| Zero candidates (stale) | 0 candidates for 24 hours across all workspaces | Info | Possible if workspace is inactive, but verify sweep is running |
| High LLM cost | > $X per day (configurable) | Warning | Review heuristic filter effectiveness |

### 7.4 Health Check Endpoint

```ts
// api/src/fleetgraph/health.ts

interface FleetGraphHealth {
  sweepSchedulerRunning: boolean;
  lastSweepAt: number | null;
  lastSweepDurationMs: number | null;
  lastSweepCandidates: number | null;
  queueSize: number;
  alertHistorySize: number;
  uptimeMs: number;
}

let lastSweepMetrics: SweepMetrics | null = null;
const startTime = Date.now();

export function updateLastSweep(metrics: SweepMetrics): void {
  lastSweepMetrics = metrics;
}

export function getHealth(): FleetGraphHealth {
  return {
    sweepSchedulerRunning: sweepInterval !== null,
    lastSweepAt: lastSweepMetrics?.startedAt ?? null,
    lastSweepDurationMs: lastSweepMetrics?.sweepDurationMs ?? null,
    lastSweepCandidates: lastSweepMetrics?.candidatesProduced ?? null,
    queueSize: getCurrentQueueSize(),
    alertHistorySize: alertHistory.size,
    uptimeMs: Date.now() - startTime,
  };
}
```

Expose via `GET /api/fleetgraph/health` (admin-only).

### 7.5 Structured Log Format

All FleetGraph logs should follow a consistent format for log aggregation:

```
[FleetGraph:{subsystem}] {message} {json_payload}
```

Subsystems: `sweep`, `event`, `queue`, `dedup`, `filter`, `llm`, `alert`, `metrics`, `health`.

Example log stream for one sweep cycle:

```
[FleetGraph:sweep] Starting sweep cycle_id=abc123
[FleetGraph:sweep] Acquired advisory lock
[FleetGraph:sweep] Scanning workspace ws_1 sprints=2
[FleetGraph:dedup] Filtered 4 of 12 candidates (unchanged digest)
[FleetGraph:filter] Heuristic passed 3 of 8 candidates
[FleetGraph:llm] Invoking GPT-4o for 3 candidates
[FleetGraph:llm] Response received duration_ms=2100 tokens_in=1200 tokens_out=340
[FleetGraph:alert] Delivered 2 alerts (1 below severity threshold)
[FleetGraph:metrics:sweep] {"sweepDurationMs":8200,"candidatesProduced":12,...}
```

---

## Appendix A: Business Day Helper Tests

```ts
// Expected test cases for businessDaysBetween:
//
// Mon 9 AM to Wed 9 AM      -> 2 business days
// Fri 9 AM to Mon 9 AM      -> 1 business day (Mon counts, Sat/Sun skip)
// Fri 9 AM to Tue 9 AM      -> 2 business days
// Mon to Mon (same day)      -> 0
// Mon to next Mon            -> 5 business days
// Wed to Wed (7 days later)  -> 5 business days
```

## Appendix B: Migration Path from In-Memory to Persistent Queue

| Phase | Queue | Dedup Store | Config Store |
|---|---|---|---|
| MVP | In-memory array | In-memory Map | Workspace properties JSONB |
| Post-MVP | `fleetgraph_candidates` table | `fleetgraph_alert_history` table | `fleetgraph_config` table |
| Scale | Redis/BullMQ | PostgreSQL + Redis cache | PostgreSQL |

Migration is non-breaking: the candidate type and queue interface stay the same. Only the storage backend changes.

## Appendix C: File Structure

```
api/src/fleetgraph/
  types.ts              # FleetGraphCandidate, ThresholdConfig, AlertRecord
  emitter.ts            # EventEmitter bus + emitFleetGraphCandidate()
  debouncer.ts          # 3s debounce per entity
  sweep.ts              # startSweepScheduler(), runSweep(), check functions
  queue.ts              # Priority sorting, backpressure
  deduplicator.ts       # Alert fingerprinting, shouldProcess()
  config.ts             # getWorkspaceConfig(), DEFAULT_CONFIG
  business-days.ts      # businessDaysBetween(), isBusinessHour()
  metrics.ts            # logSweepMetrics(), logEventMetrics()
  health.ts             # getHealth(), updateLastSweep()
```
