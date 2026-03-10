# Demo Proof Card

Date: 2026-03-10

## Live Flow

1. Show this card first.
2. Run `cd ShipShape && corepack pnpm demo:proof`.
3. If asked about accessibility, run `cd ShipShape && DEMO_PROOF_BASE_URL=http://localhost:5174 corepack pnpm demo:proof:a11y`.
4. Use source files only as backup.

Current rerun values can move if the repo changes after the written submission snapshot. The live command is the source of truth for the local checkout.

## Claims To Show

| Area | Before | Current / After | Live proof |
| --- | --- | --- | --- |
| Type safety | `270 any`, `1504 as`, `1257 !`, `1 @ts-*` | current repo rerun prints updated counts live; improvement is real but below the `25%` target | `corepack pnpm demo:proof` |
| Bundle size | main entry `2073.74 kB` | current repo rerun prints the built main entry chunk live | `corepack pnpm demo:proof` |
| Runtime resilience | confusing transient session behavior and blocking load gaps existed before | targeted runtime regressions rerun live in the proof command | `corepack pnpm demo:proof` |
| Verification status | baseline had broken / flaky areas | live proof reruns `type-check`, targeted runtime tests, web suite, focused API proof, and build | `corepack pnpm demo:proof` |
| Accessibility | earlier audit found critical / serious issues | current local axe rerun should show `0` critical / serious on core pages | `corepack pnpm demo:proof:a11y` |

## Spoken Framing

- `Ship is a task and project management tool built by the U.S. Department of the Treasury.`
- `It was already a solid, production-shaped system when I came in.`
- `My job was to improve it further with measurable proof, not to rescue a broken app.`
- `Category 1 improved meaningfully, but it was the one rubric target I improved without fully clearing.`

## Backup Docs

- [`presearch-codex.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/presearch-codex.md)
- [`verification-record.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md)
- [`demo-script.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/demo-script.md)
