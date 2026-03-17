# Ship REST API Data Source: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Complete endpoint inventory, per-use-case fetch plans, authentication model, and API client design for FleetGraph's read-side integration with Ship.

## Reconciliation Note

The service token model documented here is user-scoped. Canonical proactive MVP guidance therefore excludes workspace-wide missing-standup and inferred-accountability detection until the recommended admin endpoints in Section 7 exist. Examples that assume those cross-user reads are future-state or actor-scoped on-demand patterns.

## 1. Authentication Model

### Token Lifecycle

FleetGraph authenticates via Ship API tokens (`Bearer` scheme). Tokens are scoped to a user+workspace pair.

```
POST /api/api-tokens
Authorization: Bearer <existing-session-or-token>
Content-Type: application/json

{
  "name": "fleetgraph-service",
  "expires_in_days": null   // null = never expires
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "fleetgraph-service",
    "token": "ship_<64-hex-chars>",
    "token_prefix": "ship_1234567",
    "expires_at": null,
    "created_at": "...",
    "warning": "Save this token now. It will not be shown again."
  }
}
```

The full token is returned only on creation. Ship stores a SHA-256 hash; the raw value cannot be recovered.

### How Auth Middleware Resolves Tokens

From `api/src/middleware/auth.ts`:

1. Check `Authorization: Bearer <token>` header first
2. Hash the token with SHA-256
3. Look up `api_tokens` table by `token_hash`
4. Reject if `revoked_at IS NOT NULL` or `expires_at < NOW()`
5. Populate `req.userId`, `req.workspaceId`, `req.isSuperAdmin`, `req.isApiToken = true`
6. Update `last_used_at` on the token row

The token carries its workspace scope. FleetGraph does not need to switch workspaces; each token is bound to exactly one.

### Token Management Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/api-tokens` | Create token (returns raw value once) |
| `GET` | `/api/api-tokens` | List tokens for current user (never returns raw value) |
| `DELETE` | `/api/api-tokens/:id` | Revoke token (soft delete, sets `revoked_at`) |

### Service Account Strategy

Create a dedicated Ship user for FleetGraph (e.g., `fleetgraph@service.internal`), grant workspace membership with `admin` role so visibility filters pass for all documents, then generate a non-expiring API token for that user.

---

## 2. Complete API Endpoint Inventory

Every endpoint FleetGraph may call. Read-only endpoints are marked with `R`. Write endpoints FleetGraph would use only for actions requiring human approval are marked `W/HITL`.

### 2.1 Issues

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/issues` | `state` (csv), `priority`, `assignee_id`, `program_id`, `sprint_id`, `source`, `parent_filter` | List issues with filters | R: Core data fetch |
| `GET` | `/api/issues/:id` | | Single issue with belongs_to | R: Detail fetch |
| `GET` | `/api/issues/by-ticket/:number` | | Lookup by ticket number | R: Reference resolution |
| `GET` | `/api/issues/action-items` | | User's action items (source=action_items, not done) | R: Accountability check |
| `GET` | `/api/issues/:id/children` | | Sub-issues of a parent | R: Hierarchy traversal |
| `GET` | `/api/issues/:id/history` | | Change log (field, old_value, new_value, changed_by, automated_by) | R: Staleness detection |
| `GET` | `/api/issues/:id/iterations` | `status` | Claude iteration entries | R: Progress signal |
| `PATCH` | `/api/issues/:id` | | Update state/priority/assignee/belongs_to | W/HITL: Reassign, unblock |
| `POST` | `/api/issues/bulk` | | Bulk archive/delete/restore/update | W/HITL: Batch ops |

**Issue Response Shape:**

```typescript
interface IssueResponse {
  id: string;                          // UUID
  title: string;
  state: 'triage' | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  assignee_id: string | null;          // UUID of assigned user
  assignee_name: string | null;
  assignee_archived: boolean;
  estimate: number | null;
  source: 'internal' | 'external' | 'action_items';
  rejection_reason: string | null;
  due_date: string | null;             // YYYY-MM-DD
  is_system_generated: boolean;
  accountability_target_id: string | null;
  accountability_type: string | null;
  ticket_number: number;
  display_id: string;                  // "#42"
  content: object | null;              // TipTap JSON
  created_at: string;                  // ISO timestamp
  updated_at: string;
  created_by: string | null;           // UUID
  created_by_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  converted_from_id: string | null;
  belongs_to: BelongsToEntry[];
}

