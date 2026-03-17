# Performance Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready performance specification for FleetGraph. Covers per-node execution budgets, Ship API response time analysis, OpenAI optimization, parallel fetch patterns, caching strategy, database query performance, memory profiling, load testing, and runtime monitoring.

Current Ship facts in this document come from code-path inspection and configuration references. Performance budgets, SLAs, latency tables, memory ceilings, and scale breakpoints are proposed FleetGraph targets or assumptions unless this document explicitly says they were benchmarked.

## 1. Performance Budget Allocation

Every graph execution is a pipeline of discrete nodes. Each node has a hard time budget. If a node exceeds its budget, the pipeline either degrades gracefully or aborts with a logged warning.

### Per-Node Budget Table

| Node | Target | P99 Ceiling | Strategy | I/O |
|------|--------|-------------|----------|-----|
| `trigger_context` | <10ms | 25ms | Pure computation: parse event payload, construct candidate shape | None |
| `fetch_core_context` | <200ms | 500ms | Parallel API calls via `Promise.all` for entity + parent context | 2-3 HTTP |
| `fetch_parallel_signals` | <500ms | 1,200ms | `Promise.all` with 5 concurrent fetches, 2s timeout per fetch | 3-5 HTTP |
| `heuristic_filter` | <50ms | 100ms | Deterministic checks on pre-fetched data, zero I/O | None |
| `reason_about_risk` | <3,000ms | 8,000ms | OpenAI Responses API structured output, narrow context | 1 HTTPS |
| `prepare_notification` | <10ms | 25ms | Template rendering from structured assessment output | None |
| `human_gate` | N/A | N/A | Async WebSocket delivery + user action; not in critical path | WS |
| `execute_action` | <500ms | 2,000ms | Ship API PATCH (single document update) | 1 HTTP |
| `error_fallback` | <10ms | 25ms | Log structured error, return safe default | None |

### Aggregate Budgets by Path

| Path | Sum of Node Budgets | Target End-to-End | SLA |
|------|--------------------|--------------------|-----|
| Event-triggered (fast) | ~3,770ms | <5,000ms | <30s |
| Sweep-triggered (batch) | ~4,270ms per candidate | <5,000ms pipeline | <5min total cycle |
| On-demand (streaming) | ~700ms to first token | <2,000ms to first token | <3s |

### Budget Enforcement

```typescript
// api/src/fleetgraph/budget.ts

interface NodeBudget {
  name: string;
  targetMs: number;
  ceilingMs: number;
}

const NODE_BUDGETS: Record<string, NodeBudget> = {
  trigger_context:        { name: 'trigger_context',        targetMs: 10,    ceilingMs: 25 },
  fetch_core_context:     { name: 'fetch_core_context',     targetMs: 200,   ceilingMs: 500 },
  fetch_parallel_signals: { name: 'fetch_parallel_signals', targetMs: 500,   ceilingMs: 1200 },
  heuristic_filter:       { name: 'heuristic_filter',       targetMs: 50,    ceilingMs: 100 },
  reason_about_risk:      { name: 'reason_about_risk',      targetMs: 3000,  ceilingMs: 8000 },
  prepare_notification:   { name: 'prepare_notification',   targetMs: 10,    ceilingMs: 25 },
  execute_action:         { name: 'execute_action',         targetMs: 500,   ceilingMs: 2000 },
  error_fallback:         { name: 'error_fallback',         targetMs: 10,    ceilingMs: 25 },
};

export function checkBudget(nodeName: string, durationMs: number): {
  withinTarget: boolean;
  withinCeiling: boolean;
  overshootMs: number;
} {
  const budget = NODE_BUDGETS[nodeName];
  if (!budget) return { withinTarget: true, withinCeiling: true, overshootMs: 0 };

  return {
    withinTarget: durationMs <= budget.targetMs,
    withinCeiling: durationMs <= budget.ceilingMs,
    overshootMs: Math.max(0, durationMs - budget.ceilingMs),
  };
}
```

When a node exceeds its ceiling, the pipeline logs a structured warning and continues. The exception is `reason_about_risk`: if it exceeds 10 seconds, the call is aborted and the candidate is re-queued for the next sweep cycle.

## 2. Ship API Performance

### Endpoint Response Time Analysis

FleetGraph is planned to call Ship API endpoints via HTTP. In the likely same-host or same-process deployment described elsewhere in this doc, network latency should be small relative to database and model latency, but that remains a deployment assumption rather than a benchmark result.

#### Endpoints FleetGraph Calls

| Endpoint | Query Complexity | Expected Latency | Notes |
|----------|-----------------|-------------------|-------|
| `GET /api/weeks` (active sprints) | Medium: joins `documents`, `document_associations`, `users`; correlated subqueries for `issue_count`, `completed_count`, `started_count`, `has_plan`, `has_retro` | 50-200ms | Heaviest per-row cost due to 6 correlated subqueries. Mitigated by filtering to current sprint number. |
| `GET /api/issues?state=in_progress,in_review,todo` | Light-Medium: single table scan on `documents` with JSONB property filter, LEFT JOIN to `users` | 30-100ms (planning estimate) | Scales with total issue count. Example estimate for a medium workspace is ~80ms, but this repo does not yet include FleetGraph-specific benchmarks. |
| `GET /api/team/accountability-grid-v3` | Heavy: 4 sequential queries (workspace, people, programs, sprint assignments with multi-table joins) | 100-400ms | Admin-only. Most expensive endpoint FleetGraph calls. Contains `jsonb_array_elements_text` expansion. |
| `GET /api/weeks/:id` (single sprint) | Light: single row lookup by ID with same subqueries as list | 15-50ms | Fixed cost regardless of workspace size. |
| `GET /api/issues/:id` (single issue) | Light: single row lookup with association fetch | 10-30ms | Used in event-triggered path for context enrichment. |
| `PATCH /api/issues/:id` | Light: single UPDATE + association management | 20-60ms | Used by `execute_action` node for state changes. |
| `GET /api/weeks/:id/standups` | Light-Medium: filtered document query | 20-80ms | Returns standup entries for a sprint. |
| `GET /api/weeks/:id/scope-changes` | Medium: compares issue timestamps against approval timestamps | 30-100ms | Used for scope creep detection. |

