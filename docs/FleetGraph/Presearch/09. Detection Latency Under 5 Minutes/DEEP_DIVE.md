# Detection Latency Under 5 Minutes: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready specification for the hybrid trigger model that guarantees FleetGraph surfaces problems within 5 minutes of the underlying event. Covers the end-to-end timing budget for all three detection paths, integration points with Ship's existing write and WebSocket infrastructure, and the deduplication and alert delivery mechanisms.

## Latency Budget Breakdown

Three detection paths exist. Each has a distinct timing constraint.

### Path 1: Event-Triggered (Target: <30 seconds)

```
Ship write event (issue update, approval change, standup post)
  |  ~0ms   (in-process function call)
  v
fleetgraph.enqueueCandidate()
  |  ~1ms   (push to in-memory queue)
  v
normalize_candidate({ entityType, entityId, signalType, timestamp })
  |  ~2ms   (object construction)
  v
dedupe_check(risk_fingerprint)
  |  ~5ms   (Map lookup + state hash comparison)
  v
heuristic_filter(deterministic)
  |  ~50-200ms   (batch Ship API reads, cached entity digests)
  v
reason_about_risk(OpenAI Responses API)
  |  ~1,000-3,000ms   (structured output, narrow context)
  v
deliver_alert(WebSocket broadcastToUser)
  |  ~5ms   (in-process WS send)
  v
User sees notification
```

**Total budget: 1,063ms to 3,213ms (well under 30s)**

Worst case occurs when the heuristic flags a candidate and OpenAI reasoning is invoked. The common case (heuristic rejects candidate) completes in under 210ms.

### Path 2: Sweep-Triggered (Target: <5 minutes total)

```
setInterval fires (every 240,000ms = 4 minutes)
  |  ~0ms
  v
enumerate_active_entities(workspace)
  |  ~100-500ms   (one batch query per entity type via Ship API)
  v
for each entity: compute_entity_digest(hash of key fields)
  |  ~50ms total   (in-memory hash comparison against cached digests)
  v
filter: skip unchanged entities
  |  reduces candidates by ~80-95%
  v
heuristic_filter(all remaining candidates in batch)
  |  ~200-500ms   (deterministic checks on pre-fetched data)
  v
reason_about_risk(OpenAI, batched parallel calls for flagged candidates)
  |  ~1,000-3,000ms per candidate, parallelized across up to 5 concurrent calls
  v
dedupe_check(risk_fingerprint) per result
  |  ~5ms each
  v
deliver_alert(WebSocket broadcastToUser) per new alert
  |  ~5ms each
  v
User sees notification
```

**Total budget: ~2,000-4,500ms (well under 5 minutes)**

The 4-minute interval provides 60 seconds of margin. Even with 50 active entities, the sweep completes within the budget because entity digests eliminate most candidates before any expensive work happens.

### Path 3: On-Demand (Target: <3 seconds to first token)

```
User opens FleetGraph panel
  |  ~0ms
  v
fetch_context(entityType, entityId, userId)
  |  ~200-500ms   (parallel Ship API reads for entity + children)
  v
stream reasoning response (OpenAI streaming)
  |  ~500-1,500ms to first token
  v
First token arrives at client
```

**Total budget: 700ms to 2,000ms (well under 3s)**

On-demand path skips deduplication and heuristic filtering entirely. It streams directly from context fetch to reasoning because the user explicitly requested analysis.

## Event-Triggered Architecture

### Existing Write Event Infrastructure

Ship's API routes already broadcast real-time events via the collaboration WebSocket server. The `broadcastToUser` function in `/api/src/collaboration/index.ts` (line 586) sends typed JSON payloads to all active WebSocket connections for a given user:

```typescript
// Existing pattern from collaboration/index.ts
export function broadcastToUser(
  userId: string,
  eventType: string,
  data?: Record<string, unknown>
): void {
  const payload = JSON.stringify({ type: eventType, data: data || {} });
  eventConns.forEach((conn, ws) => {
    if (conn.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}
```

Current call sites that represent FleetGraph-relevant write events:

