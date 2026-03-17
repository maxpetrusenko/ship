# State Management Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready specification for every stateful surface in FleetGraph: the per-run graph state, LangGraph Annotation patterns, PostgresSaver checkpointing, persistent alert state, request-scope memoization, entity digest caching, on-demand conversation management, cold start behavior, and serialization constraints. After reading this document, a developer should be able to implement the full state layer without consulting external documentation.

## 1. Complete FleetGraphState Definition

### Supporting types

```typescript
/** Risk signal produced by heuristic_filter */
interface CandidateSignal {
  signalType:
    | "missing_standup"
    | "stale_issue"
    | "approval_bottleneck"
    | "scope_drift"
    | "risk_cluster"
    | "capacity_overload"
    | "ownership_gap";
  severity: "low" | "medium" | "high" | "critical";
  entityId: string;
  entityType: "issue" | "sprint" | "project";
  evidence: Record<string, unknown>;
  fingerprint: string;
}

/** Structured output from the reasoning node */
interface RiskAssessment {
  overallSeverity: "none" | "low" | "medium" | "high" | "critical";
  explanation: string;
  recommendation: string;
  suggestedAction: {
    type: "no_action" | "notify" | "mutate";
    target?: string;
    payload?: Record<string, unknown>;
  };
  confidence: number; // 0-100
}

/** Approval payload surfaced to the human */
interface ApprovalPayload {
  threadId: string;
  actionType: string;
  targetEntityId: string;
  targetEntityType: string;
  evidenceSummary: string;
  recommendedEffect: string;
  riskTier: "low" | "medium" | "high";
  generatedAt: string; // ISO 8601
  fingerprint: string;
  traceLink: string;
}

/** Human response to an approval gate */
type HumanDecision =
  | { action: "approve" }
  | { action: "dismiss"; reason?: string }
  | { action: "snooze"; until: string };

/** Action execution result */
interface ActionResult {
  success: boolean;
  httpStatus?: number;
  response?: Record<string, unknown>;
  error?: string;
}

/** A single conversation turn (on-demand mode) */
interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
}

/** Graph error state */
interface GraphError {
  message: string;
  node: string;
  recoverable: boolean;
}
```

### Full Annotation

```typescript
import { Annotation } from "@langchain/langgraph";

export const FleetGraphState = Annotation.Root({
  // ─── trigger_context writes ───────────────────────────────
  mode: Annotation<"proactive" | "on_demand">,
  actorId: Annotation<string | null>,
  entityId: Annotation<string>,
  entityType: Annotation<"issue" | "sprint" | "project">,
  workspaceId: Annotation<string>,
  traceId: Annotation<string>,

  // ─── fetch_core_context writes ────────────────────────────
  coreContext: Annotation<Record<string, unknown>>,

  // ─── fetch_parallel_signals writes ────────────────────────
  signals: Annotation<Record<string, unknown>>,

  // ─── heuristic_filter writes (reducer: accumulate) ────────
  candidates: Annotation<CandidateSignal[]>({
    reducer: (current, update) => {
      // Deduplicate by fingerprint on merge
      const seen = new Set(current.map((c) => c.fingerprint));
      const novel = update.filter((u) => !seen.has(u.fingerprint));
      return [...current, ...novel];
    },
    default: () => [],
  }),

  // ─── reason_about_risk writes ─────────────────────────────
  riskAssessment: Annotation<RiskAssessment | null>,

  // ─── branch_decision writes ───────────────────────────────
  branchPath: Annotation<
    "no_issue" | "inform_only" | "confirm_action" | "error"
  >,

  // ─── prepare_notification writes ──────────────────────────
  notification: Annotation<Record<string, unknown> | null>,

  // ─── prepare_action writes ────────────────────────────────
  approvalPayload: Annotation<ApprovalPayload | null>,

  // ─── human_gate writes ────────────────────────────────────
  humanDecision: Annotation<HumanDecision | null>,

  // ─── execute_action writes ────────────────────────────────
  actionResult: Annotation<ActionResult | null>,

  // ─── error_fallback writes ────────────────────────────────
  error: Annotation<GraphError | null>,

  // ─── on-demand conversation state (reducer: rolling window)
  conversationWindow: Annotation<ConversationTurn[]>({
    reducer: (current, update) => {
      const merged = [...current, ...update];
      // Keep most recent 20 turns
      if (merged.length > 20) {
        return merged.slice(merged.length - 20);
      }
      return merged;
    },
    default: () => [],
  }),

  // ─── conversation summary (old turns compressed) ──────────
  conversationSummary: Annotation<string | null>,

  // ─── memoization map (request-scope, reducer: merge) ──────
  memoCache: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});
```

### Field reference matrix

