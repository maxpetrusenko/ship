# 7. Error and Failure Handling
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Implementation detail, retry strategy, and degradation matrix live in [`DEEP_DIVE.md`](./DEEP_DIVE.md).

## If The Ship API Is Down

- Trace the failure
- Retry with bounded backoff
- Avoid spamming end users on the first failure

## How It Degrades Gracefully

- Proactive mode records the miss and waits for recovery
- On-demand mode can show a partial answer with a clear stale-data warning if some context calls succeed

## What Gets Cached And For How Long

- Entity digest and alert dedupe metadata: longer-lived
- Fetched operational context: short-lived
- Action path data: always re-fetch before execution

## Why

Read caching is useful. Write decisions need fresh state.
