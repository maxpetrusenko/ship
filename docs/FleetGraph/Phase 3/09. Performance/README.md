# 9. Performance
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## How The Trigger Model Meets The Under-5-Minute Goal

- Write events trigger immediate checks
- Time-based sweep runs every 4 minutes
- Heuristics narrow model invocations to likely-problem cases
- Both proactive and on-demand requests still run through the same graph; only the trigger and presentation path differ

## Token Budget Per Invocation

- Proactive candidate run: keep input narrow and output short
- On-demand run: allow more context, but still summarize early and avoid dumping whole documents unless needed

## Where The Cost Cliffs Are

- Sending full document bodies by default
- Re-analyzing unchanged entities
- Invoking OpenAI reasoning for every sweep candidate instead of only high-signal ones
- Long conversational context in on-demand chat

## Why

Cost grows from bad context discipline more than from the graph framework itself.

## Source Split

- Current Ship facts belong to concrete route, query, and runtime config references in [`DEEP_DIVE.md`](./DEEP_DIVE.md).
- Latency targets, P99 ceilings, and capacity breakpoints are proposed FleetGraph budgets until benchmarked.