| Field | Type | Default | Channel | Writer Node(s) | Reader Node(s) |
|-------|------|---------|---------|-----------------|-----------------|
| `mode` | `"proactive" \| "on_demand"` | n/a | last-write | trigger_context | all downstream |
| `actorId` | `string \| null` | n/a | last-write | trigger_context | fetch_core_context, prepare_notification |
| `entityId` | `string` | n/a | last-write | trigger_context | fetch_core_context, fetch_parallel_signals, prepare_action |
| `entityType` | `"issue" \| "sprint" \| "project"` | n/a | last-write | trigger_context | fetch_core_context, fetch_parallel_signals, heuristic_filter |
| `workspaceId` | `string` | n/a | last-write | trigger_context | fetch_core_context, prepare_notification |
| `traceId` | `string` | n/a | last-write | trigger_context | prepare_notification, prepare_action, error_fallback |
| `coreContext` | `Record<string, unknown>` | n/a | last-write | fetch_core_context | fetch_parallel_signals, heuristic_filter, reason_about_risk |
| `signals` | `Record<string, unknown>` | n/a | last-write | fetch_parallel_signals | heuristic_filter, reason_about_risk |
| `candidates` | `CandidateSignal[]` | `[]` | reducer (dedupe) | heuristic_filter | reason_about_risk, prepare_notification, prepare_action |
| `riskAssessment` | `RiskAssessment \| null` | n/a | last-write | reason_about_risk | branch_decision, prepare_notification, prepare_action |
| `branchPath` | string enum | n/a | last-write | prepare_notification, prepare_action | (routing only) |
| `notification` | `Record \| null` | n/a | last-write | prepare_notification, error_fallback | deliver_alert |
| `approvalPayload` | `ApprovalPayload \| null` | n/a | last-write | prepare_action | human_gate |
| `humanDecision` | `HumanDecision \| null` | n/a | last-write | human_gate | post_approval_branch |
| `actionResult` | `ActionResult \| null` | n/a | last-write | execute_action | (terminal) |
| `error` | `GraphError \| null` | n/a | last-write | withErrorHandling wrapper | branch_decision, error_fallback |
| `conversationWindow` | `ConversationTurn[]` | `[]` | reducer (rolling 20) | on-demand entry, reason_about_risk | reason_about_risk |
| `conversationSummary` | `string \| null` | n/a | last-write | conversation summarizer | reason_about_risk |
| `memoCache` | `Record<string, unknown>` | `{}` | reducer (merge) | any fetch node | any fetch node |

### Initial state factory

```typescript
export function createInitialState(
  input: {
    entityId: string;
    entityType: "issue" | "sprint" | "project";
    workspaceId: string;
    actorId?: string | null;
    userMessage?: string;
  }
): Partial<typeof FleetGraphState.State> {
  return {
    mode: input.actorId ? "on_demand" : "proactive",
    actorId: input.actorId ?? null,
    entityId: input.entityId,
    entityType: input.entityType,
    workspaceId: input.workspaceId,
    traceId: crypto.randomUUID(),
    coreContext: {},
    signals: {},
    candidates: [],
    riskAssessment: null,
    branchPath: "no_issue",
    notification: null,
    approvalPayload: null,
    humanDecision: null,
    actionResult: null,
    error: null,
    conversationWindow: input.userMessage
      ? [{ role: "user", content: input.userMessage, timestamp: new Date().toISOString() }]
      : [],
    conversationSummary: null,
    memoCache: {},
  };
}
```

---

## 2. LangGraph Annotation Pattern

### Channel types

LangGraph JS uses `Annotation.Root` to define a typed state schema. Every field is a **channel** with one of two behaviors.

**Last-write-wins (value channel):**

```typescript
const State = Annotation.Root({
  count: Annotation<number>,
  name: Annotation<string>,
});
```

When a node returns `{ count: 5 }`, the previous value is replaced entirely. This is the default when `Annotation<T>` is called without arguments.

**Reducer channel (accumulate/merge):**

```typescript
const State = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});
```

When a node returns `{ messages: ["new msg"] }`, the reducer merges the update with the existing value. The `default` factory provides the initial value before any node writes.

### How LangGraph uses channels internally

1. **Initialization**: When a graph run begins, each channel is initialized using its `default()` factory (for reducer channels) or left undefined (for value channels) until the first node writes to it.

2. **Node output merge**: After a node returns a partial state update, LangGraph iterates over each key in the update. For value channels, the new value replaces the old. For reducer channels, the reducer function is called with `(currentValue, nodeReturnedValue)`.

3. **Checkpoint serialization**: The entire state object is JSON-serialized and stored in the PostgresSaver checkpoint. On resume, the state is deserialized and passed to the next node.

4. **Type extraction**: `typeof State.State` gives the full state type (all fields populated). `typeof State.Update` gives the partial update type (all fields optional), used as the return type for node functions.

### FleetGraph reducer rationale

| Field | Why reducer | Reducer behavior |
|-------|-------------|-----------------|
| `candidates` | Multiple heuristic checks may produce signals in separate fan-out paths; must accumulate without duplicating | Append with fingerprint-based dedup |
| `conversationWindow` | Each on-demand turn appends; old turns are trimmed to keep window at 20 | Append then slice |
| `memoCache` | Multiple fetch nodes contribute cache entries; must merge without overwriting | Shallow object merge |

All other fields use last-write-wins because only one node writes to each field, or the most recent write is the authoritative value.

### Custom reducer: signals accumulator (alternative)

If `signals` were written by multiple parallel fan-out nodes instead of a single `fetch_parallel_signals` node:

```typescript
signals: Annotation<Record<string, unknown>>({
  reducer: (current, update) => ({ ...current, ...update }),
  default: () => ({}),
}),
```

For the current graph design where `fetch_parallel_signals` is a single node using `Promise.all`, last-write-wins is sufficient.

---

## 3. PostgresSaver Setup

