# 2. Proactive and On-Demand Modes
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Use one shared graph with two entry triggers:

- Proactive trigger: background event plus scheduled sweep
- On-demand trigger: user opens FleetGraph from issue, week, or project context

## Why

The PRD is explicit that the graph changes by trigger, not by architecture. A single graph keeps behavior consistent, reduces duplicated logic, and makes traces easier to compare.

## What This Means We Have To Do

- Define one graph state shape
- Pass mode, actor, and context into the same graph
- Make LangSmith traces clearly show different branches for push versus pull runs

## Deep Dive

- [Background Use Cases Deep Dive](./DEEP_DIVE.md) (15 use cases across 3 tiers, all sharing one pipeline)
- [Phase 1 / 03. Trigger Model Decision](../../Phase%201/03.%20Trigger%20Model%20Decision/README.md)
- [Phase 2 / 05. State Management](../../Phase%202/05.%20State%20Management/README.md)