| Route File | Event | Signal Type |
|-----------|-------|-------------|
| `routes/issues.ts:685` | Issue created in sprint | `week_issues` |
| `routes/issues.ts:1014` | Issue moved to sprint | `week_issues` |
| `routes/issues.ts:1030` | Issue state changed | `issue_state_change` |
| `routes/weeks.ts:1286` | Sprint started | `week_start` |
| `routes/weeks.ts:1490` | Plan submitted/updated | `weekly_plan` |
| `routes/weeks.ts:2009` | Standup posted | `standup` |
| `routes/weeks.ts:2363` | Review submitted | `weekly_review` |
| `routes/weeks.ts:2692` | Plan approved or re-routed for changes | `approval_change` |
| `routes/weeks.ts:3051` | Approval state change | `approval_change` |
| `routes/projects.ts:761` | Project plan updated | `project_plan` |
| `routes/projects.ts:1052` | Project retro updated | `project_retro` |
| `routes/documents.ts:580` | Document created | `document_create` |
| `routes/documents.ts:1036` | Approval resubmission | `approval_change` |

### Hook Strategy: Internal Event Bus

FleetGraph taps into these write events without modifying existing route logic. The approach: add a lightweight internal event emitter that route handlers call after successful writes, alongside the existing `broadcastToUser` calls.

```typescript
// api/src/fleetgraph/event-bus.ts

import { EventEmitter } from 'events';

export interface FleetGraphCandidate {
  entityType: 'issue' | 'sprint' | 'project' | 'standup' | 'weekly_plan' | 'weekly_retro';
  entityId: string;
  signalType: string;
  workspaceId: string;
  actorId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

class FleetGraphEventBus extends EventEmitter {
  enqueue(candidate: FleetGraphCandidate): void {
    this.emit('candidate', candidate);
  }
}

export const fleetGraphBus = new FleetGraphEventBus();
```

Route integration is a single line addition at each existing `broadcastToUser` call site:

```typescript
// In routes/issues.ts, after state change broadcast (line ~1030)
broadcastToUser(assigneeId, 'accountability:updated', { issueId: id, state: data.state });

// ADD: FleetGraph event hook
fleetGraphBus.enqueue({
  entityType: 'issue',
  entityId: id as string,
  signalType: 'issue_state_change',
  workspaceId: req.workspaceId!,
  actorId: req.userId!,
  timestamp: Date.now(),
  metadata: { oldState: currentState, newState: data.state },
});
```

### Candidate Normalization

All candidates, whether from event triggers or sweep, get normalized to the same shape before entering the detection pipeline:

```typescript
// api/src/fleetgraph/candidate.ts

import { createHash } from 'crypto';

export interface NormalizedCandidate {
  entityType: string;
  entityId: string;
  signalType: string;
  workspaceId: string;
  timestamp: number;
  fingerprint: string;        // hash for deduplication
  stateHash: string;          // hash of relevant entity fields
  source: 'event' | 'sweep';
  metadata?: Record<string, unknown>;
}

export function normalizeCandidate(
  raw: FleetGraphCandidate,
  source: 'event' | 'sweep',
  stateHash: string
): NormalizedCandidate {
  const fingerprint = createHash('sha256')
    .update(`${raw.entityType}:${raw.entityId}:${raw.signalType}:${stateHash}`)
    .digest('hex')
    .slice(0, 16);

  return {
    entityType: raw.entityType,
    entityId: raw.entityId,
    signalType: raw.signalType,
    workspaceId: raw.workspaceId,
    timestamp: raw.timestamp,
    fingerprint,
    stateHash,
    source,
    metadata: raw.metadata,
  };
}
```

## Sweep Scheduler Design

### Why setInterval, Not AWS EventBridge

FleetGraph runs inside the Ship API process (`api/src/index.ts`). The API is a single Express + WebSocket server on Elastic Beanstalk. setInterval is the correct choice because:

1. The sweep needs access to the in-memory deduplication state (fingerprint cache)
2. EventBridge would require a separate Lambda, adding cold start latency and cross-service coordination
3. The sweep workload is light (sub-5-second execution for typical workspaces)
4. If the API process restarts, the sweep restarts with it (correct behavior, since the fingerprint cache also resets)

### Sweep Worker Implementation

