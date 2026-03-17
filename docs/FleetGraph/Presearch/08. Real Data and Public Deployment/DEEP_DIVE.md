# Real Data and Public Deployment: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready reference for deploying FleetGraph against real Ship data in production. Covers infrastructure topology, worker process model, authentication, database migrations, seed data, environment configuration, trace capture, and a step-by-step deployment checklist.

Migration reconciliation note: Ship-managed numbered migrations cover `fleetgraph_alert_state`, `fleetgraph_approvals`, and `fleetgraph_audit_log`. LangGraph checkpoint tables are created by `PostgresSaver.setup()` and are not a numbered Ship migration.

Deployment reconciliation note: request handlers enqueue candidates and a backend worker consumes them. The fallback sweep cadence is 4 minutes, not 5 or 15, and approval rows expire after 72 hours.

---

## 1. Current Ship Deployment Architecture

### Infrastructure Overview

```
                    CloudFront (CDN)
                   /       |        \
                  /        |         \
           S3 Bucket   /api/*    /collaboration/*
          (React SPA)  /health        /events
                       |
               ALB (Application Load Balancer)
                       |
               Elastic Beanstalk
               (Docker on AL2023)
                       |
                  Node.js Process
                  (migrate.js then index.js)
                       |
               Aurora PostgreSQL 16
               (Serverless v2)
```

### Component Details

