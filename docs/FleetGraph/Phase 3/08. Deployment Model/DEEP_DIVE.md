# Deployment Model: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready implementation guide for deploying FleetGraph into Ship's existing Elastic Beanstalk + Aurora PostgreSQL infrastructure. Covers worker architecture, multi-instance safety, pipeline changes, environment variables, migrations, monitoring, and rollback.

This document focuses on **implementation specifics** not covered in the Presearch 08 deep dive. Read that document for infrastructure topology, service token creation, seed data requirements, and trace capture strategy.

## Reconciliation Note

- Request handlers enqueue candidates; the worker owns graph execution
- The fallback sweep cadence is 4 minutes
- Approval rows follow the full HITL lifecycle with 72-hour expiry
- LangGraph checkpoints live in the `fleetgraph` schema and are created by `checkpointer.setup()`

Migration reconciliation note: Ship-managed numbered migrations cover `fleetgraph_alert_state`, `fleetgraph_approvals`, and `fleetgraph_audit_log`. LangGraph checkpoint tables are created by `PostgresSaver.setup()` inside the `fleetgraph` schema and are not a numbered Ship migration.

---

## 1. Worker Process Architecture

### Current Server Startup Sequence

The Ship API starts via `api/src/index.ts`:

```
main()
  1. dotenv loads .env.local, .env
  2. if production: loadProductionSecrets() from SSM
  3. import createApp (Express routes, middleware)
  4. import setupCollaboration (WebSocket/Yjs)
  5. createServer(app)
  6. set DDoS timeouts (60s request, 65s keepAlive, 66s headers)
  7. setupCollaboration(server)
  8. server.listen(PORT)
```

### Where FleetGraph Initializes

FleetGraph starts **after** `server.listen()` resolves. This ensures:
- SSM secrets are already loaded (OpenAI key, LangSmith key, service token)
- Database pool is ready (`api/src/db/client.ts` initializes on import)
- Express routes are accepting requests (health check passes)
- Collaboration WebSocket is active

```typescript
// api/src/index.ts - addition after server.listen()

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});

// FleetGraph worker: conditional on feature flag
if (process.env.FLEETGRAPH_ENABLED === 'true') {
  const { startFleetGraphWorker } = await import('./fleetgraph/worker.js');
  startFleetGraphWorker();
  console.log('FleetGraph proactive worker started');
}
```

The dynamic `import()` ensures zero FleetGraph code loads when the feature is disabled. No LangChain packages parsed, no OpenAI client constructed, no memory allocated.

### Worker Module Structure

```
api/src/fleetgraph/
  worker.ts           -- Sweep loop, lifecycle management, advisory lock
  graph.ts            -- LangGraph StateGraph definition
  checkpointer.ts     -- PostgresSaver setup using shared pool
  nodes/
    fetch-context.ts  -- Pulls workspace data from Ship API
    heuristic.ts      -- Deterministic signal filters (no LLM)
    reason.ts         -- OpenAI reasoning node
    alert-state.ts    -- Upserts canonical `fleetgraph_alert_state` dedupe and suppression rows
    approve.ts        -- Creates approval gates
  routes.ts           -- Express routes: /api/fleetgraph/*
```

### Worker Lifecycle

