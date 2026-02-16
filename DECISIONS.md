# DECISIONS.md

Date initialized: 2026-02-16
Purpose: log system decisions, alternatives, rationale, and change history.

## Decision Template
- ID:
- Date:
- Status: Proposed | Accepted | Superseded
- Decision:
- Alternatives Considered:
- Rationale:
- Consequences:
- Revisit Trigger:

## Active Decisions

### D-001
- Date: 2026-02-16
- Status: Accepted
- Decision: Use TypeScript across frontend and server functions.
- Alternatives Considered: Mixed stack (Python backend, TS frontend).
- Rationale: Fastest team velocity, shared types, easier refactors under deadline.
- Consequences: Team remains in one language ecosystem; faster onboarding.
- Revisit Trigger: Need ML-heavy server pipelines that justify Python services.

### D-002
- Date: 2026-02-16
- Status: Accepted
- Decision: Use React + Konva for whiteboard rendering.
- Alternatives Considered: Fabric.js, PixiJS, custom canvas.
- Rationale: Strong ecosystem, predictable component model, fast shipping.
- Consequences: Must manage canvas state carefully to avoid re-render bottlenecks.
- Revisit Trigger: FPS degradation at 500+ objects.

### D-003
- Date: 2026-02-16
- Status: Accepted
- Decision: Use Firebase stack for auth, realtime collaboration, and hosting.
- Alternatives Considered: Supabase, custom WebSocket infra.
- Rationale: Lowest infrastructure burden for 1-week sprint.
- Consequences: Vendor lock-in tradeoff accepted for delivery speed.
- Revisit Trigger: Cost or feature constraints beyond sprint scope.

### D-004
- Date: 2026-02-16
- Status: Accepted
- Decision: Presence + cursor data in RTDB; canonical board objects in Firestore.
- Alternatives Considered: Firestore-only, RTDB-only.
- Rationale: RTDB is efficient for volatile presence; Firestore better for persistent objects.
- Consequences: Two data systems to manage, but clearer separation of concerns.
- Revisit Trigger: Ops/debug complexity outweighs performance benefit.

### D-005
- Date: 2026-02-16
- Status: Accepted
- Decision: Conflict strategy for MVP is Last-Write-Wins with documented behavior.
- Alternatives Considered: CRDT/OT in sprint scope.
- Rationale: Rubric permits LWW; significantly lower implementation risk.
- Consequences: Rare edit overwrites under concurrent edits are possible.
- Revisit Trigger: Product requires fine-grained merge semantics.

### D-006
- Date: 2026-02-16
- Status: Accepted
- Decision: AI commands execute server-side via validated tool-call dispatcher.
- Alternatives Considered: Direct client-to-LLM calls.
- Rationale: Better key security, consistent command validation, shared deterministic writes.
- Consequences: Extra server function path and logging needed.
- Revisit Trigger: Need offline/edge inference path.

### D-007
- Date: 2026-02-16
- Status: Accepted
- Decision: Test every feature with at least one automated check; prioritize integration/e2e for collaboration paths.
- Alternatives Considered: Manual testing only.
- Rationale: Realtime bugs are regression-prone; test guardrails are mandatory.
- Consequences: Slightly slower implementation pace but much lower risk.
- Revisit Trigger: None during sprint.

## Change Log
- 2026-02-16: Initial decision set created from Pre-Search and sprint constraints.
