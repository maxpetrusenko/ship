# Human Approval Before Consequential Actions: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


As of March 16, 2026.

This document is the engineer-ready specification for FleetGraph's human-in-the-loop approval system. It covers action risk classification, LangGraph interrupt mechanics, approval payload design, frontend UX, backend API, dismiss and snooze behavior, idempotency guarantees, audit trail, and database schema.

## Evidence Base

### Local repo evidence

- [`./README.md`](./README.md)
- [`../../Phase 1/01. Agent Responsibility Scoping/README.md`](../../Phase%201/01.%20Agent%20Responsibility%20Scoping/README.md)
- [`../../Phase 2/06. Human-in-the-Loop Design/README.md`](../../Phase%202/06.%20Human-in-the-Loop%20Design/README.md)
- [`../../Phase 2/04. Node Design/README.md`](../../Phase%202/04.%20Node%20Design/README.md)
- [`../../Phase 2/05. State Management/README.md`](../../Phase%202/05.%20State%20Management/README.md)
- [`../01. Complete Presearch Before Code/DEEP_DIVE.md`](../01.%20Complete%20Presearch%20Before%20Code/DEEP_DIVE.md)
- [`../../../../web/src/components/ApprovalButton.tsx`](../../../../web/src/components/ApprovalButton.tsx)
- [`../../../../web/src/components/ConfirmDialog.tsx`](../../../../web/src/components/ConfirmDialog.tsx)
- [`../../../../api/src/db/schema.sql`](../../../../api/src/db/schema.sql)

### External primary sources