#### Query Weight Analysis from Codebase

The `GET /api/weeks` endpoint (file: `api/src/routes/weeks.ts`, line 360) is the heaviest because each sprint row triggers 6 correlated subqueries:

```sql
-- Each of these runs per-row in the result set:
(SELECT COUNT(*) FROM documents i JOIN document_associations ...)  -- issue_count
(SELECT COUNT(*) FROM documents i JOIN document_associations ...)  -- completed_count
(SELECT COUNT(*) FROM documents i JOIN document_associations ...)  -- started_count
(SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = ...)  -- has_plan
(SELECT COUNT(*) > 0 FROM documents rt JOIN document_associations ...) -- has_retro
(SELECT rt.properties->>'outcome' FROM documents rt JOIN ...)     -- retro_outcome
```

For a workspace with 10 active sprints, this means ~60 subquery executions. PostgreSQL optimizes these with nested loop joins, but the cost is non-trivial.

The `GET /api/issues` endpoint (file: `api/src/routes/issues.ts`, line 158) is lighter: a single table scan with optional JSONB property filters and a LEFT JOIN for assignee names. The `properties->>'state' = ANY($N)` filter uses a sequential scan on the JSONB column (no GIN index on individual properties).

#### Connection Pool Configuration

From `api/src/db/client.ts`:

```typescript
const pool = new Pool({
  max: isProduction ? 20 : 10,          // Max connections
  idleTimeoutMillis: 30000,             // 30s idle reclaim
  connectionTimeoutMillis: 2000,        // 2s connection acquire timeout
  maxUses: 7500,                        // Recycle after 7500 queries
  statement_timeout: 30000,             // 30s query timeout
});
```

**Implication for FleetGraph:** The 20-connection pool is shared between user-facing API requests and FleetGraph internal calls. A sweep cycle that fires 3 parallel HTTP requests consumes at most 3 connections simultaneously (one per request handler). This is 15% of the production pool. Under heavy user load, FleetGraph requests may queue for connection acquisition (up to the 2s `connectionTimeoutMillis`).

### Recommended: Dedicated FleetGraph Pool Partition

```typescript
// api/src/fleetgraph/db.ts

import pg from 'pg';

const { Pool } = pg;

// Separate pool for FleetGraph operations
// Prevents FleetGraph sweeps from competing with user requests
export const fleetGraphPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,                               // 3 connections is sufficient for sweep workload
  idleTimeoutMillis: 60000,             // Keep connections warm between sweeps
  connectionTimeoutMillis: 1000,        // Fail fast: 1s
  statement_timeout: 10000,             // FleetGraph queries should be fast; 10s hard limit
});
```

This is a proposed isolation strategy for FleetGraph traffic. The total pool across both becomes 23 connections, which is typically acceptable for managed Postgres deployments, but the safe ceiling depends on the actual database tier and should be verified in the target environment.

## 3. OpenAI API Optimization

### Model Selection Matrix

Policy note: follow [`../10. Cost Analysis/README.md`](../10.%20Cost%20Analysis/README.md) for the canonical selection surface. Day-one implementation may bind every role below to the same configured OpenAI Responses model. Role-specific overrides are optional and should flow through the shared model-policy helper.

| Run Type | Policy Role | Default rollout guidance | Pricing basis if bound today | Input Cost/1M | Output Cost/1M |
|----------|-------------|--------------------------|------------------------------|---------------|----------------|
| Proactive sweep reasoning | `reasoning_primary` | Same configured Responses model as other reasoning paths | Example current binding: GPT-4.1 mini | $0.40 | $1.60 |
| On-demand first response | `reasoning_primary` | Same configured Responses model as other reasoning paths | Example current binding: GPT-4.1 mini | $0.40 | $1.60 |
| On-demand follow-up | `reasoning_primary` | Same configured Responses model unless evals justify a cheaper follow-up role | Example current binding: GPT-4.1 mini | $0.40 | $1.60 |
| Approval-gated actions | `reasoning_primary` | Same configured Responses model unless audit quality forces a separate role | Example current binding: GPT-4.1 mini | $0.40 | $1.60 |
| Degraded mode fallback | `reasoning_fallback` | Optional fallback role; enable only if evals prove graceful degradation is acceptable | Example future binding: GPT-4.1 nano | $0.10 | $0.40 |

### Structured Output Benefits

FleetGraph uses OpenAI's `responses.parse()` with Zod schemas for all reasoning calls. This provides:

1. **Guaranteed valid JSON.** No parsing retries. The model is constrained to emit tokens matching the schema via guided decoding.
2. **Faster effective latency.** No retry loop for malformed output. Single round-trip per candidate.
3. **Smaller output tokens.** Structured output produces exactly the fields needed, no preamble or explanation padding.
4. **Type safety.** The parsed response is immediately usable as a TypeScript type.

