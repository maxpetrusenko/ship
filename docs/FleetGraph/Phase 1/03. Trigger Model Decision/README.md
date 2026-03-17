# 3. Trigger Model Decision
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Chosen Model

Hybrid.

- Event-triggered checks for writes on issues, weeks, standups, and projects
- 4-minute sweep for time-based drift and missed edge cases
- Candidate queue between triggers and graph execution
- Deterministic heuristics before any LLM reasoning

## Why Hybrid Instead Of Poll Only?

- Lower latency after meaningful updates
- Lower cost because not every cycle needs model reasoning
- Easier to justify under the under-5-minute SLA with margin for fetch, reasoning, and delivery

## Why Hybrid Instead Of Webhook Only?

Some key failures are about missing actions, not incoming events.

- Missing standups and stale blockers still need periodic checks

## How Stale Is Too Stale?

- Standup missing: same workday after expected check window
- Blocked issue: more than 24 hours with no progress signal
- Week approval pending: more than 48 hours after request
- Scope creep: immediate once work is added after the saved plan snapshot

Why:
Each threshold maps to a real coordination failure, not just arbitrary activity levels.

## What Does This Choice Cost At 100 Projects And 1,000?

Key assumption:
Every 4-minute sweep is cheap and deterministic unless it flags a candidate. Only flagged candidates invoke the OpenAI reasoning step.

Rough reasoning:

- `100` projects: sweep traffic is fine if batched by workspace and narrowed to active weeks and changed projects
- `1,000` projects: still feasible if we keep read-side checks lightweight, cache entity digests, and avoid LLM calls when nothing changed

The real cost cliff is not polling. The real cost cliff is sending too much unchanged context to the model.
