# Cost Analysis Deep Dive (Phase 3: Implementation)
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready implementation guide for cost tracking, cost controls, and cost reporting in FleetGraph. This document covers the concrete code, SQL, and configuration needed to build cost observability into the system. It does not re-derive the pricing model or volume assumptions from the Presearch deep dive; it tells you how to build the machinery that enforces and reports on those numbers.

**Prerequisite reading:** [Presearch / 10. Cost Analysis / DEEP_DIVE.md](../../Presearch/10.%20Cost%20Analysis/DEEP_DIVE.md) for pricing tables, volume projections, and sensitivity analysis.

## Canonical model policy

This document is the canonical docs surface for model-selection policy. Other FleetGraph docs should refer to named policy roles and a shared config helper, not hardcode model IDs inline.

Default rollout: bind all reasoning roles to one configured OpenAI Responses model first. Add lower-cost or fallback overrides only after evals justify the extra routing complexity.

## 1. Token Usage Logging Middleware

### The wrapper

Every OpenAI call in FleetGraph passes through a single instrumented wrapper. The wrapper extracts token counts from the response, computes cost, and writes a `FleetGraphRunLog` row.

```typescript
// api/src/fleetgraph/instrumentation/token-logger.ts

import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { pool } from "../../db/pool.js";

// Singleton: wrapped for LangSmith tracing
const openai = wrapOpenAI(new OpenAI());

/** Model pricing lookup (USD per 1M tokens). Keep this in the shared model policy module. */
const MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-4.1":      { input: 2.00, cachedInput: 0.50, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, cachedInput: 0.10, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gpt-4o":       { input: 2.50, cachedInput: 1.25, output: 10.00 },
  "gpt-4o-mini":  { input: 0.15, cachedInput: 0.075, output: 0.60 },
};

function computeCostUsd(
  model: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0; // Unknown model; log 0, alert separately
  const freshInput = inputTokens - cachedTokens;
  return (
    (freshInput * pricing.input) / 1_000_000 +
    (cachedTokens * pricing.cachedInput) / 1_000_000 +
    (outputTokens * pricing.output) / 1_000_000
  );
}

export interface InstrumentedCallOptions<T extends z.ZodType> {
  model: string;
  instructions: string;
  input: OpenAI.Responses.ResponseInput;
  schema: T;
  schemaName: string;
  /** Graph metadata for attribution */
  meta: {
    runId: string;
    mode: "proactive" | "on_demand";
    node: string;
    workspaceId: string;
    entityType?: string;
    entityId?: string;
  };
  maxOutputTokens?: number;
}

export interface InstrumentedResult<T> {
  parsed: T;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
}

/**
 * Instrumented wrapper around openai.responses.parse().
 * Logs token usage to the fleet_graph_run_logs table and returns
 * both the parsed output and the usage metadata.
 */
export async function instrumentedParse<T extends z.ZodType>(
  opts: InstrumentedCallOptions<T>
): Promise<InstrumentedResult<z.infer<T>>> {
  const response = await openai.responses.parse({
    model: opts.model,
    instructions: opts.instructions,
    input: opts.input,
    text: { format: zodResponseFormat(opts.schema, opts.schemaName) },
    ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
  });

  // Extract token counts from the response usage object
  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  const costUsd = computeCostUsd(opts.model, inputTokens, cachedTokens, outputTokens);

  // Fire-and-forget: write the log row
  writeRunLog({
    run_id: opts.meta.runId,
    mode: opts.meta.mode,
    node: opts.meta.node,
    model: opts.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    cost_usd: costUsd,
    workspace_id: opts.meta.workspaceId,
    entity_type: opts.meta.entityType ?? null,
    entity_id: opts.meta.entityId ?? null,
  }).catch((err) => {
    console.error("[fleetgraph] Failed to write run log:", err.message);
  });

  return {
    parsed: response.output_parsed as z.infer<T>,
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
  };
}
```

### Using the wrapper in a graph node

```typescript
// api/src/fleetgraph/nodes/reason-about-risk.ts

import { instrumentedParse } from "../instrumentation/token-logger.js";
import { RiskAssessmentSchema } from "../schemas/risk-assessment.js";
import type { FleetGraphState } from "../state.js";

export async function reasonAboutRisk(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  if (state.candidates.length === 0) {
    return { riskAssessment: null };
  }

  const model = resolveModelPolicy({
    role: "reasoning_primary",
    mode: state.mode,
  });

  const result = await instrumentedParse({
    model,
    instructions: buildSystemPrompt(state.entityType, state.mode),
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidates: state.candidates,
          context: summarizeContext(state.coreContext),
        }),
      },
    ],
    schema: RiskAssessmentSchema,
    schemaName: "risk_assessment",
    meta: {
      runId: state.traceId,
      mode: state.mode,
      node: "reason_about_risk",
      workspaceId: state.workspaceId,
      entityType: state.entityType,
      entityId: state.entityId,
    },
    maxOutputTokens: 800,
  });

  return { riskAssessment: result.parsed };
}
```