- LangChain, [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- LangChain, [LangGraph JS durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)
- LangChain, [LangGraph JS persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- OpenAI, [Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions)

---

## 1. Action Risk Classification

Every action FleetGraph can take falls into one of three tiers. The tier determines whether the action proceeds autonomously, pauses for human approval, or is outright forbidden.

### Tier 1: Autonomous (no gate)

These actions are read-only or low-risk surfacing. They never mutate canonical Ship state.

| Action | Example | Why autonomous |
|--------|---------|----------------|
| Generate risk summary | "This week has 3 blocked issues and no standup for 2 days" | Read-only synthesis |
| Send in-app notification | FleetGraph insight card appears in sidebar | Presentation only; user decides next step |
| Prepare draft recommendation | "Consider reassigning issue #42 to Alex" | Draft, not execution |
| Refresh existing alert with new evidence | Updated evidence on a previously surfaced risk | No new entity mutation |
| Open FleetGraph insight card | Card appears in the FleetGraph panel | Informational; user controls what happens next |
| Log detection to audit trail | Record that a condition was detected | Internal bookkeeping |

### Tier 2: Gated (requires human approval)

These actions mutate canonical project state. The graph must pause at a `human_gate` node and wait for explicit approval before executing.

| Action | Entity affected | Why gated |
|--------|----------------|-----------|
| Issue state change | `documents` (issue) | Alters coordination; changes what the team sees on the board |
| Issue reassignment | `documents` (issue) `properties.assignee_id` | Changes ownership and responsibility |
| Week plan approval or rejection | Approval tracking on week | Formal accountability action |
| Week retro approval or rejection | Approval tracking on week | Formal accountability action |
| Scope change (add/remove issue from week) | `document_associations` | Changes sprint commitment |
| Content edit on user-authored document | `documents.content` | Modifying someone else's writing |
| Create consequential record on behalf of user | `documents` (new row) | Impersonation risk without explicit consent |
| Request plan or retro changes | Approval tracking + notification | Triggers workflow for another person |
| Escalation to broader audience | Notification routing | Widens blast radius beyond direct owner |

### Tier 3: Forbidden (never allowed)

These actions are blocked at the code level. No approval flow exists for them because they should never happen.

| Action | Why forbidden |
|--------|---------------|
| Act as or impersonate a user | Identity fraud; violates Ship's auth model |
| Bulk operations across multiple entities in a single action | Blast radius too large; each mutation needs individual review |
| Delete data (hard delete) | Irreversible; Ship uses soft delete via `deleted_at` |
| Modify workspace membership or roles | Security-critical; outside FleetGraph's domain |
| Change authentication or session state | Security-critical; outside FleetGraph's domain |
| Access or modify data outside the current workspace | Workspace isolation boundary |
| Bypass approval state machine (e.g., mark approved without accountable user) | Violates Ship's approval workflow integrity |

### Enforcement

Risk tier is determined by a pure function that maps `(actionType, targetEntityType)` to a tier. This function runs before any action node executes:

```typescript
type RiskTier = 'autonomous' | 'gated' | 'forbidden';

interface ActionClassification {
  actionType: string;
  targetEntityType: string;
  riskTier: RiskTier;
  requiresApproval: boolean;
  reason: string;
}

const ACTION_RISK_POLICY: Record<string, RiskTier> = {
  'generate_summary':       'autonomous',
  'send_notification':      'autonomous',
  'prepare_draft':          'autonomous',
  'refresh_alert':          'autonomous',
  'change_issue_status':    'gated',
  'reassign_issue':         'gated',
  'approve_plan':           'gated',
  'reject_plan':            'gated',
  'approve_retro':          'gated',
  'reject_retro':           'gated',
  'add_issue_to_week':      'gated',
  'remove_issue_from_week': 'gated',
  'edit_content':           'gated',
  'create_record':          'gated',
  'request_changes':        'gated',
  'escalate_notification':  'gated',
  'impersonate_user':       'forbidden',
  'bulk_operation':         'forbidden',
  'hard_delete':            'forbidden',
  'modify_membership':      'forbidden',
  'modify_auth':            'forbidden',
};

function classifyAction(actionType: string): ActionClassification {
  const tier = ACTION_RISK_POLICY[actionType];
  if (!tier) {
    // Unknown actions default to forbidden
    return {
      actionType,
      targetEntityType: 'unknown',
      riskTier: 'forbidden',
      requiresApproval: false,
      reason: 'Unrecognized action type; blocked by default',
    };
  }
  return {
    actionType,
    targetEntityType: '', // filled by caller
    riskTier: tier,
    requiresApproval: tier === 'gated',
    reason: `Action classified as ${tier} by risk policy`,
  };
}
```

---

## 2. LangGraph Interrupt Mechanics

FleetGraph uses LangGraph JS interrupts to implement the pause/resume pattern at the `human_gate` node. This section documents the exact API behavior based on the `@langchain/langgraph` package.

### How `interrupt()` works in a node

The `interrupt()` function accepts any JSON-serializable payload and immediately suspends graph execution by throwing a special exception. The payload surfaces to callers via the `__interrupt__` field in the graph's return value.

```typescript
import { interrupt } from '@langchain/langgraph';

// Signature
function interrupt(payload: JSONSerializable): any;
```

When `interrupt()` is called:

1. The graph's checkpointer persists the current state to the database.
2. The special exception propagates up, halting execution.
3. The caller receives a result with `__interrupt__` containing the payload.
4. The graph is now paused and will not advance until resumed.

### How the graph checkpoints state

Before pausing, the checkpointer writes a snapshot of the full graph state to Postgres. This includes:

- All annotation values (entity IDs, fetched data, heuristic results, model outputs)
- The current node position in the graph
- The interrupt payload
- Thread metadata

FleetGraph uses `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres` for production persistence:

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);

const graph = builder.compile({ checkpointer });
```

### How to resume with approval data via `Command`

To resume a paused graph, invoke it with a `Command` object containing the resume value. The resume value becomes the return value of the `interrupt()` call that originally paused execution.

```typescript
import { Command } from '@langchain/langgraph';

// Resume with approval response
const config = {
  configurable: { thread_id: originalThreadId },
};

const result = await graph.invoke(
  new Command({ resume: { decision: 'approve', respondedBy: userId } }),
  config,
);
```

Critical details:

- The `thread_id` must match the original invocation exactly.
- Only `Command({ resume: ... })` is valid input when resuming.
- The resume value can be any JSON-serializable object.

### Thread ID management

Every FleetGraph graph run gets a unique `thread_id`. This ID serves as the primary key for:

- Checkpoint lookup and resume
- Linking the Ship-side approval record to the graph execution
- Trace correlation in LangSmith

Thread ID generation strategy:

```typescript
import { randomUUID } from 'crypto';

function generateFleetGraphThreadId(
  mode: 'proactive' | 'on_demand',
  entityType: string,
  entityId: string,
): string {
  // Deterministic prefix for debugging, random suffix for uniqueness
  return `fg_${mode}_${entityType}_${entityId}_${randomUUID()}`;
}
```

The `thread_id` is stored on the `fleetgraph_approvals` row so the backend can resume the correct graph execution when the human responds.

### Node restart behavior on resume

When the graph resumes, the entire node containing the `interrupt()` call restarts from the beginning. All code before `interrupt()` re-executes. This has critical implications:

1. Any side effects before `interrupt()` will run again.
2. Pre-interrupt code must be idempotent or moved after the interrupt.
3. The `interrupt()` return value on resume is the value from `Command({ resume: ... })`.

```typescript
// human_gate node implementation
async function humanGateNode(state: FleetGraphState) {
  // This code runs TWICE: once on initial execution, once on resume.
  // It must be idempotent.
  const payload = buildApprovalPayload(state);

  // Graph pauses here. On resume, interrupt() returns the human's response.
  const humanResponse = interrupt(payload);

  // This code runs ONLY after resume.
  if (humanResponse.decision === 'approve') {
    return { approvalDecision: 'approved', approvedBy: humanResponse.respondedBy };
  } else if (humanResponse.decision === 'dismiss') {
    return { approvalDecision: 'dismissed', dismissedBy: humanResponse.respondedBy };
  } else if (humanResponse.decision === 'snooze') {
    return {
      approvalDecision: 'snoozed',
      snoozedBy: humanResponse.respondedBy,
      snoozeUntil: humanResponse.snoozeUntil,
    };
  }

  return { approvalDecision: 'dismissed' };
}
```

### What happens if the user never responds (timeout handling)

LangGraph does not have a built-in timeout for interrupted graphs. The checkpoint persists indefinitely. FleetGraph handles timeout externally:

1. The `fleetgraph_approvals` table stores `expires_at` (default: 72 hours after creation).
2. A sweep job runs every hour, finds expired pending approvals, and resumes the graph with a synthetic `{ decision: 'expired' }` response.
3. The `human_gate` node treats `expired` as equivalent to `dismiss`.

```typescript
// Timeout sweep (runs on worker tier)
async function expireStaleApprovals(db: Pool, graph: CompiledGraph) {
  const expired = await db.query(`
    UPDATE fleetgraph_approvals
    SET status = 'expired', responded_at = now()
    WHERE status = 'pending' AND expires_at < now()
    RETURNING thread_id
  `);

  for (const row of expired.rows) {
    const config = { configurable: { thread_id: row.thread_id } };
    await graph.invoke(
      new Command({ resume: { decision: 'expired', respondedBy: 'system' } }),
      config,
    );
  }
}
```

### Critical interrupt rules

1. **Never wrap `interrupt()` in try/catch.** The interrupt exception must propagate. Catching it prevents the graph from pausing.

2. **Maintain deterministic interrupt order.** Interrupt matching is index-based. If the node has multiple interrupts, their order must be identical on initial run and resume.

3. **Only pass JSON-serializable values.** No functions, no class instances, no circular references.

4. **Make pre-interrupt code idempotent.** Everything before `interrupt()` runs again on resume.

---

## 3. Approval Payload Design

The approval payload is what the human sees when FleetGraph pauses for confirmation. It must contain enough context for an informed decision without requiring the user to leave the approval card.

### TypeScript types

```typescript
/** What FleetGraph sends to the frontend when pausing for approval */
interface ApprovalPayload {
  /** LangGraph thread ID for resuming execution */
  threadId: string;

  /** The specific mutation being proposed */
  actionType:
    | 'change_issue_status'
    | 'reassign_issue'
    | 'approve_plan'
    | 'reject_plan'
    | 'approve_retro'
    | 'reject_retro'
    | 'add_issue_to_week'
    | 'remove_issue_from_week'
    | 'edit_content'
    | 'create_record'
    | 'request_changes'
    | 'escalate_notification';

  /** Ship entity type being acted upon */
  targetEntityType: 'issue' | 'week' | 'project' | 'document' | 'approval';

  /** UUID of the target entity */
  targetEntityId: string;

  /** Human-readable title of the target (e.g., issue title, week name) */
  targetEntityTitle: string;

  /** Markdown summary of the evidence that led to this recommendation */
  evidenceSummary: string;

  /** What the agent recommends doing, in plain language */
  recommendedAction: string;

  /** What will change if the action is approved */
  expectedEffect: string;

  /** Risk classification */
  riskTier: 'low' | 'medium' | 'high';

  /** ISO 8601 timestamp when the payload was generated */
  generatedAt: string;

  /** SHA-256 hash of (actionType + targetEntityId + evidenceSummary) for dedup */
  fingerprintHash: string;

  /** LangSmith trace URL for this graph run */
  traceLink: string;

  /** When this approval expires if not acted upon */
  expiresAt: string;
}

/** What the human sends back */
interface ApprovalResponse {
  /** The decision */
  decision: 'approve' | 'dismiss' | 'snooze';

  /** Who responded (user UUID) */
  respondedBy: string;

  /** For snooze: ISO 8601 timestamp to suppress until */
  snoozeUntil?: string;

  /** Optional note from the human */
  note?: string;
}

/** Internal type used after resume to record the full lifecycle */
interface ApprovalRecord {
  id: string;
  threadId: string;
  workspaceId: string;
  payload: ApprovalPayload;
  status: 'pending' | 'approved' | 'dismissed' | 'snoozed' | 'expired';
  respondedBy: string | null;
  respondedAt: string | null;
  note: string | null;
  snoozeUntil: string | null;
  executionResult: 'success' | 'failure' | null;
  executionError: string | null;
  createdAt: string;
  expiresAt: string;
}
```

### Fingerprint hash generation

The fingerprint prevents duplicate approvals for the same underlying condition:

```typescript
import { createHash } from 'crypto';

function generateFingerprintHash(
  actionType: string,
  targetEntityId: string,
  evidenceSummary: string,
): string {
  const input = `${actionType}:${targetEntityId}:${evidenceSummary}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
```

---

## 4. Frontend Approval UX

### Where the approval card appears

The approval card renders inside the FleetGraph panel, which is embedded in Ship's existing sidebar or context panel. It does not use a modal or dialog. The card appears inline, in the same space where FleetGraph surfaces insights and chat responses.

Flow:

1. FleetGraph streams a response (text explaining what it found).
2. When the stream reaches the `human_gate` node, the streaming response transitions to an approval card.
3. The card replaces the "thinking" state with a structured decision interface.

### Card layout

The approval card follows Ship's existing component patterns (Radix primitives, Tailwind classes, `bg-background`/`text-foreground` tokens). It uses the same visual language as the existing `ConfirmDialog` and `ApprovalButton` components.

```
+--------------------------------------------------+
|  FleetGraph Recommendation              [risk badge]
|                                                    |
|  EVIDENCE                                          |
|  [evidenceSummary rendered as markdown]             |
|                                                    |
|  PROPOSED ACTION                                   |
|  [recommendedAction in plain language]             |
|                                                    |
|  EXPECTED EFFECT                                   |
|  [expectedEffect description]                      |
|                                                    |
|  Target: [targetEntityTitle] ([targetEntityType])  |
|  Generated: [relative time]    Expires: [countdown]|
|  Trace: [link]                                     |
|                                                    |
|  +----------+  +---------+  +-------+              |
|  | Approve  |  | Dismiss |  | Snooze|              |
|  +----------+  +---------+  +-------+              |
+--------------------------------------------------+
```

### Component structure

```typescript
interface FleetGraphApprovalCardProps {
  payload: ApprovalPayload;
  onRespond: (response: ApprovalResponse) => void;
  isSubmitting: boolean;
}
```

The card reuses Ship's existing patterns:

- `Radix Dialog` for the snooze duration picker (same pattern as `ConfirmDialog`)
- Tailwind utility classes consistent with Ship's design tokens
- `apiPost` from `@/lib/api` for the approval response call
- Inline SVG icons (same pattern as `ApprovalButton.tsx`)

### Risk badge colors

| Tier | Background | Text |
|------|------------|------|
| low | `bg-green-500/10 border-green-500/20` | `text-green-400` |
| medium | `bg-amber-500/10 border-amber-500/20` | `text-amber-400` |
| high | `bg-red-500/10 border-red-500/20` | `text-red-400` |

### Snooze duration picker

When the user clicks "Snooze", a small dropdown appears with preset durations:

- 1 hour
- 4 hours
- Tomorrow morning (9 AM local)
- Next Monday (9 AM local)
- Custom (date/time picker)

The selected duration becomes `snoozeUntil` in the `ApprovalResponse`.

### Streaming to approval card transition

During a graph run, the frontend receives streaming text from reasoning nodes. When the graph reaches `human_gate` and calls `interrupt()`, the backend sends a structured event over the stream:

```typescript
// Server-sent event types
type FleetGraphStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'approval_required'; payload: ApprovalPayload }
  | { type: 'action_executed'; result: { success: boolean; summary: string } }
  | { type: 'done' };
```

The frontend switches from rendering streamed text to rendering the `FleetGraphApprovalCard` component when it receives `approval_required`.

---

## 5. Backend Approval API

### Endpoints

#### GET /api/fleetgraph/pending-approvals

Returns all pending approval requests for the current workspace.

```typescript
// Request
GET /api/fleetgraph/pending-approvals
Cookie: session=<session_id>

// Response 200
interface PendingApprovalsResponse {
  approvals: Array<{
    id: string;
    threadId: string;
    payload: ApprovalPayload;
    status: 'pending';
    createdAt: string;
    expiresAt: string;
  }>;
}
```

Query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Max results |
| `offset` | number | 0 | Pagination offset |
| `targetEntityType` | string | all | Filter by entity type |

#### POST /api/fleetgraph/approvals/:threadId/respond

Submit a human response to a pending approval.

```typescript
// Request
POST /api/fleetgraph/approvals/:threadId/respond
Cookie: session=<session_id>
Content-Type: application/json

{
  "decision": "approve" | "dismiss" | "snooze",
  "snoozeUntil": "2026-03-17T09:00:00Z",  // only for snooze
  "note": "Looks good, proceed."            // optional
}

// Response 200
interface ApprovalRespondResponse {
  approval: ApprovalRecord;
  executionResult?: {
    success: boolean;
    summary: string;
    error?: string;
  };
}

// Response 404
{ "error": "Approval not found or already resolved" }

// Response 403
{ "error": "User does not have permission to respond to this approval" }
```

#### GET /api/fleetgraph/approvals/:threadId

Get details of a specific approval (any status).

```typescript
// Response 200
interface ApprovalDetailResponse {
  approval: ApprovalRecord;
  auditTrail: Array<{
    event: string;
    actor: string;
    timestamp: string;
    details: Record<string, unknown>;
  }>;
}
```

### Backend resume flow

When the human responds, the backend:

1. Validates the session and workspace membership.
2. Validates the user has permission to respond (workspace admin, or the entity's owner/accountable).
3. Updates `fleetgraph_approvals` row with the response.
4. If `approve`: resumes the LangGraph execution via `Command({ resume: ... })`.
5. If `dismiss`: resumes the graph with dismiss (graph routes to `record_outcome` and terminates).
6. If `snooze`: writes snooze state to `fleetgraph_alert_state`, resumes graph with snooze (graph terminates).
7. Records the full lifecycle in `fleetgraph_audit_log`.

```typescript
async function handleApprovalResponse(
  db: Pool,
  graph: CompiledGraph,
  threadId: string,
  response: ApprovalResponse,
): Promise<ApprovalRecord> {
  // 1. Load and validate the pending approval
  const approval = await db.query(
    `SELECT * FROM fleetgraph_approvals WHERE thread_id = $1 AND status = 'pending'`,
    [threadId],
  );
  if (approval.rows.length === 0) {
    throw new NotFoundError('Approval not found or already resolved');
  }

  // 2. Update approval record
  await db.query(
    `UPDATE fleetgraph_approvals
     SET status = $1, responded_by = $2, responded_at = now(),
         note = $3, snooze_until = $4
     WHERE thread_id = $5`,
    [response.decision, response.respondedBy, response.note, response.snoozeUntil, threadId],
  );

  // 3. If snoozed, write to alert state table
  if (response.decision === 'snooze') {
    const row = approval.rows[0];
    await db.query(
      `INSERT INTO fleetgraph_alert_state (fingerprint_hash, workspace_id, snoozed_until, snoozed_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fingerprint_hash, workspace_id)
       DO UPDATE SET snoozed_until = $3, snoozed_by = $4, updated_at = now()`,
      [row.fingerprint_hash, row.workspace_id, response.snoozeUntil, response.respondedBy],
    );
  }

  // 4. Resume the graph
  const config = { configurable: { thread_id: threadId } };
  const result = await graph.invoke(new Command({ resume: response }), config);

  // 5. Record execution outcome
  const executionSuccess = !result.executionError;
  await db.query(
    `UPDATE fleetgraph_approvals
     SET execution_result = $1, execution_error = $2
     WHERE thread_id = $3`,
    [executionSuccess ? 'success' : 'failure', result.executionError || null, threadId],
  );

  // 6. Log to audit trail
  await db.query(
    `INSERT INTO fleetgraph_audit_log
     (workspace_id, thread_id, event_type, actor_user_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      approval.rows[0].workspace_id,
      threadId,
      `approval_${response.decision}`,
      response.respondedBy,
      JSON.stringify({ note: response.note, executionSuccess }),
    ],
  );

  return approval.rows[0];
}
```

---

## 6. Dismiss and Snooze Behavior

### Dismiss

When a human dismisses an approval:

1. The `fleetgraph_approvals` row is updated to `status = 'dismissed'`.
2. The graph resumes with `{ decision: 'dismiss' }` and routes to `record_outcome`, then terminates.
3. The `fleetgraph_alert_state` table records the fingerprint as dismissed.
4. Future proactive sweeps check the alert state table before surfacing the same fingerprint.
5. The same condition will **not** resurface unless the underlying state **materially changes** (the entity digest hash changes).

"Materially changes" means: a field relevant to the original detection has a new value. The heuristic node computes an entity digest hash from the relevant fields. If the hash changes after a dismissal, the fingerprint is considered fresh and eligible for resurfacing.

```typescript
// Dedupe check in heuristic_filter node
async function shouldSurface(
  db: Pool,
  fingerprintHash: string,
  workspaceId: string,
  currentDigest: string,
): Promise<boolean> {
  const result = await db.query(
    `SELECT status, entity_digest, snoozed_until
     FROM fleetgraph_alert_state
     WHERE fingerprint_hash = $1 AND workspace_id = $2`,
    [fingerprintHash, workspaceId],
  );

  if (result.rows.length === 0) return true; // Never seen before

  const row = result.rows[0];

  // If dismissed and digest unchanged, suppress
  if (row.status === 'dismissed' && row.entity_digest === currentDigest) {
    return false;
  }

  // If snoozed and snooze not expired, suppress
  if (row.status === 'snoozed' && row.snoozed_until && new Date(row.snoozed_until) > new Date()) {
    return false;
  }

  // Digest changed or snooze expired: resurface
  return true;
}
```

### Snooze

When a human snoozes an approval:

1. The `fleetgraph_approvals` row is updated to `status = 'snoozed'`.
2. The `fleetgraph_alert_state` table stores the `snoozed_until` timestamp.
3. The graph terminates without executing the action.
4. Future proactive sweeps skip this fingerprint until `snoozed_until` has passed.
5. After expiry, the next sweep that detects the same condition will resurface it as a fresh approval.
6. If the underlying state materially changes before the snooze expires, the condition resurfaces immediately (the digest hash mismatch overrides the snooze).

### Storage: Ship tables, not graph state

Dismiss and snooze state lives in the `fleetgraph_alert_state` table in Ship's Postgres database, not in LangGraph's checkpoint state. This is intentional:

- Alert state must survive across multiple independent graph runs.
- Different graph threads for the same fingerprint need to see the same dismiss/snooze state.
- The UI needs to query alert state without loading graph checkpoints.

---

## 7. Idempotency Guarantees

The fundamental rule: **no side effects before `interrupt()`, write only after approval.**

### Why this matters

When a LangGraph graph resumes from an interrupt, the entire node containing the `interrupt()` call restarts from the beginning. Every line of code before `interrupt()` runs again. If that code performs writes (database inserts, API calls, notifications), those writes will execute twice: once on the original run, once on resume.

### Implementation rules

1. **The `human_gate` node must be pure before the interrupt.** It reads state, builds the approval payload, and calls `interrupt()`. Nothing else.

2. **The `execute_action` node runs after the interrupt.** This is where mutations happen. It only executes if the graph routes there after approval.

3. **The `prepare_action` node (before `human_gate`) builds the payload but does not write.** It assembles what the action would do, stores it in graph state, and passes it to `human_gate`.

4. **All mutations in `execute_action` must be idempotent.** Use upsert patterns, check-then-act with row-level locks, or idempotency keys.

```typescript
// Graph node order for consequential actions:
//
// prepare_action  -> builds payload, stores in state (NO WRITES)
// human_gate      -> calls interrupt(), pauses (NO WRITES before interrupt)
// execute_action  -> performs the actual mutation (WRITES HERE ONLY)
// record_outcome  -> logs result to audit trail

// prepare_action: pure computation
async function prepareActionNode(state: FleetGraphState) {
  const payload: ApprovalPayload = {
    threadId: state.threadId,
    actionType: state.recommendedActionType,
    targetEntityType: state.targetEntityType,
    targetEntityId: state.targetEntityId,
    targetEntityTitle: state.targetEntityTitle,
    evidenceSummary: state.evidenceSummary,
    recommendedAction: state.recommendedAction,
    expectedEffect: state.expectedEffect,
    riskTier: state.riskTier,
    generatedAt: new Date().toISOString(),
    fingerprintHash: generateFingerprintHash(
      state.recommendedActionType,
      state.targetEntityId,
      state.evidenceSummary,
    ),
    traceLink: state.traceLink,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  };

  return { approvalPayload: payload };
}

// human_gate: interrupt only
async function humanGateNode(state: FleetGraphState) {
  // Idempotent: writing the pending approval row uses ON CONFLICT DO NOTHING
  // so it is safe if this runs twice.
  const humanResponse = interrupt(state.approvalPayload);

  return {
    approvalDecision: humanResponse.decision,
    approvalRespondedBy: humanResponse.respondedBy,
    approvalNote: humanResponse.note,
    snoozeUntil: humanResponse.snoozeUntil,
  };
}

// execute_action: writes happen here
async function executeActionNode(state: FleetGraphState) {
  // Only reaches here if decision was 'approve'
  const result = await executeShipApiMutation(state);

  return {
    executionResult: result.success ? 'success' : 'failure',
    executionError: result.error || null,
  };
}
```

### Idempotency key for Ship API mutations

Each approved action carries an idempotency key derived from the thread ID:

```typescript
function getIdempotencyKey(threadId: string, actionType: string): string {
  return `fg_${threadId}_${actionType}`;
}
```

The `execute_action` node passes this key to Ship API calls. If the call was already executed (e.g., due to a retry), the API returns the cached result instead of mutating again.

---

## 8. Audit Trail

Every step in the approval lifecycle is logged. The audit trail answers: what was detected, what was proposed, who responded, what happened after, and when.

### Events logged

| Event | When | Actor | Details |
|-------|------|-------|---------|
| `detection` | Risk detected by heuristic or reasoning node | system | Signal type, entity IDs, heuristic scores |
| `approval_requested` | `interrupt()` called, approval row created | system | Full `ApprovalPayload` |
| `approval_approved` | Human approves | user UUID | Note, timestamp |
| `approval_dismissed` | Human dismisses | user UUID | Note, reason |
| `approval_snoozed` | Human snoozes | user UUID | `snoozeUntil`, note |
| `approval_expired` | Timeout sweep expires a pending approval | system | Original `expiresAt` |
| `action_executed` | Approved action performed via Ship API | system | API response, success/failure |
| `action_failed` | Approved action failed | system | Error details, will retry or dead-letter |
| `alert_resurfaced` | Previously dismissed alert resurfaced due to state change | system | Old digest vs new digest |

### Audit log entry structure

```typescript
interface FleetGraphAuditEntry {
  id: string;
  workspaceId: string;
  threadId: string;
  eventType: string;
  actorUserId: string | null;  // null for system events
  targetEntityType: string | null;
  targetEntityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
```

### Relationship to Ship's existing audit_logs

Ship already has an `audit_logs` table for compliance-grade logging. FleetGraph audit entries go into a separate `fleetgraph_audit_log` table because:

- FleetGraph events have different fields (thread_id, fingerprint_hash, approval lifecycle events).
- FleetGraph events fire at a higher rate than user-initiated actions.
- Separating them keeps the existing `audit_logs` table focused on user actions.

When FleetGraph executes an approved mutation via the Ship API, that mutation also generates a standard `audit_logs` entry (with `details.automated_by = 'fleetgraph'`), creating a cross-reference between the two audit streams.

---

## 9. Database Schema

Canonical split:

- `039_fleetgraph_alert_state.sql`
- `040_fleetgraph_approvals.sql`
- `041_fleetgraph_audit_log.sql`

LangGraph checkpoints are created separately by `PostgresSaver.setup()` inside the `fleetgraph` schema. Treat the combined migration example below as historical context, not the final migration plan.

### Historical combined example: `039_fleetgraph_approval_tables.sql`

```sql
-- FleetGraph approval tracking
-- Stores every approval request lifecycle from pending through resolution

CREATE TABLE IF NOT EXISTS fleetgraph_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- LangGraph execution reference
  thread_id TEXT NOT NULL UNIQUE,

  -- What was proposed
  action_type TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id UUID NOT NULL,
  target_entity_title TEXT NOT NULL DEFAULT '',
  evidence_summary TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  expected_effect TEXT NOT NULL DEFAULT '',
  risk_tier TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_tier IN ('low', 'medium', 'high')),
  fingerprint_hash TEXT NOT NULL,
  trace_link TEXT NOT NULL DEFAULT '',

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed', 'snoozed', 'expired')),
  responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  note TEXT,
  snooze_until TIMESTAMPTZ,

  -- Execution outcome (only populated after approval + execution)
  execution_result TEXT CHECK (execution_result IN ('success', 'failure')),
  execution_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query patterns: pending approvals per workspace, approvals by entity, expired approvals
CREATE INDEX idx_fleetgraph_approvals_workspace_status
  ON fleetgraph_approvals (workspace_id, status);
CREATE INDEX idx_fleetgraph_approvals_target
  ON fleetgraph_approvals (target_entity_type, target_entity_id);
CREATE INDEX idx_fleetgraph_approvals_expires
  ON fleetgraph_approvals (expires_at)
  WHERE status = 'pending';
CREATE INDEX idx_fleetgraph_approvals_fingerprint
  ON fleetgraph_approvals (fingerprint_hash, workspace_id);


-- FleetGraph alert state
-- Tracks dismiss/snooze state per fingerprint across graph runs
-- Prevents resurfacing dismissed alerts unless underlying state changes

CREATE TABLE IF NOT EXISTS fleetgraph_alert_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Alert identity
  fingerprint_hash TEXT NOT NULL,
  entity_digest TEXT,  -- Hash of relevant entity fields at time of last decision

  -- Current state
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dismissed', 'snoozed')),
  snoozed_until TIMESTAMPTZ,
  snoozed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Last surfaced
  last_surfaced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface_count INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One alert state per fingerprint per workspace
  UNIQUE (fingerprint_hash, workspace_id)
);