```typescript
// Schema constrains model output to exactly these fields
const RiskAssessmentSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string().max(200),
  recommendation: z.enum(['no_issue', 'inform_only', 'confirm_action']),
  evidence: z.array(z.string()).max(5),
  suggestedAction: z.string().max(300).optional(),
});

// Output token budget: ~300-500 tokens (JSON field names + values)
// Without structured output, same info would be ~800-1200 tokens (natural language + parsing)
```

### Prompt Caching Strategy

OpenAI automatically caches prompt prefixes longer than 1,024 tokens. Cached inputs are billed at 75% discount for GPT-4.1 series.

**Cache-friendly prompt structure:**

```
[SYSTEM INSTRUCTIONS: ~400 tokens] ← STABLE across all calls (cached)
[SCHEMA DEFINITION: ~200 tokens]   ← STABLE (cached)
[ENTITY CONTEXT: ~1,200 tokens]    ← VARIES per candidate (not cached)
[RECENT SIGNALS: ~400 tokens]      ← VARIES per candidate (not cached)
```

The stable prefix (~600 tokens) falls below the 1,024-token cache threshold. To activate caching:

```typescript
// Pad the system prompt to exceed 1,024 tokens by including
// the full signal type taxonomy and entity type descriptions.
// This is NOT wasted tokens; it improves model accuracy AND triggers caching.

const SYSTEM_PROMPT = `
You are FleetGraph, a project management risk detection system.
[... signal type definitions: ~300 tokens ...]
[... entity type definitions: ~200 tokens ...]
[... severity criteria: ~200 tokens ...]
[... output format instructions: ~200 tokens ...]
[... example assessments: ~400 tokens ...]
`;
// Total: ~1,300 tokens. First 1,024+ are cached after first call.
// Subsequent calls pay 25% of input price for the cached prefix.
```

**Estimated savings:**

| Metric | Without Caching | With Caching |
|--------|----------------|--------------|
| System prompt cost per call (GPT-4.1 mini) | $0.40/1M * 1,300 = $0.00052 | $0.10/1M * 1,024 + $0.40/1M * 276 = $0.000213 |
| 1,000 proactive calls/day | $0.52 | $0.213 |
| Monthly savings | | ~$9.21 |

### Token Budget Enforcement

Context sent to OpenAI must be truncated before sending, not after. This prevents runaway costs from unexpectedly large entity state.

```typescript
// api/src/fleetgraph/token-budget.ts

const TOKEN_LIMITS = {
  proactive: {
    systemPrompt: 1500,    // Fixed, stable
    entityContext: 1500,    // Truncated to fit
    recentSignals: 500,     // Last 3 signals max
    totalInput: 3500,       // Hard cap
    totalOutput: 600,       // Structured output
  },
  onDemand: {
    systemPrompt: 2000,
    entityContext: 4000,    // More context for user-facing
    recentSignals: 1000,
    conversationHistory: 3000,
    totalInput: 10000,
    totalOutput: 2000,
  },
} as const;

// Approximate token count (4 chars per token for English text)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateContext(
  context: string,
  maxTokens: number
): string {
  const estimated = estimateTokens(context);
  if (estimated <= maxTokens) return context;

  // Truncate to approximately maxTokens worth of characters
  const maxChars = maxTokens * 4;
  return context.slice(0, maxChars) + '\n[...truncated]';
}

export function enforceTokenBudget(
  mode: 'proactive' | 'onDemand',
  parts: { systemPrompt: string; entityContext: string; signals: string; history?: string }
): { systemPrompt: string; entityContext: string; signals: string; history?: string } {
  const limits = TOKEN_LIMITS[mode];

  return {
    systemPrompt: truncateContext(parts.systemPrompt, limits.systemPrompt),
    entityContext: truncateContext(parts.entityContext, limits.entityContext),
    signals: truncateContext(parts.signals, limits.recentSignals),
    history: parts.history
      ? truncateContext(parts.history, 'conversationHistory' in limits ? limits.conversationHistory : 0)
      : undefined,
  };
}
```

### Streaming vs Non-Streaming

| Mode | Streaming? | Reason |
|------|-----------|--------|
| Proactive sweep | No | Structured output parsed as complete JSON. No user waiting. |
| On-demand first response | Yes | User is watching. First token latency matters for perceived performance. |
| On-demand follow-up | Yes | Same as above. |
| Approval-gated reasoning | No | Result is consumed programmatically, not displayed incrementally. |

Streaming is a presentation concern, not a separate reasoning path. The same FleetGraph run still loads context, evaluates heuristics, and executes the shared reasoning nodes. If the UI wants incremental output, stream graph events or the final response rendering from that shared run:

```typescript
// On-demand path: stream the shared graph run to the UI
const eventStream = graph.streamEvents(
  {
    entityId,
    entityType,
    workspaceId,
    actorId: userId,
    userPrompt,
  },
  { configurable: { thread_id } },
);

for await (const event of eventStream) {
  if (event.event === 'on_chat_model_stream') {
    broadcastToUser(userId, 'fleetgraph:stream_chunk', {
      requestId,
      delta: event.data?.chunk ?? '',
    });
  }
}
```

## 4. Parallel Fetch Optimization

### Core Pattern: Promise.all with Timeout

```typescript
// api/src/fleetgraph/fetch.ts

import pLimit from 'p-limit';

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 2000;

const limit = pLimit(FETCH_CONCURRENCY);

interface FetchResult<T> {
  status: 'fulfilled' | 'rejected' | 'timeout';
  value?: T;
  error?: string;
  durationMs: number;
}

async function fetchWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<FetchResult<T>> {
  const start = Date.now();

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FETCH_TIMEOUT')), timeoutMs)
      ),
    ]);

    return {
      status: 'fulfilled',
      value: result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'FETCH_TIMEOUT';
    return {
      status: isTimeout ? 'timeout' : 'rejected',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
```