```typescript
// api/src/fleetgraph/sweep.ts

import { FleetGraphCandidate, fleetGraphBus } from './event-bus.js';

const SWEEP_INTERVAL_MS = 240_000; // 4 minutes (60s margin under 5-minute SLA)

interface SweepContext {
  workspaceId: string;
  apiBaseUrl: string;
  apiToken: string;
}

export function startSweepScheduler(contexts: SweepContext[]): NodeJS.Timeout {
  return setInterval(async () => {
    const sweepStart = Date.now();

    for (const ctx of contexts) {
      try {
        await runSweepForWorkspace(ctx);
      } catch (err) {
        console.error(`[FleetGraph] Sweep failed for workspace ${ctx.workspaceId}:`, err);
      }
    }

    const sweepDuration = Date.now() - sweepStart;
    console.log(`[FleetGraph] Sweep completed in ${sweepDuration}ms`);
  }, SWEEP_INTERVAL_MS);
}

async function runSweepForWorkspace(ctx: SweepContext): Promise<void> {
  // Phase 1: Enumerate active entities (batch API calls)
  const [activeWeeks, activeIssues, pendingApprovals] = await Promise.all([
    fetchActiveWeeks(ctx),
    fetchInProgressIssues(ctx),
    fetchPendingApprovals(ctx),
  ]);

  // Phase 2: Generate candidates for each entity type
  const candidates: FleetGraphCandidate[] = [];

  // Missing standup check
  for (const week of activeWeeks) {
    candidates.push({
      entityType: 'sprint',
      entityId: week.id,
      signalType: 'missing_standup',
      workspaceId: ctx.workspaceId,
      actorId: 'system',
      timestamp: Date.now(),
      metadata: { ownerId: week.ownerId, lastStandupAt: week.lastStandupAt },
    });
  }

  // Blocked issue staleness check
  for (const issue of activeIssues) {
    if (issue.state === 'in_progress' && issue.daysSinceUpdate > 1) {
      candidates.push({
        entityType: 'issue',
        entityId: issue.id,
        signalType: 'blocked_stale',
        workspaceId: ctx.workspaceId,
        actorId: 'system',
        timestamp: Date.now(),
        metadata: { daysSinceUpdate: issue.daysSinceUpdate },
      });
    }
  }

  // Approval bottleneck check
  for (const approval of pendingApprovals) {
    if (approval.hoursPending > 48) {
      candidates.push({
        entityType: 'sprint',
        entityId: approval.sprintId,
        signalType: 'approval_bottleneck',
        workspaceId: ctx.workspaceId,
        actorId: 'system',
        timestamp: Date.now(),
        metadata: { hoursPending: approval.hoursPending, approvalType: approval.type },
      });
    }
  }

  // Phase 3: Feed candidates into the same pipeline as event-triggered
  for (const candidate of candidates) {
    fleetGraphBus.enqueue(candidate);
  }
}
```

### What the Sweep Checks

| Check | Entity Source | Condition |
|-------|-------------|-----------|
| Missing standup | Active weeks via `/api/weeks` | Business day, no standup after expected window |
| Blocked/stale issue | In-progress issues via `/api/issues` | No state change or update >24 hours |
| Approval bottleneck | Week approval metadata via `/api/weeks/:id` | plan_approval or review_approval pending >48 hours |
| Scope creep | Issues added to approved week | Issue created_at > plan_approval.approved_at |
| Project risk cluster | Aggregated signals per project | Multiple weak signals converge on same project |

## Deduplication Strategy

### Risk Fingerprint

Each candidate produces a fingerprint: a short hash of the entity identity and the relevant state that triggered the signal.

```typescript
// Fingerprint = sha256(entityType + entityId + signalType + stateHash).slice(0, 16)

// Examples:
// Issue state change: hash("issue" + "uuid-123" + "issue_state_change" + hash({state: "blocked", updatedAt}))
// Missing standup:    hash("sprint" + "uuid-456" + "missing_standup" + hash({lastStandupDate, currentDate}))
// Approval pending:   hash("sprint" + "uuid-789" + "approval_bottleneck" + hash({approvalState, hoursPending: bucket}))
```

The `stateHash` component is critical. It ensures the same entity with the same signal type produces a different fingerprint when the underlying state changes (e.g., an issue that was blocked, got unblocked, and became blocked again should trigger a new alert).

### Fingerprint Storage

The in-memory map is a latency optimization layer only. Canonical dedupe state lives in `fleetgraph_alert_state`.

