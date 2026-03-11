# Ship Audit Demo Script

Date: 2026-03-09
 
## Goal

Deliver a clear 3 to 5 minute walkthrough that sounds natural out loud and ties every claim to evidence.

## Spoken Script

### 1. Opening

`This project used Ship, a task and project management tool built by the U.S. Department of the Treasury. It was already a solid, production-shaped system when I came in. My job was not to rescue a broken app. My job was to audit a real codebase, understand it deeply, find the highest-value gaps, improve it further across seven categories, and back every claim with before and after evidence.`

Show:

- [`demo-proof-card.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/demo-proof-card.md)
- [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md)
- repo root

### 2. What the system is

`This repository is a pnpm monorepo with a React frontend, Express API, shared types, Playwright tests, PostgreSQL, and Yjs based collaboration. It already had a strong foundation from the beginning: clear package boundaries, meaningful tests, and a coherent document model. The most important architectural idea is that issues, docs, programs, projects, and weeks are all treated as documents under one shared model.`

Show:

- orientation section in [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md)
- architecture docs list

### 3. Biggest frontend win

`The clearest frontend win was bundle size. I moved heavy editor related code behind lazy boundaries, which cut the initial frontend entry payload from about 2.07 megabytes to about 969 kilobytes. That is a reduction of a little over 53 percent.`

Show:

- [`UnifiedEditor.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/UnifiedEditor.tsx)
- [`PersonEditor.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/pages/PersonEditor.tsx)
- bundle before and after numbers in [`final-narrative.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/final-narrative.md)

### 4. Biggest backend win

`The cleanest backend performance improvement was search. I aligned the runtime query shape with trigram indexes, so the indexed expression actually matched the query being executed. That dropped mentions search from 72 milliseconds P95 to 28 milliseconds, and learnings search from 65 milliseconds to 6 milliseconds.`

`For verification, I did not rely on one tool. I used benchmark reruns, EXPLAIN ANALYZE, Playwright plus axe for browser checks, and targeted Vitest regression tests so each claim had a direct proof path.`

Show:

- [`search.ts`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/routes/search.ts)
- [`schema.sql`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/db/schema.sql)
- [`038_search_title_trgm_indexes.sql`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/db/migrations/038_search_title_trgm_indexes.sql)

### 5. Reliability and quality work

`I also worked on reliability and quality alongside speed. I fixed runtime confusion around transient session extension failures, improved crash fallback announcements, repaired stale or weak tests, and pushed on Category 1 type safety by reducing unsafe typing in high-traffic code paths.`

`On the runtime side, I focused on real failure paths in active workflows: session expiry, failed review loads, failed retro loads, and failed standup loads. I replaced misleading empty states with blocking retry states, then locked those fixes in with targeted Vitest regression tests.`

`The type safety work was a clean refactor with typed helpers and route-local types. I verified the result two ways: a syntax-aware AST count and an upstream/master grep recount. Both now clear the target.`

`I also ran the full Playwright suite, which gave me a realistic browser-level picture of the app. The current rerun finished with 862 passing tests, plus a small legacy reliability tail that is documented separately in the verification record.`

Show:

- [`useSessionTimeout.ts`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/hooks/useSessionTimeout.ts)
- [`ErrorBoundary.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/ui/ErrorBoundary.tsx)
- [`Login.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/pages/Login.tsx)
- [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md)

Say:

`At verification time, the web suite was 164 out of 164 passing, the API suite was 454 out of 454 passing, type-check passed, and the web build passed.`

### 6. Accessibility

`For accessibility, I combined automated and manual evidence. The live axe rerun showed zero critical or serious issues on login, issues, team, docs, and programs. I also completed a direct VoiceOver pass in Brave on the core pages, and no issues were observed during that manual run.`

Show:

- Category 7 in [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md)
- [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md)

### 7. Close

`The biggest takeaway from this project is that Ship started from a strong Treasury codebase. The value came from understanding where a good system still had room to improve, then making targeted changes with reproducible proof.`

`If you want to review the full work, the repo fork is here: <GITHUB_FORK_URL>, and the recorded demo is here: <LOOM_URL>.`

## Recording Notes

- keep `docs/submission/demo-proof-card.md` open first
- keep `docs/presearch-codex.md` open
- keep `docs/verification-record.md` open
- keep one terminal tab ready with `cd ShipShape && corepack pnpm demo:proof`
- do not read large code blocks line by line
- use numbers sparingly and only when they support a point

## Link Placeholders

- Fork: `https://github.com/maxpetrusenko/ship`
- Demo: `<LOOM_URL>`
