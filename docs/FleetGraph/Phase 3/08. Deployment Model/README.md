# 8. Deployment Model
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Canonical migration ownership lives in [`../../CANONICAL_RECONCILIATION.md`](../../CANONICAL_RECONCILIATION.md).

## Choice

Keep FleetGraph in the Ship backend codebase as a shared graph module plus a leader-elected worker that consumes queued candidates.

## Why

- Fastest path to deployment in a one-week sprint
- Reuses TypeScript, environment handling, auth, and API knowledge
- Avoids creating a second service that would slow down setup and demos
- Keeps trigger ingestion separate from graph reasoning so request handlers stay lightweight

## Where The Proactive Agent Runs

Alongside the deployed Ship backend in a worker module that owns the candidate queue and the 4-minute sweep.

## How It Is Kept Alive

Managed as a backend worker process, not a browser session.

## How It Authenticates

Dedicated Ship API token created through the existing `/api/api-tokens` flow.

## Why This Auth Path

The repo already supports bearer-token auth. That is the cleanest way to run without a user session and still keep auditability.

The proactive MVP stays limited to endpoints this token can use for workspace-wide evaluation today. Cross-user standup and inferred-accountability sweeps stay stretch until Ship adds the missing admin reads documented in Presearch 06.