```typescript
// api/src/fleetgraph/dedupe.ts

interface FingerprintEntry {
  fingerprint: string;
  lastSurfacedAt: number;
  stateHash: string;
  snoozedUntil: number | null;
  dismissed: boolean;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const fingerprints = new Map<string, FingerprintEntry>();

// Cleanup expired fingerprints every 30 minutes
setInterval(() => {
  const now = Date.now();
  fingerprints.forEach((entry, key) => {
    if (now - entry.lastSurfacedAt > TTL_MS && !entry.snoozedUntil) {
      fingerprints.delete(key);
    }
  });
}, 30 * 60 * 1000);

export function shouldSurface(candidate: NormalizedCandidate): boolean {
  const existing = fingerprints.get(candidate.fingerprint);

  // New fingerprint: always surface
  if (!existing) return true;

  // Dismissed: never re-surface until fingerprint expires
  if (existing.dismissed) return false;

  // Snoozed: re-surface only after snooze expires
  if (existing.snoozedUntil && Date.now() < existing.snoozedUntil) return false;

  // State changed since last surface: re-surface
  if (existing.stateHash !== candidate.stateHash) return true;

  // Same state, already surfaced: skip
  return false;
}

export function recordSurfaced(candidate: NormalizedCandidate): void {
  fingerprints.set(candidate.fingerprint, {
    fingerprint: candidate.fingerprint,
    lastSurfacedAt: Date.now(),
    stateHash: candidate.stateHash,
    snoozedUntil: null,
    dismissed: false,
  });
}

export function snoozeFingerprint(fingerprint: string, durationMs: number): void {
  const existing = fingerprints.get(fingerprint);
  if (existing) {
    existing.snoozedUntil = Date.now() + durationMs;
  }
}

export function dismissFingerprint(fingerprint: string): void {
  const existing = fingerprints.get(fingerprint);
  if (existing) {
    existing.dismissed = true;
  }
}
```

### Skip Rule Summary

Do not re-alert when ALL of these are true:
1. Fingerprint exists in the map
2. State hash has NOT changed since `lastSurfacedAt`
3. Entry is NOT snoozed-expired (snooze exists and has not elapsed)
4. Entry is NOT dismissed

Re-alert when ANY of these are true:
1. Fingerprint does not exist (new signal)
2. State hash changed (entity state evolved)
3. Snooze period has elapsed (user asked to be reminded later)

### Fingerprint TTL

Default TTL: 24 hours. After 24 hours without the same signal recurring, the fingerprint is garbage collected. If the same signal appears again after TTL expiry, it is treated as new.

For persistent signals (e.g., a chronically missing standup), the sweep will re-generate the candidate every 4 minutes. The deduplication layer ensures only the first occurrence surfaces. If the user snoozes for 4 hours, the signal re-surfaces after 4 hours regardless of how many sweep cycles fired in between.

## Heuristic Filter Performance

### Design Principles

1. **Zero LLM calls.** Heuristics are pure TypeScript functions operating on pre-fetched data.
2. **Batch Ship API reads.** One call per entity type, not per entity.
3. **Entity digest caching.** Hash of key fields per entity, skip if unchanged since last sweep.

### Batch Fetch Strategy

```typescript
// api/src/fleetgraph/heuristics/fetch.ts

interface EntityDigestCache {
  digestMap: Map<string, string>;   // entityId -> hash of key fields
  fetchedAt: number;
}

const digestCache = new Map<string, EntityDigestCache>(); // workspaceId -> cache

export async function fetchActiveEntities(
  ctx: SweepContext
): Promise<{ weeks: WeekSummary[]; issues: IssueSummary[]; approvals: ApprovalSummary[] }> {

  // Parallel batch fetches (3 concurrent HTTP calls)
  const [weeksResponse, issuesResponse, approvalsResponse] = await Promise.all([
    fetch(`${ctx.apiBaseUrl}/api/weeks?status=active`, {
      headers: { Authorization: `Bearer ${ctx.apiToken}` },
    }),
    fetch(`${ctx.apiBaseUrl}/api/issues?state=in_progress,in_review,todo`, {
      headers: { Authorization: `Bearer ${ctx.apiToken}` },
    }),
    fetch(`${ctx.apiBaseUrl}/api/team/accountability-grid-v3`, {
      headers: { Authorization: `Bearer ${ctx.apiToken}` },
    }),
  ]);

  const weeks = await weeksResponse.json();
  const issues = await issuesResponse.json();
  const approvals = await approvalsResponse.json();

  return { weeks, issues, approvals };
}
```

### Entity Digest for Skip-Unchanged Optimization

```typescript
import { createHash } from 'crypto';

function computeEntityDigest(entity: Record<string, unknown>, fields: string[]): string {
  const relevant = fields.map(f => String(entity[f] ?? ''));
  return createHash('sha256').update(relevant.join('|')).digest('hex').slice(0, 12);
}

// For an issue, the digest covers: state, assignee_id, priority, updated_at
// For a week, the digest covers: plan_approval.state, review_approval.state, owner_id, status
// If the digest hasn't changed since the last sweep, the entity is skipped entirely

export function filterChangedEntities<T extends { id: string }>(
  entities: T[],
  digestFields: string[],
  workspaceId: string
): T[] {
  const cache = digestCache.get(workspaceId);
  const newDigestMap = new Map<string, string>();
  const changed: T[] = [];

  for (const entity of entities) {
    const digest = computeEntityDigest(entity as Record<string, unknown>, digestFields);
    newDigestMap.set(entity.id, digest);

    const previousDigest = cache?.digestMap.get(entity.id);
    if (previousDigest !== digest) {
      changed.push(entity);
    }
  }

  // Update cache
  digestCache.set(workspaceId, { digestMap: newDigestMap, fetchedAt: Date.now() });

  return changed;
}
```