Every LLM-backed node (reason_about_risk, on-demand chat response, action reasoning) calls `instrumentedParse` instead of `openai.responses.parse()` directly. Deterministic nodes do not call this wrapper since they do not invoke the LLM.

### FleetGraphRunLog table design

```sql
-- api/src/db/migrations/NNN_fleet_graph_run_logs.sql

CREATE TABLE IF NOT EXISTS fleet_graph_run_logs (
  id            BIGSERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,              -- graph trace ID (maps to LangSmith run)
  mode          TEXT NOT NULL CHECK (mode IN ('proactive', 'on_demand')),
  node          TEXT NOT NULL,              -- graph node name
  model         TEXT NOT NULL,              -- e.g. 'gpt-4.1-mini'
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
  workspace_id  TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for cost dashboard queries
CREATE INDEX idx_fgrl_workspace_created ON fleet_graph_run_logs (workspace_id, created_at);
CREATE INDEX idx_fgrl_mode_created      ON fleet_graph_run_logs (mode, created_at);
CREATE INDEX idx_fgrl_node              ON fleet_graph_run_logs (node);
CREATE INDEX idx_fgrl_run_id            ON fleet_graph_run_logs (run_id);
```

### Write function

```typescript
// api/src/fleetgraph/instrumentation/token-logger.ts (continued)

interface RunLogRow {
  run_id: string;
  mode: string;
  node: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  workspace_id: string;
  entity_type: string | null;
  entity_id: string | null;
}

async function writeRunLog(row: RunLogRow): Promise<void> {
  await pool.query(
    `INSERT INTO fleet_graph_run_logs
       (run_id, mode, node, model, input_tokens, output_tokens, cached_tokens,
        cost_usd, workspace_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.run_id,
      row.mode,
      row.node,
      row.model,
      row.input_tokens,
      row.output_tokens,
      row.cached_tokens,
      row.cost_usd,
      row.workspace_id,
      row.entity_type,
      row.entity_id,
    ]
  );
}
```

### Cross-referencing with LangSmith

The `run_id` stored in `fleet_graph_run_logs` is the same value passed as `metadata.traceId` to the graph invocation. To correlate:

1. Query `fleet_graph_run_logs` for cost data
2. Search LangSmith with `eq(metadata["traceId"], "<run_id>")` for the full trace
3. The LangSmith trace shows the execution path, latency, and raw payloads
4. The `fleet_graph_run_logs` table shows the cost attribution that LangSmith does not natively provide

This two-source model gives you cost granularity (from the table) and execution detail (from LangSmith) without duplicating data.

## 2. Cost Dashboard Queries

These SQL queries power the operator dashboard. They run against `fleet_graph_run_logs`.

### Daily/weekly/monthly spend

```sql
-- Daily spend for last 30 days
SELECT
  date_trunc('day', created_at) AS day,
  SUM(cost_usd)                 AS total_usd,
  SUM(input_tokens)             AS total_input,
  SUM(output_tokens)            AS total_output,
  COUNT(*)                      AS call_count
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC;

-- Weekly spend
SELECT
  date_trunc('week', created_at) AS week,
  SUM(cost_usd)                  AS total_usd,
  COUNT(*)                       AS call_count
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '12 weeks'
GROUP BY week
ORDER BY week DESC;

-- Monthly spend
SELECT
  date_trunc('month', created_at) AS month,
  SUM(cost_usd)                   AS total_usd,
  COUNT(*)                        AS call_count
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '6 months'
GROUP BY month
ORDER BY month DESC;
```

### Spend by mode (proactive vs on-demand)

```sql
SELECT
  mode,
  date_trunc('day', created_at) AS day,
  SUM(cost_usd)                 AS total_usd,
  COUNT(*)                      AS call_count
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY mode, day
ORDER BY day DESC, mode;
```

### Spend by node (use case attribution)

```sql
SELECT
  node,
  SUM(cost_usd)    AS total_usd,
  AVG(cost_usd)    AS avg_per_call,
  COUNT(*)          AS call_count,
  AVG(input_tokens) AS avg_input,
  AVG(output_tokens) AS avg_output
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY node
ORDER BY total_usd DESC;
```

### Spend per workspace (multi-tenant)

```sql
SELECT
  workspace_id,
  SUM(cost_usd)    AS total_usd,
  COUNT(*)          AS call_count,
  SUM(cost_usd) / GREATEST(COUNT(DISTINCT date_trunc('day', created_at)), 1) AS avg_daily_usd
