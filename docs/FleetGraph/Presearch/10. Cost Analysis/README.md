# 10. Cost Analysis
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Track development and production costs separately. Use the OpenAI SDK via the Responses API as the single provider path. Keep proactive runs narrow and structured.

## Why

The assignment explicitly asks for cost breakdowns. Cost is easier to defend when the LLM is used for reasoning only after deterministic filtering.

## What This Means We Have To Do

- Log token usage per run (input and output tokens separately)
- Log run counts by mode
- Estimate monthly cost at 100, 1,000, and 10,000 users using proactive volume, on-demand volume, and average token budget
- Track development costs: total invocations, total token spend, total development spend
- Use OpenAI direct API pricing as the cost basis

## Deep Dive

- [Phase 3 / 10. Cost Analysis](../../Phase%203/10.%20Cost%20Analysis/README.md)