interface BelongsToEntry {
  id: string;       // UUID of related document
  type: 'program' | 'project' | 'sprint' | 'parent';
  title?: string;
  color?: string;
}
```

**Issue History Entry Shape:**

```typescript
interface IssueHistoryEntry {
  id: string;
  field: string;           // 'state', 'priority', 'assignee_id', 'belongs_to', etc.
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  changed_by: { id: string; name: string } | null;
  automated_by: string | null;  // 'claude' when automated
}
```

### 2.2 Weeks (Sprints)

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/weeks` | | All sprints for current sprint number | R: Active sprint discovery |
| `GET` | `/api/weeks/:id` | | Single sprint with approval/plan/retro metadata | R: Sprint detail |
| `GET` | `/api/weeks/lookup` | `project_id`, `sprint_number` | Find sprint by project+number | R: Cross-reference |
| `GET` | `/api/weeks/lookup-person` | `user_id` | Find person doc by user_id | R: Identity resolution |
| `GET` | `/api/weeks/my-week` | `state`, `assignee`, `show_mine`, `sprint_number` | Aggregated issues across sprints | R: Week overview |
| `GET` | `/api/weeks/my-action-items` | | Missing plans/retros for owned sprints | R: Accountability |
| `GET` | `/api/weeks/:id/issues` | | Issues in a specific sprint | R: Sprint scope |
| `GET` | `/api/weeks/:id/scope-changes` | | Issues added/removed after snapshot | R: Scope creep detection |
| `GET` | `/api/weeks/:id/standups` | | Standup entries for a sprint | R: Standup coverage |
| `GET` | `/api/weeks/:id/review` | | Sprint review data | R: Review status |
| `PATCH` | `/api/weeks/:id` | | Update sprint title/owner/number | W/HITL |
| `PATCH` | `/api/weeks/:id/plan` | | Update plan/success_criteria/confidence | W/HITL |
| `POST` | `/api/weeks/:id/approve-plan` | | Approve sprint plan (body: optional `comment`) | W/HITL |
| `POST` | `/api/weeks/:id/unapprove-plan` | | Revoke plan approval | W/HITL |
| `POST` | `/api/weeks/:id/approve-review` | | Approve sprint review (body: optional `comment`, `rating`) | W/HITL |
| `POST` | `/api/weeks/:id/request-plan-changes` | | Request changes on plan (body: `comment`) | W/HITL |
| `POST` | `/api/weeks/:id/request-retro-changes` | | Request changes on retro (body: `comment`) | W/HITL |
| `POST` | `/api/weeks/:id/carryover` | | Carry over incomplete issues to next sprint | W/HITL |

**Sprint Response Shape:**

```typescript
interface SprintResponse {
  id: string;
  name: string;
  sprint_number: number;
  status: 'planning' | 'active' | 'completed';
  owner: { id: string; name: string; email: string } | null;
  owner_reports_to: string | null;     // User ID of supervisor
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_accountable_id: string | null;
  workspace_sprint_start_date: string; // ISO date, workspace-level config
  issue_count: number;
  completed_count: number;
  started_count: number;
  has_plan: boolean;
  has_retro: boolean;
  retro_outcome: string | null;
  retro_id: string | null;
  // Plan tracking
  plan: string | null;
  success_criteria: string[] | null;
  confidence: number | null;           // 0-100
  plan_history: object | null;
  // Completeness
  is_complete: boolean | null;
  missing_fields: string[];
  // Plan snapshot (taken when sprint becomes active)
  planned_issue_ids: string[] | null;
  snapshot_taken_at: string | null;
  // Approval tracking
  plan_approval: string | null;        // 'approved', 'changes_requested', or null
  review_approval: string | null;
  review_rating: number | null;        // OPM 5-level scale
  accountable_id: string | null;
}
```

**Scope Changes Response Shape (GET /api/weeks/:id/scope-changes):**

```typescript
interface ScopeChangesResponse {
  planned_issues: Issue[];     // Issues in original snapshot
  added_issues: Issue[];       // Issues added after snapshot
  removed_issues: Issue[];     // Issues removed after snapshot
  current_issues: Issue[];     // Current sprint issues
  snapshot_taken_at: string | null;
  has_snapshot: boolean;
}
```

