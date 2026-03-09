# Ship Audit Demo Script

Date: 2026-03-09

## Goal

Deliver a clear 3 to 5 minute walkthrough that sounds natural out loud and ties every claim to evidence.

## Spoken Script

### 1. Opening

`For this project, the goal was not to build a new feature first. The goal was to inherit a real TypeScript monorepo, understand how it works, measure its health across seven categories, improve it, and prove the improvements with before and after evidence.`

Show:

- [`docs/presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/presearch-codex.md)
- repo root

### 2. What the system is

`This repository is a pnpm monorepo with a React frontend, Express API, shared types, Playwright tests, PostgreSQL, and Yjs based collaboration. The most important architectural idea is that everything is treated as a document, so issues, docs, programs, projects, and weeks all share the same underlying model.`

Show:

- orientation section in [`docs/presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/presearch-codex.md)
- architecture docs list

### 3. Biggest frontend win

`The clearest frontend win was bundle size. I moved heavy editor related code behind lazy boundaries, which cut the initial frontend entry payload from about 2.07 megabytes to about 969 kilobytes. That is a reduction of a little over 53 percent.`

Show:

- [`UnifiedEditor.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/UnifiedEditor.tsx)
- [`PersonEditor.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/pages/PersonEditor.tsx)
- bundle before and after numbers in [`docs/final-narrative.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/final-narrative.md)

### 4. Biggest backend win

`The cleanest backend performance improvement was search. I aligned the runtime query shape with trigram indexes, so the indexed expression actually matched the query being executed. That dropped mentions search from 72 milliseconds P95 to 28 milliseconds, and learnings search from 65 milliseconds to 6 milliseconds.`

Show:

- [`search.ts`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/routes/search.ts)
- [`schema.sql`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/db/schema.sql)
- [`038_search_title_trgm_indexes.sql`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/db/migrations/038_search_title_trgm_indexes.sql)

### 5. Reliability and quality work

`I also worked on reliability, not just speed. I fixed runtime confusion around transient session extension failures, improved crash fallback announcements, repaired stale or weak tests, and added focused regression coverage around presence colors, error boundaries, and login validation.`

Show:

- [`useSessionTimeout.ts`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/hooks/useSessionTimeout.ts)
- [`ErrorBoundary.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/ui/ErrorBoundary.tsx)
- [`Login.tsx`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/pages/Login.tsx)
- [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/verification-record.md)

Say:

`At verification time, the web suite was 164 out of 164 passing, the API suite was 451 out of 451 passing, type-check passed, and the web build passed.`

### 6. Accessibility

`For accessibility, I combined automated and manual evidence. The live axe rerun showed zero critical or serious issues on login, issues, team, docs, and programs. I also completed a direct VoiceOver pass in Brave on the core pages, and no issues were observed during that manual run.`

Show:

- Category 7 in [`docs/presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/presearch-codex.md)
- [`docs/verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/verification-record.md)

### 7. Close

`The biggest takeaway from this project is that orientation and measurement made the fixes much better. Instead of guessing, I built a model of the system first, measured real bottlenecks, made targeted changes, and kept the final writeup tied to reproducible evidence.`

`If you want to review the full work, the repo fork is here: <GITHUB_FORK_URL>, and the recorded demo is here: <LOOM_URL>.`

## Recording Notes

- keep `docs/presearch-codex.md` open
- keep `docs/verification-record.md` open
- keep one terminal tab ready with passing test output
- do not read large code blocks line by line
- use numbers sparingly and only when they support a point

## Link Placeholders

- Fork: `<GITHUB_FORK_URL>`
- Demo: `<LOOM_URL>`
