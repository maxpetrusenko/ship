# Top Attention Banners Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show FleetGraph sweep findings as a second top banner directly below accountability, keeping accountability first and FleetGraph server-priority-driven.

**Architecture:** Add a small shell-only component that composes the existing accountability banner with a new FleetGraph banner. Feed the FleetGraph row from `useFleetGraphModalFeed()` output already fetched in `App.tsx` so backend sorting remains authoritative.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

---

### Task 1: Add the failing top-banner stack test

**Files:**
- Create: `web/src/components/TopAttentionBanners.test.tsx`

**Step 1: Write failing tests**

Cover:

- accountability banner renders before FleetGraph banner
- FleetGraph banner renders when modal-feed items exist
- FleetGraph banner hides when there are no FleetGraph items
- clicking the FleetGraph banner calls the supplied open handler

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/TopAttentionBanners.test.tsx
```

Expected: fail because the component does not exist yet.

### Task 2: Implement the banner stack component

**Files:**
- Create: `web/src/components/TopAttentionBanners.tsx`

**Step 1: Add minimal implementation**

- reuse `AccountabilityBanner`
- add a FleetGraph-specific row
- derive FleetGraph urgency from the first modal-feed item severity
- keep accountability first, FleetGraph second

**Step 2: Re-run focused test**

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/TopAttentionBanners.test.tsx
```

Expected: PASS.

### Task 3: Wire the new shell component into the app

**Files:**
- Modify: `web/src/pages/App.tsx`

**Step 1: Replace direct accountability banner usage**

- render `TopAttentionBanners`
- pass accountability counts and FleetGraph modal-feed items
- reuse existing modal-open behavior

**Step 2: Verify focused test plus type-check**

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/TopAttentionBanners.test.tsx
pnpm --filter @ship/web type-check
```

Expected: PASS.
