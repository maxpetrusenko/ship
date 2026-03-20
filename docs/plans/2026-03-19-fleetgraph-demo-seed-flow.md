# FleetGraph Demo Seed Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a demo/test trigger in North Star that backdates a few real issues, seeds actionable FleetGraph approvals, and makes the top banner + Action Items modal light up on demand.

**Architecture:** Keep the existing FleetGraph approval and modal-feed pipeline intact. Add one dev/demo route that mutates selected issue timestamps, runs real stale detection, and inserts synthetic actionable approvals using the existing FleetGraph alert persistence. Move the existing analyze trigger onto the header icon and repurpose the old header control into a break/test trigger.

**Tech Stack:** Express routes, React, TanStack Query, Vitest, existing FleetGraph runtime/persistence helpers.

---

### Task 1: Cover the new demo route

**Files:**
- Modify: `api/src/routes/fleetgraph.test.ts`
- Modify: `api/src/routes/fleetgraph.ts`

**Step 1: Write the failing route test**

Add a test for `POST /api/fleetgraph/demo/seed-flow` that expects:
- a `200` response in test/dev mode
- direct DB backdating queries to run
- real graph invocation to run for seeded stale issues
- synthetic alert + recipient + approval persistence for actionable items

**Step 2: Run the route test and confirm it fails**

Run: `pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts`

Expected: FAIL because the route does not exist yet.

**Step 3: Implement the route**

Add a demo-only endpoint that:
- selects 2 to 3 issues in the current workspace
- backdates the selected issue docs and history rows
- invokes FleetGraph on those issues to create real stale findings
- inserts synthetic actionable approvals for the Action Items modal

**Step 4: Re-run the route test**

Run: `pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts`

Expected: PASS.

### Task 2: Cover the floating chat control move

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Modify: `web/src/hooks/useFleetGraph.ts`

**Step 1: Write the failing component test**

Add tests that expect:
- clicking the header icon next to `North Star` runs analysis
- the old top-right bolt no longer exists
- a new break/test button triggers the demo seed mutation

**Step 2: Run the component test and confirm it fails**

Run: `pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`

Expected: FAIL because the UI still uses the old control layout.

**Step 3: Implement the UI + hook**

Add a new mutation hook for the demo route, move the analyze handler onto the title icon, and replace the old top-right bolt with a break/test icon button.

**Step 4: Re-run the component test**

Run: `pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`

Expected: PASS.

### Task 3: Update the CTO demo docs

**Files:**
- Modify: `docs/Audit/submission/demo-script.md`
- Modify: `docs/Audit/submission/demo-script-short.md`

**Step 1: Add the seeded-flow demo step**

Update the spoken demo docs so Max can explain the new break/test trigger, the resulting top banner findings, and the approve/deny path.

**Step 2: Verify the doc wording matches the shipped UI**

Read both docs after the UI changes land and align the wording to the final button placement and behavior.

### Task 4: Verify the whole change

**Files:**
- Verify: `api/src/routes/fleetgraph.ts`
- Verify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Verify: `docs/Audit/submission/demo-script.md`
- Verify: `docs/Audit/submission/demo-script-short.md`

**Step 1: Run the targeted API and web tests**

Run:
- `pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts`
- `pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`

**Step 2: Confirm only intended files changed**

Run: `git status --short`

Expected: only the FleetGraph route/UI/tests/doc files plus this plan.
