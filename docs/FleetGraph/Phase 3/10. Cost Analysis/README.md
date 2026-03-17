# 10. Cost Analysis
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


This is the canonical docs surface for FleetGraph model-selection policy. Other docs should reference policy roles here instead of hardcoding model IDs.

Implementation detail and instrumentation sketches live in [`DEEP_DIVE.md`](./DEEP_DIVE.md). Pricing tables and volume assumptions belong to [`../../Presearch/10. Cost Analysis/DEEP_DIVE.md`](../../Presearch/10.%20Cost%20Analysis/DEEP_DIVE.md).

## Cost Tracking Model

Track development and production costs separately, using OpenAI direct API pricing as the cost basis.

## Default Model Strategy

Use the configured OpenAI Responses model as the default path. Add a second model tier only if evals prove it is worth the complexity.

## Production Cost Projections

The PRD requires monthly cost estimates at three tiers:

- 100 users
- 1,000 users
- 10,000 users

Include assumptions for: proactive runs per project per day, on-demand invocations per user per day, and average tokens per invocation.

## Development Cost Tracking

Track per the PRD template:

- OpenAI input tokens
- OpenAI output tokens
- Total invocations during development
- Total development spend

## Cost Controls

- Keep proactive runs narrow and structured
- Use deterministic heuristics before LLM reasoning
- Keep instructions and schema shapes stable so repeated Responses calls benefit from cache utilization
- Log token usage per run
- Log run counts by mode
- Estimate monthly cost using proactive volume, on-demand volume, and average token budget
- Surface budget exhaustion as explicit degraded behavior, not as "no issue found"

## Why

The assignment explicitly asks for cost breakdowns. The cleanest defense is disciplined routing plus measurable run telemetry.

## Source Split

- Vendor pricing and model behavior are external-doc-backed snapshots.
- Cost telemetry code, schema, and guardrails are proposed FleetGraph implementation.
- Monthly totals remain assumption-backed until real FleetGraph run data exists.