### Connection to Ship's existing PostgreSQL

FleetGraph reuses Ship's PostgreSQL instance. The checkpointer creates its own tables in an isolated schema.

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

// Dedicated pool for FleetGraph checkpoints.
// Separate from the Ship API's main pool to isolate connection limits.
const checkpointPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // Low pool size: checkpoint reads/writes are infrequent
});

const checkpointer = new PostgresSaver(checkpointPool, undefined, {
  schema: "fleetgraph",
});
```

### Schema isolation

The `schema: "fleetgraph"` option causes PostgresSaver to create all its tables under the `fleetgraph` Postgres schema. This keeps checkpoint tables separate from Ship's `public` schema tables (`documents`, `users`, `workspaces`, etc.).

The schema must be created before `checkpointer.setup()` runs. Add this to the FleetGraph initialization:

```typescript
export async function initFleetGraphCheckpointer(): Promise<PostgresSaver> {
  // Ensure the schema exists
  const client = await checkpointPool.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS fleetgraph");
  } finally {
    client.release();
  }

  const checkpointer = new PostgresSaver(checkpointPool, undefined, {
    schema: "fleetgraph",
  });

  // Creates tables and runs internal migrations
  await checkpointer.setup();

  return checkpointer;
}
```

### Tables created by setup()

PostgresSaver creates and manages the checkpoint tables automatically inside the `fleetgraph` schema. The exact auxiliary table set can vary by library version, but the canonical persistence boundary is schema-scoped, not `public`.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `fleetgraph.checkpoints` | Stores serialized graph state at each checkpoint | `thread_id TEXT`, `checkpoint_ns TEXT`, `checkpoint_id TEXT`, `parent_checkpoint_id TEXT`, `type TEXT`, `checkpoint JSONB`, `metadata JSONB` |
| `fleetgraph.checkpoint_writes` | Stores intermediate node outputs for a given checkpoint | `thread_id TEXT`, `checkpoint_ns TEXT`, `checkpoint_id TEXT`, `task_id TEXT`, `idx INTEGER`, `channel TEXT`, `type TEXT`, `blob BYTEA` |
| `fleetgraph.checkpoint_blobs` or version-specific auxiliary tables | Stores channel blobs and library-managed checkpoint artifacts | library-managed |

You never create these tables manually. `checkpointer.setup()` handles creation and future schema migrations.

### Thread ID generation strategy

The `thread_id` is the primary key for resumable execution. Canonical FleetGraph thread IDs are stable for any flow that might resume:

```typescript
// Proactive alert lifecycle: stable per fingerprint
function proactiveThreadId(workspaceId: string, fingerprint: string): string {
  return `fg-alert-${workspaceId}-${fingerprint}`;
}

// On-demand entity chat: stable per user + entity pair
function onDemandThreadId(
  workspaceId: string,
  entityType: string,
  entityId: string,
  actorId: string
): string {
  return `fg-chat-${workspaceId}-${entityType}-${entityId}-${actorId}`;
}

// One-shot analysis that will never resume can use trace IDs instead,
// but those are logging keys, not the persistence model.
function ephemeralRunId(traceId: string): string {
  return `fg-run-${traceId}`;
}
```

Use stable IDs whenever the graph may pause for human approval or continue a conversation later. Timestamped IDs are appropriate only for fire-and-forget runs with no resume path.

### Checkpoint lifecycle

**Create**: LangGraph calls `checkpointer.put()` automatically after each node completes. The full graph state is serialized to JSON and stored.

**Read**: When `graph.invoke()` is called with an existing `thread_id`, LangGraph calls `checkpointer.getTuple()` to load the most recent checkpoint for that thread. If an interrupt was active, execution resumes from the interrupted node.

**Update**: Each subsequent node completion overwrites the checkpoint for that thread. The `checkpoint_writes` table stores per-node outputs so partial progress is recoverable.

**Resume after interrupt**: When the `human_gate` node calls `interrupt()`, LangGraph persists the current state and returns. When `graph.invoke(new Command({ resume: decision }), { configurable: { thread_id } })` is called later, the checkpointer loads the interrupted state and the `interrupt()` call returns the resume value.

### Cleanup and expiry

Completed proactive sweeps generate many short-lived threads. Without cleanup, the checkpoint tables grow unboundedly.

```typescript
/**
 * Remove checkpoint threads older than retentionDays.
 * Run this on a daily schedule or as part of the sweep loop.
 */
async function cleanupOldCheckpoints(
  pool: pg.Pool,
  retentionDays: number = 14
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  // Delete writes first (FK dependency)
  await pool.query(`
    DELETE FROM fleetgraph.checkpoint_writes
    WHERE thread_id IN (
      SELECT DISTINCT thread_id FROM fleetgraph.checkpoints
      WHERE (metadata->>'created_at')::timestamptz < $1
    )
  `, [cutoff]);

  const result = await pool.query(`
    DELETE FROM fleetgraph.checkpoints
    WHERE (metadata->>'created_at')::timestamptz < $1
  `, [cutoff]);

  return result.rowCount ?? 0;
}
```

**Retention policy:**

| Thread type | Retention |
|-------------|-----------|
| Proactive sweep (completed) | 14 days |
| Proactive sweep (interrupted, pending approval) | Until resolved + 14 days |
| On-demand analysis (one-shot) | 7 days |
| On-demand conversation | 30 days from last activity |

---

## 4. Persistent Alert State

### Why separate from graph checkpoints

Graph checkpoints are per-run state. Alert state persists across runs: it tracks which alerts have been surfaced, dismissed, or snoozed, and whether the underlying entity has changed since the last alert. Without this table, proactive mode repeats the same alert every 4 minutes.

### fleetgraph_alert_state table design

This table follows Ship's existing migration pattern. It is the first FleetGraph product-state migration: `api/src/db/migrations/039_fleetgraph_alert_state.sql`. Approvals and audit rows live in subsequent Ship migrations. LangGraph checkpoint tables are not numbered Ship migrations; `PostgresSaver.setup()` creates and migrates them inside the `fleetgraph` schema.

```sql
-- FleetGraph alert state: persistent dedupe and snooze tracking
-- Prevents repeated alerts for unchanged entity conditions

