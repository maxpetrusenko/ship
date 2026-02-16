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
- Consequences: Team remains in one language ecosystem.
- Revisit Trigger: Need ML-heavy backend services that justify Python.

### D-002
- Date: 2026-02-16
- Status: Accepted
- Decision: Use React + Konva for whiteboard rendering.
- Alternatives Considered: Fabric.js, PixiJS, custom canvas.
- Rationale: Strong ecosystem and fast shipping path.
- Consequences: Must avoid naive full-tree rerenders.
- Revisit Trigger: FPS degradation at 500+ objects.

### D-003
- Date: 2026-02-16
- Status: Accepted
- Decision: Use Firebase stack for auth, realtime collaboration, and hosting.
- Alternatives Considered: Supabase, custom WebSocket infra.
- Rationale: Lowest infrastructure burden for 1-week sprint.
- Consequences: Vendor lock-in accepted for speed.
- Revisit Trigger: Cost or feature constraints beyond sprint scope.

### D-004
- Date: 2026-02-16
- Status: Accepted
- Decision: Presence and cursor data in RTDB; canonical board objects in Firestore.
- Alternatives Considered: Firestore-only, RTDB-only.
- Rationale: Better separation of ephemeral vs persistent state.
- Consequences: Two data systems to maintain.
- Revisit Trigger: Operational complexity outweighs benefit.

### D-005
- Date: 2026-02-16
- Status: Accepted
- Decision: Conflict strategy for MVP is LWW with documented behavior.
- Alternatives Considered: CRDT/OT in sprint scope.
- Rationale: Rubric allows LWW and timeline favors low-risk implementation.
- Consequences: Rare overwrites possible under simultaneous edits.
- Revisit Trigger: Product demands field-level conflict merging.

### D-006
- Date: 2026-02-16
- Status: Accepted
- Decision: AI commands execute server-side via validated tool-call dispatcher.
- Alternatives Considered: Direct client-to-LLM calls.
- Rationale: Better key security and deterministic command execution.
- Consequences: Extra backend logic and monitoring required.
- Revisit Trigger: Need edge/offline AI execution path.

### D-007
- Date: 2026-02-16
- Status: Accepted
- Decision: Every feature requires automated tests; prioritize integration/e2e for collaboration.
- Alternatives Considered: Manual testing only.
- Rationale: Realtime regressions are hard to detect manually.
- Consequences: Slightly slower implementation pace with lower delivery risk.
- Revisit Trigger: None during sprint.

### D-008
- Date: 2026-02-16
- Status: Accepted
- Decision: MVP authentication provider is Firebase Google OAuth.
- Alternatives Considered: Email/password, magic link as primary.
- Rationale: Fastest reliable setup for authenticated collaboration.
- Consequences: Google account required for default MVP flow.
- Revisit Trigger: Target users require broader auth methods.

### D-009
- Date: 2026-02-16
- Status: Accepted
- Decision: Deployment strategy uses one canonical production URL and optional preview URLs.
- Alternatives Considered: Multiple public environment URLs.
- Rationale: Reduces evaluator confusion.
- Consequences: Unfinished changes require feature flags or branch isolation.
- Revisit Trigger: Need parallel external QA environments.

### D-010
- Date: 2026-02-16
- Status: Accepted
- Decision: Error recovery UX must show reconnect/sync status and non-destructive conflict messaging.
- Alternatives Considered: Silent retries.
- Rationale: Realtime failures must be visible during demos.
- Consequences: Additional UX states and copy required.
- Revisit Trigger: If telemetry shows UX noise.

### D-011
- Date: 2026-02-16
- Status: Accepted
- Decision: Adopt explicit `BoardObject` and `CursorPresence` schemas before implementation.
- Alternatives Considered: schema-by-implementation.
- Rationale: Reduces mid-build ambiguity and regression risk.
- Consequences: Up-front schema work before coding features.
- Revisit Trigger: Need backward-compatible schema migration.

### D-012
- Date: 2026-02-16
- Status: Accepted
- Decision: Object writes must include `version`, `updatedAt`, and `updatedBy` with optimistic client updates.
- Alternatives Considered: timestamp-only updates without versions.
- Rationale: Adds traceability and deterministic reconcile behavior for LWW.
- Consequences: Slightly larger payload per write.
- Revisit Trigger: Payload overhead materially impacts performance.

### D-013
- Date: 2026-02-16
- Status: Accepted
- Decision: AI command execution requires idempotency keys (`clientCommandId`) and per-board FIFO ordering.
- Alternatives Considered: best-effort parallel AI execution.
- Rationale: Prevent duplicate writes and non-deterministic outcomes under concurrent commands.
- Consequences: Queue/command-state plumbing required.
- Revisit Trigger: Throughput needs require controlled parallelism.

### D-014
- Date: 2026-02-16
- Status: Accepted
- Decision: Enable Firestore offline persistence and RTDB `onDisconnect()` cleanup for presence.
- Alternatives Considered: online-only behavior.
- Rationale: Rubric explicitly tests disconnect/reconnect recovery.
- Consequences: Must test replay/reconcile paths explicitly.
- Revisit Trigger: Offline cache constraints on target devices.

### D-015
- Date: 2026-02-16
- Status: Accepted
- Decision: Standardize testing stack as Vitest + Firebase Emulator Suite + Playwright multi-context.
- Alternatives Considered: manual browser-only verification.
- Rationale: Fastest credible path to repeatable rubric scenarios.
- Consequences: Initial setup overhead.
- Revisit Trigger: Need broader load-testing harness.

### D-016
- Date: 2026-02-16
- Status: Accepted
- Decision: Decouple high-frequency Konva interaction state from full React rerender loop.
- Alternatives Considered: React state updates for all object movement.
- Rationale: Protect 60 FPS target at higher object counts.
- Consequences: Adds imperative stage-management layer.
- Revisit Trigger: If simpler model meets performance targets in production.

## Change Log
- 2026-02-16: Initial decision set created.
- 2026-02-16: Added auth provider, deployment URL strategy, and error recovery UX decisions.
- 2026-02-16: Added schema contracts, LWW write semantics, AI idempotency/queueing, offline strategy, testing tooling, and Konva performance decision.