### Sweep Batch Fetch (3 Parallel Calls)

```typescript
export async function fetchSweepContext(ctx: SweepContext): Promise<SweepData> {
  const [weeksResult, issuesResult, approvalsResult] = await Promise.all([
    fetchWithTimeout(() =>
      fetch(`${ctx.apiBaseUrl}/api/weeks`, {
        headers: { Authorization: `Bearer ${ctx.apiToken}` },
      }).then(r => r.json())
    ),
    fetchWithTimeout(() =>
      fetch(`${ctx.apiBaseUrl}/api/issues?state=in_progress,in_review,todo`, {
        headers: { Authorization: `Bearer ${ctx.apiToken}` },
      }).then(r => r.json())
    ),
    fetchWithTimeout(() =>
      fetch(`${ctx.apiBaseUrl}/api/team/accountability-grid-v3`, {
        headers: { Authorization: `Bearer ${ctx.apiToken}` },
      }).then(r => r.json())
    ),
  ]);

  return {
    weeks: weeksResult.status === 'fulfilled' ? weeksResult.value : [],
    issues: issuesResult.status === 'fulfilled' ? issuesResult.value : [],
    approvals: approvalsResult.status === 'fulfilled' ? approvalsResult.value : [],
    partialFailure: [weeksResult, issuesResult, approvalsResult].some(
      r => r.status !== 'fulfilled'
    ),
  };
}
```

### Event-Triggered Context Enrichment (2-5 Parallel Calls)

```typescript
export async function fetchEventContext(
  entityType: string,
  entityId: string,
  signalType: string,
  ctx: SweepContext
): Promise<EventContext> {
  // Determine which enrichment calls are needed based on signal type
  const fetches: Array<() => Promise<unknown>> = [];

  // Always fetch the entity itself
  fetches.push(() =>
    fetch(`${ctx.apiBaseUrl}/api/${entityEndpoint(entityType)}/${entityId}`, {
      headers: { Authorization: `Bearer ${ctx.apiToken}` },
    }).then(r => r.json())
  );

  // Conditionally add related context
  if (signalType === 'issue_state_change' || signalType === 'blocked_stale') {
    fetches.push(() =>
      fetch(`${ctx.apiBaseUrl}/api/issues/${entityId}`, {
        headers: { Authorization: `Bearer ${ctx.apiToken}` },
      }).then(r => r.json())
    );
  }

  if (signalType === 'missing_standup') {
    fetches.push(() =>
      fetch(`${ctx.apiBaseUrl}/api/weeks/${entityId}/standups`, {
        headers: { Authorization: `Bearer ${ctx.apiToken}` },
      }).then(r => r.json())
    );
  }

  // Run all with concurrency limit and timeout
  const results = await Promise.all(
    fetches.map(fn => limit(() => fetchWithTimeout(fn)))
  );

  return assembleContext(results);
}
```

### Partial Results Handling

When one fetch times out or fails, the pipeline continues with partial data:

```typescript
interface SweepData {
  weeks: SprintSummary[];
  issues: IssueSummary[];
  approvals: ApprovalSummary[];
  partialFailure: boolean;       // True if any fetch failed
}

// In heuristic_filter: if partialFailure is true,
// skip checks that depend on missing data rather than producing false positives.
function runHeuristics(data: SweepData): HeuristicResult[] {
  const results: HeuristicResult[] = [];

  // Only run approval checks if approval data was fetched
  if (data.approvals.length > 0) {
    results.push(...checkApprovalBottlenecks(data.approvals));
  }

  // Issue checks run even with partial data (issues endpoint is lightweight)
  results.push(...checkStalledIssues(data.issues));

  // Sprint checks require both weeks and issues
  if (data.weeks.length > 0) {
    results.push(...checkMissingStandups(data.weeks));
    results.push(...checkScopeCreep(data.weeks, data.issues));
  }

  return results;
}
```

## 5. Entity Digest Caching

### How It Works

Each entity has a "digest": a short hash of the fields that matter for risk detection. Between sweep cycles, if an entity's digest hasn't changed, it is skipped entirely. This eliminates 80-95% of heuristic evaluations.

### Cache Structure

```typescript
// api/src/fleetgraph/digest-cache.ts

import { createHash } from 'crypto';

interface DigestEntry {
  digest: string;
  cachedAt: number;
}

interface DigestCache {
  entities: Map<string, DigestEntry>;   // entityId -> digest
  lastSweepAt: number;
}

// One cache per workspace
const caches = new Map<string, DigestCache>();

// Fields that contribute to digest per entity type
const DIGEST_FIELDS: Record<string, string[]> = {
  issue: ['state', 'assignee_id', 'priority', 'updated_at'],
  sprint: ['plan_approval', 'review_approval', 'owner_id', 'status', 'assignee_ids'],
  standup: ['created_at', 'content_length'],
  project: ['status', 'updated_at'],
};

export function computeDigest(
  entity: Record<string, unknown>,
  entityType: string
): string {
  const fields = DIGEST_FIELDS[entityType] || ['updated_at'];
  const values = fields.map(f => JSON.stringify(entity[f] ?? null));
  return createHash('sha256').update(values.join('|')).digest('hex').slice(0, 12);
}

export function hasChanged(
  workspaceId: string,
  entityId: string,
  newDigest: string
): boolean {
  const cache = caches.get(workspaceId);
  if (!cache) return true; // No cache = treat as changed

  const entry = cache.entities.get(entityId);
  if (!entry) return true; // New entity = changed

  return entry.digest !== newDigest;
}

export function updateDigest(
  workspaceId: string,
  entityId: string,
  digest: string
): void {
  let cache = caches.get(workspaceId);
  if (!cache) {
    cache = { entities: new Map(), lastSweepAt: Date.now() };
    caches.set(workspaceId, cache);
  }

  cache.entities.set(entityId, { digest, cachedAt: Date.now() });
  cache.lastSweepAt = Date.now();
}
```

