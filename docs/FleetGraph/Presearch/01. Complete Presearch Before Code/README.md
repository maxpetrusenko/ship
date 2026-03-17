# 1. Complete Presearch Before Code
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Write FleetGraph presearch first, keep the agent responsibility narrow enough to ship in one sprint, and turn each assignment requirement into a concrete decision before implementation.

## Why

The assignment grades design quality, not just code volume. A narrow, defensible agent will score better than a vague "AI assistant for everything."

## What This Means We Have To Do

- Finish presearch before implementation
- Create `FLEETGRAPH.md` early, not at the end
- Keep architecture decisions tied to actual Ship APIs and UI surfaces

## Deep Dive

- [Deep Dive Research](./DEEP_DIVE.md)
- [Phase 1](../../Phase%201/README.md)
- [Phase 2](../../Phase%202/README.md)
- [Phase 3](../../Phase%203/README.md)
