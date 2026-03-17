# 6. Ship REST API Data Source
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

FleetGraph reads Ship through HTTP endpoints only, even when running inside the same repo.

## Why

The assignment forbids direct database reads as the graph data source. Using the REST API also keeps the graph closer to production reality and catches permission issues earlier.

## What This Means We Have To Do

- Fetch data through `/api/...` endpoints
- Use a service API token instead of DB credentials
- Treat internal persistence separately from read-side project data
- Keep the proactive MVP inside endpoints that can be evaluated workspace-wide from that token today
- Treat workspace-wide standup coverage and inferred accountability as follow-on work until Ship adds the missing admin reads

## Deep Dive

- [Phase 1 / 01. Agent Responsibility Scoping](../../Phase%201/01.%20Agent%20Responsibility%20Scoping/README.md)
- [Phase 3 / 08. Deployment Model](../../Phase%203/08.%20Deployment%20Model/README.md)