### Performance Target

| Step | Operation | Target Time |
|------|-----------|-------------|
| Batch fetch | 3 parallel HTTP calls to Ship API | <500ms |
| Digest comparison | Hash + Map lookup per entity | <50ms total for 200 entities |
| Heuristic evaluation | Deterministic checks on filtered set | <100ms for 20 changed entities |
| **Total heuristic phase** | | **<500ms** |

The 500ms target assumes a typical workspace with ~50 active weeks, ~200 active issues, and ~30 pending approvals. The digest filter reduces this to ~10-20 entities needing heuristic evaluation.

## OpenAI Reasoning Latency

### Context Narrowing

The single most impactful optimization: keep the input context narrow. The reasoning node receives only the evidence that the heuristic already flagged, not the full entity tree.

```typescript
// api/src/fleetgraph/reasoning.ts

import OpenAI from 'openai';
import { z } from 'zod';

const RiskAssessmentSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string().max(200),
  recommendation: z.enum(['no_issue', 'inform_only', 'confirm_action']),
  evidence: z.array(z.string()).max(5),
  suggestedAction: z.string().max(300).optional(),
});

type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export async function assessRisk(
  client: OpenAI,
  candidate: NormalizedCandidate,
  evidence: Record<string, unknown>
): Promise<RiskAssessment> {
  const response = await client.responses.parse({
    model: getFleetGraphModel('reasoning_primary'),
    instructions: RISK_ASSESSMENT_SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          signalType: candidate.signalType,
          entityType: candidate.entityType,
          evidence,
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'risk_assessment',
        schema: RiskAssessmentSchema,
      },
    },
  });

  return response.output_parsed!;
}
```

### Token Budget

| Component | Budget | Rationale |
|-----------|--------|-----------|
| System instructions | ~500 tokens | Static prompt, cached by OpenAI |
| Input evidence | ~1,500 tokens | Narrow context: entity fields + heuristic output |
| Output schema | ~500 tokens | Structured output with constrained fields |
| **Total per candidate** | **~2,500 tokens** | |

At the `reasoning_primary` pricing from [Phase 3 / 10. Cost Analysis](../../Phase%203/10.%20Cost%20Analysis/README.md), each reasoning call costs approximately $0.003 per candidate.

### Parallel Reasoning Calls

When the sweep flags multiple candidates in a single cycle, reasoning calls run in parallel with a concurrency limit:

```typescript
const REASONING_CONCURRENCY = 5;

export async function assessCandidatesBatch(
  client: OpenAI,
  candidates: Array<{ candidate: NormalizedCandidate; evidence: Record<string, unknown> }>
): Promise<Array<{ candidate: NormalizedCandidate; assessment: RiskAssessment }>> {
  const results: Array<{ candidate: NormalizedCandidate; assessment: RiskAssessment }> = [];

  // Process in batches of REASONING_CONCURRENCY
  for (let i = 0; i < candidates.length; i += REASONING_CONCURRENCY) {
    const batch = candidates.slice(i, i + REASONING_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ candidate, evidence }) => ({
        candidate,
        assessment: await assessRisk(client, candidate, evidence),
      }))
    );
    results.push(...batchResults);
  }

  return results;
}
```

### Latency Expectations

| Scenario | Expected Latency | Notes |
|----------|-----------------|-------|
| Single candidate, `reasoning_primary` | 1,000-2,000ms | Structured output, small context |
| Single candidate, `reasoning_fallback` | 2,000-4,000ms | Only used for complex multi-signal cases |
| 5 parallel candidates, `reasoning_primary` | 1,200-2,500ms | Parallelism absorbs most overhead |
| 10 candidates (2 batches of 5) | 2,400-5,000ms | Sequential batches, each internally parallel |

## Alert Delivery Latency

### Existing WebSocket Infrastructure

Ship already has a dedicated `/events` WebSocket endpoint (separate from the `/collaboration/*` document sync endpoint). The `eventConns` map in `collaboration/index.ts` (line 95) tracks all connected users:

```typescript
// Existing from collaboration/index.ts
const eventConns = new Map<WebSocket, { userId: string; workspaceId: string }>();
```

The `broadcastToUser` function (line 586) sends typed JSON messages to all of a user's active connections. FleetGraph alerts use this same mechanism.

