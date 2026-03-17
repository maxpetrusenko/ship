# Background Use Cases Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Enumerate every background (proactive) use case that fits the shared FleetGraph architecture. All use cases below share the same pipeline: event or sweep trigger, deterministic heuristic filter, OpenAI reasoning only when flagged, HITL gate for consequential actions.

## Shared Background Architecture

```
Event / 5-min Sweep
       |
normalize_candidate(entity_type, entity_id, signal_type)
       |
dedupe(risk_fingerprint) → skip if recently surfaced & not snoozed
       |
heuristic_filter(deterministic) → exit early if no candidate
       |
reason_about_risk(OpenAI Responses) → only invoked for flagged candidates
       |
branch_decision → no_issue | inform_only | confirm_action
       |
human_gate (if consequential) → approve | dismiss | snooze
       |
execute_action (if approved)
```

Each use case varies only in:
- Which entities get fetched
- Which heuristic runs
- Which prompt goes to OpenAI

No new infrastructure per use case. Just config: heuristic function + prompt template.

## Tier 1: Launch Use Cases

Already decided in Phase 1 / 02. Use Case Discovery. Included here for completeness.

| ID | Signal | Trigger Type | Heuristic | Entity Source |
|----|--------|-------------|-----------|---------------|
| BG-1 | Missing standup | Sweep | Active week + no standup after expected window | `/api/weeks/:id`, `/api/standups` |
| BG-2 | Blocked issue stale | Event (status change) + Sweep | Blocked >24hrs, no progress signal | `/api/issues/:id`, `/api/weeks/:id/issues` |
| BG-3 | Approval bottleneck | Event (approval request) + Sweep | Plan/retro approval pending >48hrs | `/api/weeks/:id` (approval metadata) |
| BG-4 | Scope creep | Event (issue added to week) | Issue added after week plan approved | `/api/weeks/:id/issues`, plan snapshot |
| BG-5 | Project risk cluster | Sweep | Multiple weak signals converge on same project | All of the above, aggregated per project |

## Tier 2: Same Architecture, Zero New Infrastructure

These use cases reuse existing graph nodes and API fetches. They add one heuristic function and one prompt template each.

### BG-6: Capacity Overload

**Signal:** Individual team member has too many active issues across sprints.

**Trigger:** Event (issue assigned) + Sweep

**Heuristic:** Count active issues per assignee across all active weeks in workspace. Flag if count exceeds threshold (configurable, default 8).

**Entity source:** `/api/team/accountability-grid-v3`, `/api/weeks/:id/issues`

**Why same arch:** Team membership and issue lists already fetched in `fetch_core_context` and `fetch_parallel_signals`. Heuristic is a count operation on data already in graph state.

**Model's job:** Assess which assignments are highest risk given deadlines and dependencies. Recommend rebalancing.

**Action:** `inform_only` (suggest reassignment) or `confirm_action` (draft reassignment if owner approves).

### BG-7: Ownership Gap

**Signal:** Active project or week has no owner, or owner is deactivated/removed from workspace.

**Trigger:** Sweep

**Heuristic:** Check `owner_id` and `accountable_id` on project/week documents. Cross-reference against active workspace members.

**Entity source:** `/api/projects/:id`, `/api/weeks/:id`, `/api/workspaces/:id/members`

**Why same arch:** Workspace membership already fetched. Owner fields already on project/week documents. Pure data check.

**Model's job:** Identify who the most logical replacement owner is based on RACI history and current team capacity.

**Action:** `confirm_action` (reassign ownership requires human approval).

### BG-8: Dependency Cascade

**Signal:** A blocked issue is itself blocking other issues, creating a chain of depth >1.

**Trigger:** Event (issue status changes to blocked) + Sweep

**Heuristic:** Walk issue associations. If blocked issue A is depended on by issues B, C, and B is depended on by D, flag the chain.

**Entity source:** `/api/issues/:id`, `/api/documents/:id/associations` (backlinks)

**Why same arch:** Issue list and association data already fetched in `fetch_parallel_signals`. Heuristic traverses in-memory association graph.

**Model's job:** Assess blast radius. Which downstream work is most time-sensitive? Recommend which blocker to resolve first.

**Action:** `inform_only` (escalation path) or `confirm_action` (reassign blocker).

### BG-9: Week Plan Quality

