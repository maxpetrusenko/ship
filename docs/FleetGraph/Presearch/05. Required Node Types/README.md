# 5. Required Node Types
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Design the graph around these node families:

- Context nodes
- Fetch nodes
- Reasoning nodes
- Conditional edges
- Action nodes
- Human-in-the-loop gates
- Error and fallback nodes

## Why

These are directly required by the assignment. We should mirror the rubric in the code structure and the trace tree.

## What This Means We Have To Do

- Make node names explicit and visible in traces
- Separate deterministic data collection from model reasoning
- Branch visibly between `no_issue`, `inform_only`, and `confirm_action` paths

## Deep Dive

- [Phase 2 / 04. Node Design](../../Phase%202/04.%20Node%20Design/README.md)
- [Phase 2 / 07. Error and Failure Handling](../../Phase%202/07.%20Error%20and%20Failure%20Handling/README.md)