```typescript
// api/src/fleetgraph/worker.ts

import { pool } from '../db/client.js';

interface WorkerState {
  intervalId: ReturnType<typeof setInterval> | null;
  lastSweepAt: string | null;
  lastSweepDurationMs: number | null;
  running: boolean;
  sweepInProgress: boolean;
}

// Exported for health check access
export const workerState: WorkerState = {
  intervalId: null,
  lastSweepAt: null,
  lastSweepDurationMs: null,
  running: false,
  sweepInProgress: false,
};

const SWEEP_INTERVAL = parseInt(
  process.env.FLEETGRAPH_SWEEP_INTERVAL_MS || '240000',
  10,
);

export function startFleetGraphWorker(): void {
  if (workerState.running) return;
  workerState.running = true;

  // Run first sweep after 10s delay (let server stabilize)
  setTimeout(() => runSweep(), 10_000);

  // Schedule recurring sweeps
  workerState.intervalId = setInterval(() => runSweep(), SWEEP_INTERVAL);

  // Graceful shutdown
  const shutdown = () => {
    console.log('FleetGraph worker shutting down...');
    workerState.running = false;
    if (workerState.intervalId) {
      clearInterval(workerState.intervalId);
      workerState.intervalId = null;
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

### Process Isolation Concerns

FleetGraph shares the Node.js event loop with the Express API. Three risks and mitigations:

**Memory.** LangGraph state objects and OpenAI responses allocate heap memory. The sweep processes one workspace at a time and releases references between iterations. Worst case for a single workspace: approximately 5 MB during the reasoning node (context window serialization). With the default `max-old-space-size` (Node 20 defaults to approximately 4 GB on t3.small with 2 GB RAM, capped by container memory), this is negligible. Monitor with `process.memoryUsage().heapUsed` logged per sweep.

**CPU.** Heuristic nodes are pure JavaScript (array filtering, date math). The OpenAI reasoning node is I/O-bound (HTTP request). JSON serialization of LangGraph state is the only CPU-intensive moment, taking less than 50ms for typical workspace sizes. The event loop is never blocked for longer than one tick.

**Event loop blocking.** All database queries use the async `pg` Pool. OpenAI calls use `fetch` (async). The only synchronous operation is JSON.parse of checkpoint state, which is bounded by checkpoint size (typically under 100 KB). If a future node adds CPU-heavy work (embedding computation, large JSON transforms), wrap it in `setImmediate()` to yield the event loop:

```typescript
// Pattern for CPU-heavy sections
await new Promise<void>((resolve) => {
  setImmediate(() => {
    // Heavy synchronous work here
    resolve();
  });
});
```

---

## 2. Multi-Instance Safety

Elastic Beanstalk auto-scales from 1 to 4 instances. Each instance runs the same Docker image, including the FleetGraph worker. Without coordination, all instances would run sweeps simultaneously.

### Advisory Lock for Sweep

PostgreSQL advisory locks provide a lightweight, non-blocking mutex. Lock ID `487201` is an arbitrary constant chosen to avoid collisions with application locks.

```typescript
// api/src/fleetgraph/worker.ts

const SWEEP_LOCK_ID = 487201; // Arbitrary, unique to FleetGraph

async function runSweep(): Promise<void> {
  if (workerState.sweepInProgress) return; // Guard against overlapping sweeps

  const client = await pool.connect();
  try {
    // Try to acquire advisory lock (non-blocking)
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [SWEEP_LOCK_ID],
    );

    if (!lockResult.rows[0].acquired) {
      console.log('FleetGraph sweep: another instance holds the lock, skipping');
      return;
    }

    workerState.sweepInProgress = true;
    const start = Date.now();

    try {
      await executeSweep(client);
    } finally {
      workerState.sweepInProgress = false;
      workerState.lastSweepAt = new Date().toISOString();
      workerState.lastSweepDurationMs = Date.now() - start;
      console.log(`FleetGraph sweep completed in ${workerState.lastSweepDurationMs}ms`);

      // Release advisory lock
      await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_ID]);
    }
  } catch (err) {
    console.error('FleetGraph sweep error:', err);
    workerState.sweepInProgress = false;
    // Lock is automatically released when the connection is returned to pool
  } finally {
    client.release();
  }
}
```

**Why `pg_try_advisory_lock` (session-level, non-blocking):**
- Returns `false` immediately if another session holds it. No waiting, no deadlocks.
- Session-level lock persists until explicitly released or the connection closes.
- If the holding instance crashes, its database connection drops, and the lock releases automatically.

**Why not `pg_try_advisory_xact_lock` (transaction-level):** The sweep runs multiple transactions (one per workspace, plus alert writes). A transaction-level lock would release too early.

### Event Processing: Any Instance

Unlike sweeps, event-driven processing (scope creep detection on issue create, real-time chat) can run on any instance. Events are triggered by API requests, and the ALB routes each request to one instance. No coordination needed because:

- Each event processes independently
- Alert deduplication uses the canonical `fleetgraph_alert_state` uniqueness contract (database-level, not instance-level)
- Approval gates use `thread_id` as the resumption key (LangGraph checkpoints are in Postgres)

### Duplicate Alert Prevention

Three layers of deduplication:

**Layer 1: Persistent correctness (database).** `fleetgraph_alert_state` is the canonical source of truth. It stores one row per `(workspace_id, fingerprint)` and survives process restarts, dismiss actions, snoozes, and replayed sweeps.

**Layer 2: Cooldown and suppression checks (application).** Before invoking the LLM reasoning node, the heuristic stage reads `fleetgraph_alert_state` to decide whether the fingerprint is still snoozed, was dismissed for an unchanged digest, or was surfaced recently enough to suppress another alert.

**Layer 3: Advisory lock (infrastructure).** Only one instance runs the sweep at a time, so the sweep itself never produces duplicates. Event-driven alerts from concurrent API requests still rely on the persistent state check above.

---

## 3. Deployment Pipeline Changes

### Changes to `scripts/deploy.sh`

The existing deploy script requires **zero modifications**. Here is why:

1. **Build step** (`pnpm build:shared && pnpm build:api`) compiles all TypeScript including new `api/src/fleetgraph/` files. The `tsc` compiler picks up new files automatically.

2. **Migration copy** (`cp -r src/db/migrations dist/db/migrations`) copies all `.sql` files including new FleetGraph migrations. The migration count verification (`SRC_COUNT` vs `DIST_COUNT`) catches missed copies.

3. **Docker build test** (`docker build -t ship-api:pre-deploy-test`) installs production dependencies including new LangChain packages. The import test (`import('./dist/app.js')`) validates the dependency tree.

4. **Bundle creation** includes `api/dist/` which contains compiled FleetGraph code.

5. **EB environment variables** are set separately via `aws elasticbeanstalk update-environment` (not in deploy.sh).

### New npm Dependencies

Install before first deploy:

```bash
cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape
pnpm add -F api \
  @langchain/langgraph \
  @langchain/core \
  @langchain/openai \
  @langchain/langgraph-checkpoint-postgres