**Signal:** Plan submitted for approval is thin (too few issues, empty content body, no priorities set).

**Trigger:** Event (plan submitted for approval)

**Heuristic:** Count issues linked to week. Check if plan document content is non-empty and exceeds minimum length. Check if issue priorities are set.

**Entity source:** `/api/weeks/:id`, `/api/weeks/:id/issues`, `/api/documents/:id` (plan content)

**Why same arch:** Week and issue data already fetched. Heuristic is a count + length check. Deterministic.

**Model's job:** If flagged, analyze what's missing from the plan compared to project goals and recent retro feedback.

**Action:** `inform_only` (nudge plan author before approval review).

### BG-10: Retro Not Filed

**Signal:** Week ended but retro document is missing or empty.

**Trigger:** Sweep (weekly cadence check)

**Heuristic:** Week end date passed. No retro document associated, or retro document content is empty/below threshold.

**Entity source:** `/api/weeks/:id`, document associations for retro type

**Why same arch:** Mirror of BG-1 (missing standup) pattern. Same entity fetch, different document type check.

**Model's job:** If pattern persists (multiple weeks without retros), flag as systemic accountability gap.

**Action:** `inform_only` (remind week owner and accountable manager).

### BG-11: Stale Wiki Drift

**Signal:** Wiki document linked to an active project has not been updated while the project shows recent activity.

**Trigger:** Sweep (lower frequency: daily or every 6 hours)

**Heuristic:** Wiki doc `updated_at` older than N days (default 14). Parent project has issues updated within last 7 days.

**Entity source:** `/api/documents` (wiki type, filtered by project association), `/api/projects/:id`

**Why same arch:** Document and association data already available. Heuristic is a timestamp comparison.

**Model's job:** Assess whether the wiki is likely stale (project direction changed, decisions made but not documented) or simply stable (reference doc that doesn't need updates).

**Action:** `inform_only` (nudge document owner).

## Tier 3: Post-Launch (Needs Additional Data or Infra)

These are valid use cases but require capabilities beyond the launch architecture.

### BG-12: Recurring Retro Themes

**Signal:** Same problem surfaces across multiple weekly retros.

**Why deferred:** Requires NLP comparison across multiple retro documents. Heavier LLM usage per sweep. Needs a "theme fingerprint" model that doesn't exist yet.

**Prerequisite:** Retro content indexing or embedding pipeline.

### BG-13: Sprint Velocity Drift

**Signal:** Current sprint pace is below historical completion rate for this team/project.

**Why deferred:** Requires historical completion data aggregation. No velocity tracking exists in Ship today. Needs a new data model (completed issues per week over time).

**Prerequisite:** Velocity calculation service or materialized view.

### BG-14: Cross-Project Person Conflict

**Signal:** Same person allocated >100% across multiple active sprints/projects.

**Why deferred:** Requires aggregation across all projects in workspace. Team allocation page exists but no API endpoint that returns per-person cross-project totals.

**Prerequisite:** `/api/team/allocation-conflicts` endpoint or equivalent aggregation.

### BG-15: Learning Resurfacing

**Signal:** New issue is similar to a past issue that generated a documented learning.

**Why deferred:** Requires semantic similarity between current issue and historical learnings. Needs embeddings infrastructure.

**Prerequisite:** Embedding pipeline (Gemini Embedding 2 or equivalent) + vector similarity search.

## Launch Order Recommendation

**Sprint 1 (launch):** BG-1 through BG-5 (already committed)

**Sprint 1 stretch:** BG-9 (week plan quality) and BG-10 (retro not filed) since they are near-identical patterns to BG-1 and BG-3

**Sprint 2:** BG-6 (capacity overload), BG-7 (ownership gap), BG-8 (dependency cascade)

**Sprint 3:** BG-11 (stale wiki drift)

**Backlog:** BG-12 through BG-15 (need infrastructure work first)

## Cost Implications

Tier 2 use cases add minimal cost because:
- They reuse data already fetched by Tier 1 sweeps
- Heuristics are deterministic (no LLM cost until flagged)
- Responses calls reuse the same instructions and schema shape for better cache utilization

Estimated incremental cost per Tier 2 use case at 100 projects: still low relative to infrastructure spend, because heuristic runs are free and marginal OpenAI calls happen only when new signal types flag candidates that Tier 1 would not have caught.