FROM fleet_graph_run_logs
WHERE created_at >= now() - INTERVAL '30 days'
GROUP BY workspace_id
ORDER BY total_usd DESC;
```

### Budget alert query

```sql
-- Check if any workspace exceeds its daily budget
-- Run this query from the sweep scheduler every 4 minutes
SELECT
  workspace_id,
  SUM(cost_usd) AS today_usd
FROM fleet_graph_run_logs
WHERE created_at >= date_trunc('day', now())
GROUP BY workspace_id
HAVING SUM(cost_usd) > :daily_budget_usd;
```

### What to surface in the dashboard

| Panel | Source Query | Refresh Interval |
|-------|-------------|-----------------|
| Today's spend (total) | Sum where `created_at >= today` | 5 min |
| Spend trend (7 day sparkline) | Daily aggregation, last 7 days | 1 hour |
| Proactive vs on-demand ratio | Group by mode, current month | 1 hour |
| Top spending workspaces | Group by workspace_id, current month | 1 hour |
| Top spending nodes | Group by node, current month | 1 hour |
| Budget alerts | Workspace daily threshold check | 5 min |
| Average cost per call | Avg(cost_usd) grouped by node | 1 hour |
| Cache hit rate | Avg(cached_tokens / input_tokens) | 1 hour |

## 3. Cost Control Implementation

### Configuration table

```sql
-- api/src/db/migrations/NNN_fleet_graph_cost_config.sql