### Cache Hit Rate Projections

| Workspace Profile | Active Entities | Expected Hit Rate | Entities Evaluated |
|-------------------|----------------|--------------------|--------------------|
| Small team (5 people) | ~30 issues, ~5 sprints | 85-90% | 4-7 per sweep |
| Medium team (15 people) | ~100 issues, ~15 sprints | 90-95% | 6-12 per sweep |
| Large team (50 people) | ~300 issues, ~50 sprints | 92-97% | 10-25 per sweep |

**Reasoning:** Between 4-minute sweep cycles, most entities are unchanged. Active work typically touches 5-15% of entities in a given 4-minute window. During off-hours, hit rates approach 99%.

### Memory Usage at Scale

| Workspace Size | Entity Count | Memory per Entry | Total Cache Memory |
|---------------|-------------|------------------|-------------------|
| Small (5 people) | ~35 | ~120 bytes (ID + 12-char digest + timestamp) | ~4.2 KB |
| Medium (15 people) | ~115 | ~120 bytes | ~13.8 KB |
| Large (50 people) | ~350 | ~120 bytes | ~42 KB |
| 100 workspaces (mixed) | ~15,000 | ~120 bytes | ~1.8 MB |

Memory overhead is negligible. Even at 1,000 workspaces with large teams, the digest cache would consume ~18 MB.

### Cache Invalidation

The cache invalidates in three scenarios:

1. **Sweep cycle:** Every sweep recomputes digests for all fetched entities and overwrites stale entries. Entities that no longer appear (deleted/archived) are pruned.
2. **Event-triggered write:** When FleetGraph receives an event bus candidate, the corresponding entity's digest is invalidated immediately so the next sweep re-evaluates it.
3. **Process restart:** The entire cache is lost. The first sweep after restart evaluates all entities (slower, but within SLA).

```typescript
// Prune entities that disappeared between sweeps
export function pruneStaleEntries(
  workspaceId: string,
  currentEntityIds: Set<string>
): number {
  const cache = caches.get(workspaceId);
  if (!cache) return 0;

  let pruned = 0;
  for (const entityId of cache.entities.keys()) {
    if (!currentEntityIds.has(entityId)) {
      cache.entities.delete(entityId);
      pruned++;
    }
  }
  return pruned;
}
```

## 6. Database Query Performance

### FleetGraph-Specific Queries

Beyond the Ship API endpoints (which use the shared `pool`), FleetGraph has its own database operations:

#### Alert Fingerprint Lookups

```sql
-- Used by: dedupe check on startup (load recent fingerprints)
-- Frequency: once per process start
-- Expected time: 10-50ms
SELECT fingerprint, last_outcome, snoozed_until, last_surfaced_at
FROM fleetgraph_alert_state
WHERE workspace_id = $1
  AND last_surfaced_at > NOW() - INTERVAL '24 hours'
  AND last_outcome IN ('delivered', 'snoozed');

-- Index: idx_fleetgraph_alert_state_fingerprint (btree on fingerprint)
-- Index: idx_fleetgraph_alert_state_workspace (btree on workspace_id, last_surfaced_at DESC)
```

#### Alert Persistence (Async Write)

```sql
-- Used by: deliver_alert / suppression bookkeeping
-- Frequency: 0-10 per sweep cycle (only actionable assessments)
-- Expected time: 5-15ms per UPSERT
INSERT INTO fleetgraph_alert_state (
  workspace_id, fingerprint, signal_type, entity_id,
  entity_type, entity_digest, last_surfaced_at, last_outcome
) VALUES ($1, $2, $3, $4, $5, $6, now(), 'delivered')
ON CONFLICT (workspace_id, fingerprint)
DO UPDATE SET
  entity_digest = EXCLUDED.entity_digest,
  last_surfaced_at = EXCLUDED.last_surfaced_at,
  last_outcome = EXCLUDED.last_outcome;
```

This write preserves canonical suppression state across restarts. User-facing delivery can happen in parallel, but dedupe correctness depends on the persistent upsert succeeding.

#### Audit Log Writes

```sql
-- Used by: execute_action node (after human approval)
-- Frequency: rare (only confirmed actions)
-- Expected time: 5-10ms
-- Note: Uses existing audit service (api/src/services/audit.ts)
INSERT INTO audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
VALUES ($1, $2, $3, $4, $5, $6);
```

### LangGraph Checkpoint Storage

LangGraph persists graph state between node executions for resumability and debugging. For FleetGraph's use case (short-lived graph runs, no multi-turn conversation state), checkpoints are lightweight.

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Checkpoint write (per node transition) | 3-8ms | JSON serialization of graph state + single INSERT |
| Checkpoint read (on resume after failure) | 5-15ms | Single SELECT by thread ID |
| Checkpoint cleanup (completed runs) | Background | Async DELETE of runs older than 24 hours |