### 2.3 Projects

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/projects` | `archived` (bool), `sort` (ice_score, impact, etc.), `dir` (asc/desc) | List projects | R: Project roster |
| `GET` | `/api/projects/:id` | | Single project with RACI, ICE, status | R: Project detail |
| `GET` | `/api/projects/:id/issues` | | Issues associated with project | R: Project scope |
| `GET` | `/api/projects/:id/weeks` | | Sprints associated with project | R: Sprint roster |
| `GET` | `/api/projects/:id/sprints` | | Same as weeks (alias) | R: Sprint roster |
| `GET` | `/api/projects/:id/retro` | | Project retro data | R: Retro status |
| `POST` | `/api/projects/:id/approve-plan` | | Approve project plan | W/HITL |
| `POST` | `/api/projects/:id/approve-retro` | | Approve project retro | W/HITL |

**Project Response Shape:**

```typescript
interface ProjectResponse {
  id: string;
  title: string;
  // ICE scoring
  impact: number | null;       // 1-5
  confidence: number | null;   // 1-5
  ease: number | null;         // 1-5
  ice_score: number | null;    // impact * confidence * ease
  // Visual
  color: string;               // Hex color
  emoji: string | null;
  // Associations
  program_id: string | null;
  // RACI
  owner_id: string | null;        // R: Responsible
  accountable_id: string | null;  // A: Accountable (approver)
  consulted_ids: string[];         // C
  informed_ids: string[];          // I
  owner: { id: string; name: string; email: string } | null;
  // Counts
  sprint_count: number;
  issue_count: number;
  // Status (computed from sprint allocations)
  inferred_status: 'active' | 'planned' | 'completed' | 'backlog' | 'archived';
  // Plan and approval
  plan: string | null;
  plan_approval: string | null;
  retro_approval: string | null;
  has_retro: boolean;
  target_date: string | null;
  // Design review
  has_design_review: boolean | null;
  design_review_notes: string | null;
  // Completeness
  is_complete: boolean | null;
  missing_fields: string[];
  // Timestamps
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  converted_from_id: string | null;
}
```

### 2.4 Programs

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/programs` | `archived` (bool) | List programs | R: Program roster |
| `GET` | `/api/programs/:id` | | Single program with RACI | R: Program detail |

**Program Response Shape:**

```typescript
interface ProgramResponse {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  owner: { id: string; name: string; email: string } | null;
  owner_id: string | null;
  accountable_id: string | null;
  consulted_ids: string[];
  informed_ids: string[];
  issue_count: number;
  sprint_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### 2.5 Standups

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/standups` | `date_from`, `date_to` (required, YYYY-MM-DD) | Standups in date range for current user | R: Standup check |
| `GET` | `/api/standups/status` | | Whether standup is due today | R: Quick standup check |

**Standup Response Shape:**

```typescript
interface StandupResponse {
  id: string;
  title: string;
  document_type: 'standup';
  content: object;         // TipTap JSON
  properties: {
    author_id: string;
    date: string;          // YYYY-MM-DD
  };
  created_at: string;
  updated_at: string;
}
```

### 2.6 Accountability

| Method | Path | Purpose | FleetGraph Use |
|--------|------|---------|----------------|
| `GET` | `/api/accountability/action-items` | Inferred action items for current user (computed dynamically) | R: Missing accountability detection |

**Accountability Response Shape:**

```typescript
interface AccountabilityResponse {
  items: AccountabilityItem[];
  total: number;
  has_overdue: boolean;
  has_due_today: boolean;
}

interface AccountabilityItem {
  id: string;                    // Synthetic: "{type}-{targetId}"
  title: string;                 // Human-readable message
  state: 'todo';
  priority: 'high';
  accountability_type: AccountabilityType;
  accountability_target_id: string;
  target_title: string;
  due_date: string | null;
  days_overdue: number;
  person_id: string | null;
  project_id: string | null;
  week_number: number | null;
}

type AccountabilityType =
  | 'standup'
  | 'weekly_plan'
  | 'weekly_review'
  | 'week_start'
  | 'week_issues'
  | 'project_plan'
  | 'project_retro'
  | 'changes_requested_plan'
  | 'changes_requested_retro';
```

### 2.7 Activity

| Method | Path | Purpose | FleetGraph Use |
|--------|------|---------|----------------|
| `GET` | `/api/activity/:entityType/:entityId` | 30-day activity counts (entityType: program, project, sprint) | R: Activity signal |

