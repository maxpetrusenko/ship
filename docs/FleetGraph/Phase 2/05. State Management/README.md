# 5. State Management
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Canonical dedupe and persistence boundaries live in [`../../CANONICAL_RECONCILIATION.md`](../../CANONICAL_RECONCILIATION.md).

Implementation detail, key state types, and persistence sketches live in [`DEEP_DIVE.md`](./DEEP_DIVE.md).

## What State Does The Graph Carry Across A Session?

- Mode
- Actor identity and role
- Current entity IDs
- Fetched resource payloads
- Derived risk signals
- Recommendation list
- Trace metadata

Why:
Everything needed for one graph run should live in graph state so traces are legible and nodes stay pure.

## What State Persists Between Proactive Runs?

- Alert fingerprint
- Last surfaced timestamp
- Snoozed-until timestamp
- Last seen entity digest
- Last action outcome

Why:
Without persistence, proactive mode will repeat itself and annoy users.

## How Do We Avoid Redundant API Calls?

- Request-scope memoization inside one run
- 4-minute digest cache for unchanged entities
- Only load full rich context when heuristics detect something worth reasoning about

Why:
The cheapest token is the one we never send.
