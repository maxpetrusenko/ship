# 8. Real Data and Public Deployment
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Run FleetGraph against the existing Ship API and seeded project data in deployed environments, with no mocked graph responses in the main flow.

## Why

The grader wants working software against real Ship state. Fake runs weaken both the traces and the final demo.

## What This Means We Have To Do

- Deploy the graph worker with the backend
- Use queued candidates plus a 4-minute sweep instead of reasoning inline from request handlers
- Create a real service token
- Capture trace links from actual runs

## Deep Dive

- [Phase 3 / 08. Deployment Model](../../Phase%203/08.%20Deployment%20Model/README.md)
- [Phase 3 / 09. Performance](../../Phase%203/09.%20Performance/README.md)