**Response:** `{ days: [{ date: "YYYY-MM-DD", count: number }] }`

### 2.8 Document Associations

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/documents/:id/associations` | `type` (parent, project, sprint, program) | Forward associations | R: Graph edges |
| `GET` | `/api/documents/:id/reverse-associations` | `type` | Reverse associations (who points to me) | R: Graph edges |
| `GET` | `/api/documents/:id/context` | | Full context tree (ancestors, children, breadcrumbs) | R: Hierarchy |
| `GET` | `/api/documents/:id/backlinks` | | Documents that link to this one | R: Reference graph |

### 2.9 Documents (Generic)

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/documents` | `type`, `parent_id` | List documents by type | R: Bulk fetch by type |
| `GET` | `/api/documents/:id` | | Single document | R: Generic doc fetch |

### 2.10 Workspace and Team

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/workspaces` | | List workspaces | R: Workspace discovery |
| `GET` | `/api/workspaces/current` | | Current workspace detail | R: Sprint config |
| `GET` | `/api/workspaces/:id/members` | `includeArchived` (bool) | Workspace members | R: Team roster |
| `GET` | `/api/team/grid` | `fromSprint`, `toSprint`, `includeArchived` | Team grid with allocations | R: Allocation data |

**Workspace Member Shape:**

```typescript
interface WorkspaceMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  personDocumentId: string | null;
  joinedAt: string;
  isArchived: boolean;
}
```

### 2.11 Weekly Plans and Retros

| Method | Path | Purpose | FleetGraph Use |
|--------|------|---------|----------------|
| `POST` | `/api/weekly-plans` | Create/get weekly plan (idempotent) | R: Plan existence check |
| `GET` | `/api/weekly-plans/:id` | Get plan document content | R: Plan content |

### 2.12 Search

| Method | Path | Query Params | Purpose | FleetGraph Use |
|--------|------|-------------|---------|----------------|
| `GET` | `/api/search/mentions` | `q` | Search people + documents | R: On-demand entity lookup |
| `GET` | `/api/search/learnings` | `q`, `program_id`, `limit` | Search learning wiki docs | R: Knowledge retrieval |

### 2.13 Comments

| Method | Path | Purpose | FleetGraph Use |
|--------|------|---------|----------------|
| `GET` | `/api/documents/:id/comments` | List comments on a document | R: Discussion context |

### 2.14 Dashboard

| Method | Path | Purpose | FleetGraph Use |
|--------|------|---------|----------------|
| `GET` | `/api/dashboard/my-work` | Work items by urgency (issues, projects, sprints) | R: Quick overview |

---

## 3. Per-Use-Case Fetch Plans

### UC1: Blocked Issue Detection (BG-2)

**Signal:** Issue in `in_progress` or `in_review` with no `updated_at` change for >24 hours.

```
Step 1 (parallel):
  GET /api/weeks                       -> active sprint list
  GET /api/workspaces/current          -> sprint_start_date for date math

Step 2 (parallel, per active sprint):
  GET /api/weeks/:sprintId/issues      -> all issues in each active sprint

Step 3 (filter locally):
  Select issues where:
    state IN ('in_progress', 'in_review')
    AND (now - updated_at) > 24h

Step 4 (per flagged issue):
  GET /api/issues/:id/history          -> last state/assignee change timestamp
  GET /api/documents/:id/associations  -> parent, project, sprint links
  GET /api/documents/:id/comments      -> recent discussion (if any)

Step 5: Pass to heuristic + model
```

**Total API calls (5 active sprints, 3 flagged issues):** 2 + 5 + (3 * 3) = 16

### UC2: Missing Standup (BG-1)

**Signal:** Active sprint exists, business day, no standup posted by expected window.

```
Step 1 (parallel):
  GET /api/weeks                       -> active sprints with owner info
  GET /api/workspaces/:id/members      -> team roster

Step 2 (parallel, per active sprint):
  GET /api/weeks/:sprintId/standups    -> standup list for sprint

Step 3 (filter locally):
  For each sprint owner:
    Check if standup exists for today's date
    Flag if missing and it's past the expected window (e.g., 11 AM local)

Step 4 (per missing standup):
  GET /api/weeks/:sprintId/issues      -> what work is at risk
