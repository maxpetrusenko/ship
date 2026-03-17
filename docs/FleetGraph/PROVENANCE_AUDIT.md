# FleetGraph Provenance Audit

Audit date: 2026-03-16

Scope:

- FleetGraph root docs
- all FleetGraph `README.md` and `DEEP_DIVE.md` files
- focus on unsupported claims, weak codebase grounding, and vendor assumptions presented too strongly

## What This Pass Changed

- added a standard provenance block to every FleetGraph README and deep dive
- added canonical provenance rules in `CANONICAL_RECONCILIATION.md`
- marked Phase 2 and Phase 3 as design-heavy planning docs, not current Ship behavior
- softened the strongest overclaims in performance and cost docs
- clarified that the `QualityAssistant.tsx` reference is a UI precedent, not an existing FleetGraph chat surface

## Findings

### Patched overclaims

1. `Phase 3/09. Performance/DEEP_DIVE.md`
   The intro claimed all numbers were grounded in the actual Ship codebase and measured infrastructure characteristics.
   Status: softened. The doc now separates codebase-backed route analysis from proposed performance targets and assumptions.

2. `Phase 3/09. Performance/DEEP_DIVE.md`
   Endpoint latency table included planning numbers that read like measured results.
   Status: softened. The issue-list latency note now reads as a planning estimate rather than an observed benchmark.

3. `README.md`
   The root thesis said the current REST surface already supports a strong proactive MVP without pointing readers back to concrete route evidence.
   Status: softened. The statement now points readers to PRESEARCH route citations.

4. `PRESEARCH.md`
   `QualityAssistant.tsx` was framed too directly as a FleetGraph panel precedent.
   Status: softened. It is now described as an advisory sidebar interaction pattern only.

### External-doc-backed facts that remain explicit assumptions

1. `Presearch/10. Cost Analysis/DEEP_DIVE.md`
   OpenAI and LangSmith pricing tables are vendor snapshots, not stable repo facts.
   Status: labeled. Recheck before final submission if pricing-sensitive claims stay in grader-facing docs.

2. `Phase 3/10. Cost Analysis/README.md`
   Model strategy is canonical here, but monthly totals still depend on assumption-backed usage tiers.
   Status: labeled. Treat cost totals as projections until FleetGraph emits real run telemetry.

3. `Phase 3/09. Performance/DEEP_DIVE.md`
   Connection-pool sizing, memory ceilings, and capacity breakpoints are planning assumptions.
   Status: labeled. Benchmark or instrument before treating them as operational facts.

### Remaining review rule

Use this rule during future edits:

- current Ship behavior needs a concrete Ship path, endpoint, schema, or config reference
- vendor behavior belongs in cost or presearch docs
- FleetGraph architecture and code sketches must be labeled as proposed design
- unlabeled Phase 2 or Phase 3 snippets should be treated as proposed FleetGraph design unless they are explicitly marked as current Ship code

## Second pass: 2026-03-17 (Agent 5)

Scope: FLEETGRAPH.md full rewrite, new doc creation.

### Changes made

1. **FLEETGRAPH.md rewritten** to correct:
   - Missing standup notification now targets manager (sprint owner) first, not developer
   - Chat documented as globally available on every screen with scope label
   - Trigger model corrected to honest sweep + on-demand only (removed hybrid claim)
   - HITL documented as checkpoint-based `interruptBefore` pause/resume (not route-level side execution)
   - Added Global Chat section with scope model (issue > project > sprint > workspace)
   - Added Notification Center section (in-progress status honest)
   - Added use case 7: global chat from any screen
   - Added architecture decisions 14 (manager-first notification) and 15 (checkpoint-based HITL)
   - Added explicit "FleetGraph cannot" list for safety boundary
   - Chat endpoint documented in API section
   - `fleetgraph_approvals` table added to Database Tables section

2. **New files created:**
   - `docs/FleetGraph/trace-links.md`: Template for 4 required traces with seeded state descriptions and placeholder URLs
   - `docs/FleetGraph/professor-checklist.md`: 20+ verification items with demo script

3. **Updated existing docs:**
   - `docs/FleetGraph/COST_TRACKING.md`: Added production cost projection assumptions and note on pending LangSmith data
   - `docs/FleetGraph/PROVENANCE_AUDIT.md`: This entry

### Provenance notes for new content

- Manager-first notification: design decision based on management chain logic; code in `nodes.ts` uses `ownerUserId` from context metadata which maps to `owner_id` on sprints
- Global chat scope model: derived from existing `FleetGraphChatRequest` type which requires `entityType` and `entityId`; workspace fallback is a design intent (UI sends workspace-level context when no entity is in view)
- Notification center: honestly marked as "in progress"; backend infrastructure (alerts, WebSocket) exists, UI bell component is pending
- Trace URLs: all marked `[PENDING]` until real runs with `LANGCHAIN_TRACING_V2=true` are captured
