# FleetGraph Chat Prompt Tightening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shorten the FleetGraph reasoning prompt so chat stays Ship-only, replies stay short, and public traces remain fully visible.

**Architecture:** Keep tracing and runtime behavior unchanged. Replace only the prompt text and lock its contract with a targeted unit test.

**Tech Stack:** TypeScript, Vitest, LangChain OpenAI.

---

### Task 1: Lock the prompt contract with a failing test

**Files:**
- Modify: `api/src/fleetgraph/graph/nodes.test.ts`
- Modify: `api/src/fleetgraph/graph/nodes.ts`

**Step 1: Write the failing test**

Assert that the exported prompt:

- says unrelated questions should be declined
- says replies should stay short
- says FleetGraph should stay within Ship scope
- no longer includes the old rule allowing unrelated answers

**Step 2: Run test to verify it fails**

Run:

```bash
DATABASE_URL=postgresql://localhost/ship_shipshape_test pnpm --filter @ship/api exec vitest run src/fleetgraph/graph/nodes.test.ts
```

### Task 2: Replace the prompt with the shorter version

**Files:**
- Modify: `api/src/fleetgraph/graph/nodes.ts`

**Step 1: Write minimal implementation**

Shorten the prompt and encode:

1. Ship-only chat
2. short replies
3. unrelated-question refusal
4. page-context priority
5. accountability counts first
6. no scope overreach

**Step 2: Re-run the test**

Run:

```bash
DATABASE_URL=postgresql://localhost/ship_shipshape_test pnpm --filter @ship/api exec vitest run src/fleetgraph/graph/nodes.test.ts
```

### Task 3: Verify no tracing regression

**Files:**
- Reuse: `api/src/fleetgraph/graph/reason-about-risk.trace.test.ts`

Run:

```bash
DATABASE_URL=postgresql://localhost/ship_shipshape_test pnpm --filter @ship/api exec vitest run src/fleetgraph/graph/reason-about-risk.trace.test.ts
```

### Done When

- prompt is shorter
- unrelated questions are declined
- Ship scope guard remains explicit
- public traces still expose full prompt and inputs