```

**Total API calls (5 sprints, 2 missing):** 2 + 5 + 2 = 9

### UC3: Scope Creep (BG-4)

**Signal:** Issue added to sprint after plan snapshot was taken and plan was approved.

```
Step 1:
  GET /api/weeks                       -> active sprints

Step 2 (parallel, per sprint with plan_approval = 'approved'):
  GET /api/weeks/:sprintId/scope-changes  -> planned vs current issue diff

Step 3 (filter locally):
  Check if added_issues array is non-empty
  Cross-reference with snapshot_taken_at to verify timing

Step 4 (per sprint with scope change):
  GET /api/weeks/:sprintId             -> full sprint detail for context
  GET /api/projects/:projectId         -> project-level context
```

**Total API calls (5 sprints, 2 with approved plans, 1 with scope change):** 1 + 2 + 2 = 5

### UC4: Project Risk Cluster (BG-5)

**Signal:** Multiple weak signals converge on the same project.

```
Step 1 (parallel):
  GET /api/projects                    -> all active projects
  GET /api/weeks                       -> active sprints

Step 2 (parallel, per project):
  GET /api/projects/:id/issues         -> project issue list
  GET /api/projects/:id/weeks          -> project sprint list
  GET /api/activity/project/:id        -> 30-day activity trend

Step 3 (per project sprint):
  GET /api/weeks/:sprintId             -> approval status, plan status
  GET /api/weeks/:sprintId/standups    -> standup coverage

Step 4: Aggregate signals per project:
  - blocked issue count
  - missing standup count
  - pending approvals
  - scope changes
  - activity trend (declining = risk)
  - missing plan/retro

Step 5: Flag projects where signal count >= threshold
```

**Total API calls (10 projects, 2 sprints each):** 2 + (10 * 3) + (20 * 2) = 72

This is the most expensive use case. Memoization and caching are critical (see section 7).

### UC5: Approval Bottleneck (BG-3)

**Signal:** Plan or retro approval pending for >48 business hours.

```
Step 1 (parallel):
  GET /api/weeks                       -> active sprints with approval metadata
  GET /api/projects                    -> projects with plan_approval field

Step 2 (filter locally):
  For sprints:
    plan_approval === null AND has_plan === true  -> plan needs approval
    review_approval === null AND has_retro === true  -> review needs approval
    plan_approval === 'changes_requested'  -> changes requested, check age
  For projects:
    plan_approval === null AND plan !== null  -> project plan needs approval
    retro_approval === null AND has_retro === true  -> retro needs approval

Step 3 (per flagged item):
  GET /api/weeks/:id                   -> full detail (accountable_id, owner_reports_to)
  OR GET /api/projects/:id             -> full detail (accountable_id)

Step 4: Check age of pending approval against 48-hour threshold
```

**Total API calls (5 sprints, 10 projects, 3 bottlenecks):** 2 + 3 = 5

### UC6: On-Demand Context (per entity type)

**Issue Context:**
```
GET /api/issues/:id                    -> issue detail
GET /api/issues/:id/history            -> change log
GET /api/issues/:id/children           -> sub-issues
GET /api/documents/:id/associations    -> sprint/project/program links
GET /api/documents/:id/comments        -> discussion
GET /api/documents/:id/backlinks       -> who references this issue
```
**Calls:** 6

**Sprint Context:**
```
GET /api/weeks/:id                     -> sprint detail + approval/plan/retro status
GET /api/weeks/:id/issues              -> sprint issues
GET /api/weeks/:id/scope-changes       -> scope drift
GET /api/weeks/:id/standups            -> standup coverage
GET /api/weeks/:id/review              -> review data
GET /api/activity/sprint/:id           -> activity trend
```
**Calls:** 6

**Project Context:**
```
GET /api/projects/:id                  -> project detail + RACI + ICE
GET /api/projects/:id/issues           -> project issues
GET /api/projects/:id/weeks            -> project sprints
GET /api/projects/:id/retro            -> retro status
GET /api/activity/project/:id          -> activity trend
```
**Calls:** 5

---

## 4. API Client Design

```typescript
// fleetgraph/src/ship-client.ts

interface ShipClientConfig {
  baseUrl: string;         // e.g., "http://localhost:3000"
  apiToken: string;        // ship_<hex>
  timeout?: number;        // ms, default 10000
  retries?: number;        // default 2
  retryDelay?: number;     // ms, default 500
}

class ShipClient {
  private config: ShipClientConfig;
  private memo: Map<string, { data: unknown; expiry: number }>;

