# ShipShape Phase 2 Parallel Plan

> Working source of truth for the move from Phase 1 audit into Phase 2 implementation.

## Goal

Finish the audit cleanly, then execute measurable improvements across all 7 required categories in parallel without tripping over the same files, benchmarks, or verification gates.

## Current State

- Orientation: effectively complete
- Phase 1 audit: nearly complete
- Main remaining Phase 1 gap: direct screen-reader validation for Category 7
- Main baseline document: `presearch-codex.md`
- Appendix/orientation companion: `audit.md`
- Assignment source: `requirements.md`

## Recommended Execution Model

Use 5 parallel lanes plus one final integration lane.

### Lane 0: Phase 1 Closeout

Purpose: remove the remaining audit caveat before heavy implementation starts.

Scope:
- run direct screen-reader pass on major pages
- update `presearch-codex.md` Category 7 with actual results
- freeze the final Phase 1 baseline state

Owner profile:
- strongest frontend/manual QA person

Primary files:
- `presearch-codex.md`

## Lane 1: Type Safety

Purpose: hit Category 1 with targeted, high-yield fixes in the worst files first.

Scope:
- reduce `any`, `as`, and non-null assertions in highest-density files
- prefer real narrowing, typed helpers, shared contracts, and smaller extracted functions
- avoid cosmetic type churn

Primary files:
- `ShipShape/api/src/routes/weeks.ts`
- `ShipShape/api/src/routes/team.ts`
- `ShipShape/api/src/routes/projects.ts`
- `ShipShape/api/src/routes/issues.ts`
- `ShipShape/api/src/routes/claude.ts`
- `ShipShape/shared/src/`

Success criteria:
- measurable reduction against existing baseline
- tests still pass for touched areas

## Lane 2: Frontend Performance

Purpose: hit Category 2 by shrinking the initial web payload.

Scope:
- split or defer editor-heavy and emoji/highlight payloads
- remove genuinely unused runtime dependencies
- reduce main chunk without removing product behavior

Primary files:
- `ShipShape/web/src/pages/App.tsx`
- `ShipShape/web/src/components/`
- `ShipShape/web/src/lib/`
- `ShipShape/web/vite.config.ts`
- `ShipShape/web/package.json`

Success criteria:
- before/after bundle output
- smaller initial chunk or materially better lazy loading

## Lane 3: Backend Performance

Purpose: hit Categories 3 and 4 together, because API latency and DB efficiency are tightly coupled.

Scope:
- optimize the slowest measured endpoints first
- reduce query count or query cost on one real user flow
- add indexes only where benchmark and query evidence justify them

Primary files:
- `ShipShape/api/src/routes/`
- `ShipShape/api/src/db/schema.sql`
- `ShipShape/api/src/db/migrations/`
- `ShipShape/api/src/db/`
- `ShipShape/api/src/collaboration/index.ts`

Success criteria:
- before/after API latency benchmarks
- before/after `EXPLAIN ANALYZE`
- no regression to behavior or schema safety

## Lane 4: Quality, Runtime, Accessibility

Purpose: hit Categories 5, 6, and 7 with user-visible reliability work.

Scope:
- stabilize flaky tests or add missing critical-path tests
- fix real error-handling gaps with user-facing impact
- remediate critical/serious accessibility findings on key pages

Primary files:
- `ShipShape/web/src/pages/`
- `ShipShape/web/src/components/`
- `ShipShape/web/src/hooks/`
- `ShipShape/e2e/`
- `ShipShape/web/src/lib/`

Success criteria:
- tests added or stabilized with root-cause notes
- runtime failures reproduce before and disappear after
- accessibility evidence updated with before/after scans

## Lane 5: Final Integration

Purpose: prove the work, not just land it.

Scope:
- rerun category measurements under the same conditions
- update documentation with before/after values
- assemble demo/proof artifacts

Primary files:
- `presearch-codex.md`
- final improvement docs
- benchmark and scan artifacts

## Safe Parallel Boundaries

Good split:
- Lane 1 owns type-heavy route refactors
- Lane 2 owns bundle graph and frontend import graph
- Lane 3 owns API and DB query shape
- Lane 4 owns tests, runtime UX, and accessibility

Conflict-prone files:
- `ShipShape/web/src/pages/App.tsx`
- `ShipShape/api/src/routes/weeks.ts`
- `ShipShape/api/src/routes/team.ts`
- `ShipShape/api/src/collaboration/index.ts`

Rule:
- one owner per conflict-prone file at a time
- everyone else stacks work around that owner or waits for a merge point

## Order of Operations

1. Close Lane 0 first or accept the single remaining audit caveat explicitly.
2. Start Lanes 1 to 4 in parallel.
3. Re-measure each category immediately after its fix lands.
4. Run full integration verification at the end.

## Recommended Priority

1. Lane 0
2. Lane 4
3. Lane 3
4. Lane 2
5. Lane 1

Reasoning:
- Lane 4 removes the biggest submission risk after the screen-reader gap
- Lane 3 and Lane 2 produce the clearest measurable before/after proof
- Lane 1 can expand indefinitely, so it needs strict scope control

## Category-to-Lane Map

| Category | Lane | Notes |
| --- | --- | --- |
| 1. Type Safety | Lane 1 | hotspot files first |
| 2. Bundle Size | Lane 2 | main chunk and lazy boundaries |
| 3. API Response Time | Lane 3 | benchmark with same seeded volume |
| 4. DB Query Efficiency | Lane 3 | query count and `EXPLAIN ANALYZE` |
| 5. Test Coverage and Quality | Lane 4 | flaky tests plus missing critical paths |
| 6. Runtime Error Handling | Lane 4 | user-visible failures first |
| 7. Accessibility | Lane 0 then Lane 4 | close audit gap, then remediate |

## Non-Negotiable Gates

- do not lose the original baseline numbers
- do not change benchmark conditions between before and after runs
- do not mix multiple categories into one commit unless unavoidable
- do not claim improvement without rerunning the measurement
- do not let one lane rewrite another lane's proof artifacts

## Exit Criteria

This phase is done when:

- every category has a before and after measurement
- every claimed fix has root-cause explanation
- touched tests pass or known blockers are explicitly documented
- final docs tell a coherent story from baseline to improvement