```

These must land in `dependencies` (not `devDependencies`) in `api/package.json`. The Dockerfile runs `pnpm install --frozen-lockfile --prod`, which skips devDependencies.

**Dependency health check (as of project timeline):**
- `@langchain/langgraph`: Active development, weekly releases, 3k+ GitHub stars
- `@langchain/core`: Foundation package, same release cadence
- `@langchain/openai`: Stable adapter, tracks OpenAI API changes
- `@langchain/langgraph-checkpoint-postgres`: Purpose-built for Postgres state persistence

**Size impact on Docker image:** Approximately 15 MB additional in `node_modules` (LangChain packages + transitive deps). Negligible for a Docker image already at approximately 300 MB.

### Migration Files

Three FleetGraph product-state migrations (see Section 6 for full SQL):

```
api/src/db/migrations/039_fleetgraph_alert_state.sql
api/src/db/migrations/040_fleetgraph_approvals.sql
api/src/db/migrations/041_fleetgraph_audit_log.sql
```

The migration runner (`api/src/db/migrate.ts`) picks these up automatically. LangGraph checkpoints are initialized separately during app startup via `checkpointer.setup()`.

### Health Check Endpoint Changes

Extend the existing `/health` endpoint in `api/src/app.ts` to include FleetGraph status:

```typescript
// api/src/app.ts - replace the existing health check

app.get('/health', (_req, res) => {
  const fleetgraphStatus = process.env.FLEETGRAPH_ENABLED === 'true'
    ? {
        enabled: true,
        lastSweepAt: null as string | null,  // Set by worker module
        lastSweepDurationMs: null as number | null,
      }
    : { enabled: false };

  // Dynamically read worker state if available
  if (fleetgraphStatus.enabled) {
    try {
      // Worker state is set at runtime after dynamic import
      const state = (globalThis as any).__fleetgraphWorkerState;
      if (state) {
        fleetgraphStatus.lastSweepAt = state.lastSweepAt;
        fleetgraphStatus.lastSweepDurationMs = state.lastSweepDurationMs;
      }
    } catch {
      // Worker not yet initialized
    }
  }

  res.json({ status: 'ok', fleetgraph: fleetgraphStatus });
});
```

The worker module exposes its state on `globalThis` so the health endpoint can read it without importing FleetGraph code:

```typescript
// api/src/fleetgraph/worker.ts - expose state globally
(globalThis as any).__fleetgraphWorkerState = workerState;
```

EB health checks continue to pass (HTTP 200 from `/health`). The `fleetgraph` field is informational only.

### New API Routes

Add FleetGraph API routes to `api/src/app.ts`:

```typescript
// After other route registrations in createApp()

// FleetGraph routes (CSRF protected, auth required)
if (process.env.FLEETGRAPH_ENABLED === 'true') {
  const { fleetgraphRouter } = await import('./fleetgraph/routes.js');
  app.use('/api/fleetgraph', conditionalCsrf, fleetgraphRouter);
} else {
  // Return 503 for all FleetGraph routes when disabled
  app.use('/api/fleetgraph', (_req, res) => {
    res.status(503).json({ error: 'FleetGraph is not enabled' });
  });
}
```

Routes provided:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/fleetgraph/alerts` | List alerts for current workspace |
| GET | `/api/fleetgraph/alerts/:id` | Get single alert with metadata |
| PATCH | `/api/fleetgraph/alerts/:id` | Update status (acknowledge, resolve, snooze, dismiss) |
| GET | `/api/fleetgraph/approvals` | List pending approval gates |
| POST | `/api/fleetgraph/approvals/:id/respond` | Approve or reject an action |
| POST | `/api/fleetgraph/chat` | On-demand FleetGraph query |
| POST | `/api/fleetgraph/sweep` | Manually trigger a sweep (admin only) |

---

## 4. Docker and Container Changes

### Dockerfile: No Changes Required

The existing Dockerfile at `/ShipShape/Dockerfile` requires no modifications:

```dockerfile
FROM public.ecr.aws/docker/library/node:20-slim
WORKDIR /app
RUN npm config set strict-ssl false
RUN npm install -g pnpm@9.15.4 && pnpm config set strict-ssl false
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/
COPY shared/package.json ./shared/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && pnpm store prune
COPY shared/dist/ ./shared/dist/
COPY api/dist/ ./api/dist/
EXPOSE 80
ENV NODE_ENV=production
ENV VITE_APP_ENV=production
ENV PORT=80
WORKDIR /app/api
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
```

FleetGraph code is compiled into `api/dist/fleetgraph/` by the build step. LangChain packages are installed by `pnpm install --frozen-lockfile --prod` because they are in `dependencies`. No Procfile exists; Ship uses a single-process Docker container.

### Container Startup Flow with FleetGraph

```
Container starts
  1. node dist/db/migrate.js
       - Applies schema.sql
       - Runs migrations 001..041 (including FleetGraph tables)
       - Exits
  2. node dist/index.js
       - Loads .env (not used in prod, SSM provides secrets)
       - loadProductionSecrets() fetches from SSM:
           /ship/{env}/DATABASE_URL
           /ship/{env}/SESSION_SECRET
           /ship/{env}/CORS_ORIGIN
           /ship/{env}/CDN_DOMAIN
           /ship/{env}/APP_BASE_URL
           /ship/{env}/FLEETGRAPH_API_TOKEN    (new)
           /ship/{env}/LANGCHAIN_API_KEY       (new)
           /ship/{env}/OPENAI_API_KEY          (new)
       - createApp() builds Express routes
       - setupCollaboration() starts WebSocket
       - server.listen(80)
       - if FLEETGRAPH_ENABLED=true:
           - dynamic import('./fleetgraph/worker.js')
           - startFleetGraphWorker()
           - First sweep after 10s delay
```

---

## 5. Environment Variable Management

### Complete Variable Reference

| Variable | Required | Default | Storage | Description |
|----------|----------|---------|---------|-------------|
| `FLEETGRAPH_ENABLED` | Yes | `false` | EB env var | Master switch. Must be string `"true"` to enable. |
| `FLEETGRAPH_API_TOKEN` | When enabled | none | SSM SecureString | Ship bearer token for internal API calls. Format: `ship_{64_hex_chars}`. |
| `OPENAI_API_KEY` | When enabled | none | SSM SecureString | OpenAI API key for reasoning nodes. |
| `LANGCHAIN_TRACING_V2` | When enabled | `false` | EB env var | Enable LangSmith trace collection. |
| `LANGCHAIN_API_KEY` | When tracing | none | SSM SecureString | LangSmith API key. |
| `LANGCHAIN_PROJECT` | Optional | `default` | EB env var | LangSmith project name for trace organization. |
| `FLEETGRAPH_SWEEP_INTERVAL_MS` | Optional | `240000` | EB env var | Sweep loop interval in milliseconds (default 4 minutes). |
| `FLEETGRAPH_ALERT_COOLDOWN_MS` | Optional | `3600000` | EB env var | Dedup cooldown per fingerprint in milliseconds (default 1 hour). |
| `FLEETGRAPH_SWEEP_TIMEOUT_MS` | Optional | `120000` | EB env var | Max duration for a single sweep before abort (default 2 minutes). |
| `FLEETGRAPH_MAX_WORKSPACES_PER_SWEEP` | Optional | `10` | EB env var | Cap on workspaces processed per sweep cycle. |

### SSM Parameter Store Layout

Secrets go in SSM under the existing `/ship/{env}/` path. The EB instance role already has `ssm:GetParameter` permission scoped to `/ship/*`.

```
/ship/dev/FLEETGRAPH_API_TOKEN      (SecureString)
/ship/dev/LANGCHAIN_API_KEY         (SecureString)
/ship/dev/OPENAI_API_KEY            (SecureString)

/ship/shadow/FLEETGRAPH_API_TOKEN   (SecureString)
/ship/shadow/LANGCHAIN_API_KEY      (SecureString)
/ship/shadow/OPENAI_API_KEY         (SecureString)

/ship/prod/FLEETGRAPH_API_TOKEN     (SecureString)
/ship/prod/LANGCHAIN_API_KEY        (SecureString)
/ship/prod/OPENAI_API_KEY           (SecureString)
```

### SSM Loading Extension

Update `api/src/config/ssm.ts` to load FleetGraph secrets alongside existing secrets:

```typescript
// api/src/config/ssm.ts - add after existing secret loading

export async function loadProductionSecrets(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.AWS_SSM_ENABLED === '0' || hasDirectProductionConfig()) {
    console.log('Using direct environment configuration for production runtime');
    return;
  }

  const environment = process.env.ENVIRONMENT || 'prod';
  const basePath = `/ship/${environment}`;
  console.log(`Loading secrets from SSM path: ${basePath}`);

  // Existing core secrets (required)
  const [databaseUrl, sessionSecret, corsOrigin, cdnDomain, appBaseUrl] =
    await Promise.all([
      getSSMSecret(`${basePath}/DATABASE_URL`),
      getSSMSecret(`${basePath}/SESSION_SECRET`),
      getSSMSecret(`${basePath}/CORS_ORIGIN`),
      getSSMSecret(`${basePath}/CDN_DOMAIN`),
      getSSMSecret(`${basePath}/APP_BASE_URL`),
    ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = sessionSecret;
  process.env.CORS_ORIGIN = corsOrigin;
  process.env.CDN_DOMAIN = cdnDomain;
  process.env.APP_BASE_URL = appBaseUrl;

  // FleetGraph secrets (optional, fail silently)
  if (process.env.FLEETGRAPH_ENABLED === 'true') {
    const fgKeys = ['FLEETGRAPH_API_TOKEN', 'LANGCHAIN_API_KEY', 'OPENAI_API_KEY'];
    const results = await Promise.allSettled(
      fgKeys.map((key) => getSSMSecret(`${basePath}/${key}`)),
    );

    fgKeys.forEach((key, i) => {
      const result = results[i];
      if (result.status === 'fulfilled') {
        process.env[key] = result.value;
      } else {
        console.warn(`FleetGraph SSM key ${key} not found, skipping`);
      }
    });

    console.log('FleetGraph secrets loaded from SSM');
  }

  console.log('Secrets loaded from SSM Parameter Store');
}
```

### Per-Environment Values

| Variable | dev | shadow | prod |
|----------|-----|--------|------|
| `FLEETGRAPH_ENABLED` | `true` | `true` | `true` (set `false` to disable) |
| `LANGCHAIN_PROJECT` | `fleetgraph-dev` | `fleetgraph-shadow` | `fleetgraph-prod` |
| `FLEETGRAPH_SWEEP_INTERVAL_MS` | `60000` (1 min, faster iteration) | `240000` (4 min) | `240000` (4 min) |
| `FLEETGRAPH_ALERT_COOLDOWN_MS` | `60000` (1 min, faster testing) | `3600000` (1 hr) | `3600000` (1 hr) |

### Setting EB Environment Variables

```bash
ENV_NAME="ship-api-prod"  # or ship-api-dev, ship-api-shadow

aws elasticbeanstalk update-environment \
  --environment-name "$ENV_NAME" \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_TRACING_V2,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_PROJECT,Value=fleetgraph-prod \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_SWEEP_INTERVAL_MS,Value=240000
```

### Local Dev Setup

Add to `api/.env.local`:

```bash
# FleetGraph
FLEETGRAPH_ENABLED=true
FLEETGRAPH_API_TOKEN=ship_<token_from_seed_or_ui>
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_<your_key>
LANGCHAIN_PROJECT=fleetgraph-dev
OPENAI_API_KEY=sk-<your_key>
FLEETGRAPH_SWEEP_INTERVAL_MS=60000
FLEETGRAPH_ALERT_COOLDOWN_MS=60000
```

---

## 6. Database Migration Strategy

### Migration File Naming

The current highest migration is `038_search_title_trgm_indexes.sql`. FleetGraph migrations start at `039`:

```
api/src/db/migrations/039_fleetgraph_alert_state.sql
api/src/db/migrations/040_fleetgraph_approvals.sql
api/src/db/migrations/041_fleetgraph_audit_log.sql
```

The migration runner (`api/src/db/migrate.ts`) sorts files alphabetically and runs them in order inside individual transactions. Each migration is tracked in the `schema_migrations` table. If a migration fails, the transaction rolls back and the server exits with code 1. LangGraph checkpoint tables are initialized separately via `checkpointer.setup()`.

Historical pre-reconciliation SQL sketches remain below for context. They are superseded for implementation. Follow [`../CANONICAL_RECONCILIATION.md`](../CANONICAL_RECONCILIATION.md) for the final table set.

### Superseded historical sketch: split alert storage

Earlier drafts modeled proactive delivery as a separate alert record store with its own payload, lifecycle fields, and uniqueness index. That design is now superseded. Implementation should keep durable correctness in `fleetgraph_alert_state`, with approvals and audit history captured in their own canonical tables.

### Historical sketch: FleetGraph Approvals

