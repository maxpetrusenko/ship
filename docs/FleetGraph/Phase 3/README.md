# Phase 3: Stack and Deployment
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Phase 3 turns the design into a deployable system.

Cross-phase cleanup items that override older snippets live in [`../CANONICAL_RECONCILIATION.md`](../CANONICAL_RECONCILIATION.md).
Draft this phase using the canonical workflow in [`../PLANNING_WORKFLOW.md`](../PLANNING_WORKFLOW.md): research unknowns first, convert findings into concrete deployment decisions, then run a writer-style cleanup pass before treating the phase as stable.

## Reading Rule

- Current Ship facts in this phase should cite concrete Ship files, routes, or runtime config.
- Deployment plans, performance budgets, cost controls, and scaling thresholds are proposed FleetGraph design or explicit assumptions until benchmarked.
- Vendor pricing and API behavior stay external-doc-backed; do not read them as current Ship behavior.

## Folders

8. [Deployment Model](./08.%20Deployment%20Model/README.md)
9. [Performance](./09.%20Performance/README.md)
10. [Cost Analysis](./10.%20Cost%20Analysis/README.md)
