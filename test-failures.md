# E2E Failure Inventory

Last reviewed: 2026-03-17

This file previously listed `15` failing E2E tests. That inventory had drifted from the checked-in repo:

- several named specs no longer exist
- several test names no longer exist
- multiple failures were selector drift against old UI contracts rather than current product behavior

Current status of that historical inventory:

1. Program tabs
   Current repo already reflects the removed Feedback tab contract in [feedback-consolidation.spec.ts](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/e2e/feedback-consolidation.spec.ts).

2. Context menus
   Specs were updated to current selectors and current surfaces in [context-menus.spec.ts](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/e2e/context-menus.spec.ts).

3. Bulk-selection checkbox visibility
   Selector updated to the current row-scoped checkbox contract in [program-mode-week-ux.spec.ts](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/e2e/program-mode-week-ux.spec.ts).

4. Right-click selection state
   Root-cause bug fixed in [SelectableList.tsx](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/SelectableList.tsx) with regression coverage in [SelectableList.test.tsx](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/SelectableList.test.tsx).

Open work:

- full E2E re-run required for authoritative counts
- offline/session/race-condition cases require fresh runtime evidence rather than historical doc inference
- code-side mitigations for the documented `9` flaky tests landed on 2026-03-17:
  - infra/memory: `120000` timeout for isolated worker setup, serial mode for heavy suites
  - timing: explicit table/editor readiness helpers in place of blind waits
  - timing/cache: `/my-week` now refetches on mount and clears cached query state on unmount
- verification completed without E2E execution:
  - `pnpm exec playwright test e2e/accessibility-remediation.spec.ts e2e/file-attachments.spec.ts e2e/context-menus.spec.ts e2e/emoji.spec.ts e2e/my-week-stale-data.spec.ts e2e/team-mode.spec.ts --config=playwright.config.ts --list`
  - `pnpm --filter @ship/web type-check`
  - `pnpm build`
