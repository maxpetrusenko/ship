# E2E Verification Run

Date: 2026-03-09

Canonical submission copy of the local verification note at `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/e2e-verification-2026-03-09.md`.

Repo:
- `ShipShape`

## Environment

- Docker Desktop was required for this suite because every Playwright spec imports `e2e/fixtures/isolated-env.ts`, which starts PostgreSQL via `testcontainers`.
- Initial runs failed before test execution with `Could not find a working container runtime strategy`.
- Docker Desktop was started with `open -a Docker`, then verified with `docker info`.
- Due to low available host memory during the run, the suite was executed with `1` worker to avoid introducing extra flake from oversubscription.

## Run History

- Run 1:
  full suite attempt before Docker was up; blocked before test execution by `Could not find a working container runtime strategy`
- Run 2:
  single-test repro with `--workers=1`; confirmed the same missing-container-runtime blocker
- Run 3:
  full suite under Docker with `--workers=1`; this is the recorded result below

## Command

```bash
open -a Docker
docker info
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/ship-e2e-1worker.json corepack pnpm exec playwright test --workers=1 --reporter=json
```

## Final Result

- `862` passed
- `1` failed
- `6` flaky
- total runtime: `27.7m`

## Hard Failure

1. `e2e/session-timeout.spec.ts:414`
   `12-Hour Absolute Timeout › clicking I Understand on absolute warning does NOT extend session`
   Why:
   expected redirect to `/login`, but page stayed on `/docs`

## Flaky Tests

1. `e2e/bulk-selection.spec.ts:1581`
   `Bulk Actions - Delete (Trash) › undo restores deleted issues from trash`
   Why:
   strict locator match on `#5` also matched `#50` and `#51`

2. `e2e/feedback-consolidation.spec.ts:67`
   `Issues List: Source Display › source column/badge shows "External" for external issues`
   Why:
   expected seeded external issue row never appeared within `15s`

3. `e2e/mentions.spec.ts:417`
   `Mentions › should sync mentions between collaborators`
   Why:
   second tab never rendered `.mention` within `15s`

4. `e2e/my-week-stale-data.spec.ts:91`
   `My Week - stale data after editing plan/retro › retro edits are visible on /my-week after navigating back`
   Why:
   edited retro content did not reappear on `/my-week`

5. `e2e/project-weeks.spec.ts:205`
   `Project Weeks Tab › project link in Properties sidebar navigates back to project`
   Why:
   expected project link `Navigation Test Project` never became visible

6. `e2e/weekly-accountability.spec.ts:469`
   `Project Allocation Grid API › Allocation grid shows person with assigned issues and plan/retro status`
   Why:
   expected `planId` to equal created weekly plan ID, but received `null`

## Notable Non-Fatal Noise

- AI analysis routes logged repeated AWS Bedrock credential errors because local AWS credentials were not configured.
- Multiple editor and file attachment tests logged WebSocket handshake `429` errors and aborted requests, but those logs did not fail most assertions in this run.
- Several tests retried once and then passed; only the items listed above remained flaky or failed in the final summary.

## Failure Artifacts

- `test-results/session-timeout-12-Hour-Ab-2a8fe-ing-does-NOT-extend-session-chromium/`
- `test-results/bulk-selection-Bulk-Action-b8ca4-s-deleted-issues-from-trash-chromium/`
- `test-results/feedback-consolidation-Iss-3069a-xternal-for-external-issues-chromium/`
- `test-results/mentions-Mentions-should-sync-mentions-between-collaborators-chromium/`
- `test-results/my-week-stale-data-My-Week-7315d--week-after-navigating-back-chromium/`
- `test-results/project-weeks-Project-Week-19228-r-navigates-back-to-project-chromium/`
- `test-results/weekly-accountability-Proj-b046a-ssues-and-plan-retro-status-chromium/`