CREATE INDEX idx_fleetgraph_alert_state_snooze
  ON fleetgraph_alert_state (snoozed_until)
  WHERE status = 'snoozed';


-- FleetGraph audit log
-- Immutable event log for every step in the approval lifecycle

CREATE TABLE IF NOT EXISTS fleetgraph_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- References
  thread_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_entity_type TEXT,
  target_entity_id UUID,

  -- Event data
  details JSONB NOT NULL DEFAULT '{}',

  -- Immutable timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fleetgraph_audit_log_thread
  ON fleetgraph_audit_log (thread_id);
CREATE INDEX idx_fleetgraph_audit_log_workspace_time
  ON fleetgraph_audit_log (workspace_id, created_at DESC);
CREATE INDEX idx_fleetgraph_audit_log_event_type
  ON fleetgraph_audit_log (event_type);
```

### Table relationships

```
fleetgraph_approvals
  |-- workspace_id --> workspaces.id
  |-- responded_by --> users.id
  |-- thread_id (unique, used by LangGraph for resume)
  |-- fingerprint_hash --> fleetgraph_alert_state.fingerprint_hash (logical FK)

fleetgraph_alert_state
  |-- workspace_id --> workspaces.id
  |-- snoozed_by --> users.id
  |-- dismissed_by --> users.id
  |-- (fingerprint_hash, workspace_id) unique constraint

