# 3. Context-Aware Embedded Chat
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Embed FleetGraph in existing Ship views as a right-side assistant panel or contextual modal, starting with:

- Issue view
- Week view
- Project view

## Why

The assignment rejects a standalone chatbot. Ship is already organized around context-rich pages, so embedding the assistant where the user already is will feel like a power feature instead of a separate product.

## What This Means We Have To Do

- Add a FleetGraph entry point in the existing UI
- Pass the current entity ID and type into the graph
- Preload context before the first token so the agent does not ask basic discovery questions the UI already knows
- Extend beyond the current `/api/claude/context` interview helper so issue, week, and project pages support general analysis and action requests

## Deep Dive

- [Phase 1 / 01. Agent Responsibility Scoping](../../Phase%201/01.%20Agent%20Responsibility%20Scoping/README.md)
