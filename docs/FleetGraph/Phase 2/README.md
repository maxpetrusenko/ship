# Phase 2: Graph Architecture
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Phase 2 defines the execution graph and its safety model.

Cross-phase cleanup items that override older snippets live in [`../CANONICAL_RECONCILIATION.md`](../CANONICAL_RECONCILIATION.md).
Draft this phase using the canonical workflow in [`../PLANNING_WORKFLOW.md`](../PLANNING_WORKFLOW.md): one coherent solution-design pass first, then split the result into the four docs below. After drafting, run an advanced-elicitation pass before treating the phase as stable.

## Reading Rule

- Current Ship facts in this phase should cite specific Ship paths or endpoints.
- The graph topology, state shapes, approval mechanics, and error flows in this phase are proposed FleetGraph design until implemented.
- Each folder README is a decision summary. Mechanics, key types, and code sketches live in that folder's `DEEP_DIVE.md`.

## Folders

4. [Node Design](./04.%20Node%20Design/README.md)
5. [State Management](./05.%20State%20Management/README.md)
6. [Human-in-the-Loop Design](./06.%20Human-in-the-Loop%20Design/README.md)
7. [Error and Failure Handling](./07.%20Error%20and%20Failure%20Handling/README.md)