CREATE SCHEMA IF NOT EXISTS fleetgraph;

CREATE TABLE IF NOT EXISTS fleetgraph.alert_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alert identity
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,          -- Deterministic hash of signal type + entity + key evidence
  signal_type TEXT NOT NULL,          -- e.g. 'stale_issue', 'approval_bottleneck'

  -- Target entity
  entity_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('issue', 'sprint', 'project')),

  -- Last known entity state
  entity_digest TEXT,                 -- SHA-256 of key entity fields for change detection
  entity_digest_computed_at TIMESTAMPTZ,

  -- Alert lifecycle
  last_surfaced_at TIMESTAMPTZ,      -- When this alert was last shown to a human
  last_outcome TEXT CHECK (last_outcome IN ('delivered', 'dismissed', 'snoozed', 'approved', 'expired')),

  -- Snooze/dismiss
  snoozed_until TIMESTAMPTZ,         -- NULL = not snoozed; timestamp = suppress until
  dismissed_at TIMESTAMPTZ,          -- NULL = not dismissed
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismiss_reason TEXT,

  -- Bookkeeping
  surface_count INTEGER DEFAULT 0,   -- How many times this fingerprint has been surfaced
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One alert record per fingerprint per workspace
  UNIQUE(workspace_id, fingerprint)
);