```sql
-- api/src/db/migrations/040_fleetgraph_approvals.sql
-- Human-in-the-loop approval gates for FleetGraph actions

CREATE TABLE IF NOT EXISTS fleetgraph_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_alert_ref UUID, -- Historical sketch only. Canonical implementation uses alert-state + audit tables instead.

  -- LangGraph checkpoint for graph resumption
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT,

  -- Action description
  action_type TEXT NOT NULL,
  action_description TEXT NOT NULL,
  action_payload JSONB NOT NULL,

  -- Target
  target_entity_type TEXT,
  target_entity_id UUID,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed', 'snoozed', 'executed', 'execution_failed', 'expired')),
  responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  response_note TEXT,

  executed_at TIMESTAMPTZ,
  execution_error TEXT,

  -- Expiry (72 hours)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '72 hours'),

  -- Tracing
  langsmith_run_id TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fg_approvals_workspace
  ON fleetgraph_approvals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fg_approvals_status
  ON fleetgraph_approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fg_approvals_thread
  ON fleetgraph_approvals(thread_id);
CREATE INDEX IF NOT EXISTS idx_fg_approvals_alert
  ON fleetgraph_approvals(legacy_alert_ref);
CREATE INDEX IF NOT EXISTS idx_fg_approvals_expires
  ON fleetgraph_approvals(expires_at) WHERE status = 'pending';
```

### Canonical checkpoint setup

```sql
-- App startup bootstrap, not a numbered Ship migration.
-- LangGraph checkpoints live under their own schema.
-- Table creation and future migrations are delegated to PostgresSaver.setup().

CREATE SCHEMA IF NOT EXISTS fleetgraph;
```

At boot:

- initialize `PostgresSaver` with `schema: 'fleetgraph'`
- call `await checkpointer.setup()`
- allow the library to manage `fleetgraph.checkpoints`, `fleetgraph.checkpoint_writes`, and version-specific auxiliary tables such as `fleetgraph.checkpoint_blobs`

### Rollback Strategy

Each migration runs in a transaction. If migration 040 fails, 039 is already applied and 040 is not recorded in `schema_migrations`. Fix the SQL and redeploy.

To roll back FleetGraph entirely (destructive, removes all FleetGraph product state and checkpoints):

```sql
-- Run manually against the database. NOT a migration file.
DROP TABLE IF EXISTS fleetgraph_audit_log CASCADE;
DROP TABLE IF EXISTS fleetgraph_approvals CASCADE;
DROP TABLE IF EXISTS fleetgraph_alert_state CASCADE;
DROP TABLE IF EXISTS fleetgraph.checkpoint_blobs CASCADE;
DROP TABLE IF EXISTS fleetgraph.checkpoint_writes CASCADE;
DROP TABLE IF EXISTS fleetgraph.checkpoints CASCADE;
DROP SCHEMA IF EXISTS fleetgraph CASCADE;

DELETE FROM schema_migrations WHERE version IN (
  '039_fleetgraph_alert_state',
  '040_fleetgraph_approvals',
  '041_fleetgraph_audit_log'
);
```

To roll back non-destructively (preserve data, disable feature):

```bash
aws elasticbeanstalk update-environment \
  --environment-name ship-api-prod \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=false
```

Tables remain. No data lost. Re-enable by setting `FLEETGRAPH_ENABLED=true`.

---

## 7. Monitoring and Operations

### CloudWatch Metrics

FleetGraph emits structured log lines that CloudWatch Logs Insights can query. No custom CloudWatch metrics needed for v1; parse from logs.

**Log patterns emitted by the worker:**

```
FleetGraph proactive worker started
FleetGraph sweep: another instance holds the lock, skipping
FleetGraph sweep completed in 1234ms
FleetGraph sweep error: <error message>
FleetGraph alert created: <signal_type> for workspace <id>
FleetGraph alert skipped (cooldown): <fingerprint>
FleetGraph approval created: <action_type> for alert <id>
FleetGraph worker shutting down...
```

### CloudWatch Logs Insights Queries

**Sweep duration over time:**

```
fields @timestamp, @message
| filter @message like /sweep completed in/
| parse @message "completed in *ms" as duration
| stats avg(duration), max(duration), count() by bin(1h)
```

**Error rate:**

```
fields @timestamp, @message
| filter @message like /FleetGraph sweep error/
| stats count() by bin(1h)
```

**Alert creation rate:**

```
fields @timestamp, @message
| filter @message like /FleetGraph alert created/
| parse @message "created: * for workspace *" as signalType, workspaceId
| stats count() by signalType, bin(1d)
```

**Lock contention (multi-instance):**

```
fields @timestamp, @message
| filter @message like /another instance holds the lock/
| stats count() by bin(1h)
```

### Health Check Monitoring

Poll `/health` and inspect the `fleetgraph` object:

```bash
curl -s https://ship.awsdev.treasury.gov/health | jq '.fleetgraph'
```

Expected output when healthy:

