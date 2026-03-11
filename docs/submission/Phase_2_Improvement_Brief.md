# ShipShape Phase 2 Improvement Brief

Date: 2026-03-09

This is the CTO-readable Phase 2 brief. The full combined source remains in [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md).

## Executive Summary

Phase 2 focused on the highest-value improvements surfaced by the baseline audit. The work concentrated on seven areas: type safety, bundle size, API latency, database query efficiency, test quality, runtime failure handling, and accessibility. The outcome is not a claim that ShipShape is finished. The outcome is a narrower, more credible statement: the codebase now has better first-load behavior, safer change surfaces, cleaner failure states, stronger audited accessibility, and more trustworthy proof of improvement.

The biggest wins are straightforward. The frontend initial payload was cut materially. Search was re-indexed and benchmarked faster under concurrency. The most misleading runtime failure states were replaced with blocking retry states. The audited accessibility path now clears critical and serious axe findings on five important pages. Test trust improved sharply, but one hard Playwright failure and a small flaky set remain visible and explicitly documented.

## Improvement Scorecard

| Category | Before | After | Value created | Status |
| --- | --- | --- | --- | --- |
| Type safety | `273 any`, `691 as`, `329 !` | `93 any`, `500 as`, `320 !` | Lower unsafe surface in important runtime and test code | Met |
| Bundle size | Entry chunk `587.62 kB` gzip | Entry chunk `262.80 kB` gzip | Better first-load profile | Met |
| API response time | `mentions` P95 `72 ms`; `learnings` P95 `65 ms` at `50c` | `mentions` P95 `28 ms`; `learnings` P95 `6 ms` at `50c` | Faster concurrent search | Met |
| DB query efficiency | Search paths leaned on broader scans | Trigram-backed search path in place | Better scale posture on search | Met |
| Test quality | Web suite had `13` failures | Web suite `164 / 164` passing | Better regression confidence | Met with remaining reliability debt |
| Runtime failure handling | Some failed loads looked like blank or empty editable screens | Blocking retry states now prevent false-empty and false-edit states | Lower user-confusion risk | Met |
| Accessibility | `2` critical and `33` serious axe issues | `0` critical and serious issues on `5` key pages | Stronger compliance and usability posture | Met |

## What Improved Most

| Area | Improvement | Why it matters |
| --- | --- | --- |
| First-load performance | Large editor-heavy code moved off the initial path | Users pay less JavaScript cost up front |
| Search performance | Indexed and normalized the most obvious growth-sensitive queries | Search remains responsive under higher concurrency |
| Runtime UX | Retry-blocking states now stop misleading blank editors and fake empty states | Failures are easier to understand and safer to recover from |
| Accessibility | Landmark, validation, contrast, and fallback announcement fixes landed | Product is more defensible for real users and formal review |
| Engineering safety | Unsafe TypeScript usage was reduced in high-change areas | Lower probability of fragile refactors and weak test scaffolding |

## Before and After Proof

| Topic | Baseline | Improved state | Delta |
| --- | --- | --- | --- |
| Unsafe TypeScript aggregate | `1294` syntax-aware escape hatches | `914` | `-380` |
| Entry payload gzip | `587.62 kB` | `262.80 kB` | about `-55.3%` |
| `mentions` search P95 at `50c` | `72 ms` | `28 ms` | about `-61.1%` |
| `learnings` search P95 at `50c` | `65 ms` | `6 ms` | about `-90.8%` |
| Person search query execution | `2.860 ms` | `1.181 ms` | about `-58.7%` |
| Web tests | `138 / 151` passing | `164 / 164` passing | full green on current web suite |
| Accessibility | `2` critical, `33` serious | `0` critical and serious on audited pages | blocker class removed |

## CTO Read

| CTO question | Answer from this work |
| --- | --- |
| Is the product materially lighter to load? | Yes. The initial entry payload was cut by more than half in gzip terms. |
| Is search more scalable than before? | Yes. The search path now uses trigram indexing and shows strong measured improvement under concurrency. |
| Is the team improving the right things? | Mostly yes. The work hit user-facing load cost, engineering safety, release confidence, and accessibility. |
| Is the team over-claiming quality? | No. Remaining test reliability debt is still called out plainly. |
| Is this now easier to present to stakeholders? | Yes. The gains are measurable and tied to concerns a CTO actually tracks. |

## Category Detail

### 1. Type Safety

| Field | Value |
| --- | --- |
| Primary change | Tightened JSON and Yjs typing, reduced loose route-level `any`, removed broad test casts |
| Best metric | `any` count dropped from `273` to `93` |
| Why it matters | Lower unsafe surface in heavily modified backend and test code |
| Remaining issue | `weeks.ts` still concentrates too much complexity |

### 2. Bundle Size

| Field | Value |
| --- | --- |
| Primary change | Lazy-loaded editor-heavy surfaces and emoji picker |
| Best metric | Entry gzip dropped from `587.62 kB` to `262.80 kB` |
| Why it matters | Better cold-start experience and lower main-thread pressure |
| Remaining issue | More emitted chunks and some mixed import-path complexity remain |

