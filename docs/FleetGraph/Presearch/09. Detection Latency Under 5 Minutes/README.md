# 9. Detection Latency Under 5 Minutes
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Use a hybrid trigger model:

- Immediate event-triggered checks on write events
- A 4-minute sweep for time-based drift and missed events
- A candidate queue between triggers and graph execution
- LLM reasoning only after deterministic heuristics identify a candidate signal

## Why

- Webhook-only is incomplete because some failures are absence-of-activity problems
- Poll-only adds latency and unnecessary model cost
- Hybrid meets the SLA while keeping OpenAI usage selective

## What This Means We Have To Do

- Add cheap heuristics before the reasoning node
- Create a candidate queue for proactive checks
- Dedupe repeated alerts so the sweep does not spam users

## Deep Dive

- [Phase 1 / 03. Trigger Model Decision](../../Phase%201/03.%20Trigger%20Model%20Decision/README.md)
- [Phase 3 / 09. Performance](../../Phase%203/09.%20Performance/README.md)
