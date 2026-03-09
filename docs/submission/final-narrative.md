# ShipShape Final Narrative

Date: 2026-03-09

Status:
- integrated
- machine-verifiable sections complete
- direct screen-reader notes integrated

## One-Paragraph Summary

This submission inherited an unfamiliar TypeScript monorepo, built a concrete architecture model first, measured all 7 required categories with reproducible commands, then shipped targeted improvements with before/after proof in bundle size, API latency, query efficiency, test quality, runtime resilience, and automated accessibility. The strongest hard evidence is in the performance lanes: the initial web entry chunk dropped from `2073.74 kB` to `968.95 kB`, search endpoint P95 dropped from `72 ms` to `28 ms` and `65 ms` to `6 ms`, and the slowest measured search query dropped from `2.860 ms` to `1.181 ms`. Phase 1 baseline coverage is complete. The main remaining technical weakness is that Category 1 improved, but did not reach the rubric target.

## What Changed By Category

### 1. Type Safety

Before:
- `270 any`
- `1504 as`
- `1257 !`

After:
- `266 any`
- `1498 as`
- `1256 !`

Narrative:
- tightened auth/search narrowing in backend routes
- removed some unsound placeholders and assertions
- real improvement, but below rubric target

Status:
- improvement documented
- target not met

### 2. Bundle Size

Before:
- total bundle `4652 KB`
- main entry chunk `2073.74 kB`

After:
- total bundle `4656 KB`
- main entry chunk `968.95 kB`
- editor and emoji code moved behind lazy boundaries

Narrative:
- main user-facing win on frontend
- total emitted assets barely changed, but initial payload dropped sharply

Status:
- target met

### 3. API Response Time

Before:
- `mentions` P95 `72 ms`
- `learnings` P95 `65 ms`

After:
- `mentions` P95 `28 ms`
- `learnings` P95 `6 ms`

Narrative:
- normalized title search predicates
- added trigram indexes aligned to runtime query shape

Status:
- target met

### 4. Database Query Efficiency

Before:
- slowest measured query `2.860 ms`

After:
- same query `1.181 ms`

Narrative:
- search path now uses purpose-built trigram index access instead of broader active-doc scan behavior

Status:
- target met

### 5. Test Coverage And Quality

Before:
- web under coverage: `151 total`, `138 passed`, `13 failed`
- API had flaky `1 of 3` local run behavior

After:
- web: `155 / 155` passing
- API: `451 / 451` passing on latest verification run

Narrative:
- repaired stale web tests
- added regression coverage for session extension, details node behavior, and deep-link tab contracts

Status:
- target met

### 6. Runtime Error And Edge Case Handling

Implemented:
- session extension no longer forces immediate confusing logout on transient failure
- weekly review load failure now blocks editing and shows an explicit retry state
- project retrospective load failure now blocks editing and shows an explicit retry state
- standup feed load failure now blocks the false empty-state path and shows an explicit retry state

Repro and proof:
- transient session extension path:
  - trigger the inactivity warning
  - fail `/api/auth/extend-session`
  - expected after behavior: warning remains visible and the user can retry instead of being forced out
  - regression proof: `web/src/hooks/useSessionTimeout.test.ts`
- weekly review load failure:
  - fail `GET /api/weeks/:id/review`
  - expected after behavior: blocking `Retry` alert, no editable blank review shell
- project retro load failure:
  - fail `GET /api/projects/:id/retro`
  - expected after behavior: blocking `Retry` alert, no misleading empty retrospective draft
- standup feed load failure:
  - fail `GET /api/weeks/:id/standups`
  - expected after behavior: blocking `Retry` alert, no false `No standup updates yet` message
- screenshot artifact:
  - `docs/runtime-load-error-preview.png`
- runtime regression suite:
  - `corepack pnpm --filter @ship/web exec vitest run src/components/RuntimeLoadErrorStates.test.tsx`
- broader rerun evidence:
  - `corepack pnpm --filter @ship/web test`
  - `corepack pnpm build:web`

Status:
- documented
- target met; malformed-input matrix now explicitly covers empty forms, long text, special characters, and HTML/script injection on representative flows

### 7. Accessibility

Current after state:
- headless axe rerun shows `0` critical/serious on `/login`, `/issues`, `/team`, `/docs`, and `/programs`

Narrative:
- login surface landmark issue was fixed
- login validation alerts are now field-specific and announced against the correct input
- default crash fallback UI is now announced with alert semantics
- automated accessibility moved materially in the right direction
- direct VoiceOver pass in Brave was completed on `2026-03-09` across the core pages, with no issues observed
- the manual pass is recorded page-by-page in `docs/presearch-codex.md` and `docs/verification-record.md`

Status:
- automated target met
- direct screen-reader evidence now recorded in `docs/presearch-codex.md`

## Best Before And After Proof

Strongest measurable wins:
- frontend initial entry chunk: `2073.74 kB -> 968.95 kB`
- `mentions` search P95: `72 ms -> 28 ms`
- `learnings` search P95: `65 ms -> 6 ms`
- slowest measured person-search query: `2.860 ms -> 1.181 ms`
- web coverage run: `138 / 151 -> 155 / 155`

Most important caveats:
- Category 1 baseline requirement was met, but the improvement did not hit the `25%` reduction target
- direct screen-reader validation was completed and documented in one VoiceOver browser session; broader combinations were not rerun
- public deploy, recorded demo, and social publication are still manual

## Final Verification

Recorded in:
- `docs/verification-record.md`

Latest gate:
- `corepack pnpm type-check` -> pass
- `corepack pnpm test` -> `451 / 451` pass
- `corepack pnpm --filter @ship/web test` -> `164 / 164` pass
- `corepack pnpm build:web` -> pass

## Final Framing For Demo Or Submission

Use this framing:

`The strongest result was not one isolated fix. It was moving an unfamiliar production monorepo from assumptions to evidence: orientation first, baseline measurement second, targeted improvements third, and explicit honesty about the remaining gaps.`

## Close Checklist

Before this doc can be treated as final-final submission copy:
- sync any future screen-reader findings into `docs/presearch-codex.md`
- confirm deployed URL and fork/branch names