### Alert Delivery Flow

```typescript
// api/src/fleetgraph/alert.ts

import { broadcastToUser } from '../collaboration/index.js';
import { recordSurfaced } from './dedupe.js';

export interface FleetGraphAlert {
  id: string;
  fingerprint: string;
  signalType: string;
  entityType: string;
  entityId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  recommendation: 'inform_only' | 'confirm_action';
  suggestedAction?: string;
  createdAt: number;
}

export function deliverAlert(
  alert: FleetGraphAlert,
  targetUserId: string,
  candidate: NormalizedCandidate
): void {
  // Record in deduplication cache
  recordSurfaced(candidate);

  // Persist alert to database (async, non-blocking)
  persistAlert(alert, targetUserId).catch(err =>
    console.error('[FleetGraph] Alert persistence failed:', err)
  );

  // Deliver via WebSocket (synchronous, in-process)
  broadcastToUser(targetUserId, 'fleetgraph:alert', {
    id: alert.id,
    fingerprint: alert.fingerprint,
    signalType: alert.signalType,
    entityType: alert.entityType,
    entityId: alert.entityId,
    severity: alert.severity,
    summary: alert.summary,
    recommendation: alert.recommendation,
    suggestedAction: alert.suggestedAction,
    createdAt: alert.createdAt,
  });
}
```

### Delivery Timing

| Step | Time | Notes |
|------|------|-------|
| `recordSurfaced` (Map write) | <1ms | In-memory deduplication update |
| `persistAlert` (DB INSERT) | ~5-20ms | Async, non-blocking. Alert is delivered before persistence confirms. |
| `broadcastToUser` (WS send) | <5ms | Iterates eventConns Map, sends JSON to matching sockets |
| Network transit (server to browser) | <50ms | Same-region WebSocket |
| **Total delivery latency** | **<76ms** | |

The target of <100ms from alert generation to user notification is met with significant margin.

### Alert Persistence Schema

```sql
-- Migration: 039_fleetgraph_alert_state.sql

CREATE TABLE IF NOT EXISTS fleetgraph_alert_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'snoozed', 'dismissed', 'resolved')),
  snoozed_until TIMESTAMPTZ,
  last_surfaced_at TIMESTAMPTZ,
  entity_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_fleetgraph_alert_state_workspace_fingerprint
  ON fleetgraph_alert_state(workspace_id, fingerprint);

CREATE INDEX idx_fleetgraph_alert_state_workspace
  ON fleetgraph_alert_state(workspace_id, created_at DESC);
```

## Latency Measurement and Testing

### Instrumentation Strategy

Every node in the detection pipeline records timing metadata that flows into LangSmith traces:

```typescript
// api/src/fleetgraph/instrumentation.ts

export interface PipelineTimings {
  pipelineId: string;
  source: 'event' | 'sweep' | 'on_demand';
  startedAt: number;
  nodes: Array<{
    name: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    metadata?: Record<string, unknown>;
  }>;
  totalDurationMs: number;
  completedAt: number;
}

export function createTimingTracker(source: 'event' | 'sweep' | 'on_demand'): {
  startNode: (name: string) => void;
  endNode: (metadata?: Record<string, unknown>) => void;
  finalize: () => PipelineTimings;
} {
  const pipelineId = crypto.randomUUID();
  const startedAt = Date.now();
  const nodes: PipelineTimings['nodes'] = [];
  let currentNode: { name: string; startedAt: number } | null = null;

  return {
    startNode(name: string) {
      currentNode = { name, startedAt: Date.now() };
    },
    endNode(metadata?: Record<string, unknown>) {
      if (!currentNode) return;
      const completedAt = Date.now();
      nodes.push({
        name: currentNode.name,
        startedAt: currentNode.startedAt,
        completedAt,
        durationMs: completedAt - currentNode.startedAt,
        metadata,
      });
      currentNode = null;
    },
    finalize(): PipelineTimings {
      const completedAt = Date.now();
      return {
        pipelineId,
        source,
        startedAt,
        nodes,
        totalDurationMs: completedAt - startedAt,
        completedAt,
      };
    },
  };
}
```

### LangSmith Trace Integration

Each pipeline run is a LangSmith trace with timing metadata attached as run tags:

