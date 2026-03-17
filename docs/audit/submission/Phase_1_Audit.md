# ShipShape Phase 1 Audit

Date: 2026-03-09

This is the readable baseline audit. The full source audit, orientation appendix, and raw narrative remain in [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md).

## Executive Read

The baseline showed a product with strong architectural intent and real engineering depth, but also clear execution debt in safety, bundle weight, regression trust, and accessibility. The most important point is not that the codebase was broken. The point is that several high-value areas were measurable, improvable, and worth prioritizing.

This baseline establishes the "before" picture for seven required categories. It is written for fast review, not for line-by-line forensic replay.

## Baseline Scorecard

| Category | Baseline signal | Business read | Severity |
| --- | --- | --- | --- |
| Type safety | Strict mode enabled, but unsafe escape hatches were still dense in major API files | Future change risk higher than it should be | High |
| Bundle size | Main frontend payload was too heavy for an ideal first load | Slower cold-start and weaker perceived quality | Critical |
| API response time | Local seeded benchmarks were already fast | No immediate latency emergency | Low |
| DB query efficiency | Search and some association-heavy flows were the clearest scale risks | Fine now, likely to degrade first as volume rises | Medium |
| Test quality | Repo-root signal was incomplete, web suite was failing, Playwright reliability had caveats | Weak release confidence | High |
| Runtime edge cases | Core flows worked, but several failures could be misleading or under-signaled | Support risk and user confusion risk | Medium |
| Accessibility | Lighthouse looked decent, axe found serious and critical issues | Compliance and usability gap | High |

## Product and Architecture Context

| Field | Baseline finding |
| --- | --- |
| Repo root | `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape` |
| Package model | Monorepo with `api`, `web`, `shared`, `e2e`, `docs`, `terraform` |
| Core architectural pattern | Unified `documents` model plus `document_associations` |
| Realtime model | WebSocket plus Yjs with persisted `yjs_state` |
| Shared contract layer | `@ship/shared` consumed by both frontend and backend |
| Largest complexity hotspots | `weeks.ts`, `team.ts`, `App.tsx`, `projects.ts`, `collaboration/index.ts` |
| First scale risks | Realtime room state, oversized route files, and frontend entry payload |

## Baseline by Category

### 1. Type Safety

| Field | Baseline |
| --- | --- |
| Compiler posture | `strict` enabled, `noUncheckedIndexedAccess` enabled, `noImplicitReturns` enabled |
| Unsafe `any` count | `273` |
| Type assertions | `691` |
| Non-null assertions | `329` |
| `@ts-ignore` / `@ts-expect-error` | `1` |
| Highest-density file | `api/src/routes/weeks.ts` |
| Human read | Good compiler settings, but too much unsafe escape-hatch usage in important code |

### 2. Bundle Size

| Field | Baseline |
| --- | --- |
| Total production bundle | `4652 KB` |
| Main entry chunk | `2073.74 kB` minified, `587.62 kB` gzip |
| Asset count | `262` emitted files |
| Largest dependency slices in main chunk | `highlight.js`, `emoji-picker-react`, `react-dom` |
| Human read | App loaded too much JavaScript before the user earned it |

### 3. API Response Time

| Field | Baseline |
| --- | --- |
| Dataset used | seeded local data with `20` users, `516` documents, `104` issues, `35` sprints |
| Representative result | all required endpoints stayed very fast on local hardware |
| Slowest measured case | `/api/documents?type=wiki` at `50c` with `P99 = 10 ms` |
| Human read | Raw API latency was not the main problem at this stage |

### 4. Database Query Efficiency

| Field | Baseline |
| --- | --- |
| Strongest signal | Search path was the clearest scan risk |
| Slowest observed query | background Yjs persistence write at `14.795 ms` during list-issues flow capture |
| Measured N+1 issue | none in the audited flows |
| Main structural concern | title search and some JSONB-heavy filters lacked narrower indexing |
| Human read | Query layer was acceptable at baseline volume, but search looked like the first real growth bottleneck |

### 5. Test Coverage and Quality

| Field | Baseline |
| --- | --- |
| Repo-root test reality | `pnpm test` only exercised the API suite |
| API repeated-run result | `451 / 0 / 23` pass/fail/flaky across repeated runs |
| Web suite result | `151` total, `138` passed, `13` failed |
| API coverage | `40.34%` statements |
| Web coverage | `27.64%` statements |
| High-risk low-coverage areas | collaboration, dashboard, team, weekly plans, CAIA auth |
| Human read | Too much verification debt to claim strong release confidence |

### 6. Runtime Edge Cases

| Field | Baseline |
| --- | --- |
| Offline edit and reconnect | passed |
| Concurrent same-document editing | passed |
| 3G-equivalent throttling | passed |
| Console errors during normal usage | `1` observed background `401` |
| Main weakness | some failure states were sparse, coarse, or easy to misread |
| Human read | Core runtime behavior was better than expected, but failure UX was not clean enough |

### 7. Accessibility

| Field | Baseline |
| --- | --- |
| Lighthouse range | `91` to `100` across audited pages |
| axe critical violations | `2` |
| axe serious violations | `33` |
| Main defect cluster | color contrast |
| Keyboard evidence | strong on login, partial elsewhere at baseline |
| Screen-reader evidence | one documented VoiceOver pass |
| Human read | Automated accessibility debt was real despite decent Lighthouse scores |

## Measured Evidence

| Category | Measurement style |
| --- | --- |
| Type safety | `tsc --noEmit` plus syntax-aware AST count |
| Bundle size | production build, asset measurement, treemap, dependency check |
| API response time | authenticated local concurrency benchmarking |
| DB efficiency | query logging plus `EXPLAIN ANALYZE` |
| Test quality | repeated suite runs plus coverage plus Playwright review |
| Runtime edge cases | live browser probes under malformed input, offline/reconnect, and throttled network |
| Accessibility | Lighthouse, axe, keyboard pass, and manual VoiceOver pass |

## What the Baseline Said Clearly

| Theme | Baseline conclusion |
| --- | --- |
| Architecture quality | Strong concepts, especially unified documents and shared contracts |
| Performance posture | API was already reasonably fast; frontend payload was the bigger user-facing problem |
| Safety posture | Strict TypeScript config existed, but unsafe escapes were still too common |
| Reliability posture | Web tests and browser-suite reliability reduced trust in change safety |
| UX resilience | Core flows worked, but some failure states and console behavior needed cleanup |
| Accessibility posture | The product was closer than many internal tools, but not yet defensible enough |

## Priority Order Coming Out of Phase 1

| Priority | Area | Why |
| --- | --- | --- |
| 1 | Bundle size | Largest direct user-facing win |
| 2 | Test quality | Weak release confidence was blocking trust |
| 3 | Accessibility | Critical and serious issues needed visible remediation |
| 4 | Type safety | High-change files had more unsafe escapes than they should |
| 5 | Runtime failure UX | Misleading states create expensive user confusion |
| 6 | Search query efficiency | Strong medium-term scale risk |
| 7 | Raw API latency | Already good enough at local benchmark scale |

## Bottom Line

The baseline was a good engineering starting point, not a finished product. ShipShape already had the bones of a serious system: shared contracts, a unified data model, realtime collaboration, and meaningful test and accessibility intent. What it lacked was sharper execution in the parts a CTO cares about most during scale-up: safe change velocity, first-load cost, release trust, and defensible accessibility posture.
