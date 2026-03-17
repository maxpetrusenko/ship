# 1. Agent Responsibility Scoping
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## What Events In Ship Should The Agent Monitor Proactively?

FleetGraph should monitor:

- Blocked issues that stay blocked too long
- Scope creep after a week has started
- Week plans or reviews waiting too long for approval
- Projects or weeks with missing or conflicting ownership fields
- Concentrated risk clusters where multiple weak signals point to likely drift
- Current-user standup or accountability follow-ups only when the viewed context and token scope make them queryable

Why these:

- The first five are visible workspace-wide through the current Ship REST surface
- They map to real PM and engineering pain
- They are actionable
- They support different user roles without inventing fake workflows
- Workspace-wide missing-standup and inferred-accountability sweeps need additional admin endpoints, so they are stretch rather than core proactive MVP

## What Constitutes A Condition Worth Surfacing?

A condition is worth surfacing when all of these are true:

- It changes a near-term decision
- It has enough evidence from Ship data to explain itself
- It has a clear likely owner
- It is fresh or worsening
- It has not already been surfaced recently or snoozed

Why this threshold:
The agent should be useful, not noisy. "Interesting" is not enough; the output must help someone decide what to do next.

## What Is The Agent Allowed To Do Without Human Approval?

Allowed:

- Generate a risk summary
- Send an in-app notification
- Open a FleetGraph insight card
- Prepare a draft recommendation
- Refresh an existing alert with new evidence

Not allowed without approval:

- Change issue status
- Assign or reassign work
- Request plan or retro changes
- Approve or reject plans or reviews
- Edit project, week, or issue content
- Create consequential records on behalf of a user

Why:
Low-risk surfacing can be autonomous. State mutation needs explicit human accountability.

## What Must Always Require Confirmation?

- Anything that changes ownership
- Anything that changes approval state
- Anything that changes project scope or week scope
- Anything that edits user-authored content
- Anything that could notify a broader audience than the directly responsible owner

Why:
Those actions alter coordination, not just presentation. The user must stay in control.

## How Does The Agent Know Who Is On A Project?

Primary sources:

- Project RACI fields from `/api/projects/:id`
- Week owner and approval metadata from `/api/weeks/:id`
- Issue assignee and status from `/api/issues/:id` and `/api/weeks/:id/issues`
- Program accountable relationships already embedded in project or sprint payloads
- Workspace members from `/api/workspaces/:id/members`

Why this choice:
These are already native Ship concepts. We should lean on existing responsibility fields instead of inventing a second membership model.

## How Does The Agent Know Who To Notify?

Notification policy:

- Issue-level problem: assignee first, then accountable owner if stale
- Week-level drift: week owner first, then accountable manager
- Project-level multi-signal risk: project owner or accountable, then director only on escalation

Escalate when:

- The same issue persists across multiple runs
- The responsible user has not acted after a configured window
- The risk affects multiple people or multiple weeks

Why:
Start narrow. Escalation should be earned, not default.

## How Does The On-Demand Mode Use Context From The Current View?

Context rules:

- Issue view: start from issue ID, assignee, project, linked week, and recent history
- Week view: start from week ID, plan, issues, scope changes, approvals, and any current-user standup context the actor can read
- Project view: start from project ID, owner, accountable, active weeks, unresolved issues

Implementation note:
Ship already has a context-oriented endpoint pattern in `/api/claude/context`, but that route is scoped to standup, review, and retro assistance. FleetGraph should reuse the pattern and add generic issue, week, and project analysis context rather than treating `/api/claude/context` as sufficient as-is.

Why:
The assistant should begin with the page the user is already looking at. That is the product requirement and the fastest path to a useful answer.