```typescript
import { traceable } from 'langsmith/traceable';

const runDetectionPipeline = traceable(
  async (candidate: NormalizedCandidate) => {
    const timer = createTimingTracker(candidate.source);

    timer.startNode('dedupe_check');
    const shouldProcess = shouldSurface(candidate);
    timer.endNode({ skipped: !shouldProcess });
    if (!shouldProcess) return timer.finalize();

    timer.startNode('heuristic_filter');
    const flagged = await runHeuristic(candidate);
    timer.endNode({ flagged });
    if (!flagged) return timer.finalize();

    timer.startNode('openai_reasoning');
    const assessment = await assessRisk(openaiClient, candidate, flagged.evidence);
    timer.endNode({ severity: assessment.severity, recommendation: assessment.recommendation });

    if (assessment.recommendation !== 'no_issue') {
      timer.startNode('deliver_alert');
      deliverAlert(buildAlert(candidate, assessment), flagged.targetUserId, candidate);
      timer.endNode();
    }

    return timer.finalize();
  },
  { name: 'fleetgraph_detection_pipeline' }
);
```

### Generating the Latency Proof

The timed test required for submission follows this script:

```typescript
// api/src/fleetgraph/__tests__/latency-proof.test.ts

import { describe, it, expect } from 'vitest';

describe('FleetGraph Detection Latency', () => {
  it('surfaces an event-triggered alert in under 30 seconds', async () => {
    const startTime = Date.now();

    // 1. Create a condition that triggers detection
    //    (e.g., change an issue state to 'blocked' via Ship API)
    const issueId = await createTestIssue({ state: 'in_progress' });
    await updateIssueState(issueId, 'blocked');

    // 2. Wait for the FleetGraph alert to arrive via WebSocket
    const alert = await waitForAlert({
      signalType: 'blocked_stale',
      entityId: issueId,
      timeoutMs: 30_000,
    });

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    // 3. Assert latency is under SLA
    expect(alert).toBeDefined();
    expect(latencyMs).toBeLessThan(30_000);

    console.log(`Event-triggered detection latency: ${latencyMs}ms`);
  });

  it('surfaces a sweep-triggered alert in under 5 minutes', async () => {
    const startTime = Date.now();

    // 1. Create a condition that only the sweep detects
    //    (e.g., an active week with no standup on a business day)
    const weekId = await createActiveWeekWithoutStandup();

    // 2. Wait for the sweep to pick it up
    const alert = await waitForAlert({
      signalType: 'missing_standup',
      entityId: weekId,
      timeoutMs: 300_000, // 5 minutes
    });

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    expect(alert).toBeDefined();
    expect(latencyMs).toBeLessThan(300_000);

    console.log(`Sweep-triggered detection latency: ${latencyMs}ms`);
  });

  it('returns first token in under 3 seconds for on-demand', async () => {
    const startTime = Date.now();

    // 1. Request on-demand analysis for an entity
    const stream = await requestOnDemandAnalysis({
      entityType: 'sprint',
      entityId: testWeekId,
    });

    // 2. Wait for first token
    const firstChunk = await stream.next();
    const firstTokenTime = Date.now();
    const latencyMs = firstTokenTime - startTime;

    expect(firstChunk.value).toBeDefined();
    expect(latencyMs).toBeLessThan(3_000);

    console.log(`On-demand first-token latency: ${latencyMs}ms`);
  });
});
```

### Test Output Format for Submission

The latency proof generates a JSON artifact:

```json
{
  "testRunAt": "2026-03-16T00:00:00Z",
  "results": {
    "eventTriggered": {
      "latencyMs": 2847,
      "slaMs": 30000,
      "passed": true,
      "pipelineTimings": {
        "normalize": 2,
        "dedupe": 4,
        "heuristic": 142,
        "reasoning": 1856,
        "delivery": 8,
        "total": 2847
      }
    },
    "sweepTriggered": {
      "latencyMs": 243891,
      "slaMs": 300000,
      "passed": true,
      "sweepCycleHitNumber": 1,
      "pipelineTimings": {
        "enumerate": 312,
        "digestFilter": 28,
        "heuristic": 89,
        "reasoning": 1644,
        "delivery": 6,
        "total": 2079
      }
    },
    "onDemand": {
      "firstTokenMs": 1423,
      "slaMs": 3000,
      "passed": true
    }
  }
}
```

## Bottleneck Analysis

### Risk 1: Ship API Response Times Under Load

**Where:** Batch fetch in sweep (3 parallel HTTP calls to Ship API)

**Typical latency:** 50-200ms per endpoint

**Risk scenario:** If the Ship API is under heavy load (many concurrent users editing documents), response times could spike to 1-2 seconds per call.