CREATE TABLE IF NOT EXISTS fleet_graph_cost_config (
  workspace_id       TEXT PRIMARY KEY,
  daily_budget_usd   NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
  per_run_token_cap  INTEGER NOT NULL DEFAULT 6000,   -- max total tokens per LLM call
  proactive_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  model_override     TEXT,                              -- force a cheaper model when budget is low
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Cost guard middleware

```typescript
// api/src/fleetgraph/instrumentation/cost-guard.ts

import { pool } from "../../db/pool.js";

export interface CostGuardResult {
  allowed: boolean;
  reason?: string;
  modelOverride?: string;
}

/**
 * Check cost budget before making an LLM call.
 * Returns { allowed: false } if budget is exceeded.
 * Returns { modelOverride } if budget is low and a cheaper model should be used.
 */
export async function checkCostBudget(
  workspaceId: string,
  mode: "proactive" | "on_demand"
): Promise<CostGuardResult> {
  // 1. Load workspace config
  const configResult = await pool.query(
    `SELECT daily_budget_usd, proactive_enabled, model_override
     FROM fleet_graph_cost_config
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const config = configResult.rows[0] ?? {
    daily_budget_usd: 10.0,
    proactive_enabled: true,
    model_override: null,
  };

  // 2. Circuit breaker: proactive mode disabled
  if (mode === "proactive" && !config.proactive_enabled) {
    return { allowed: false, reason: "proactive_disabled" };
  }

  // 3. Check today's spend
  const spendResult = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS today_usd
     FROM fleet_graph_run_logs
     WHERE workspace_id = $1
       AND created_at >= date_trunc('day', now())`,
    [workspaceId]
  );

  const todayUsd = parseFloat(spendResult.rows[0].today_usd);
  const budget = parseFloat(config.daily_budget_usd);

  // 4. Hard stop: budget exceeded
  if (todayUsd >= budget) {
    return { allowed: false, reason: "daily_budget_exceeded" };
  }

  // 5. Soft threshold: >80% budget consumed, downgrade model
  if (todayUsd >= budget * 0.8) {
    return {
      allowed: true,
      modelOverride: config.model_override ?? resolveModelPolicy({ role: "reasoning_primary", mode }),
    };
  }

  // 6. Under budget
  return { allowed: true };
}
```

### Integrating the guard into graph nodes

```typescript
// api/src/fleetgraph/nodes/reason-about-risk.ts (updated)

import { checkCostBudget } from "../instrumentation/cost-guard.js";
import { instrumentedParse } from "../instrumentation/token-logger.js";

export async function reasonAboutRisk(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  if (state.candidates.length === 0) {
    return { riskAssessment: null };
  }

  // Cost guard check
  const budget = await checkCostBudget(state.workspaceId, state.mode);

  if (!budget.allowed) {
    console.warn(
      `[fleetgraph] Cost guard blocked: workspace=${state.workspaceId} reason=${budget.reason}`
    );
    // Return an explicit degraded outcome instead of pretending there is no issue
    return {
      riskAssessment: null,
      degradedReason: budget.reason,
      systemNotice: {
        type: "analysis_deferred",
        detail: "LLM reasoning skipped because the workspace budget is exhausted.",
      },
    };
  }

  // Model selection: start from the shared policy helper; allow budget-aware override if configured
  const defaultModel = resolveModelPolicy({
    role: "reasoning_primary",
    mode: state.mode,
  });
  const model = budget.modelOverride ?? defaultModel;

  const result = await instrumentedParse({
    model,
    instructions: buildSystemPrompt(state.entityType, state.mode),
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidates: state.candidates,
          context: summarizeContext(state.coreContext),
        }),
      },
    ],
    schema: RiskAssessmentSchema,
    schemaName: "risk_assessment",
    meta: {
      runId: state.traceId,
      mode: state.mode,
      node: "reason_about_risk",
      workspaceId: state.workspaceId,
      entityType: state.entityType,
      entityId: state.entityId,
    },
    maxOutputTokens: 800,
  });

  return { riskAssessment: result.parsed };
}
```

### Per-run token limit enforcement

The `max_output_tokens` parameter on the OpenAI call caps output. For input, truncate before sending:

```typescript
// api/src/fleetgraph/instrumentation/token-budget.ts

/** Token budget caps per node type */
const TOKEN_CAPS: Record<string, { maxInput: number; maxOutput: number }> = {
  reason_about_risk:      { maxInput: 3000,  maxOutput: 800 },
  chat_first_response:    { maxInput: 6000,  maxOutput: 1500 },
  chat_follow_up:         { maxInput: 3000,  maxOutput: 800 },
  action_reasoning:       { maxInput: 5000,  maxOutput: 1200 },
};

/**
 * Rough token estimate: 1 token per 4 characters.
 * Use tiktoken for exact counts if precision matters.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate input content to stay within the node's token budget.
 * Removes the least important data first (recent signals, then related entities).
 * Never truncates the system prompt.
 */
export function enforceInputBudget(
  node: string,
  systemPrompt: string,
  userContent: string
): string {
  const caps = TOKEN_CAPS[node];
  if (!caps) return userContent;

  const systemTokens = estimateTokens(systemPrompt);
  const remainingBudget = caps.maxInput - systemTokens;

  if (estimateTokens(userContent) <= remainingBudget) {
    return userContent;
  }

  // Truncate to fit. In production, parse the JSON and remove
  // least-recent signals first, then trim related entities.
  const maxChars = remainingBudget * 4;
  return userContent.slice(0, maxChars);
}

export function getMaxOutputTokens(node: string): number {
  return TOKEN_CAPS[node]?.maxOutput ?? 800;
}
```

### Proactive mode circuit breaker

The sweep scheduler checks cost before starting each sweep:

```typescript
// api/src/fleetgraph/scheduler.ts (excerpt)

import { checkCostBudget } from "./instrumentation/cost-guard.js";

async function runProactiveSweep(workspaceId: string): Promise<void> {
  const budget = await checkCostBudget(workspaceId, "proactive");

  if (!budget.allowed) {
    console.warn(
      `[fleetgraph] Proactive sweep skipped: workspace=${workspaceId} reason=${budget.reason}`
    );
    // Record the skip in a metrics table for dashboard visibility
    await pool.query(
      `INSERT INTO fleet_graph_sweep_skips (workspace_id, reason, created_at)
       VALUES ($1, $2, now())`,
      [workspaceId, budget.reason]
    );
    return;
  }

  // Proceed with sweep...
}
```

## 4. Infrastructure Cost Breakdown

FleetGraph runs inside the existing Ship API on Elastic Beanstalk. Additional infrastructure costs come from compute for the worker, database storage for run logs and checkpoints, and logging.

### Compute: Elastic Beanstalk

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| FleetGraph worker | Shared with Ship API (t3.small) | Upgrade to t3.medium ($30/mo) | Dedicated worker instance, t3.large ($60/mo) |
| Proactive sweep scheduler | Runs on same EB instance | Same | Separate worker tier on EB ($60/mo) |
| **Incremental EB cost** | **$0** | **$30** | **$120** |

At 100 users, the Ship API's existing t3.small instance handles FleetGraph. The proactive sweep is a lightweight cron (every 4 minutes) that evaluates heuristics in-memory; LLM calls are async I/O, not CPU-bound.

At 10,000 users, a separate EB worker tier runs proactive sweeps independently from the API serving path, preventing sweep latency from affecting on-demand request latency.

### Storage: Aurora PostgreSQL

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| `fleet_graph_run_logs` rows/month | ~6,800 | ~58,500 | ~400,000 |
| Row size (avg) | ~200 bytes | ~200 bytes | ~200 bytes |
| Storage/month | ~1.4 MB | ~11.7 MB | ~80 MB |
| LangGraph checkpoint storage | ~5 MB | ~50 MB | ~500 MB |
| **Incremental Aurora I/O** | **$0 (shared)** | **$10** | **$50** |
| **Incremental Aurora storage** | **$0 (shared)** | **$5** | **$20** |

Aurora charges $0.10/GB-month for storage and $0.20 per 1M I/O operations. At 10,000 users the checkpoint tables are the main storage driver. The 30-day cleanup job keeps checkpoint growth bounded.

### Cache: ElastiCache (entity digest dedup)

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Cache type | In-memory Map (no infra) | ElastiCache t4g.micro | ElastiCache t4g.small |
| Monthly cost | $0 | $12 | $25 |

At 100 users, a Node.js `Map` is sufficient (300 entities, ~60KB). At 1,000+ users, ElastiCache ensures digest state survives process restarts and scales across multiple EB instances.

### Data transfer

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| OpenAI API calls (outbound) | Negligible (JSON payloads) | ~1 GB/mo | ~10 GB/mo |
| AWS outbound transfer | Free tier (first 100 GB) | Free tier | $0.09/GB after 100 GB |
| **Monthly data transfer** | **$0** | **$0** | **$0** |

FleetGraph's payloads are small JSON. Even at 10,000 users, total data transfer stays well within AWS free tier.

### CloudWatch logging

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Log volume (FleetGraph-specific) | ~50 MB/mo | ~500 MB/mo | ~5 GB/mo |
| CloudWatch ingestion ($0.50/GB) | $0.03 | $0.25 | $2.50 |
| CloudWatch storage ($0.03/GB/mo) | $0.01 | $0.10 | $1.00 |
| **Monthly CloudWatch** | **$0.04** | **$0.35** | **$3.50** |

### Infrastructure total

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Elastic Beanstalk (incremental) | $0 | $30 | $120 |
| Aurora (I/O + storage) | $0 | $15 | $70 |
| ElastiCache | $0 | $12 | $25 |
| CloudWatch | $0 | $1 | $4 |
| Data transfer | $0 | $0 | $0 |
| **Infrastructure total** | **$0** | **$58** | **$219** |

These numbers are lower than the Presearch estimates ($5 / $100 / $400) because the Presearch used conservative round numbers as safety margin. The breakdown above reflects more precise per-service pricing.

## 5. Cost Optimization Roadmap

### Phase 1: MVP (Week 1 of implementation)

**Goal:** Basic observability. Know what FleetGraph costs after a day of operation.

| Deliverable | Implementation |
|-------------|---------------|
| `instrumentedParse()` wrapper | Wraps every LLM call, logs to `fleet_graph_run_logs` |
| Migration for `fleet_graph_run_logs` | SQL table with indexes |
| Model pricing map | Hardcoded in `token-logger.ts` |
| Manual cost review | Query `fleet_graph_run_logs` with SQL; check OpenAI dashboard |

**What this does NOT include:** Dashboard UI, automatic model downgrade, budget alerts. You review costs by running SQL queries.

### Phase 2: Optional eval-backed model tiering (Week 2+)

**Goal:** Route calls to the cheapest model that produces acceptable quality for the signal severity.

| Deliverable | Implementation |
|-------------|---------------|
| Signal severity-based model selection | Keep the default single-model path unless evals prove severity-based overrides preserve quality. If enabled, express low/medium/high routing in the shared model-policy helper instead of hardcoding node logic. |
| Cost guard middleware | `checkCostBudget()` blocks calls when daily budget is exceeded |
| Per-workspace budget config | `fleet_graph_cost_config` table |
| Budget alert logging | Sweep scheduler logs skips; cost guard logs blocks |

**Estimated savings:** If 60% of proactive signals are low severity and nano passes evals, proactive costs drop by ~50%.

### Phase 3: Prompt caching and response caching (Week 3)

**Goal:** Reduce input token cost by maximizing OpenAI's automatic caching and avoid redundant LLM calls.

| Deliverable | Implementation |
|-------------|---------------|
| Stable prompt prefix >= 1,024 tokens | Pad system instructions with detailed schema docs and heuristic rules. Keep variable data after the stable prefix. |
| Entity digest caching | SHA-256 of entity state. Store in Redis/Map. Skip LLM if digest unchanged. TTL = 1 hour. |
| Response caching for on-demand | Cache structured output keyed on `(entityId, entityStateHash, node)`. TTL = 10 minutes. Serve cached response for repeat queries on unchanged entities. |
| Cache hit rate metric | Log cache hits/misses in `fleet_graph_run_logs` with `node = 'cache_hit'` and `cost_usd = 0`. |

**Estimated savings:**
- Prompt caching: 38% reduction on input tokens for proactive calls (from Presearch analysis)
- Entity digest caching: 30-50% fewer proactive LLM calls during quiet periods
- Response caching: 20-30% fewer on-demand LLM calls when users view the same entity within 10 minutes

### Phase 4: Batch processing for proactive sweeps (Week 4+)

**Goal:** Reduce per-call overhead by batching multiple entity evaluations into a single LLM call.

| Deliverable | Implementation |
|-------------|---------------|
| Batch prompt assembly | Group up to 5 flagged entities from the same project into a single prompt. Model evaluates all 5 and returns an array of assessments. |
| Batch response parsing | Zod schema becomes `z.array(RiskAssessmentSchema)` with an `entityId` field per item. |
| Token efficiency gain | System prompt (400 tokens) is sent once per batch instead of once per entity. At 5 entities/batch: 2,000 tokens saved per batch. |

**Estimated savings:** At 10,000 users with 4,000 daily proactive calls, batching into groups of 5 reduces calls to ~800/day. Monthly proactive cost drops from $192 to ~$80.

**Risk:** Batch prompts are longer, reducing prompt cache hit rate. Net savings depend on batch size vs cache invalidation. Test with batch sizes of 3, 5, and 10.

## 6. PRD Submission Tables

These tables are the exact format required by the FleetGraph PRD grading rubric. Fill them in `FLEETGRAPH.md` at submission.

### Development and Testing Costs

```markdown
| Item | Amount |
|------|--------|
| OpenAI input tokens | _______ |
| OpenAI output tokens | _______ |
| Total invocations during development | _______ |
| Total development spend (USD) | _______ |
```

**Source:** `fleet_graph_run_logs` table + OpenAI usage dashboard. If development also uses Claude Code or Codex for coding, those costs go into a separate "agent-assisted development" line, not the OpenAI production cost line. The PRD asks for OpenAI API spend specifically.

**Query to generate at submission:**

```sql
SELECT
  SUM(input_tokens)  AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  COUNT(*)            AS total_invocations,
  SUM(cost_usd)       AS total_spend_usd
FROM fleet_graph_run_logs;
```

### Production Cost Projections

```markdown
| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Proactive OpenAI | $1.92/mo | $19.20/mo | $192.00/mo |
| On-demand OpenAI | $36.79/mo | $306.60/mo | $1,839.60/mo |
| LangSmith tracing | $39.00/mo | $131.50/mo | ~$300-500/mo |
| Infrastructure (EB, Aurora, cache) | $0/mo | $58/mo | $219/mo |
| **Total monthly** | **$77.71** | **$515.30** | **$2,550.60-2,750.60** |
| **Per user per month** | **$0.78** | **$0.52** | **$0.26-0.28** |
```

### Assumptions (document alongside projections)

```markdown
**Volume assumptions:**
- Proactive: 40 / 400 / 4,000 LLM calls per day (after heuristic filter + dedup)
- On-demand: 60 / 500 / 3,000 first responses per day
- On-demand follow-ups: 120 / 1,000 / 6,000 per day
- Action reasoning: 6 / 50 / 300 per day

**Token assumptions:**
- Proactive: ~2,000 input + ~500 output per call
- On-demand first: ~4,000 input + ~1,000 output per call
- On-demand follow-up: ~2,000 input + ~500 output per call
- Action reasoning: ~3,000 input + ~800 output per call

**Model assumptions:**
- Proactive + follow-ups: GPT-4.1 mini ($0.40/$1.60 per 1M tokens)
- First response + action reasoning: GPT-4.1 ($2.00/$8.00 per 1M tokens)

**Infrastructure assumptions:**
- Shared EB instance at 100 users; dedicated worker at 10K
- Aurora shared at 100 users; incremental I/O at scale
- ElastiCache only needed at 1K+ users
```

## 7. Cost Attribution for FLEETGRAPH.md

The final `FLEETGRAPH.md` deliverable requires a cost section. Here is how to generate the data.

### Step 1: Collect development token usage

```bash
# From fleet_graph_run_logs (if FleetGraph has been running locally)
psql $DATABASE_URL -c "
  SELECT
    SUM(input_tokens) AS input,
    SUM(output_tokens) AS output,
    COUNT(*) AS invocations,
    SUM(cost_usd) AS spend
  FROM fleet_graph_run_logs;
"

# From OpenAI dashboard: filter by date range of FleetGraph development
# platform.openai.com/usage -> filter by project or API key

# Claude Code development costs (for context, not the PRD OpenAI line)
npx ccusage session --instances -p ShipShapeProject
```

### Step 2: Separate FleetGraph from other Ship AI features

If Ship has other AI features sharing the same OpenAI API key:
- **Option A (preferred):** Use a separate OpenAI Project for FleetGraph. Create at platform.openai.com/settings -> Projects. Each project gets isolated billing.
- **Option B:** Filter by the `fleet_graph_run_logs` table, which logs only FleetGraph calls regardless of shared API key.
- **Option C:** Use LangSmith project filtering. All FleetGraph traces are tagged under the `fleetgraph-dev` or `fleetgraph-prod` LangSmith project.

### Step 3: Template for the submission

```markdown
## Cost Analysis

### Development Costs

| Item | Amount |
|------|--------|
| OpenAI input tokens | X,XXX,XXX |
| OpenAI output tokens | XXX,XXX |
| Total invocations | X,XXX |
| Total development spend | $XX.XX |

Development costs were tracked via the `fleet_graph_run_logs` table, which
instruments every LLM call through the `instrumentedParse()` wrapper.
Cross-referenced with the OpenAI usage dashboard filtered to the FleetGraph
API project.

### Production Cost Projections

| Tier | Monthly Cost | Per User/Month |
|------|-------------|----------------|
| 100 users | $78 | $0.78 |
| 1,000 users | $515 | $0.52 |
| 10,000 users | $2,551-2,751 | $0.26-0.28 |

Assumptions: [link to full assumptions in this doc]

### LangSmith Traces

- Development traces: [LangSmith project link]
- Example proactive trace: [trace link]
- Example on-demand trace: [trace link]
- Example action approval trace: [trace link]
```

## 8. Sensitivity Analysis

The Presearch deep dive covers variable-by-variable sensitivity (candidate rate, session count, turns, cache hit rate). This section covers the implementation-relevant question: what changes costs dramatically when you change a design decision?

### Adding a new use case

**Scenario:** Add a sixth signal type (e.g., "dependency_risk" that checks cross-project blocking chains).

| Impact | Marginal Cost |
|--------|---------------|
| Heuristic evaluation | $0 (deterministic, runs on existing sweep) |
| LLM calls if candidate rate stays at 3% | +0% (same entities, new signal type on existing entities) |
| LLM calls if new signal flags additional 1% of entities | +33% proactive LLM calls |
| At 10,000 users: +33% of $192/mo | **+$63/mo** |

Adding a use case is cheap if the heuristic is selective. The LLM cost scales with the candidate rate, not the number of signal types.

### Changing sweep frequency

| Frequency | Sweeps/Day | Realistic LLM Calls/Day (10K) | Monthly Proactive Cost |
|-----------|-----------|-------------------------------|----------------------|
| Every 15 min | 96 | ~1,300 | $62 |
| Every 4 min (default) | 360 | ~5,000 | $240 |
| Every 2 min | 720 | ~10,000 | $480 |
| Every 1 min | 1,440 | ~20,000 | $960 |

The entity digest cache absorbs most of the increased frequency (unchanged entities are skipped). The cost increase is sublinear with frequency because more sweeps hit cached digests. Moving from 4-minute to 2-minute sweeps does not fully double the cost, but it does materially increase scheduler volume.

**Recommendation:** 4-minute sweeps are the canonical default because they preserve latency margin under the PRD's 5-minute SLA. 2-minute sweeps are justifiable only for high-value workspaces willing to pay materially more.

### Changing model

| Model | Cost/Proactive Call | Monthly Proactive (10K) | Monthly On-Demand First (10K) |
|-------|--------------------|-----------------------|------------------------------|
| GPT-4.1 nano | $0.0005 | $60 | N/A (quality too low for user-facing) |
| GPT-4.1 mini | $0.0016 | $192 | $480 (if used for first response) |
| GPT-4.1 | $0.0160 | $1,920 | $1,440 |
| GPT-4o | $0.0175 | $2,100 | $1,575 |

**Key insight:** The model choice for proactive sweeps is a 32x cost swing between nano ($60/mo) and GPT-4.1 ($1,920/mo). Run evals on nano early. If nano achieves >80% agreement with mini on proactive triage decisions, the savings are massive.

### Adding more context per prompt

| Context Size | Input Tokens | Cost/Proactive Call (mini) | Monthly Proactive (10K) |
|-------------|-------------|---------------------------|------------------------|
| Minimal (title + status) | 800 | $0.0007 | $84 |
| Standard (digest) | 2,000 | $0.0016 | $192 |
| Rich (full doc + history) | 6,000 | $0.0032 | $384 |
| Full context (all linked entities) | 12,000 | $0.0056 | $672 |

**Formula:** `monthly_cost = daily_calls * ((input_tokens * input_price / 1M) + (output_tokens * output_price / 1M)) * 30`

Every 1,000 additional input tokens per proactive call adds ~$48/mo at 10,000 users (on GPT-4.1 mini). This is why entity digests (200 tokens) are preferred over full document bodies (2,000-10,000 tokens) for proactive sweeps.

### Combined worst-case scenario

All pessimistic assumptions simultaneously:

| Variable | Pessimistic Value |
|----------|------------------|
| Candidate rate | 5% (vs 3% baseline) |
| On-demand sessions/user/day | 3 (vs 1.5 baseline) |
| Turns per session | 5 (vs 3 baseline) |
| Cache hit rate | 50% (vs 70% baseline) |
| Model | Configured primary Responses model everywhere (no eval-backed overrides) |

**Result at 10,000 users:**
- Proactive: 6,667 calls/day * $0.016/call * 30 = **$3,200/mo**
- On-demand: (6,000 first * $0.016 + 18,000 follow * $0.016 + 600 action * $0.0124) * 30 = **$11,743/mo**
- LangSmith: **~$500/mo**
- Infrastructure: **$219/mo**
- **Total: ~$15,662/mo ($1.57/user/mo)**

This is the absolute ceiling. It requires every guard to fail simultaneously. With the cost controls in section 3 active (daily budget cap, optional eval-backed tiering, proactive circuit breaker), this scenario is structurally impossible.

### Combined best-case scenario

All optimistic assumptions:

| Variable | Optimistic Value |
|----------|-----------------|
| Candidate rate | 1% |
| GPT-4.1 nano passes proactive evals | Yes |
| Cache hit rate | 90% |
| On-demand sessions/user/day | 1 |
| Batch processing active | 5 entities/batch |

**Result at 10,000 users:**
- Proactive: ~160 calls/day * $0.0005/call * 30 = **$2.40/mo**
- On-demand: (2,000 first * $0.016 + 4,000 follow * $0.0016 + 200 action * $0.0124) * 30 = **$1,126/mo**
- LangSmith: **~$300/mo**
- Infrastructure: **$219/mo**
- **Total: ~$1,647/mo ($0.16/user/mo)**

The proactive cost becomes negligible. On-demand first responses dominate because they use GPT-4.1 (the expensive model) and are directly proportional to user activity.

## Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| [Presearch / 10. Cost Analysis / DEEP_DIVE](../../Presearch/10.%20Cost%20Analysis/DEEP_DIVE.md) | Pricing tables, volume assumptions, sensitivity variables. This document builds on those numbers. |
| [COST_TRACKING.md](../../COST_TRACKING.md) | Development cost snapshots from ccusage. Separate from production cost projections. |
| [Presearch / 04. LangGraph and LangSmith / DEEP_DIVE](../../Presearch/04.%20LangGraph%20and%20LangSmith/DEEP_DIVE.md) | `wrapOpenAI` setup, LangSmith tracing integration that `instrumentedParse()` depends on. |
| [Presearch / 05. Required Node Types / DEEP_DIVE](../../Presearch/05.%20Required%20Node%20Types/DEEP_DIVE.md) | Node definitions and token budgets per node. |
| [Phase 3 / 08. Deployment Model](../08.%20Deployment%20Model/README.md) | EB instance sizing and worker tier architecture referenced in the infrastructure breakdown. |