```json
{
  "enabled": true,
  "lastSweepAt": "2025-03-15T14:30:00.000Z",
  "lastSweepDurationMs": 2340
}
```

**Alert if `lastSweepAt` is more than 2x the sweep interval behind.** This indicates the worker crashed or is stuck.

### Database Monitoring Queries

**Open alerts by signal type:**

```sql
SELECT signal_type, last_outcome, count(*)
FROM fleetgraph_alert_state
GROUP BY signal_type, last_outcome
ORDER BY count(*) DESC;
```

**Expired pending approvals (indicates users ignoring gates):**

```sql
SELECT count(*)
FROM fleetgraph_approvals
WHERE status = 'pending'
  AND expires_at < now();
```

**Checkpoint table growth (early warning for storage):**

```sql
SELECT
  pg_size_pretty(pg_total_relation_size('checkpoints')) AS checkpoints_size,
  pg_size_pretty(pg_total_relation_size('checkpoint_writes')) AS writes_size,
  pg_size_pretty(pg_total_relation_size('checkpoint_blobs')) AS blobs_size;
```

### Operational Runbook

#### Sweep appears stuck (no logs for 2+ intervals)

1. Check if the worker is running:
   ```bash
   curl -s https://ship.awsdev.treasury.gov/health | jq '.fleetgraph'
   ```
2. If `lastSweepAt` is stale, check EB logs:
   ```bash
   aws elasticbeanstalk request-environment-info \
     --environment-name ship-api-prod --info-type tail
   # Wait 30 seconds
   aws elasticbeanstalk retrieve-environment-info \
     --environment-name ship-api-prod --info-type tail
   ```
3. If the process is alive but sweep is not firing, check for a leaked advisory lock:
   ```sql
   SELECT pid, granted, objid
   FROM pg_locks
   WHERE locktype = 'advisory' AND objid = 487201;
   ```
4. If a lock is held by a dead connection, terminate it:
   ```sql
   SELECT pg_terminate_backend(<pid from above>);
   ```

#### Alerts not delivering

1. Verify the sweep is running (check logs for "sweep completed").
2. Verify alert state is being persisted:
   ```sql
   SELECT *
   FROM fleetgraph_alert_state
   ORDER BY updated_at DESC
   LIMIT 5;
   ```
3. If alerts exist but the UI does not show them, check the API route:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     https://ship.awsdev.treasury.gov/api/fleetgraph/alerts
   ```
4. If the API returns 503, `FLEETGRAPH_ENABLED` is `false`. Check EB env vars.

#### OpenAI quota exhausted

Symptoms: Sweep completes but no alerts created. Logs show `429 Too Many Requests` or `insufficient_quota`.

1. Check LangSmith traces for error nodes.
2. Verify quota at https://platform.openai.com/usage.
3. Temporary mitigation: increase sweep interval to reduce call frequency:
   ```bash
   aws elasticbeanstalk update-environment \
     --environment-name ship-api-prod \
     --option-settings \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_SWEEP_INTERVAL_MS,Value=900000
   ```

#### Checkpoint table growing too large

LangGraph checkpoints accumulate over time. Prune completed threads older than 7 days:

```sql
DELETE FROM checkpoint_writes
WHERE thread_id IN (
  SELECT DISTINCT thread_id FROM checkpoints
  WHERE created_at < now() - INTERVAL '7 days'
);

DELETE FROM checkpoint_blobs
WHERE thread_id IN (
  SELECT DISTINCT thread_id FROM checkpoints
  WHERE created_at < now() - INTERVAL '7 days'
);

DELETE FROM checkpoints
WHERE created_at < now() - INTERVAL '7 days';
```

Consider adding this as a scheduled job or extending the sweep to include cleanup.

#### Memory spike on EB instance

1. Check instance health:
   ```bash
   aws elasticbeanstalk describe-instances-health \
     --environment-name ship-api-prod \
     --attribute-names All
   ```
2. If memory is above 80%, check if a sweep is processing an unusually large workspace.
3. Set `FLEETGRAPH_MAX_WORKSPACES_PER_SWEEP` to a lower value to cap per-sweep work.
4. Emergency: disable FleetGraph (`FLEETGRAPH_ENABLED=false`), then investigate.

---

## 8. Rollback Plan

### Disable Without Redeploy

Set the environment variable to `false`. EB performs a rolling restart (approximately 2 minutes):

```bash
aws elasticbeanstalk update-environment \
  --environment-name ship-api-prod \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=false
