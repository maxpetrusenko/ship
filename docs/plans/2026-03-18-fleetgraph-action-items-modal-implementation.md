# FleetGraph Action Items Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing `ActionItemsModal` so recipient-scoped FleetGraph findings appear below accountability items in the same modal shell, with server-owned prioritization and in-place expand / approve / deny / snooze behavior.

**Architecture:** Keep the current accountability modal entry point in [App.tsx](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/pages/App.tsx) and the current shell in [ActionItemsModal.tsx](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/ActionItemsModal.tsx). Add a dedicated FleetGraph modal-feed contract on the server so deprioritization and rollup rules stay backend-owned. Reuse the existing `fleetgraph:alert` realtime event and existing resolve endpoint for skip / snooze / approve / deny actions.

**Tech Stack:** TypeScript, React, React Query, Express, Vitest.

---

### Task 1: Define the modal-feed contract in shared types

**Files:**
- Modify: `shared/src/types/fleetgraph.ts`

**Step 1: Write the failing type expectations in API/web tests**

Add or update focused tests so the new modal feed shape is required by both server and web code. The response should include:

- `items`
- `total`
- per-item display data:
  - `alertId`
  - `entityType`
  - `entityId`
  - `title`
  - `signalType`
  - `severity`
  - `whatChanged`
  - `whyThisMatters`
  - `ownerLabel`
  - `nextDecision`
  - `explanation`
  - `reasoning`
  - `displayPriority`
  - `supersededBy`
  - `isActionable`
  - optional `approval`

**Step 2: Add the minimal shared types**

Add a dedicated response type such as:

- `FleetGraphModalFeedItem`
- `FleetGraphModalFeedResponse`

Keep the existing `FleetGraphAlertsResponse` intact for bell consumers.

**Step 3: Run type-aware focused suites**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphNotificationBell.test.tsx
```

Expected: type or shape failures until the route and hook are implemented.

### Task 2: Build the server-side modal feed and prioritization helper

**Files:**
- Create: `api/src/fleetgraph/modal-feed.ts`
- Create: `api/src/fleetgraph/modal-feed.test.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write failing server tests for ranking and suppression**

Cover at least these cases:

- actionable approval sorts above inform-only alert
- sprint / project parent signal suppresses lower stale issue row
- snoozed alert is omitted for the current user
- `Skip` still maps to dismiss semantics at the route level
- duplicate approve returns conflict if already processed

**Step 2: Implement the helper with explicit product rules**

In `modal-feed.ts`, add pure functions that:

- join user alerts with pending approvals
- derive display-ready rows
- assign `displayPriority`
- set `supersededBy`
- drop suppressed rows
- preserve idempotent approval linkage through `alertId` / approval id

Keep these rules out of the frontend.

**Step 3: Add a dedicated route**

Add a route such as:

```text
GET /api/fleetgraph/modal-feed
```

It should:

- fetch recipient-scoped alerts for `req.userId`
- fetch pending approvals
- build modal items via `modal-feed.ts`
- return `FleetGraphModalFeedResponse`

Do not overload the bell response with modal-specific fields.

**Step 4: Verify focused API suites**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/fleetgraph/modal-feed.test.ts
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

Expected: PASS.

### Task 3: Add a React Query hook for the FleetGraph modal feed

**Files:**
- Modify: `web/src/hooks/useFleetGraph.ts`

**Step 1: Write the failing hook consumer test**

Extend a web test so the modal expects a dedicated FleetGraph modal-feed query rather than raw alert data.

**Step 2: Implement the hook**

Add:

- `fleetgraphKeys.modalFeed()`
- `useFleetGraphModalFeed()`

Use:

```text
GET /api/fleetgraph/modal-feed
```

Invalidate it on:

- `fleetgraph:alert`
- successful resolve / dismiss / snooze / approve actions

**Step 3: Verify focused web tests**

Run:

```bash
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphNotificationBell.test.tsx
```

Expected: existing FleetGraph behavior still passes after hook changes.