-- Indexes for sweep lookups
CREATE INDEX IF NOT EXISTS idx_fg_alert_workspace_entity
  ON fleetgraph.alert_state(workspace_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_fg_alert_fingerprint
  ON fleetgraph.alert_state(fingerprint);

CREATE INDEX IF NOT EXISTS idx_fg_alert_snoozed
  ON fleetgraph.alert_state(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fg_alert_signal_type
  ON fleetgraph.alert_state(signal_type);

COMMENT ON TABLE fleetgraph.alert_state IS
  'Persistent alert dedupe, snooze, and dismiss state for FleetGraph proactive mode. One row per unique fingerprint per workspace.';
```

### Alert fingerprint generation

The fingerprint is a deterministic hash that identifies a specific condition on a specific entity. The same condition detected on different sweep cycles produces the same fingerprint, enabling dedupe.

```typescript
import { createHash } from "crypto";

/**
 * Generate a stable fingerprint for an alert condition.
 *
 * Components:
 *   signalType  - The heuristic that fired (e.g. "stale_issue")
 *   entityId    - The target entity UUID
 *   ...variant  - Additional discriminators (e.g. approval type, issue updated_at)
 *
 * The variant prevents different conditions on the same entity from colliding.
 * Example: two different stale issues in the same sprint produce different
 * fingerprints because their entityIds differ.
 */
export function alertFingerprint(
  signalType: string,
  entityId: string,
  ...variant: string[]
): string {
  const input = [signalType, entityId, ...variant].join("::");
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
```

**Fingerprint examples:**

| Signal | Inputs | Fingerprint uniqueness |
|--------|--------|----------------------|
| `stale_issue` | signalType + issue ID + issue updated_at | Changes when the issue is updated (reset) |
| `missing_standup` | signalType + sprint ID + missing day list hash | Changes when a new day is missed or a standup is posted |
| `approval_bottleneck` | signalType + sprint ID + approval type ("plan" or "review") | Stable until approval state changes |
| `scope_drift` | signalType + sprint ID + added issue ID | One fingerprint per added issue |

### Dismiss and snooze state tracking

```typescript
/**
 * Check whether an alert should be suppressed.
 * Called by heuristic_filter before surfacing a candidate.
 */
export async function shouldSuppressAlert(
  pool: pg.Pool,
  workspaceId: string,
  fingerprint: string,
  currentDigest: string
): Promise<{ suppress: boolean; reason?: string }> {
  const result = await pool.query(`
    SELECT
      dismissed_at,
      snoozed_until,
      entity_digest,
      last_outcome
    FROM fleetgraph.alert_state
    WHERE workspace_id = $1 AND fingerprint = $2
  `, [workspaceId, fingerprint]);

  if (result.rows.length === 0) {
    return { suppress: false };
  }

  const row = result.rows[0];

  // Dismissed and entity unchanged since dismissal
  if (row.dismissed_at && row.entity_digest === currentDigest) {
    return { suppress: true, reason: "dismissed_unchanged" };
  }

  // Snoozed and snooze has not expired
  if (row.snoozed_until && new Date(row.snoozed_until) > new Date()) {
    return { suppress: true, reason: "snoozed" };
  }

  // Entity changed since last alert: re-surface
  if (row.entity_digest !== currentDigest) {
    return { suppress: false };
  }

  // Already surfaced for this exact state
  if (row.entity_digest === currentDigest && row.last_surfaced_at) {
    return { suppress: true, reason: "already_surfaced" };
  }

  return { suppress: false };
}
```

### Entity digest for change detection

The entity digest is a hash of key fields that, if changed, mean the alert should be re-evaluated.

```typescript
/**
 * Compute a digest of the fields that matter for alert decisions.
 * If this digest changes, previously dismissed/snoozed alerts
 * should be re-evaluated.
 */
export function computeEntityDigest(
  entityType: string,
  entity: Record<string, unknown>
): string {
  let fields: Record<string, unknown>;

  switch (entityType) {
    case "issue":
      fields = {
        state: entity.state ?? entity.properties?.state,
        assignee_id: entity.assignee_id ?? entity.properties?.assignee_id,
        priority: entity.priority ?? entity.properties?.priority,
        updated_at: entity.updated_at,
      };
      break;

    case "sprint":
      fields = {
        plan_approval: entity.properties?.plan_approval,
        review_approval: entity.properties?.review_approval,
        sprint_status: entity.properties?.sprint_status,
        updated_at: entity.updated_at,
      };
      break;

    case "project":
      fields = {
        owner_id: entity.properties?.owner_id,
        accountable_id: entity.properties?.accountable_id,
        updated_at: entity.updated_at,
      };
      break;

    default:
      fields = { updated_at: entity.updated_at };
  }

  const input = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
```

### Recording alert outcomes

```typescript
export async function recordAlertOutcome(
  pool: pg.Pool,
  params: {
    workspaceId: string;
    fingerprint: string;
    signalType: string;
    entityId: string;
    entityType: string;
    entityDigest: string;
    outcome: "delivered" | "dismissed" | "snoozed" | "approved";
    dismissedBy?: string;
    dismissReason?: string;
    snoozedUntil?: string;
  }
): Promise<void> {
  await pool.query(`
    INSERT INTO fleetgraph.alert_state (
      workspace_id, fingerprint, signal_type,
      entity_id, entity_type, entity_digest, entity_digest_computed_at,
      last_surfaced_at, last_outcome, surface_count,
      snoozed_until, dismissed_at, dismissed_by, dismiss_reason,
      updated_at
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, now(),
      now(), $7, 1,
      $8, $9, $10, $11,
      now()
    )
    ON CONFLICT (workspace_id, fingerprint) DO UPDATE SET
      entity_digest = EXCLUDED.entity_digest,
      entity_digest_computed_at = now(),
      last_surfaced_at = now(),
      last_outcome = EXCLUDED.last_outcome,
      surface_count = fleetgraph.alert_state.surface_count + 1,
      snoozed_until = EXCLUDED.snoozed_until,
      dismissed_at = EXCLUDED.dismissed_at,
      dismissed_by = EXCLUDED.dismissed_by,
      dismiss_reason = EXCLUDED.dismiss_reason,
      updated_at = now()
  `, [
    params.workspaceId,
    params.fingerprint,
    params.signalType,
    params.entityId,
    params.entityType,
    params.entityDigest,
    params.outcome,
    params.snoozedUntil ?? null,
    params.outcome === "dismissed" ? new Date().toISOString() : null,
    params.dismissedBy ?? null,
    params.dismissReason ?? null,
  ]);
}
```

---

## 5. Request-Scope Memoization

### Problem

Within a single graph run, multiple nodes may need the same API data. `fetch_core_context` might load sprint issues. `fetch_parallel_signals` might need the same sprint issues for scope drift detection. Without memoization, the same `GET /api/issues?sprint_id=X` call fires twice.

### Memoization map pattern

The `memoCache` state field acts as a request-scope cache. Every fetch node checks it before making an API call, and writes results back into it.

```typescript
/**
 * Build a cache key from an API endpoint and parameters.
 * Deterministic: same endpoint + params always produce the same key.
 */
function memoCacheKey(endpoint: string, params?: Record<string, string>): string {
  const paramStr = params
    ? Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")
    : "";
  return `${endpoint}?${paramStr}`;
}

/**
 * Fetch with memoization. Returns cached result if available.
 * Caller must include the returned memoCache update in its state return.
 */
async function memoFetch(
  memoCache: Record<string, unknown>,
  endpoint: string,
  params?: Record<string, string>
): Promise<{ data: unknown; cacheUpdate: Record<string, unknown> }> {
  const key = memoCacheKey(endpoint, params);

  // Cache hit
  if (key in memoCache) {
    return { data: memoCache[key], cacheUpdate: {} };
  }

  // Cache miss: make the API call
  const url = params
    ? `${endpoint}?${new URLSearchParams(params).toString()}`
    : endpoint;
  const data = await shipApi.get(url);

  return {
    data,
    cacheUpdate: { [key]: data },
  };
}
```

### Usage in a fetch node

```typescript
async function fetchParallelSignals(state: typeof FleetGraphState.State) {
  const cache = state.memoCache;
  const cacheUpdates: Record<string, unknown> = {};
  const signals: Record<string, unknown> = {};

  // Sprint issues (may already be in cache from fetch_core_context)
  if (state.entityType === "sprint") {
    const { data, cacheUpdate } = await memoFetch(
      { ...cache, ...cacheUpdates },
      "/api/issues",
      { sprint_id: state.entityId }
    );
    Object.assign(cacheUpdates, cacheUpdate);
    signals.sprintIssues = data;
  }

  // ... more fetches ...

  return {
    signals,
    memoCache: cacheUpdates, // Reducer merges into existing cache
  };
}
```

### Scope lifetime

The memoization cache lives only within the graph state for a single run. When the run completes, the state (including `memoCache`) is checkpointed, but the next fresh invocation starts with an empty `memoCache` from the default factory.

For resumed interrupt flows, the cache is restored from the checkpoint. This is fine because the resume only executes post-gate nodes that do not make fetch calls (except `execute_action`, which always re-fetches for freshness).

---

## 6. Entity Digest Caching

### Problem

Proactive sweeps run every 4 minutes. Most entities do not change between sweeps. Without a cross-run cache, FleetGraph fetches and re-processes every entity on every sweep, wasting API calls and (potentially) LLM tokens on unchanged data.

### How it works

Before a sweep fetches and reasons about an entity, it checks whether the entity's digest has changed since the last sweep.

```
Sweep start
  |
  v
For each entity in scope:
  1. Quick-fetch entity metadata (lightweight: GET /api/issues/:id or sprint payload)
  2. Compute entity digest from key fields
  3. Compare against stored digest in fleetgraph.alert_state
  4. If unchanged: skip this entity (no fetch, no heuristics, no LLM)
  5. If changed or no prior digest: proceed with full graph run
```

### Storage location

Entity digests are stored in the `fleetgraph.alert_state` table in the `entity_digest` and `entity_digest_computed_at` columns. This collocates digest tracking with alert suppression, avoiding a second table.

For entities with no prior alert record, an in-memory `Map<string, { digest: string; computedAt: Date }>` serves as a fast lookup during the sweep loop. This map is populated at sweep start and discarded at sweep end.

```typescript
/**
 * Sweep-scope digest cache. Populated once per sweep cycle.
 * Avoids repeated DB lookups within the same sweep.
 */
class SweepDigestCache {
  private cache = new Map<string, { digest: string; computedAt: Date }>();

  async loadFromDb(pool: pg.Pool, workspaceId: string): Promise<void> {
    const result = await pool.query(`
      SELECT entity_id, entity_digest, entity_digest_computed_at
      FROM fleetgraph.alert_state
      WHERE workspace_id = $1
        AND entity_digest IS NOT NULL
        AND entity_digest_computed_at > now() - interval '5 minutes'
    `, [workspaceId]);

    for (const row of result.rows) {
      this.cache.set(row.entity_id, {
        digest: row.entity_digest,
        computedAt: new Date(row.entity_digest_computed_at),
      });
    }
  }

  hasUnchanged(entityId: string, currentDigest: string): boolean {
    const cached = this.cache.get(entityId);
    if (!cached) return false;
    return cached.digest === currentDigest;
  }
}
```

### TTL

Cached digests are valid for 4 minutes. The query above filters `entity_digest_computed_at > now() - interval '4 minutes'` to ensure stale digests are ignored.

If a digest is older than 4 minutes, the entity is treated as changed and proceeds through the full pipeline.

### Skip logic

```typescript
async function sweepEntity(
  pool: pg.Pool,
  digestCache: SweepDigestCache,
  entity: { id: string; type: string },
  workspaceId: string
): Promise<"skipped" | "processed"> {
  // 1. Lightweight metadata fetch
  const metadata = await shipApi.get(`/api/${entity.type}s/${entity.id}`);

  // 2. Compute current digest
  const currentDigest = computeEntityDigest(entity.type, metadata);

  // 3. Check cache
  if (digestCache.hasUnchanged(entity.id, currentDigest)) {
    return "skipped"; // Entity unchanged; no graph run needed
  }

  // 4. Entity changed or no prior digest: run the full graph
  const graph = await getFleetGraph();
  await graph.invoke(
    createInitialState({ entityId: entity.id, entityType: entity.type as any, workspaceId }),
    {
      configurable: { thread_id: proactiveThreadId(entity.id) },
      metadata: { mode: "proactive", entityType: entity.type, entityId: entity.id },
      tags: ["fleetgraph", "proactive", entity.type],
    }
  );

  return "processed";
}
```

---

## 7. On-Demand Conversation State

### Problem

On-demand mode supports multi-turn conversation. The user asks "what matters here?", gets a response, then asks follow-up questions. The conversation must maintain context without unbounded growth.

### Rolling window of recent turns

The `conversationWindow` state field (defined in section 1) uses a reducer that keeps the most recent 20 turns. Each turn is a `{ role, content, timestamp }` object.

**Why 20 turns:**

- A typical on-demand interaction is 3-8 turns
- 20 turns provides generous context for deep follow-up
- At ~200 tokens average per turn, 20 turns is ~4,000 tokens of conversation context
- This stays well within the token budget alongside entity context

### Summarization of old turns

When the conversation exceeds 20 turns, the oldest turns are dropped by the reducer. Before they are dropped, a summarization step compresses them into `conversationSummary`.

```typescript
/**
 * Called when conversation exceeds the rolling window.
 * Summarizes the oldest turns before they are trimmed.
 */
async function summarizeOldTurns(
  turns: ConversationTurn[],
  existingSummary: string | null
): Promise<string> {
  // Only summarize if we have turns to compress
  const turnsToCompress = turns.slice(0, turns.length - 20);
  if (turnsToCompress.length === 0) return existingSummary ?? "";

  const openai = new OpenAI();

  const response = await openai.responses.create({
    model: getFleetGraphModel("conversation_summary"),
    instructions: `Summarize this conversation history into 2-3 sentences.
Preserve key decisions, entity references, and user preferences.
If there is an existing summary, incorporate it.`,
    input: [
      {
        role: "user",
        content: JSON.stringify({
          existingSummary: existingSummary ?? "none",
          turnsToSummarize: turnsToCompress.map((t) => ({
            role: t.role,
            content: t.content,
          })),
        }),
      },
    ],
  });

  return response.output_text;
}
```

This summarization runs inside the `trigger_context` node when on-demand mode detects the conversation window is full.

### Thread ID and session management

On-demand conversations use a stable `thread_id` per user + entity pair:

```typescript
// Stable across turns: same user looking at same entity resumes the thread
const threadId = `fg-chat-${entityId}-${actorId}`;
```

This means:
- First message on an entity creates a new checkpoint thread
- Subsequent messages on the same entity resume the thread and accumulate turns
- Looking at a different entity starts a fresh thread
- A different user on the same entity gets their own thread

### Session timeout and cleanup

Conversation threads expire after 30 minutes of inactivity. The cleanup job checks `metadata.last_activity` from the checkpoint metadata.

```typescript
async function cleanupStaleConversations(
  pool: pg.Pool,
  timeoutMinutes: number = 30
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();

  // Find conversation threads (fg-chat-*) with old activity
  const result = await pool.query(`
    SELECT DISTINCT thread_id FROM fleetgraph.checkpoints
    WHERE thread_id LIKE 'fg-chat-%'
      AND (metadata->>'last_activity')::timestamptz < $1
  `, [cutoff]);

  let cleaned = 0;
  for (const row of result.rows) {
    await checkpointer.deleteThread(row.thread_id);
    cleaned++;
  }

  return cleaned;
}
```

When a user returns to an entity after the session expired, FleetGraph starts a fresh conversation with the current page context.

---

## 8. Cold Start Behavior

### What cold start means

Cold start occurs when FleetGraph has little or no historical data to work with:

- A new workspace with no prior sweep history
- A newly created project, sprint, or issue
- A workspace that just enabled FleetGraph
- First proactive sweep after deployment

### Which use cases degrade gracefully

| Use case | Minimum data required | Cold start behavior |
|----------|----------------------|---------------------|
| Stale issue detection | At least one `in_progress` issue with a `created_at` or `updated_at` timestamp | Works immediately; any issue older than 3 business days in active state triggers |
| Missing standup | At least one sprint with a defined date range | Works immediately; checks standup records against expected business days |
| Approval bottleneck | A sprint with `plan_approval` or `review_approval` set to `pending` | Works immediately; age computed from approval state timestamp |
| Scope drift | A sprint with `planned_issue_ids` and `snapshot_taken_at` populated | Requires planning snapshot to have been taken. New sprints without snapshots produce no signal (graceful no-op) |
| Risk clustering | Two or more individual signals on the same project | Requires other heuristics to fire first. No single-signal clusters. |
| Sprint carryover (stretch) | Three or more consecutive sprints with the same issue | Requires sprint history. New projects with one sprint cannot detect carryover. Report "not enough history yet." |
| On-demand chat | The entity must exist and be fetchable via API | Works immediately. The first response loads current state and answers from it. |

### What to show the user

When FleetGraph determines it cannot provide a meaningful answer due to insufficient history:

```typescript
const COLD_START_RESPONSES: Record<string, string> = {
  no_sprint_history:
    "This project has only one sprint so far. Cross-sprint patterns like carryover " +
    "detection need at least three sprints of data. FleetGraph will start tracking " +
    "these patterns as more sprints complete.",

  no_planning_snapshot:
    "This sprint does not have a planning snapshot yet. Scope drift detection " +
    "activates after the sprint plan is finalized and snapshotted.",

  empty_workspace:
    "This workspace is new. FleetGraph is monitoring for activity. " +
    "Alerts will start appearing once issues, sprints, and standups are created.",

  no_activity_baseline:
    "There is not enough activity history to establish a baseline for this project. " +
    "Velocity and activity comparisons need at least 4 weeks of data.",
};
```

### Minimum data requirements per use case

```typescript
interface ColdStartCheck {
  useCase: string;
  check: (coreContext: Record<string, unknown>) => boolean;
  message: string;
}

const COLD_START_CHECKS: ColdStartCheck[] = [
  {
    useCase: "scope_drift",
    check: (ctx) => {
      const sprint = ctx.claudeContext as any;
      return Boolean(sprint?.planned_issue_ids?.length && sprint?.snapshot_taken_at);
    },
    message: COLD_START_RESPONSES.no_planning_snapshot,
  },
  {
    useCase: "carryover_detection",
    check: (ctx) => {
      const retro = ctx.retroContext as any;
      return (retro?.sprints?.length ?? 0) >= 3;
    },
    message: COLD_START_RESPONSES.no_sprint_history,
  },
  // ... additional checks
];
```

These checks run in `heuristic_filter`. If a check fails, the corresponding heuristic is skipped and the cold-start message is included in the response for on-demand mode.

---

## 9. State Serialization Concerns

### JSON-serializable only

PostgresSaver serializes graph state as JSON. Everything in `FleetGraphState` must be JSON-serializable.

**Allowed:**
- Strings, numbers, booleans, null
- Arrays of the above
- Plain objects (no class instances)
- Nested combinations of the above
- ISO 8601 date strings (not Date objects)

**Prohibited:**
- `Date` objects (use ISO strings instead)
- Functions or closures
- `Map` and `Set` instances (use plain objects and arrays)
- Circular references (JSON.stringify throws)
- `undefined` values (dropped by JSON.stringify)
- `BigInt` values
- Symbols
- Class instances with methods

### Converting prohibited types

```typescript
// BAD: Date object in state
return { lastChecked: new Date() };

// GOOD: ISO string in state
return { lastChecked: new Date().toISOString() };

// BAD: Map in state
return { cache: new Map([["key", "value"]]) };

// GOOD: Plain object in state
return { cache: { key: "value" } };

// BAD: Set in state
return { seen: new Set(["a", "b"]) };

// GOOD: Array in state
return { seen: ["a", "b"] };
```

### Handling large payloads

Raw Ship API responses can be large, especially `coreContext` from the Claude context endpoint. Storing full payloads inflates checkpoint size and slows serialization.

**Strategy: summarize before storing.**

```typescript
/**
 * Extract only the fields needed by downstream nodes.
 * Keep coreContext under ~50KB when serialized.
 */
function compactCoreContext(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    // Issue: keep metadata, drop full content bodies
    issue: raw.issue ? {
      id: (raw.issue as any).id,
      title: (raw.issue as any).title,
      state: (raw.issue as any).properties?.state,
      priority: (raw.issue as any).properties?.priority,
      assignee_id: (raw.issue as any).properties?.assignee_id,
      updated_at: (raw.issue as any).updated_at,
      created_at: (raw.issue as any).created_at,
    } : undefined,

    // History: keep last 10 entries only
    history: raw.history
      ? (raw.history as any[]).slice(-10).map((h) => ({
          field: h.field,
          old_value: h.old_value,
          new_value: h.new_value,
          changed_by: h.changed_by,
          created_at: h.created_at,
        }))
      : undefined,

    // Children: keep IDs and states only
    children: raw.children
      ? (raw.children as any[]).map((c) => ({
          id: c.id,
          title: c.title,
          state: c.properties?.state,
        }))
      : undefined,

    // Drop: content bodies, yjs_state, full TipTap JSON
  };
}
```

### State size limits and monitoring

PostgresSaver does not enforce a hard size limit, but large checkpoints degrade performance. Guidelines:

| Concern | Threshold | Action |
|---------|-----------|--------|
| Single checkpoint size | > 100KB | Audit what is being stored. Summarize or drop verbose fields. |
| `coreContext` serialized size | > 50KB | Use `compactCoreContext` to trim. |
| `conversationWindow` serialized size | > 20KB | Reduce max turns from 20 to 15. Summarize more aggressively. |
| `memoCache` serialized size | > 30KB | Evict entries for API calls that are only needed once. |
| Total checkpoint writes per sweep | > 1000 rows/minute | Increase digest caching TTL. Reduce sweep scope. |

**Monitoring query:**

```sql
-- Check average checkpoint size in the last hour
SELECT
  avg(pg_column_size(checkpoint)) AS avg_bytes,
  max(pg_column_size(checkpoint)) AS max_bytes,
  count(*) AS checkpoint_count
FROM fleetgraph.checkpoints
WHERE (metadata->>'created_at')::timestamptz > now() - interval '1 hour';
```

### What should never be in state

| Data | Why excluded | Where it goes instead |
|------|-------------|----------------------|
| Full TipTap document content | Too large; changes frequently; not needed for reasoning | Fetch on demand from Ship API |
| Yjs binary state | Not JSON-serializable; large | Never fetched by FleetGraph |
| User passwords or session tokens | Security risk | Never fetched by FleetGraph |
| Raw API response headers | Noise; not useful for reasoning | Dropped after fetch |
| Intermediate computation artifacts | Bloat; only final results matter | Local variables in node functions |

---

## Relationship to Other Phase 2 Docs

| Document | Relationship |
|----------|-------------|
| [04. Node Design / README](../04.%20Node%20Design/README.md) | Node inventory that reads/writes the state defined here |
| [06. Human-in-the-Loop Design / README](../06.%20Human-in-the-Loop%20Design/README.md) | Dismiss and snooze UX that updates `fleetgraph.alert_state` |
| [07. Error and Failure Handling / README](../07.%20Error%20and%20Failure%20Handling/README.md) | Error state field and recovery patterns |
| [Presearch / 04. LangGraph and LangSmith / DEEP_DIVE](../../Presearch/04.%20LangGraph%20and%20LangSmith/DEEP_DIVE.md) | PostgresSaver setup, Annotation pattern, and interrupt flow |
| [Presearch / 05. Required Node Types / DEEP_DIVE](../../Presearch/05.%20Required%20Node%20Types/DEEP_DIVE.md) | Per-node read/write contracts against this state |
