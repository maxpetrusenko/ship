# FleetGraph Public Trace Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change FleetGraph trace URLs from private LangSmith run URLs to public shared LangSmith run URLs so end users can open debug traces directly.

**Architecture:** Keep all API and UI contracts unchanged. Replace the shared LangSmith trace resolver with a public-share resolver that reuses an existing shared URL when present and creates one when absent.

**Tech Stack:** TypeScript, LangSmith SDK, Express, Vitest, React.

---

### Task 1: Lock the resolver behavior with tests

**Files:**
- Modify: `api/src/fleetgraph/runtime/langsmith.test.ts`
- Test: `api/src/fleetgraph/runtime/langsmith.test.ts`

**Step 1: Write the failing test**

Add coverage for:

- returning an existing public shared URL from `readRunSharedLink()`
- creating and returning a public shared URL with `shareRun()`
- falling back to `null` when tracing is unavailable

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ship/api test -- src/fleetgraph/runtime/langsmith.test.ts
```

Expected: failure because the resolver still calls `getRunUrl()`.

**Step 3: Write minimal implementation**

Update the resolver interface and implementation to prefer:

1. `readRunSharedLink(runId)`
2. `shareRun(runId)`

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @ship/api test -- src/fleetgraph/runtime/langsmith.test.ts
```

Expected: PASS

### Task 2: Keep deterministic trace capture aligned

**Files:**
- Modify: `api/src/fleetgraph/graph/reason-about-risk.trace.test.ts`
- Test: `api/src/fleetgraph/graph/reason-about-risk.trace.test.ts`

**Step 1: Write the failing test**

Update the deterministic tracing mock so the embedded LangSmith client exposes shared-link methods and assert the returned URL is public.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ship/api test -- src/fleetgraph/graph/reason-about-risk.trace.test.ts
```

Expected: failure because the resolver still returns the private run URL.

**Step 3: Write minimal implementation**

Adjust any local types so the deterministic tracing path can pass the richer LangSmith client shape into the resolver.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @ship/api test -- src/fleetgraph/graph/reason-about-risk.trace.test.ts
```

Expected: PASS

### Task 3: Verify downstream trace surfaces

**Files:**
- Reuse existing tests:
  - `api/src/routes/fleetgraph.test.ts`
  - `web/src/components/fleetgraph/FleetGraphChat.test.tsx`
  - `web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`

**Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @ship/api test -- src/routes/fleetgraph.test.ts
pnpm --filter @ship/web test -- src/components/fleetgraph/FleetGraphChat.test.tsx src/components/fleetgraph/FleetGraphFloatingChat.test.tsx
```

Expected: existing consumers keep passing because only the URL shape changes from one valid string to another.

### Task 4: Final verification

Run:

```bash
pnpm --filter @ship/api test -- src/fleetgraph/runtime/langsmith.test.ts src/fleetgraph/graph/reason-about-risk.trace.test.ts src/routes/fleetgraph.test.ts
pnpm --filter @ship/web test -- src/components/fleetgraph/FleetGraphChat.test.tsx src/components/fleetgraph/FleetGraphFloatingChat.test.tsx
```

### Done When

- FleetGraph returns public LangSmith trace URLs
- deterministic tracing uses the same public-share path
- debug links in existing UI surfaces remain wired through `traceUrl`