**Mitigation:**
- FleetGraph uses a dedicated API token with its own rate limit bucket, separate from user requests
- Batch fetches use `Promise.all` so the slowest call dominates, not the sum
- Entity digest caching means the sweep can partially proceed with stale data if one fetch times out
- Circuit breaker: if Ship API latency exceeds 5 seconds, skip this sweep cycle and log a warning

### Risk 2: OpenAI API Latency

**Where:** Reasoning node, after heuristic flags a candidate

**Typical latency:** 1,000-3,000ms for gpt-4.1-mini with structured outputs

**Risk scenario:** OpenAI API degradation can push latency to 5-10 seconds. Outages block all reasoning.

**Mitigation:**
- Reasoning is the last node in the pipeline. Heuristic filtering runs independently and is unaffected.
- Timeout per reasoning call: 10 seconds. If exceeded, the candidate is re-queued for the next sweep cycle.
- For the event-triggered path, the alert can be delivered with heuristic-only data (lower confidence, flagged as "preliminary") if reasoning times out.
- Model fallback chain: `reasoning_primary` -> `reasoning_fallback`

### Risk 3: Database Writes for Alert State

**Where:** Alert persistence to `fleetgraph_alert_state`

**Typical latency:** 5-20ms for a single INSERT

**Risk scenario:** Database connection pool exhaustion during high write periods (many documents being edited simultaneously).

**Mitigation:**
- Alert persistence is async and non-blocking. The WebSocket delivery happens before the DB write confirms.
- Alert persistence uses a separate connection from the main API pool (or a dedicated queue).
- If the INSERT fails, the alert was already delivered via WebSocket. Persistence is retried on next sweep.
- Persistent dedupe correctness lives in `fleetgraph_alert_state`; the in-memory cache is acceleration only.

### Risk 4: In-Memory State Loss on Process Restart

**Where:** Fingerprint cache and entity digest cache

**Risk scenario:** API server restarts (deployment, crash). All in-memory caches are lost. Next sweep may re-surface recently delivered alerts.

**Mitigation:**
- The `fleetgraph_alert_state` table is the persistent deduplication source of truth. On process start, preload recent rows into the fingerprint cache.
- The worst case is a brief burst of duplicate alerts after restart, which the frontend can dedupe by fingerprint.
- Entity digest cache loss is harmless: the next sweep simply evaluates all entities instead of only changed ones (slower sweep, but within SLA).

### Risk 5: Sweep Overlapping With Previous Sweep

**Where:** setInterval fires while previous sweep is still running

**Risk scenario:** A slow sweep (due to API latency or many candidates) takes longer than 4 minutes, causing the next sweep to start before the first finishes.

**Mitigation:**
```typescript
let sweepInProgress = false;

const sweepInterval = setInterval(async () => {
  if (sweepInProgress) {
    console.warn('[FleetGraph] Skipping sweep cycle: previous sweep still running');
    return;
  }
  sweepInProgress = true;
  try {
    await runSweep();
  } finally {
    sweepInProgress = false;
  }
}, SWEEP_INTERVAL_MS);
```

## End-to-End Timing Diagram

```
EVENT-TRIGGERED PATH (target <30s, typical <3s)
================================================

t=0ms      Ship route handler completes write
t=1ms      fleetGraphBus.enqueue(candidate)
t=3ms      normalizeCandidate() produces fingerprint
t=8ms      shouldSurface() checks dedupe cache
t=8ms      [IF DUPLICATE] -> EXIT (total: 8ms)
t=58ms     runHeuristic() evaluates deterministic checks
t=58ms     [IF NOT FLAGGED] -> EXIT (total: 58ms)
t=2058ms   assessRisk() returns OpenAI structured output
t=2058ms   [IF no_issue] -> EXIT (total: 2058ms)
t=2063ms   deliverAlert() sends via WebSocket
t=2063ms   DONE. User notified.

SWEEP-TRIGGERED PATH (target <5min, typical <5s for pipeline)
=============================================================

t=0s       setInterval fires
t=0.5s     fetchActiveEntities() returns batch data
t=0.55s    filterChangedEntities() reduces via digest cache
t=0.65s    runHeuristic() on changed entities
t=0.65s    [N candidates flagged, M skipped by heuristic]
t=2.65s    assessCandidatesBatch() (parallel, up to 5 concurrent)
t=2.7s     deliverAlert() for each actionable result
t=2.7s     DONE. Alerts delivered. Next sweep in ~237.3 seconds.

ON-DEMAND PATH (target <3s first token)
========================================

t=0ms      User opens FleetGraph panel
t=200ms    fetchContext() parallel API reads complete
t=700ms    OpenAI streaming begins
t=700ms    First token arrives at client. DONE.
```