**Recommendation:** Use PostgreSQL-backed checkpointing (`@langchain/langgraph-checkpoint-postgres`) with the FleetGraph dedicated pool. This keeps checkpoint I/O separate from user-facing queries.

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const checkpointer = PostgresSaver.fromConnInfo({
  connectionString: process.env.DATABASE_URL,
  // Uses own pool (2 connections) separate from main app pool
});
```

### Connection Pool Sizing

| Pool | Max Connections | Purpose |
|------|----------------|---------|
| Main app pool | 20 (production) | User-facing API requests, collaboration WebSocket |
| FleetGraph pool | 3 | Sweep queries, alert persistence, audit writes |
| LangGraph checkpointer | 2 | Graph state persistence |
| **Total** | **25** | Well within RDS/Aurora limits (typically 100-200) |

## 7. Memory Profiling

### What FleetGraph Keeps in Memory

| Component | Memory Per Unit | Scale Factor | Typical Total |
|-----------|----------------|-------------|---------------|
| Fingerprint cache (dedup) | ~160 bytes/entry | Alerts in last 24h | 500 entries = ~80 KB |
| Entity digest cache | ~120 bytes/entry | Active entities per workspace | 15K entries = ~1.8 MB |
| Active graph state | ~2-5 KB/run | Concurrent graph executions | 5 concurrent = ~25 KB |
| Memoization maps (sweep context) | ~50 KB/workspace | Workspace count | 100 workspaces = ~5 MB |
| Event bus queue (in-flight) | ~500 bytes/event | Pending events | 50 events = ~25 KB |

### Estimated Memory Per Concurrent Graph Run

```
Graph state object:        ~2 KB  (candidate + evidence + assessment)
Fetched context (parsed):  ~5-15 KB  (entity JSON + signals)
OpenAI request/response:   ~3-8 KB  (serialized prompt + parsed output)
Temporary variables:       ~1-2 KB
────────────────────────────────────
Total per run:             ~11-27 KB
Peak (5 concurrent):       ~55-135 KB
```

Memory per graph run is trivially small. The bottleneck is never memory but rather I/O latency (API calls, OpenAI).

### Total FleetGraph Memory Footprint

| Scenario | Total Resident Memory |
|----------|-----------------------|
| Cold start (empty caches) | ~500 KB (code + structures) |
| Steady state (100 workspaces, warm caches) | ~8 MB |
| Peak (1000 workspaces, 10 concurrent runs) | ~25 MB |

For context, a typical Node.js Express server consumes 50-150 MB base. FleetGraph adds 5-15% overhead.

### Memory Cleanup

```typescript
// api/src/fleetgraph/memory.ts

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;     // Every 30 minutes

export function startMemoryCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let totalPruned = 0;

    // Prune fingerprint entries older than TTL
    for (const [key, entry] of fingerprints.entries()) {
      if (now - entry.lastSurfacedAt > CACHE_MAX_AGE_MS && !entry.snoozedUntil) {
        fingerprints.delete(key);
        totalPruned++;
      }
    }

    // Prune digest caches for workspaces with no recent sweep
    for (const [workspaceId, cache] of digestCaches.entries()) {
      if (now - cache.lastSweepAt > CACHE_MAX_AGE_MS) {
        digestCaches.delete(workspaceId);
        totalPruned += cache.entities.size;
      }
    }

    if (totalPruned > 0) {
      console.log(`[FleetGraph] Memory cleanup: pruned ${totalPruned} stale entries`);
    }
  }, CLEANUP_INTERVAL_MS);
}
```

### Memory Limits

If total FleetGraph memory exceeds 50 MB (measured via `process.memoryUsage().heapUsed` delta), trigger an emergency cache flush:

```typescript
const MEMORY_CEILING_BYTES = 50 * 1024 * 1024; // 50 MB

function checkMemoryPressure(): boolean {
  const usage = process.memoryUsage();
  // Rough heuristic: if heap used exceeds base + ceiling, flush caches
  return usage.heapUsed > BASE_HEAP_USAGE + MEMORY_CEILING_BYTES;
}
```

## 8. Load Testing Plan

### Test Workload Profiles

| Profile | Workspaces | People/WS | Issues/WS | Sprints/WS | Sweeps/Hour |
|---------|-----------|-----------|-----------|------------|-------------|
| Small | 10 | 5 | 30 | 5 | 15 |
| Medium | 100 | 15 | 100 | 15 | 15 |
| Large | 1,000 | 50 | 300 | 50 | 15 |

### Test 1: Sweep Duration Under Load

**Objective:** Measure time for a complete sweep cycle across all workspaces.

```typescript
// load-test/sweep-duration.ts

import { performance } from 'perf_hooks';

interface SweepLoadTestResult {
  workspaceCount: number;
  totalDurationMs: number;
  avgPerWorkspaceMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  candidatesGenerated: number;
  reasoningCallsMade: number;
  alertsDelivered: number;
}

