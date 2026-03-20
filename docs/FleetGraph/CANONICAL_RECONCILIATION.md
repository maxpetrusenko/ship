# FleetGraph Canonical Reconciliation
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Use this file as the cross-document source of truth when FleetGraph docs disagree.

## 1. Grader-facing source priority

1. `requirements.md`
2. `FleetGraph_PRD.pdf`
3. Deep dives and phase summaries in this folder

`requirements.md` controls grader expectations. The PDF is supplemental context only. Any SDK, deliverable, or tracing decision that affects submission should be verified against `requirements.md` first.

## 2. Canonical persistence and migration plan

Ship-managed numbered migrations cover only FleetGraph product tables:

- `039_fleetgraph_alert_state.sql`
- `040_fleetgraph_approvals.sql`
- `041_fleetgraph_audit_log.sql`

LangGraph checkpoint tables are a separate concern:

- create the `fleetgraph` schema in app startup if needed
- initialize `PostgresSaver` with `schema: "fleetgraph"`
- call `checkpointer.setup()`
- let LangGraph manage `fleetgraph.checkpoints`, `fleetgraph.checkpoint_writes`, and version-specific auxiliary tables such as `fleetgraph.checkpoint_blobs`

Treat any doc that proposes `fleetgraph_alerts`, a single combined approval migration, or a manual `041_langgraph_checkpoints.sql` file as superseded.

## 3. Canonical dedupe architecture

Deduplication has two layers with distinct jobs:

- Persistent correctness layer: `fleetgraph_alert_state`
- Runtime acceleration layer: in-memory fingerprint and digest caches

Rules:

- restart correctness depends on `fleetgraph_alert_state`, not on in-memory maps
- runtime caches may preload from persistent rows
- runtime caches may improve latency and reduce repeated reads
- runtime caches do not redefine alert lifecycle semantics

## 4. Canonical proactive scope and cadence

Core proactive MVP includes:

- stale or blocked issue drift
- post-start scope drift
- approval bottlenecks and change-request churn
- ownership gaps and multi-signal project drift

Stretch only until new admin endpoints exist:

- workspace-wide standup coverage
- cross-user inferred accountability

Trigger cadence:

- event-triggered candidates enqueue immediately
- fallback sweep runs every 4 minutes and rolls active sprint state up through issue and linked project stages
- request handlers do not run graph reasoning inline

## 5. Canonical approval lifecycle

Approval row states are:

- `pending`
- `approved`
- `dismissed`
- `snoozed`
- `executed`
- `execution_failed`
- `expired`

Rules:

- expiry window is 72 hours
- snooze expiry returns the fingerprint to eligibility; it does not mutate history into a fake terminal state
- any doc that uses `rejected` as the canonical approval row state is superseded

## 6. Canonical shared helper ownership

`withErrorHandling` has one canonical home:

- code: `api/src/fleetgraph/nodes/error-fallback.ts`
- design source: `Phase 2/07. Error and Failure Handling`

Other docs may show usage examples. They should reference the shared helper, not redefine it as a second source of truth.

## 7. Canonical model-selection policy

Model IDs and pricing belong to one policy surface:

- docs source: `Phase 3/10. Cost Analysis`
- code target: a single config/helper such as `api/src/fleetgraph/config/model-policy.ts`

Other docs should refer to named policy roles, for example:

- `reasoning_primary`
- `reasoning_fallback`
- `conversation_summary`
- `chat_streaming`

Hardcoded model IDs outside the cost/config surface are illustrative only and should be treated as stale during implementation review.

Default rollout rule:

- start with one configured OpenAI Responses model bound to all policy roles
- introduce cheaper or fallback role overrides only through the shared policy helper
- treat tiered routing as an eval-backed optimization, not a day-one requirement

## 8. Canonical error terminal node name

The terminal error node name is:

- `error_fallback`

Treat `fallback_and_error` as a stale alias in planning docs, traces, and test names.

## 9. Canonical provenance rules

Evidence ranking for FleetGraph docs is:

1. `requirements.md`
2. current Ship codebase facts with concrete file paths or route references
3. external vendor docs for pricing or API behavior
4. proposed FleetGraph design and explicit assumptions

Rules:

- if `requirements.md` and a deeper design doc disagree, `requirements.md` wins
- any claim presented as current Ship behavior should cite a concrete Ship file path, route, or schema
- vendor pricing, model pricing, cache discounts, and API behavior belong in presearch or cost docs, not general architecture prose
- Phase 2 and Phase 3 docs must label snippets as either `Current Ship code` or `Proposed FleetGraph sketch`; the file-level provenance block may serve as the default label when a snippet is not tagged inline
- unlabeled speculative code snippets are not canonical and should be treated as stale during review
- latency budgets, scale breakpoints, memory ceilings, and cost projections are assumptions until benchmarked or observed in this repo