### 3. API Response Time

| Field | Value |
| --- | --- |
| Primary change | Indexed and normalized the heaviest search paths |
| Best metric | `learnings` P95 dropped from `65 ms` to `6 ms` at `50c` |
| Why it matters | Search remains responsive at higher local benchmark concurrency |
| Remaining issue | Evidence is strong for the isolated benchmark dataset, not a production deployment |

### 4. Database Query Efficiency

| Field | Value |
| --- | --- |
| Primary change | Added `pg_trgm` and targeted title-search indexes |
| Best metric | Person search execution improved from `2.860 ms` to `1.181 ms` |
| Why it matters | Better query plan on the path most likely to degrade with scale |
| Remaining issue | Additional indexes increase write and storage cost |

### 5. Test Quality

| Field | Value |
| --- | --- |
| Primary change | Fixed stale web tests and added regressions tied to real breakage |
| Best metric | Web suite moved from `13` failures to `164 / 164` passing |
| Why it matters | Better day-to-day regression trust |
| Remaining issue | Latest packaged Playwright rerun still has `1` hard failure and `6` flaky tests |

### 6. Runtime Failure Handling

| Field | Value |
| --- | --- |
| Primary change | Added retry-blocking states for review, retro, standup, and transient session-extension failures |
| Best metric | Failed loads no longer present as fake empty or editable states |
| Why it matters | Users are less likely to make bad edits or misread failure as success |
| Remaining issue | Coverage still focuses on the highest-risk flows, not every surface |

### 7. Accessibility

| Field | Value |
| --- | --- |
| Primary change | Fixed landmarks, validation wiring, contrast, and crash-fallback announcement behavior |
| Best metric | Critical and serious axe findings cleared on `5` key pages |
| Why it matters | Better compliance posture and better usability on audited paths |
| Remaining issue | Manual screen-reader coverage is still limited to one documented VoiceOver/browser pass |

## Remaining Risks

| Risk | Current state | Why it matters | Next move |
| --- | --- | --- | --- |
| Playwright reliability | `1` hard failure, `6` flaky tests in latest packaged rerun | Release confidence is improved, not fully stable | Fix or quarantine the flaky cluster and close the hard failure |
| Large route files | `weeks.ts`, `team.ts`, `projects.ts` remain oversized | Change cost and bug risk remain high | Split by feature boundary |
| Realtime complexity | `api/src/collaboration/index.ts` remains dense and stateful | Realtime bugs are expensive to debug | Add more direct reconnect and persistence coverage |
| Accessibility breadth | Strong audited path, limited broader AT matrix | Edge regressions can still hide outside the audited pass | Expand manual AT/browser coverage |

## Discoveries Worth Keeping

| Discovery | Meaning | Long-term value |
| --- | --- | --- |
| JSON-to-Yjs fallback works as a live migration path | Older JSON content can upgrade into collaborative state without offline backfill | Safer future format migrations |
| CSRF is correctly conditional by auth mechanism | Browser session flows stay protected without breaking token-based clients | Better security model clarity |
| E2E harness uses per-worker Postgres plus `vite preview` | Stronger isolation without the dev-server memory blowups already observed | Better template for constrained CI or laptop environments |

## AI Leverage and Cost

| Field | Value |
| --- | --- |
| Source | `ShipShape/docs/agent-usage.md` |
| Codex session cost | `7.27785 USD` |
| Codex session tokens | `29,919,370` |
| Codex last-30-day cost | `96.947824 USD` |
| Claude last-30-day snapshot | `0.259821 USD` |
| Human read | AI accelerated inventory and rewrite speed; human verification remained necessary anywhere claims could drift beyond evidence |

## Submission Readiness

| Deliverable | Status | Notes |
| --- | --- | --- |
| Phase 1 baseline audit | Ready | [`Phase_1_Audit.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/Phase_1_Audit.md) |
| Phase 2 improvement brief | Ready | this document |
| Combined source of truth | Ready | [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md) |
| Final narrative | Ready | [`final-narrative.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/final-narrative.md) |
| Verification record | Ready | [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md) |
| Demo | Partial | script exists, recording still manual |
| Public deployment | Partial | deployment path exists, public packaging still manual |
| Social post | Partial | draft exists, publication still manual |

## Primary Evidence

| Evidence | Location |
| --- | --- |
| Full combined source | [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md) |
| Phase 1 baseline audit | [`Phase_1_Audit.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/Phase_1_Audit.md) |
| Final narrative | [`final-narrative.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/final-narrative.md) |
| Verification record | [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md) |
| Full E2E rerun artifact | [`e2e-verification-2026-03-09.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/e2e-verification-2026-03-09.md) |

## Bottom Line

This brief now does what a CTO-facing document should do. It surfaces the measurable wins quickly, keeps the remaining risks visible, and ties the work to real product and engineering outcomes instead of audit mechanics. The story is credible because it shows both improvement and unfinished work.