async function runSweepLoadTest(
  workspaceCount: number
): Promise<SweepLoadTestResult> {
  const durations: number[] = [];
  let totalCandidates = 0;
  let totalReasoning = 0;
  let totalAlerts = 0;

  for (const workspace of testWorkspaces.slice(0, workspaceCount)) {
    const start = performance.now();
    const result = await runSweepForWorkspace(workspace);
    const duration = performance.now() - start;

    durations.push(duration);
    totalCandidates += result.candidatesGenerated;
    totalReasoning += result.reasoningCalls;
    totalAlerts += result.alertsDelivered;
  }

  durations.sort((a, b) => a - b);

  return {
    workspaceCount,
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
    avgPerWorkspaceMs: durations.reduce((a, b) => a + b, 0) / durations.length,
    p50Ms: durations[Math.floor(durations.length * 0.5)] ?? 0,
    p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
    p99Ms: durations[Math.floor(durations.length * 0.99)] ?? 0,
    candidatesGenerated: totalCandidates,
    reasoningCallsMade: totalReasoning,
    alertsDelivered: totalAlerts,
  };
}
```

**Expected results:**

| Profile | Sweep Duration (total) | Avg per Workspace | Within 4-min Window? |
|---------|----------------------|-------------------|---------------------|
| 10 workspaces | 5-15s | 0.5-1.5s | Yes |
| 100 workspaces | 50-150s | 0.5-1.5s | Yes (2.5 min max) |
| 1,000 workspaces | 500-1500s | 0.5-1.5s | No. Requires sharding. |

**Breaking point:** At ~160 workspaces, sequential sweep processing approaches the 4-minute window. Beyond this, workspaces must be processed in batches across multiple sweep intervals, or the sweep must parallelize across workspaces.

### Test 2: On-Demand Response Under Load

**Objective:** Measure first-token latency while sweeps are running.

```typescript
async function runOnDemandLoadTest(
  concurrentRequests: number,
  sweepRunning: boolean
): Promise<{ p50Ms: number; p95Ms: number; p99Ms: number }> {
  // Start a sweep in background if testing under load
  if (sweepRunning) {
    runSweepForWorkspace(testWorkspace); // fire and forget
  }

  const latencies: number[] = [];

  const requests = Array.from({ length: concurrentRequests }, async () => {
    const start = performance.now();

    const stream = await requestOnDemandAnalysis({
      entityType: 'sprint',
      entityId: testSprintId,
    });

    // Wait for first token
    const firstChunk = await stream.next();
    const latency = performance.now() - start;
    latencies.push(latency);
  });

  await Promise.all(requests);
  latencies.sort((a, b) => a - b);

  return {
    p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    p99Ms: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
  };
}
```

**Expected results:**

| Scenario | P50 First Token | P95 First Token | Within SLA? |
|----------|----------------|-----------------|-------------|
| 1 request, no sweep | ~1,200ms | ~1,800ms | Yes (<3s) |
| 5 concurrent, no sweep | ~1,400ms | ~2,200ms | Yes |
| 5 concurrent, sweep running | ~1,600ms | ~2,800ms | Yes (tight) |
| 10 concurrent, sweep running | ~2,000ms | ~3,500ms | P95 breaches |

**Breaking point:** At ~8 concurrent on-demand requests during an active sweep, the P95 latency approaches the 3-second SLA. The primary bottleneck is database connection acquisition (3+20 pool connections shared) and OpenAI API concurrency.

### Test 3: Event Burst Handling

**Objective:** Simulate rapid-fire write events (e.g., bulk issue import) and measure pipeline throughput.

```
Scenario: 50 issue state changes in 1 second
Expected: Event bus queues all 50, processes sequentially
Target: All 50 processed within 30 seconds
Concern: OpenAI reasoning calls (if 10+ pass heuristics) may bottleneck
```

### Scaling Strategy at Breaking Points

| Threshold | Mitigation |
|-----------|------------|
| >150 workspaces | Shard sweep across 2-minute staggered intervals (half per cycle) |
| >8 concurrent on-demand | Queue on-demand requests with priority over sweep reasoning |
| >50 events/second burst | Batch events by entity (dedupe before pipeline entry) |
| >500 reasoning calls/hour | Switch remaining candidates to GPT-4.1 nano degraded mode |

## 9. Performance Monitoring

### Runtime Metrics

Every FleetGraph execution emits structured metrics. These flow into LangSmith traces and also into application logs for aggregation.

#### Per-Node Execution Timing

```typescript
// api/src/fleetgraph/metrics.ts

interface FleetGraphMetrics {
  // Per-run metrics
  runId: string;
  source: 'event' | 'sweep' | 'on_demand';
  workspaceId: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;

  // Per-node breakdown
  nodes: Array<{
    name: string;
    durationMs: number;
    withinBudget: boolean;
    metadata?: Record<string, unknown>;
  }>;

  // Aggregate counters
  apiCallCount: number;
  openaiCallCount: number;
  openaiTokensUsed: { input: number; output: number };
  cacheHits: number;
  cacheMisses: number;
  alertsDelivered: number;
}