  constructor(config: ShipClientConfig) {
    this.config = {
      timeout: 10_000,
      retries: 2,
      retryDelay: 500,
      ...config,
    };
    this.memo = new Map();
  }

  /** Clear request-scope memo (call at start of each sweep/on-demand run) */
  clearMemo(): void {
    this.memo.clear();
  }

  /** Core fetch with auth, retries, and memo */
  private async get<T>(
    path: string,
    params?: Record<string, string>,
    ttlMs: number = 60_000,
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const cacheKey = url.toString();

    // Request-scope memo check
    const cached = this.memo.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }

    let lastError: Error | null = null;
    const maxAttempts = 1 + (this.config.retries ?? 2);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.config.timeout,
        );

        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.status === 429) {
          // Rate limited: exponential backoff
          const delay = (this.config.retryDelay ?? 500) * 2 ** attempt;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (!res.ok) {
          throw new ShipApiError(res.status, await res.text(), path);
        }

        const data = await res.json() as T;

        // Cache in memo
        this.memo.set(cacheKey, { data, expiry: Date.now() + ttlMs });

        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts - 1) {
          const delay = (this.config.retryDelay ?? 500) * 2 ** attempt;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError ?? new Error(`Failed after ${maxAttempts} attempts: ${path}`);
  }

  // ---- Domain Methods ----

  async listActiveWeeks(): Promise<ActiveWeeksResponse> {
    return this.get('/api/weeks');
  }

  async getSprint(id: string): Promise<SprintResponse> {
    return this.get(`/api/weeks/${id}`);
  }

  async getSprintIssues(sprintId: string): Promise<IssueResponse[]> {
    return this.get(`/api/weeks/${sprintId}/issues`);
  }

  async getSprintScopeChanges(sprintId: string): Promise<ScopeChangesResponse> {
    return this.get(`/api/weeks/${sprintId}/scope-changes`);
  }

  async getSprintStandups(sprintId: string): Promise<StandupEntry[]> {
    return this.get(`/api/weeks/${sprintId}/standups`);
  }

  async getSprintReview(sprintId: string): Promise<SprintReviewResponse> {
    return this.get(`/api/weeks/${sprintId}/review`);
  }

  async listIssues(params?: {
    state?: string;
    sprint_id?: string;
    assignee_id?: string;
    program_id?: string;
  }): Promise<IssueResponse[]> {
    return this.get('/api/issues', params as Record<string, string>);
  }

  async getIssue(id: string): Promise<IssueResponse> {
    return this.get(`/api/issues/${id}`);
  }

  async getIssueHistory(id: string): Promise<IssueHistoryEntry[]> {
    return this.get(`/api/issues/${id}/history`);
  }

  async getIssueChildren(id: string): Promise<IssueResponse[]> {
    return this.get(`/api/issues/${id}/children`);
  }

  async listProjects(params?: {
    archived?: string;
    sort?: string;
  }): Promise<ProjectResponse[]> {
    return this.get('/api/projects', params as Record<string, string>);
  }

  async getProject(id: string): Promise<ProjectResponse> {
    return this.get(`/api/projects/${id}`);
  }

  async getProjectIssues(id: string): Promise<IssueResponse[]> {
    return this.get(`/api/projects/${id}/issues`);
  }

  async getProjectWeeks(id: string): Promise<SprintResponse[]> {
    return this.get(`/api/projects/${id}/weeks`);
  }

  async getProjectRetro(id: string): Promise<ProjectRetroResponse> {
    return this.get(`/api/projects/${id}/retro`);
  }

  async listPrograms(): Promise<ProgramResponse[]> {
    return this.get('/api/programs');
  }

  async getProgram(id: string): Promise<ProgramResponse> {
    return this.get(`/api/programs/${id}`);
  }

  async getActivity(
    entityType: 'program' | 'project' | 'sprint',
    entityId: string,
  ): Promise<ActivityResponse> {
    return this.get(`/api/activity/${entityType}/${entityId}`);
  }

  async getDocumentAssociations(
    id: string,
    type?: string,
  ): Promise<AssociationEntry[]> {
    const params = type ? { type } : undefined;
    return this.get(`/api/documents/${id}/associations`, params);
  }

  async getDocumentReverseAssociations(
    id: string,
    type?: string,
  ): Promise<AssociationEntry[]> {
    const params = type ? { type } : undefined;
    return this.get(`/api/documents/${id}/reverse-associations`, params);
  }

  async getDocumentContext(id: string): Promise<DocumentContextResponse> {
    return this.get(`/api/documents/${id}/context`);
  }

  async getDocumentBacklinks(id: string): Promise<BacklinkEntry[]> {
    return this.get(`/api/documents/${id}/backlinks`);
  }

  async getDocumentComments(id: string): Promise<CommentEntry[]> {
    return this.get(`/api/documents/${id}/comments`);
  }

  async getCurrentWorkspace(): Promise<WorkspaceResponse> {
    return this.get('/api/workspaces/current');
  }

  async getWorkspaceMembers(
    workspaceId: string,
    includeArchived?: boolean,
  ): Promise<WorkspaceMembersResponse> {
    const params = includeArchived ? { includeArchived: 'true' } : undefined;
    return this.get(`/api/workspaces/${workspaceId}/members`, params);
  }

  async getTeamGrid(params?: {
    fromSprint?: string;
    toSprint?: string;
  }): Promise<TeamGridResponse> {
    return this.get('/api/team/grid', params as Record<string, string>);
  }

  async getAccountabilityItems(): Promise<AccountabilityResponse> {
    return this.get('/api/accountability/action-items');
  }

  async getStandups(dateFrom: string, dateTo: string): Promise<StandupResponse[]> {
    return this.get('/api/standups', { date_from: dateFrom, date_to: dateTo });
  }

  async getStandupStatus(): Promise<StandupStatusResponse> {
    return this.get('/api/standups/status');
  }

  async getDashboardMyWork(): Promise<DashboardMyWorkResponse> {
    return this.get('/api/dashboard/my-work');
  }

  async searchMentions(query: string): Promise<SearchMentionsResponse> {
    return this.get('/api/search/mentions', { q: query });
  }
}

class ShipApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`Ship API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = 'ShipApiError';
  }
}
```

---

## 5. Parallel Fetch Strategy

### Independent Reads (can execute concurrently)

**Sweep initialization (every 4 minutes):**

```typescript
const [activeWeeks, projects, programs, workspace, members] = await Promise.all([
  client.listActiveWeeks(),
  client.listProjects(),
  client.listPrograms(),
  client.getCurrentWorkspace(),
  client.getWorkspaceMembers(workspaceId),
]);
```

**Per-sprint detail (concurrent across sprints):**

```typescript
const sprintDetails = await Promise.all(
  activeWeeks.weeks.map(sprint =>
    Promise.all([
      client.getSprintIssues(sprint.id),
      client.getSprintStandups(sprint.id),
      client.getSprintScopeChanges(sprint.id),
    ]).then(([issues, standups, scope]) => ({
      sprint, issues, standups, scope,
    }))
  )
);
```

**Per-project detail (concurrent across projects):**

```typescript
const projectDetails = await Promise.all(
  projects.map(project =>
    Promise.all([
      client.getProjectIssues(project.id),
      client.getActivity('project', project.id),
    ]).then(([issues, activity]) => ({
      project, issues, activity,
    }))
  )
);
```

### Dependency Order

```
Phase 1: [weeks, projects, programs, workspace, members]  -- all parallel
Phase 2: per-sprint [issues, standups, scope-changes]     -- parallel per sprint
Phase 3: per-issue  [history, associations]                -- only for flagged issues
```

Phases are sequential. Within each phase, all calls run concurrently.

---

## 6. Caching and Memoization

### Request-Scope Deduplication

The `ShipClient.memo` map provides within-run deduplication. When UC4 (risk cluster) fetches the same sprint issues that UC1 (blocked issue) already fetched in the same sweep, the memo returns cached data.

**Lifecycle:**
1. `client.clearMemo()` at the start of each sweep or on-demand invocation
2. Each GET stores response with a TTL (default 60s)
3. Subsequent calls to the same URL within the run return cached data
4. Memo is never persisted across runs

### Entity Digest Cache (Cross-Run)

For proactive sweeps, store a content digest per entity to skip unchanged data:

```typescript
interface EntityDigest {
  entityId: string;
  entityType: string;
  updatedAt: string;      // Last known updated_at
  contentHash: string;     // SHA-256 of serialized response
  fetchedAt: string;       // When FleetGraph last fetched
}
```

