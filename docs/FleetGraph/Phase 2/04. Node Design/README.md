# 4. Node Design
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Canonical helper ownership and model-selection overrides live in [`../../CANONICAL_RECONCILIATION.md`](../../CANONICAL_RECONCILIATION.md).

Implementation detail and proposed node types live in [`DEEP_DIVE.md`](./DEEP_DIVE.md).

## Planned Nodes

- `trigger_context`
  Determines mode, actor, entity scope, and trace metadata
- `fetch_core_context`
  Loads project, week, issue, role, ownership, and membership context
- `fetch_parallel_signals`
  In parallel, loads issues, scope changes, approvals, recent activity, and mode-appropriate optional signals such as actor-scoped standups
- `heuristic_filter`
  Computes candidate signals without using the model
- `reason_about_risk`
  OpenAI Responses reasoning evaluates relationships, importance, and recommended action
- `branch_decision`
  Routes to `no_issue`, `inform_only`, or `confirm_action`
- `prepare_action`
  Builds a notification or proposed mutation payload
- `human_gate`
  Waits for approve, dismiss, or snooze
- `execute_action`
  Performs approved low-level API call
- `error_fallback`
  Captures degraded outcomes and retry guidance

## Which Fetch Nodes Run In Parallel?

- Issue list
- Week scope changes
- Approval state
- Recent activity and history
- Standup or accountability reads only when the actor or endpoint scope supports them

Why:
The assignment requires parallel fetches when multiple calls are needed. These data sources are independent and fit parallel execution cleanly.

## Where Are The Conditional Edges?

- No candidate signals -> `no_issue`
- Candidate signals but low confidence or low actionability -> `inform_only`
- Candidate signals plus consequential next step -> `confirm_action`
- API failure or missing data -> `error_fallback`

Why:
These are visibly different graph paths and easy to prove in LangSmith traces.