export function emitMetrics(metrics: FleetGraphMetrics): void {
  // Structured log (parseable by CloudWatch/Datadog)
  console.log(JSON.stringify({
    level: 'info',
    service: 'fleetgraph',
    event: 'pipeline_complete',
    ...metrics,
  }));

  // LangSmith metadata (attached to trace)
  // The traceable wrapper in LangGraph handles this automatically
  // when metrics are returned from the graph execution
}
```

#### Sweep Cycle Metrics

```typescript
interface SweepCycleMetrics {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
  workspacesProcessed: number;
  entitiesEnumerated: number;
  digestCacheHits: number;
  digestCacheMisses: number;
  candidatesGenerated: number;
  candidatesFilteredByHeuristic: number;
  candidatesPassedToReasoning: number;
  alertsDelivered: number;
  errors: number;
  skippedDueToPreviousSweep: boolean;
}
```

### Metric Dashboards

#### Primary Dashboard: FleetGraph Health

| Panel | Metric | Alert Threshold |
|-------|--------|----------------|
| Sweep Duration | `sweep_cycle_duration_ms` histogram | P95 > 180,000ms (3 min) |
| Event Pipeline Latency | `event_pipeline_duration_ms` histogram | P95 > 10,000ms (10s) |
| On-Demand First Token | `on_demand_first_token_ms` histogram | P95 > 3,000ms |
| Digest Cache Hit Rate | `digest_cache_hits / (hits + misses)` | < 70% for 3 consecutive cycles |
| OpenAI Error Rate | `openai_errors / openai_calls` | > 5% over 15 minutes |
| Reasoning Latency | `reason_about_risk_duration_ms` histogram | P95 > 5,000ms |
| Alerts per Hour | `alerts_delivered_total` counter | > 100/hr (noise threshold) |

#### Secondary Dashboard: Cost Tracking

| Panel | Metric | Alert Threshold |
|-------|--------|----------------|
| OpenAI Tokens/Hour | `openai_tokens_input + openai_tokens_output` | > 500K tokens/hour |
| Reasoning Calls/Hour | `openai_calls_total` | > 200 calls/hour |
| Cost Estimate/Day | Derived from token counts * pricing | > $10/day |

### Alert Rules

```typescript
// api/src/fleetgraph/alerts-meta.ts
// (Alerts about FleetGraph itself, not user-facing alerts)

const PERFORMANCE_ALERTS = {
  sweep_sla_breach: {
    condition: 'sweep_cycle_duration_ms > 240000',  // > 4 minutes
    severity: 'critical',
    action: 'Page on-call. Sweep is overlapping with next cycle.',
  },
  event_latency_degraded: {
    condition: 'p95(event_pipeline_duration_ms) > 10000 over 15m',
    severity: 'warning',
    action: 'Check OpenAI API status. Consider switching to nano fallback.',
  },
  on_demand_sla_breach: {
    condition: 'p95(on_demand_first_token_ms) > 3000 over 5m',
    severity: 'warning',
    action: 'Check concurrent load. May need to deprioritize sweep reasoning.',
  },
  cache_degradation: {
    condition: 'digest_cache_hit_rate < 0.5 for 3 consecutive cycles',
    severity: 'info',
    action: 'High change volume or cache was recently cleared. Self-resolving.',
  },
  cost_anomaly: {
    condition: 'openai_daily_cost_estimate > 20',
    severity: 'warning',
    action: 'Review reasoning call volume. May indicate runaway loop or misconfigured heuristics.',
  },
};
```

### LangSmith Integration

Every graph execution is a LangSmith trace. Node timings appear as child spans:

```
fleetgraph_proactive_run (3,247ms)
  ├── trigger_context (4ms)
  ├── fetch_core_context (187ms)
  ├── fetch_parallel_signals (412ms)
  ├── heuristic_filter (38ms)
  ├── reason_about_risk (2,541ms)
  │     ├── openai_request (2,498ms)  [tokens: 2100 in / 380 out]
  │     └── parse_structured (43ms)
  ├── prepare_notification (7ms)
  └── deliver_alert (3ms)
```

LangSmith provides:
- Trace search by latency (find all runs > 5s)
- Token usage aggregation (daily/weekly cost reports)
- Error grouping (cluster failures by node and error type)
- Run comparison (A/B prompt versions, model versions)

### Health Check Endpoint

```typescript
// api/src/fleetgraph/health.ts

interface FleetGraphHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastSweepAt: number | null;
  lastSweepDurationMs: number | null;
  sweepOverdue: boolean;
  cacheStats: {
    fingerprintEntries: number;
    digestEntries: number;
    estimatedMemoryBytes: number;
  };
  openai: {
    lastCallAt: number | null;
    lastCallDurationMs: number | null;
    recentErrorRate: number;
  };
}

export function getFleetGraphHealth(): FleetGraphHealth {
  const now = Date.now();
  const sweepOverdue = lastSweepAt
    ? (now - lastSweepAt) > 300_000  // > 5 minutes since last sweep
    : true;

  const status = sweepOverdue
    ? 'degraded'
    : recentOpenAIErrorRate > 0.1
      ? 'degraded'
      : 'healthy';

  return {
    status,
    lastSweepAt,
    lastSweepDurationMs,
    sweepOverdue,
    cacheStats: {
      fingerprintEntries: fingerprints.size,
      digestEntries: getTotalDigestEntries(),
      estimatedMemoryBytes: estimateMemoryUsage(),
    },
    openai: {
      lastCallAt: lastOpenAICallAt,
      lastCallDurationMs: lastOpenAICallDuration,
      recentErrorRate: recentOpenAIErrorRate,
    },
  };
}
```

Exposed at `GET /api/fleetgraph/health` for uptime monitoring and debugging.

## Summary: Performance Guarantees

| Guarantee | Target | Measured By | Fallback |
|-----------|--------|-------------|----------|
| Event detection latency | <30s | End-to-end timer in latency-proof test | Heuristic-only alert (skip reasoning) |
| Sweep cycle duration | <4 min | `sweep_cycle_duration_ms` metric | Skip cycle, log warning |
| On-demand first token | <3s | `on_demand_first_token_ms` metric | Return cached assessment if available |
| Memory overhead | <50 MB | `process.memoryUsage()` delta | Emergency cache flush |
| Database pool impact | <15% of main pool | Connection count monitoring | Dedicated FleetGraph pool isolates contention |
| OpenAI cost per day | <$10 (100 workspaces) | Token counter metrics | Switch to nano model, increase heuristic strictness |
| Cache hit rate (steady state) | >85% | `digest_cache_hits / total` | Full evaluation (slower but correct) |