### Task 4: Split FleetGraph modal rendering out of `ActionItemsModal`

**Files:**
- Create: `web/src/components/fleetgraph/FleetGraphModalSection.tsx`
- Create: `web/src/components/fleetgraph/FleetGraphModalSection.test.tsx`
- Modify: `web/src/components/ActionItemsModal.tsx`

**Step 1: Write the failing UI test first**

Add a focused test for the new section that verifies:

- accountability items stay first
- FleetGraph section renders below them
- rows are collapsed by default
- expand reveals:
  - `What changed`
  - `Why this matters`
  - `Owner`
  - `Next decision`
  - `Explain`
  - `Show reasoning`
- action buttons render correctly for:
  - inform-only row: `Skip`, `Snooze`, `Open issue`
  - actionable row: `Approve`, `Deny`, `Snooze`, `Open issue`

**Step 2: Implement the new section component**

Keep `ActionItemsModal.tsx` as the shell and accountability list owner.

Move FleetGraph-specific rendering into `FleetGraphModalSection.tsx` so file size stays controlled.

Implementation notes:

- no inline chat in modal
- `Open issue` navigates to the issue or entity page
- `Skip` maps to backend dismiss
- keep the FleetGraph section above the footer with `Got it`

**Step 3: Integrate the section into the existing modal**

Modify `ActionItemsModal.tsx` so it:

- keeps current accountability behavior intact
- fetches both accountability items and FleetGraph modal items
- shows an empty / partial state correctly
- preserves the current footer and `Got it` button

**Step 4: Verify focused web suites**

Run:

```bash
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphModalSection.test.tsx
```

Expected: PASS.

### Task 5: Update modal-open logic and realtime invalidation in the app shell

**Files:**
- Modify: `web/src/pages/App.tsx`

**Step 1: Write the failing shell behavior test**

Cover:

- modal opens on login when FleetGraph modal feed has displayable items even if accountability items are empty
- modal still opens for accountability-only state
- existing `fleetgraph:alert` invalidates the modal feed query

**Step 2: Implement the minimal shell changes**

Update `App.tsx` so:

- modal-open logic checks both accountability items and FleetGraph modal items
- `fleetgraph:alert` invalidates the new modal-feed query in addition to status
- existing accountability celebration path remains unchanged

Do not change the accountability banner behavior in this task.

**Step 3: Verify focused web suites**

Run:

```bash
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphModalSection.test.tsx
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphNotificationBell.test.tsx
```

Expected: PASS.

### Task 6: Wire resolve semantics and copy carefully

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphModalSection.tsx`
- Modify: `web/src/hooks/useFleetGraph.ts`
- Modify: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write the failing resolve-path tests**

Cover:

- `Skip` uses dismiss outcome
- `Snooze` uses recipient-scoped suppression
- `Approve` only appears for explicit pending approval
- second approve returns conflict and forces refetch

**Step 2: Implement the minimal action wiring**

Use the existing resolve endpoint:

- `Skip` -> `dismiss`
- `Snooze` -> `snooze`
- `Approve` -> `approve`
- `Deny` -> `reject`

Keep action copy action-specific where approval metadata allows it.

**Step 3: Verify focused API + web suites**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphModalSection.test.tsx
```

Expected: PASS.

### Task 7: Final verification

**Files:**
- Modify if needed after verification fixes

**Step 1: Run the focused gate**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/fleetgraph/modal-feed.test.ts
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphModalSection.test.tsx
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphNotificationBell.test.tsx
pnpm --filter @ship/web type-check
pnpm --filter @ship/api type-check
```

Expected:

- tests pass
- both packages type-check cleanly

### Done When

- the existing `ActionItemsModal` remains the only modal shell
- accountability items stay intact
- FleetGraph items render below current modal content and above `Got it`
- FleetGraph modal rows are server-prioritized and can suppress lower-value children
- expanded rows show diagnosis fields instead of chat CTAs
- `Open issue` is the path to deeper context
- approve / deny / snooze / skip semantics are explicit and race-safe
