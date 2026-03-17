# ShipShape Parallel Task Board

Status legend: `ready` `blocked` `in-progress` `done`

## Lane 0: Phase 1 Closeout

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L0-1 | done | Run direct screen-reader pass on `/login`, `/my-week`, `/docs`, `/projects`, `/team` | Max/manual | app booted locally | notes + findings |
| L0-2 | done | Patch Category 7 in `presearch-codex.md` with direct screen-reader results | Codex | L0-1 | updated audit |
| L0-3 | done | Freeze the final Phase 1 audit baseline and mark remaining caveats, if any | Codex | L0-2 | baseline locked |

## Lane 1: Type Safety

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L1-1 | done | Reconfirm top 5 type-safety hotspot files from the baseline | Codex | none | hotspot list |
| L1-2 | done | Pick 2 hotspot files for the first reduction pass | Codex | L1-1 | scoped fix set |
| L1-3 | done | Replace unsafe narrowing in hotspot file 1 with typed helpers or guards | Codex | L1-2 | code + before/after counts |
| L1-4 | done | Replace unsafe narrowing in hotspot file 2 with typed helpers or guards | Codex | L1-2 | code + before/after counts |
| L1-5 | blocked | Expand beyond 2 files only if category target still not met |  | L1-3, L1-4 | optional second pass |

## Lane 2: Frontend Performance

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L2-1 | done | Re-run bundle build and preserve the exact before artifact paths | Codex | none | frozen before state |
| L2-2 | done | Isolate main chunk contributors: editor, highlight, emoji, upload, heavy routes | Codex | L2-1 | ranked import graph |
| L2-3 | done | Implement first chunk-splitting or deferred-loading pass | Codex | L2-2 | code + new build |
| L2-4 | done | Remove or justify unused runtime dependencies from baseline | Codex | L2-2 | dependency cleanup |
| L2-5 | done | Re-measure bundle size and compare to target | Codex | L2-3, L2-4 | before/after bundle proof |

## Lane 3: Backend Performance

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L3-1 | done | Freeze current API benchmark scripts and seeded-volume assumptions | Codex | none | benchmark contract |
| L3-2 | done | Choose 2 endpoints and 1 user flow to optimize first | Codex | L3-1 | scoped perf targets |
| L3-3 | done | Optimize the slowest API path without changing benchmark conditions | Codex | L3-2 | before/after latency |
| L3-4 | done | Optimize the highest-value DB query or flow with `EXPLAIN ANALYZE` proof | Codex | L3-2 | before/after query proof |
| L3-5 | done | Re-run endpoint and DB measurements under identical conditions | Codex | L3-3, L3-4 | final perf evidence |

## Lane 4: Quality, Runtime, Accessibility

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L4-1 | done | Reproduce the flaky test set and choose fix-vs-replace strategy | Codex | none | root-cause note |
| L4-2 | done | Add or repair tests for 3 critical-path gaps with risk comments | Codex | L4-1 | test coverage improvement |
| L4-3 | done | Fix 3 runtime/error-handling gaps with repro steps and screenshots | Codex | none | runtime before/after proof |
| L4-4 | done | Fix critical/serious accessibility issues on the 3 most important pages | Codex | L0-2 | axe/lighthouse before/after |
| L4-5 | done | Rerun quality, runtime, and accessibility checks | Codex | L4-2, L4-3, L4-4 | final evidence pack |

## Lane 5: Final Integration

| ID | Status | Task | Owner | Depends On | Deliverable |
| --- | --- | --- | --- | --- | --- |
| L5-1 | done | Merge the category results into one final before/after narrative | Codex | L1-4, L2-5, L3-5, L4-5 | final writeup |
| L5-2 | done | Run end-to-end verification for touched areas | Codex | L5-1 | verification record |
| L5-3 | done | Assemble demo, artifact links, and submission checklist | Codex | L5-2 | submission pack |

## Current Claims

- all planned lanes are complete and reflected in `docs/presearch-codex.md`
- direct VoiceOver findings are now folded into Category 7
- final verification output is captured in `docs/verification-record.md`
- submission packaging artifacts now exist locally: checklist, blockers, demo script, social draft, runtime screenshot, final narrative, submission pack

## Suggested Owner Split

| Owner | Lane Focus | Notes |
| --- | --- | --- |
| Owner A | Lane 0 + Lane 4 accessibility/runtime | frontend and UX-heavy |
| Owner B | Lane 2 | web performance and build graph |
| Owner C | Lane 3 | API and DB performance |
| Owner D | Lane 1 | type-safety reductions in route hotspots |
| Owner E | Lane 4 tests | flaky tests and critical path coverage |

## File Conflict Watchlist

| File | Risk | Rule |
| --- | --- | --- |
| `ShipShape/web/src/pages/App.tsx` | Lane 2 and Lane 4 overlap | one active owner only |
| `ShipShape/api/src/routes/weeks.ts` | Lane 1 and Lane 3 overlap | performance changes win first |
| `ShipShape/api/src/routes/team.ts` | Lane 1 and Lane 3 overlap | assign a single owner |
| `ShipShape/api/src/collaboration/index.ts` | Lane 3 and Lane 4 overlap | do not parallel-edit |

## Daily Sync Questions

Answer these once per work block:

1. Which task IDs moved today?
2. Which before/after measurements are now frozen?
3. Which files are conflict-prone right now?
4. Which category still lacks proof?