| Component | Resource | Configuration |
|---|---|---|
| Compute | Elastic Beanstalk | Docker on 64bit Amazon Linux 2023, t3.small, 1-4 instances |
| Database | Aurora PostgreSQL 16 | Serverless v2, 0.5-4 ACUs, encrypted at rest |
| Frontend CDN | CloudFront | S3 origin (OAC) + EB origin for /api/*, /health, /collaboration/*, /events |
| Frontend Storage | S3 | Versioning enabled, AES256 encryption, public access blocked |
| File Uploads | S3 (separate bucket) | Presigned URLs, versioned, CORS configured |
| Secrets | SSM Parameter Store | Path: `/ship/{env}/` (DATABASE_URL, SESSION_SECRET, CORS_ORIGIN, CDN_DOMAIN, APP_BASE_URL) |
| OAuth Secrets | Secrets Manager | Path: `/ship/{env}/caia-credentials` |
| DNS | Route53 | Optional custom domain (app_domain_name) |
| WAF | WAFv2 | Attached to CloudFront distribution |
| Networking | VPC | 10.0.0.0/16, 2 public subnets (ALB), 2 private subnets (EB + Aurora), NAT Gateway |
| IAM | EB instance role | SSM read, Bedrock invoke, Secrets Manager read |

### Environments

| Environment | EB App Name | EB Env Name | Terraform Dir | Notes |
|---|---|---|---|---|
| prod | `ship-api` | `ship-api-prod` | `terraform/` | Root terraform, original structure |
| dev | `ship-api-dev` | `ship-api-dev` | `terraform/environments/dev/` | Modular structure, own Aurora/EB/CF |
| shadow | `ship-api-shadow` | `ship-api-shadow` | `terraform/environments/shadow/` | Shares dev VPC, isolated resources |

### Docker Container Startup

The `Dockerfile` runs two commands sequentially on container start:

```dockerfile
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
```

1. `migrate.js`: Applies `schema.sql`, then runs numbered migrations from `api/src/db/migrations/` in sorted order. Each migration runs in a transaction. Applied migrations tracked in `schema_migrations` table.
2. `index.js`: Loads SSM secrets (production), imports `app.js`, creates HTTP server, sets up WebSocket collaboration, listens on port 80.

### Health Check

EB health check path is `/health`. The endpoint returns `{ "status": "ok" }` and requires no authentication.

```
GET /health -> 200 { "status": "ok" }
```

EB uses enhanced health reporting. The ALB targets the health check endpoint on the default process.

---

## 2. FleetGraph Worker Deployment Model

### Design Decision: In-Process Worker

FleetGraph runs as a worker loop inside the same Node.js process as the API server. This is the simplest path for a one-week sprint and avoids creating a second service.

### Why In-Process

- Single deployment artifact (same Docker image, same EB environment)
- Shared database connection pool
- Shared SSM/secrets loading
- No inter-process communication needed
- EB health check covers both API and worker (if worker crashes, process dies, EB replaces instance)

### Process Architecture

```
index.js
  |
  +-- loadProductionSecrets()     (SSM)
  +-- createApp(CORS_ORIGIN)      (Express)
  +-- createServer(app)           (HTTP)
  +-- setupCollaboration(server)  (WebSocket)
  +-- server.listen(PORT)         (API ready)
  |
  +-- startFleetGraphWorker()     (NEW: conditional on FLEETGRAPH_ENABLED)
       |
       +-- candidate queue consumer + 4-minute fallback sweep
       |     +-- Fetch workspace list
       |     +-- For each active workspace:
       |     |     +-- Run proactive sweep graph
       |     |     +-- Write alerts to fleetgraph_alerts
       |     +-- Log sweep duration to console
       |
       +-- Graceful shutdown on SIGTERM/SIGINT
```

### Worker Entry Point (to be added to index.ts)

```typescript
// After server.listen()
if (process.env.FLEETGRAPH_ENABLED === 'true') {
  const { startFleetGraphWorker } = await import('./fleetgraph/worker.js');
  startFleetGraphWorker();
  console.log('FleetGraph proactive worker started');
}
```

### Health Check Integration

The existing `/health` endpoint should be extended to report worker status:

```typescript
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    fleetgraph: process.env.FLEETGRAPH_ENABLED === 'true'
      ? { enabled: true, lastSweep: globalFleetGraphState.lastSweepAt }
      : { enabled: false },
  });
});
```

EB will continue to health-check on HTTP 200 from `/health`. The FleetGraph status field is informational only.

### Scaling Consideration

With EB auto-scaling (1-4 instances), multiple instances would each run the worker loop. To prevent duplicate sweeps, use a simple database advisory lock:

```sql
SELECT pg_try_advisory_lock(42)  -- FleetGraph sweep lock
```

Only the instance that acquires the lock runs the sweep. Others skip and retry next interval.

---

## 3. Service Token Creation

### How Ship API Tokens Work

Ship uses bearer token authentication via the `/api/api-tokens` endpoint. Tokens have the format `ship_{64_hex_chars}`. Only the SHA-256 hash is stored. The token is returned exactly once at creation time.

The auth middleware (`api/src/middleware/auth.ts`) checks for `Bearer` tokens before falling back to session cookies. Token validation:
1. Hash the presented token with SHA-256
2. Look up `token_hash` in `api_tokens` table
3. Verify not revoked (`revoked_at IS NULL`)
4. Verify not expired (`expires_at IS NULL` or `expires_at > NOW()`)
5. Update `last_used_at`
6. Set `req.userId`, `req.workspaceId`, `req.isSuperAdmin`, `req.isApiToken = true`

### Token Scoping

Each token is bound to:
- A specific `user_id` (the user who created it)
- A specific `workspace_id` (the workspace context at creation time)
- The user's `is_super_admin` flag

FleetGraph needs a token from an admin user in the target workspace. The token inherits that user's permissions.

### Step-by-Step: Create FleetGraph Service Token

#### Option A: Via the Ship UI (recommended for production)

1. Log in to Ship as an admin user (e.g., `dev@ship.local` in dev)
2. Navigate to Settings > API Tokens
3. Create token with name `fleetgraph-proactive`
4. Copy the token immediately (it will not be shown again)
5. Store as environment variable

#### Option B: Via curl (useful for automation)

```bash
# 1. Log in and get session cookie
curl -c cookies.txt -X POST https://ship.awsdev.treasury.gov/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@ship.local","password":"admin123"}'

# 2. Create the service token (no expiry for long-lived worker)
curl -b cookies.txt -X POST https://ship.awsdev.treasury.gov/api/api-tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"fleetgraph-proactive"}'

# Response (SAVE THE TOKEN VALUE):
# {
#   "success": true,
#   "data": {
#     "id": "...",
#     "name": "fleetgraph-proactive",
#     "token": "ship_a1b2c3d4...",       <-- SAVE THIS
#     "token_prefix": "ship_a1b2c3d",
#     "expires_at": null,
#     "warning": "Save this token now. It will not be shown again."
#   }
# }
```

#### Option C: Via seed script (dev environments only)

Add to `seed.ts` after user/workspace creation:

```typescript
// Create FleetGraph service token for dev
const tokenValue = `ship_${crypto.randomBytes(32).toString('hex')}`;
const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex');
const tokenPrefix = tokenValue.substring(0, 12);

await pool.query(
  `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix)
   VALUES ($1, $2, 'fleetgraph-proactive', $3, $4)
   ON CONFLICT (user_id, workspace_id, name) DO NOTHING`,
  [devUserId, workspaceId, tokenHash, tokenPrefix]
);
console.log(`FleetGraph token: ${tokenValue}`);
```

### Storing the Token

#### Local Dev

Add to `api/.env.local`:

```bash
FLEETGRAPH_API_TOKEN=ship_a1b2c3d4...
```

#### Production / Shadow

Store in SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name "/ship/prod/FLEETGRAPH_API_TOKEN" \
  --value "ship_a1b2c3d4..." \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name "/ship/shadow/FLEETGRAPH_API_TOKEN" \
  --value "ship_e5f6g7h8..." \
  --type SecureString \
  --overwrite
```

Then update `ssm.ts` to load the new parameter:

```typescript
// In loadProductionSecrets(), add:
const fleetGraphToken = await getSSMSecret(`${basePath}/FLEETGRAPH_API_TOKEN`).catch(() => '');
if (fleetGraphToken) {
  process.env.FLEETGRAPH_API_TOKEN = fleetGraphToken;
}
```

---

## 4. Database Migrations for FleetGraph

### Existing Migration Pattern

Files in `api/src/db/migrations/` named `NNN_description.sql`. The migration runner (`migrate.ts`) sorts alphabetically, runs each in a transaction, and records the version in `schema_migrations`. The current highest migration is `038_search_title_trgm_indexes.sql`.

### New Migrations Required

Historical pre-reconciliation SQL sketches remain below for context. Follow [`../../CANONICAL_RECONCILIATION.md`](../../CANONICAL_RECONCILIATION.md) for the final table set.

#### Historical sketch: FleetGraph Alerts

```sql
-- api/src/db/migrations/039_fleetgraph_alerts.sql
-- FleetGraph alert storage for proactive detections

CREATE TABLE IF NOT EXISTS fleetgraph_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Deduplication: same fingerprint within cooldown window = skip
  fingerprint TEXT NOT NULL,

  -- Classification
  signal_type TEXT NOT NULL,        -- 'missing_standup', 'blocked_stale', 'approval_bottleneck', etc.
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'snoozed', 'dismissed')),

  -- Payload
  title TEXT NOT NULL,
  summary TEXT,                     -- LLM-generated explanation
  entity_type TEXT,                 -- 'issue', 'sprint', 'project', 'person'
  entity_id UUID,                   -- References documents(id) when applicable
  metadata JSONB DEFAULT '{}',      -- Signal-specific data (issue IDs, sprint numbers, etc.)

  -- Lifecycle
  snoozed_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Tracing
  langsmith_run_id TEXT,            -- LangSmith run ID for trace link
  langsmith_url TEXT,               -- Direct URL to trace

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_workspace ON fleetgraph_alerts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_fingerprint ON fleetgraph_alerts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_status ON fleetgraph_alerts(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_signal ON fleetgraph_alerts(signal_type);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_entity ON fleetgraph_alerts(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleetgraph_alerts_created ON fleetgraph_alerts(created_at DESC);

-- Dedupe: one open alert per fingerprint per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_alerts_unique_open
  ON fleetgraph_alerts(workspace_id, fingerprint)
  WHERE status IN ('open', 'snoozed');

COMMENT ON TABLE fleetgraph_alerts IS 'Proactive alerts generated by FleetGraph sweeps. Fingerprint-deduped.';
```

#### Historical sketch: FleetGraph Approvals

```sql
-- api/src/db/migrations/040_fleetgraph_approvals.sql
-- Human-in-the-loop approval gates for FleetGraph actions

CREATE TABLE IF NOT EXISTS fleetgraph_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Link to alert that triggered this
  alert_id UUID REFERENCES fleetgraph_alerts(id) ON DELETE SET NULL,

  -- LangGraph checkpoint (for graph resumption after human response)
  thread_id TEXT NOT NULL,          -- LangGraph thread ID
  checkpoint_ns TEXT,               -- Checkpoint namespace

  -- Action description
  action_type TEXT NOT NULL,        -- 'reassign_issue', 'change_priority', 'send_notification', etc.
  action_description TEXT NOT NULL, -- Human-readable description of proposed action
  action_payload JSONB NOT NULL,    -- Structured data for action execution

  -- Target
  target_entity_type TEXT,
  target_entity_id UUID,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed', 'snoozed', 'executed', 'execution_failed', 'expired')),
  responded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  response_note TEXT,               -- Optional note from reviewer

  executed_at TIMESTAMPTZ,
  execution_error TEXT,

  -- Expiry
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '72 hours'),

  -- Tracing
  langsmith_run_id TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_workspace ON fleetgraph_approvals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_status ON fleetgraph_approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_thread ON fleetgraph_approvals(thread_id);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_alert ON fleetgraph_approvals(alert_id);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_approvals_expires ON fleetgraph_approvals(expires_at) WHERE status = 'pending';

COMMENT ON TABLE fleetgraph_approvals IS 'Human-in-the-loop gates. Graph pauses until user approves, dismisses, snoozes, expires, or executes.';
```

#### Historical sketch: LangGraph Checkpoint Tables

The `@langchain/langgraph-checkpoint-postgres` package creates its own tables when initialized. However, it is good practice to run the setup explicitly so migrations are tracked.

```sql
-- api/src/db/migrations/041_langgraph_checkpoints.sql
-- LangGraph checkpoint tables for state persistence
-- These tables are normally auto-created by @langchain/langgraph-checkpoint-postgres
-- but we create them explicitly for migration tracking.

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value JSONB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON checkpoints(thread_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_writes_thread ON checkpoint_writes(thread_id);

COMMENT ON TABLE checkpoints IS 'LangGraph checkpoint state for graph resumption (HITL gates, multi-turn chat).';
```

---

## 5. Seed Data Requirements

### What FleetGraph Needs for a Meaningful Demo

The existing seed script (`api/src/db/seed.ts`) already creates a rich dataset. Here is what exists and what FleetGraph uses for each detection type.

#### Existing Seed Data Inventory

| Entity | Count | Source |
|---|---|---|
| Workspace | 1 ("Ship Workspace") | seed.ts |
| Users | 11 (dev + 10 fake) | seed.ts |
| Workspace Memberships | 11 (1 admin, 10 members) | seed.ts |
| Person Documents | 11 (with reports_to hierarchy) | seed.ts |
| Programs | 5 (SHIP, AUTH, API, UI, INFRA) | seed.ts |
| Projects | 15 (3 per program: Core Features, Bug Fixes, Performance) | seed.ts |
| Sprints/Weeks | ~35 (7 per program, current-3 to current+3) | seed.ts |
| Issues | ~100+ (Ship Core: 35 detailed, others: 17 per program) | seed.ts |
| Standups | ~6 (current and recent sprints, Ship Core only) | seed.ts |
| Sprint Reviews | All past sprints have reviews | seed.ts |
| Weekly Plans | Per-person per-sprint, with deliberate gaps (~14% missing past, ~33% missing current) | seed.ts |
| Weekly Retros | Per-person per-sprint, with deliberate gaps (~17% missing past) | seed.ts |
| Wiki Docs | 6+ (welcome tutorial, nested, standalone) | seed.ts |

#### Issue States by Sprint (Ship Core, the primary demo program)

| Sprint Offset | Issues | States | Demo Value |
|---|---|---|---|
| -3 | 4 | All done | Healthy baseline |
| -2 | 6 | 3 done, 3 todo (incomplete) | Triggers "incomplete sprint" detection |
| -1 | 6 | 2 done, 3 todo, 1 cancelled | Triggers "consecutive incomplete sprints" pattern |
| 0 (current) | 9 | 3 done, 3 in_progress, 3 todo | Active sprint with mixed progress |
| +1 | 4 | 3 todo, 1 backlog | Planned upcoming work |
| +2 | 2 | 1 todo, 1 backlog | Light future planning |
| +3 | 0 | (empty) | No planning for far future |
| backlog | 5 | All backlog | Unscheduled ideas |

#### FleetGraph Signal to Seed Data Mapping

| Signal (BG-ID) | Seed Data That Triggers It | Notes |
|---|---|---|
| BG-1: Missing standup | Current sprint, only 3 standups for 11 users | Most team members have no standup |
| BG-2: Blocked issue stale | No blocked issues in seed (would need to add) | **Gap: add blocked issues to seed** |
| BG-3: Approval bottleneck | Weekly plans with `submitted_at` but no approval state | Depends on approval metadata |
| BG-4: Scope creep | Would trigger when issue added to active sprint post-plan | **Event-driven, not seed-dependent** |
| BG-5: Project risk cluster | Sprint -2 and -1 both incomplete for Ship Core | Multi-signal convergence |
| BG-9: Plan quality | Some plans may be thin | Check plan content length |
| BG-10: Retro not filed | ~17% of past retros missing in seed | Deliberately seeded gaps |

#### Recommended Seed Additions for FleetGraph Demo

```typescript
// Add to seed.ts for FleetGraph-specific demo data:

// 1. Blocked issues (for BG-2: Blocked issue stale)
// Add 2-3 issues in 'blocked' state to current sprint
{ title: 'Resolve database connection pooling', state: 'blocked', sprintOffset: 0, priority: 'high', estimate: 6 },
{ title: 'Fix authentication race condition', state: 'blocked', sprintOffset: 0, priority: 'critical', estimate: 4 },

// 2. Very old in_progress issue (for staleness detection)
// Would need created_at backdated:
{ title: 'Migrate legacy API endpoints', state: 'in_progress', sprintOffset: -2, priority: 'medium', estimate: 8 },
```

---

## 6. Environment Configuration

### Environment Variable Reference

| Variable | Required | Local Dev | Shadow/UAT | Production | Purpose |
|---|---|---|---|---|---|
| `FLEETGRAPH_ENABLED` | Yes | `true` or `false` | `true` | `true` | Master switch for worker loop |
| `FLEETGRAPH_API_TOKEN` | When enabled | `.env.local` | SSM | SSM | Bearer token for Ship API calls |
| `LANGCHAIN_TRACING_V2` | When enabled | `true` | `true` | `true` | Enable LangSmith tracing |
| `LANGCHAIN_API_KEY` | When enabled | `.env.local` | SSM | SSM | LangSmith API key |
| `LANGCHAIN_PROJECT` | Optional | `fleetgraph-dev` | `fleetgraph-shadow` | `fleetgraph-prod` | LangSmith project name |
| `OPENAI_API_KEY` | When enabled | `.env.local` | SSM | SSM | OpenAI API key for reasoning nodes |
| `FLEETGRAPH_SWEEP_INTERVAL_MS` | Optional | `240000` (4min) | `240000` | `240000` | Proactive sweep interval |
| `FLEETGRAPH_ALERT_COOLDOWN_MS` | Optional | `3600000` (1hr) | `3600000` | `3600000` | Dedup window per fingerprint |

### Local Dev Setup

```bash
# api/.env.local (add to existing file)

# FleetGraph
FLEETGRAPH_ENABLED=true
FLEETGRAPH_API_TOKEN=ship_<your_dev_token>
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_<your_key>
LANGCHAIN_PROJECT=fleetgraph-dev
OPENAI_API_KEY=sk-<your_key>
```

### Shadow/UAT Setup

Store in SSM under `/ship/shadow/`:

```bash
aws ssm put-parameter --name /ship/shadow/FLEETGRAPH_API_TOKEN --value "ship_..." --type SecureString
aws ssm put-parameter --name /ship/shadow/LANGCHAIN_API_KEY --value "lsv2_pt_..." --type SecureString
aws ssm put-parameter --name /ship/shadow/OPENAI_API_KEY --value "sk-..." --type SecureString
```

Set EB environment variables:

```bash
aws elasticbeanstalk update-environment \
  --environment-name ship-api-shadow \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_TRACING_V2,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_PROJECT,Value=fleetgraph-shadow
```

### Production Setup

Same pattern as shadow, with `/ship/prod/` SSM path and `ship-api-prod` environment name.

### Disabling FleetGraph

When `FLEETGRAPH_ENABLED` is not set or is `false`, the worker import is skipped entirely. No FleetGraph code runs. No API keys required. The API server functions normally.

```typescript
// Guard in index.ts
if (process.env.FLEETGRAPH_ENABLED === 'true') {
  // Only then import and start worker
}
```

### SSM Loading Extension

Update `api/src/config/ssm.ts` to optionally load FleetGraph secrets:

```typescript
// After existing secrets load, conditionally load FleetGraph secrets
const fleetGraphKeys = ['FLEETGRAPH_API_TOKEN', 'LANGCHAIN_API_KEY', 'OPENAI_API_KEY'];
for (const key of fleetGraphKeys) {
  try {
    const value = await getSSMSecret(`${basePath}/${key}`);
    process.env[key] = value;
  } catch {
    // FleetGraph keys are optional; missing = FleetGraph disabled
  }
}
```

---

## 7. Demo Trace Capture Strategy

### Required Trace Types

The grader expects shared LangSmith trace links demonstrating different execution paths. Five distinct trace types are needed:

### Trace 1: Clean Proactive Sweep (No Issues Found)

**Setup:**
- All sprints have standups filed
- No blocked issues
- No approval bottlenecks
- All plans and retros submitted

**Expected trace path:**
```
fetch_workspaces -> fetch_core_context -> fetch_parallel_signals
  -> heuristic_filter (all signals clear)
  -> branch_decision: no_issue
  -> log_clean_sweep
```

**How to produce:**
1. Seed fresh database
2. Manually mark all standups as filed for current sprint
3. Trigger sweep manually: `POST /api/fleetgraph/sweep`

### Trace 2: Proactive Sweep with Alert

**Setup:**
- Current sprint has missing standups (default seed state)
- Active blocked issue older than 24 hours

**Expected trace path:**
```
fetch_workspaces -> fetch_core_context -> fetch_parallel_signals
  -> heuristic_filter (2 candidates flagged)
  -> dedupe_check (new fingerprints)
  -> reason_about_risk (OpenAI)
  -> branch_decision: inform_only
  -> create_alert (write to fleetgraph_alerts)
  -> notify_channel
```

**How to produce:**
1. Use default seed data (standups missing for most users)
2. Add a blocked issue via API
3. Wait for sweep or trigger manually

### Trace 3: On-Demand Query from Issue Page

**Setup:**
- User views a specific issue and asks FleetGraph about it

**Expected trace path:**
```
parse_user_context (issue page, issue_id)
  -> fetch_issue_detail
  -> fetch_related_sprint
  -> fetch_issue_history
  -> reason_about_issue (OpenAI)
  -> format_response
```

**How to produce:**
1. Navigate to an issue page in Ship
2. Open FleetGraph chat panel
3. Ask: "What's the risk with this issue?"
4. Copy trace link from LangSmith

### Trace 4: Approval-Gated Action

**Setup:**
- FleetGraph detects a reassignment opportunity
- Requires human confirmation before executing

**Expected trace path:**
```
(same as Trace 2 through reason_about_risk)
  -> branch_decision: confirm_action
  -> create_approval_gate (write to fleetgraph_approvals)
  -> PAUSE (waiting for human)
  ... user approves in UI ...
  -> resume_from_checkpoint
  -> execute_action (update issue via API)
  -> create_audit_log
```

**How to produce:**
1. Set up capacity overload scenario (assign 10+ issues to one person)
2. Sweep detects overload
3. FleetGraph proposes reassignment
4. Approve in Ship UI
5. Capture both the pre-pause and post-resume traces

### Trace 5: Error/Fallback Branch

**Setup:**
- Simulate API failure or missing data

**Expected trace path:**
```
fetch_workspaces -> fetch_core_context -> fetch_parallel_signals
  -> ERROR (API timeout or 500)
  -> error_handler
  -> log_degraded_sweep (partial results)
  -> branch_decision: degrade_gracefully
```

**How to produce:**
- Option A: Temporarily revoke the service token mid-sweep
- Option B: Configure a workspace with no projects (empty workspace triggers edge case handling)
- Option C: Set `FLEETGRAPH_SWEEP_TIMEOUT_MS=100` to force timeouts

### Trace Capture Commands

```bash
# Manually trigger a proactive sweep (for demo)
curl -X POST https://ship.awsdev.treasury.gov/api/fleetgraph/sweep \
  -H "Authorization: Bearer $FLEETGRAPH_API_TOKEN"

# List recent traces in LangSmith
# (via LangSmith UI or API)
# Project: fleetgraph-prod
# Filter by run_type: "chain"

# Get shareable trace link
# In LangSmith UI: click run -> Share -> Copy public link
```

### LangSmith Project Configuration

```bash
# Environment variable sets the project
LANGCHAIN_PROJECT=fleetgraph-dev      # local
LANGCHAIN_PROJECT=fleetgraph-shadow   # shadow/UAT
LANGCHAIN_PROJECT=fleetgraph-prod     # production
```

Each environment traces to a separate LangSmith project, keeping demo traces clean.

---

## 8. Deployment Checklist

### Prerequisites

- [ ] AWS CLI configured with credentials
- [ ] Terraform state bucket exists (SSM: `/ship/terraform-state-bucket`)
- [ ] LangSmith account created and API key obtained
- [ ] OpenAI API key with sufficient quota

### First-Time FleetGraph Deployment

#### Step 1: Write Migration Files

```bash
# Create migration files
# api/src/db/migrations/039_fleetgraph_alert_state.sql
# api/src/db/migrations/040_fleetgraph_approvals.sql
# api/src/db/migrations/041_fleetgraph_audit_log.sql
```

Verify migration count matches expectations:

```bash
ls -1 api/src/db/migrations/*.sql | wc -l
# Should be previous count + 3
```

#### Step 2: Add FleetGraph Worker Code

```bash
# Create worker module
# api/src/fleetgraph/worker.ts       (sweep loop)
# api/src/fleetgraph/graph.ts        (LangGraph definition)
# api/src/fleetgraph/nodes/          (individual node implementations)
# api/src/fleetgraph/heuristics/     (deterministic signal filters)

# Update entry point
# api/src/index.ts                   (add conditional worker import)
```

#### Step 3: Install Dependencies

```bash
cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape
pnpm add -F api @langchain/langgraph @langchain/core @langchain/openai @langchain/langgraph-checkpoint-postgres
```

Verify the new packages are in `api/package.json` under `dependencies` (not devDependencies). The Docker build runs `pnpm install --prod`, so dev dependencies are not available at runtime.

#### Step 4: Create Service Token (Dev)

```bash
# Start local dev server
pnpm dev

# In another terminal, create the token
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@ship.local","password":"admin123"}'

curl -b cookies.txt -X POST http://localhost:3000/api/api-tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"fleetgraph-proactive"}'

# Save the returned token value to api/.env.local
```

#### Step 5: Configure Local Environment

Add to `api/.env.local`:

```bash
FLEETGRAPH_ENABLED=true
FLEETGRAPH_API_TOKEN=ship_<token_from_step_4>
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_<your_langsmith_key>
LANGCHAIN_PROJECT=fleetgraph-dev
OPENAI_API_KEY=sk-<your_openai_key>
```

#### Step 6: Test Locally

```bash
# Start with FleetGraph enabled
pnpm dev

# Verify in logs:
# "FleetGraph proactive worker started"
# "FleetGraph sweep completed in Xms"

# Check health endpoint
curl http://localhost:3000/health
# Should include fleetgraph.enabled: true

# Check LangSmith dashboard for traces
# https://smith.langchain.com/
```

#### Step 7: Run Tests

```bash
pnpm test
```

#### Step 8: Store Secrets in SSM (Production)

```bash
ENV=prod  # or shadow

aws ssm put-parameter \
  --name "/ship/${ENV}/FLEETGRAPH_API_TOKEN" \
  --value "ship_<production_token>" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name "/ship/${ENV}/LANGCHAIN_API_KEY" \
  --value "lsv2_pt_<key>" \
  --type SecureString \
  --overwrite

aws ssm put-parameter \
  --name "/ship/${ENV}/OPENAI_API_KEY" \
  --value "sk-<key>" \
  --type SecureString \
  --overwrite
```

#### Step 9: Set EB Environment Variables

```bash
ENV_NAME=ship-api-prod  # or ship-api-shadow

aws elasticbeanstalk update-environment \
  --environment-name "$ENV_NAME" \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_TRACING_V2,Value=true \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=LANGCHAIN_PROJECT,Value=fleetgraph-prod
```

#### Step 10: Deploy

```bash
# Test Docker build locally first (deploy.sh does this automatically)
docker build -t ship-api:pre-deploy-test .

# Deploy backend
./scripts/deploy.sh prod

# Monitor deployment
aws elasticbeanstalk describe-environments \
  --environment-names ship-api-prod \
  --query 'Environments[0].[Health,HealthStatus,Status]'
```

#### Step 11: Create Production Service Token

```bash
# After deploy, create the production token
# Log in via browser or curl, then create token via /api/api-tokens
# Store the token in SSM (Step 8)
# Restart the EB environment to pick up the new SSM value

aws elasticbeanstalk restart-app-server --environment-name ship-api-prod
```

#### Step 12: Verify Deployment

```bash
# Check health
curl https://ship.awsdev.treasury.gov/health

# Check LangSmith for first sweep trace
# https://smith.langchain.com/ -> project: fleetgraph-prod

# Verify no errors in EB logs
aws elasticbeanstalk request-environment-info \
  --environment-name ship-api-prod \
  --info-type tail

# Wait 30 seconds, then retrieve
aws elasticbeanstalk retrieve-environment-info \
  --environment-name ship-api-prod \
  --info-type tail
```

#### Step 13: Capture Demo Traces

Follow the trace capture strategy in Section 7 to generate all five required trace types. Share public links from LangSmith.

### Post-Deployment Monitoring

```bash
# Check FleetGraph alert count
curl -H "Authorization: Bearer $TOKEN" \
  https://ship.awsdev.treasury.gov/api/fleetgraph/alerts

# Check pending approvals
curl -H "Authorization: Bearer $TOKEN" \
  https://ship.awsdev.treasury.gov/api/fleetgraph/approvals?status=pending

# View recent sweeps in LangSmith
# Filter: project=fleetgraph-prod, run_type=chain, last 24h
```

---

## Appendix A: IAM Permissions

The EB instance role already has SSM read access scoped to `/ship/{env}/*`. No additional IAM changes are needed for FleetGraph since it reads the same SSM path.

If FleetGraph needs to invoke Bedrock (future enhancement), the existing `eb_bedrock_access` policy already allows `bedrock:InvokeModel` for Anthropic models.

## Appendix B: Security Considerations

- **Token rotation:** Create a new token periodically and revoke the old one. FleetGraph should handle 401 gracefully (log and retry next sweep).
- **Token scope:** The service token inherits the creating user's workspace. If Ship adds multi-workspace support for FleetGraph, each workspace needs its own token.
- **Audit trail:** All API calls made with the service token are logged via the existing audit middleware. The `isApiToken` flag distinguishes automated calls from user sessions.
- **Rate limiting:** FleetGraph makes internal API calls. If rate limiting is added to Ship, the service token should be exempted or given a higher limit.

## Appendix C: Rollback

To disable FleetGraph without a redeploy:

```bash
aws elasticbeanstalk update-environment \
  --environment-name ship-api-prod \
  --option-settings \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=FLEETGRAPH_ENABLED,Value=false
```

This triggers a rolling restart. The worker loop will not start on new instances. Existing alerts and approvals remain in the database.

To remove FleetGraph tables entirely (destructive):

```sql
DROP TABLE IF EXISTS fleetgraph_approvals CASCADE;
DROP TABLE IF EXISTS fleetgraph_alerts CASCADE;
DROP TABLE IF EXISTS checkpoint_blobs CASCADE;
DROP TABLE IF EXISTS checkpoint_writes CASCADE;
DROP TABLE IF EXISTS checkpoints CASCADE;
```