```

**What happens:**
- New instances start without importing `./fleetgraph/worker.js`
- No FleetGraph code executes (dynamic import is skipped)
- LangChain packages remain installed but idle (no memory overhead beyond module cache)
- `/api/fleetgraph/*` routes return `503 Service Unavailable`
- `/health` returns `{ status: "ok", fleetgraph: { enabled: false } }`
- All data in `fleetgraph_alert_state`, `fleetgraph_approvals`, `fleetgraph_audit_log`, and checkpoint tables is preserved
- Advisory lock (if held) is released when the old instance's database connection closes

**To re-enable:**

```bash
aws elasticbeanstalk update-environment \
  --environment-name ship-api-prod \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=true
```

The worker resumes from where it left off. Existing open alerts remain visible. Pending approvals may have expired during the disabled period; the worker marks them `expired` on the next sweep.

### Full Removal (Nuclear Option)

If FleetGraph must be removed from the codebase entirely:

1. Set `FLEETGRAPH_ENABLED=false` and deploy (so no running worker)
2. Drop tables via manual SQL (see Section 6 rollback)
3. Remove `api/src/fleetgraph/` directory
4. Remove FleetGraph routes from `api/src/app.ts`
5. Remove FleetGraph worker import from `api/src/index.ts`
6. Remove FleetGraph SSM loading from `api/src/config/ssm.ts`
7. Uninstall packages:
   ```bash
   pnpm remove -F api \
     @langchain/langgraph \
     @langchain/core \
     @langchain/openai \
     @langchain/langgraph-checkpoint-postgres
   ```
8. Deploy

### Gradual Rollout Strategy

For cautious production rollout:

1. **Phase A:** Deploy with `FLEETGRAPH_ENABLED=false`. Migrations run, tables created, no worker starts. Verify migrations succeed.
2. **Phase B:** Enable in shadow first. Monitor for 24 hours. Check LangSmith traces, alert quality, memory usage.
3. **Phase C:** Enable in prod with `FLEETGRAPH_SWEEP_INTERVAL_MS=240000` (4 minutes) and a low workspace cap while validating alert quality.
4. **Phase D:** Raise workspace caps after 48 hours of stable operation instead of relaxing the SLA cadence.

---

## Appendix A: Checklist for First Deploy

```
Pre-deploy:
  [ ] LangChain packages added to api/package.json dependencies
  [ ] Migration files 039, 040, 041 created in api/src/db/migrations/
  [ ] Worker module at api/src/fleetgraph/worker.ts
  [ ] Routes at api/src/fleetgraph/routes.ts
  [ ] index.ts updated with conditional worker import
  [ ] app.ts updated with FleetGraph routes and health check extension
  [ ] ssm.ts updated with FleetGraph secret loading
  [ ] pnpm lock file regenerated (pnpm install)
  [ ] Local Docker build passes (docker build -t ship-api:test .)
  [ ] pnpm test passes
  [ ] pnpm type-check passes

SSM secrets (per environment):
  [ ] /ship/{env}/FLEETGRAPH_API_TOKEN stored
  [ ] /ship/{env}/LANGCHAIN_API_KEY stored
  [ ] /ship/{env}/OPENAI_API_KEY stored

EB environment variables:
  [ ] FLEETGRAPH_ENABLED=true (or false for Phase A)
  [ ] LANGCHAIN_TRACING_V2=true
  [ ] LANGCHAIN_PROJECT=fleetgraph-{env}

Post-deploy verification:
  [ ] /health returns fleetgraph.enabled: true
  [ ] Logs show "FleetGraph proactive worker started"
  [ ] First sweep completes (check logs within 1 minute)
  [ ] LangSmith dashboard shows traces in correct project
  [ ] /api/fleetgraph/alerts returns 200 (with auth)
  [ ] No errors in EB environment health
```

## Appendix B: File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `api/src/index.ts` | Modify | Add conditional FleetGraph worker import after `server.listen()` |
| `api/src/app.ts` | Modify | Extend `/health` endpoint, add `/api/fleetgraph/*` routes |
| `api/src/config/ssm.ts` | Modify | Load FleetGraph secrets from SSM when enabled |
| `api/package.json` | Modify | Add LangChain dependencies |
| `api/src/fleetgraph/worker.ts` | Create | Sweep loop, advisory lock, lifecycle management |
| `api/src/fleetgraph/graph.ts` | Create | LangGraph StateGraph definition |
| `api/src/fleetgraph/checkpointer.ts` | Create | PostgresSaver configuration |
| `api/src/fleetgraph/routes.ts` | Create | Express routes for alerts, approvals, chat, manual sweep |
| `api/src/fleetgraph/nodes/*.ts` | Create | Individual graph node implementations |
| `api/src/db/migrations/039_fleetgraph_alert_state.sql` | Create | Persistent alert dedupe and suppression state |
| `api/src/db/migrations/040_fleetgraph_approvals.sql` | Create | Approvals table and indexes |
| `api/src/db/migrations/041_fleetgraph_audit_log.sql` | Create | FleetGraph audit log table |