fleetgraph_audit_log
  |-- workspace_id --> workspaces.id
  |-- actor_user_id --> users.id
  |-- thread_id --> fleetgraph_approvals.thread_id (logical FK, not enforced)
```

### Why no foreign key from audit_log.thread_id to approvals.thread_id

Audit entries are created for events that may not have an approval row (e.g., `detection` events for conditions that route to `inform_only` instead of `confirm_action`). Enforcing a FK would prevent logging those events.

---

## Integration with Graph Node Design

This approval system maps directly to the node design in Phase 2:

```
... -> branch_decision -> [confirm_action path] -> prepare_action -> human_gate -> execute_action -> record_outcome
                       -> [inform_only path]    -> prepare_notification -> record_outcome
                       -> [no_issue path]       -> record_outcome
```

The `human_gate` node is the only place `interrupt()` is called. The `prepare_action` node is the only place the `ApprovalPayload` is constructed. The `execute_action` node is the only place Ship API mutations occur. This separation ensures the idempotency guarantee holds and the audit trail captures every transition.

---

## Open Questions

1. **Permission model for approval responses.** Current design: workspace admins and the target entity's owner or accountable user can respond. Should any workspace member be able to dismiss or snooze?

2. **Approval delegation.** If the accountable user is unavailable, should there be an explicit delegation chain, or is workspace admin sufficient?

3. **Batch approval UX.** The current design is one card at a time. If multiple approvals are pending, should the UI offer a bulk review mode? (This would be a Tier 2 feature; the initial implementation handles one approval per card.)

4. **Notification channel for pending approvals.** The current design uses in-app cards only. Email or Slack notifications for pending approvals that approach expiry would be a natural extension.