At sweep start, compare `updated_at` from list endpoints against stored digests. Skip detail fetches for entities whose `updated_at` has not changed.

### Stale Data Policy

| Context | Max Staleness | Behavior |
|---------|--------------|----------|
| Proactive sweep | 4 minutes (sweep interval) | Always fetch fresh list, use digest cache for details |
| On-demand (issue page) | 0 (real-time) | Always fetch fresh, no cache |
| On-demand (project page) | 30 seconds | Short memo TTL |
| Retry after partial failure | Return partial with stale warning | Label which entities are stale |

---

## 7. Missing Endpoints / Gaps

Endpoints FleetGraph needs but Ship does not currently expose:

| Gap | What FleetGraph Needs | Current Workaround | Recommended Endpoint |
|-----|----------------------|-------------------|---------------------|
| **Standup by user across sprints** | All standups for a user in a date range regardless of sprint | `GET /api/standups?date_from&date_to` only returns for the token's user. FleetGraph service account cannot fetch other users' standups. | `GET /api/standups?author_id=<userId>&date_from&date_to` with admin visibility bypass |
| **Bulk issue history** | History for all issues in a sprint in one call | Fetch `GET /api/issues/:id/history` per issue (N+1) | `GET /api/weeks/:id/issues/history` returning issue_id-keyed map |
| **Workspace-wide standup coverage** | Which members posted standups today | Call `/api/weeks/:id/standups` per sprint + cross-reference members | `GET /api/standups/coverage?date=YYYY-MM-DD` returning `{ posted: userId[], missing: userId[] }` |
| **Document change feed** | Stream of recent changes across workspace (for event-driven triggers) | Poll list endpoints and compare timestamps | `GET /api/documents/changes?since=<ISO>` returning recently changed documents |
| **Approval history with timestamps** | When was plan_approval set, by whom | `plan_approval` field is a string, no timestamp. Must infer from document `updated_at` | Store approval events with timestamp + actor in properties or history table |
| **Cross-user accountability** | Accountability items for all workspace members (admin view) | `GET /api/accountability/action-items` only returns for the authenticated user | `GET /api/accountability/action-items?user_id=<userId>` with admin check, or `GET /api/accountability/workspace-summary` |

### Priority Ranking for Missing Endpoints

1. **Cross-user accountability** (blocks proactive sweeps for all users from a single service account)
2. **Standup by user across sprints** (blocks UC2 from service account perspective)
3. **Document change feed** (enables event-driven instead of polling)
4. **Bulk issue history** (performance optimization for UC1 and UC4)
5. **Workspace-wide standup coverage** (convenience, can be composed from existing endpoints)
6. **Approval history with timestamps** (can partially infer from document history)

### Canonical Scope Decision

Given the endpoint gaps above, the proactive MVP should ship with signals that a single service token can evaluate workspace-wide today:

- stale or blocked issue drift
- post-start scope drift
- approval bottlenecks and change-request churn
- ownership gaps and multi-signal project drift

Missing standup coverage and cross-user accountability remain valid follow-on use cases, but they require the recommended admin endpoints before they qualify as canonical proactive coverage.

---

## 8. Rate Limiting and Concurrency

From `api/src/app.ts`, the API has a rate limiter on `/api/` routes. FleetGraph must respect this.

**Recommended concurrency settings:**

```typescript
const CONCURRENT_REQUESTS = 10;  // max parallel in-flight requests
const SWEEP_INTERVAL_MS = 300_000; // 5 minutes between sweeps
```

Use a semaphore or `p-limit` to cap concurrent requests:

```typescript
import pLimit from 'p-limit';
const limit = pLimit(10);

const results = await Promise.all(
  sprintIds.map(id => limit(() => client.getSprintIssues(id)))
);
```

---

## 9. Configuration

```typescript
// Environment variables for FleetGraph
interface FleetGraphEnv {
  SHIP_API_BASE_URL: string;       // "http://localhost:3000" or production URL
  SHIP_API_TOKEN: string;          // "ship_<hex>"
  SHIP_WORKSPACE_ID: string;       // UUID (token is already scoped, but useful for logging)
  FLEETGRAPH_SWEEP_INTERVAL: number; // ms, default 240000
  FLEETGRAPH_REQUEST_TIMEOUT: number; // ms, default 10000
  FLEETGRAPH_MAX_CONCURRENT: number;  // default 10
}
```
