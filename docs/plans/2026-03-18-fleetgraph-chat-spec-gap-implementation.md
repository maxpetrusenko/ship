# FleetGraph Chat Spec Gap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring FleetGraph chat back into alignment with the current spec by fixing the global-thread contract, page-context carry-forward, sensitive-request denial, and launcher scope-chip behavior.

**Architecture:** Keep the current DB-backed thread and message model, but treat chat threads as workspace-global at the route layer. Persist enough page context to rehydrate the latest turn, fail closed on sensitive prompts before model/tool execution, and update the floating chat UI/tests so the visible launcher matches the spec.

**Tech Stack:** TypeScript, Express, PostgreSQL, React, React Query, Vitest, Testing Library.

---

## Scope

This plan covers only the remaining deltas against [FLEETGRAPH.md](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/FLEETGRAPH.md):

1. one active Ship Chat thread per `user + workspace`
2. latest page context carried into follow-up turns
3. immediate denial for sensitive requests
4. scope chip always visible in the launcher
5. tests updated to assert the production behavior instead of the old branch behavior

Per repo note, skip browser e2e for chat work. Use API, runtime, and component tests only.

### Task 1: Enforce the workspace-global thread contract in chat routes

**Files:**
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/fleetgraph/runtime/persistence.ts`
- Modify: `shared/src/types/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write the failing tests**

Add route tests for:

- first `POST /api/fleetgraph/chat` from an entity page without `threadId` reuses or creates the workspace thread, not an entity-scoped thread
- `POST /api/fleetgraph/chat/thread` rejects half-scoped payloads (`entityType` without `entityId`, or the reverse) with `400`
- `GET /api/fleetgraph/chat/thread` remains workspace-global when no explicit thread id is supplied

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

Expected: FAIL on the new thread-scope and invalid-payload assertions.

**Step 2: Write the minimal implementation**

Route-level rule:

```ts
const hasPartialScope = (!!body.entityType) !== (!!body.entityId);
if (hasPartialScope) {
  return res.status(400).json({ error: 'entityType and entityId must be provided together' });
}

thread = body.threadId
  ? await getThreadById(pool, body.threadId, workspaceId, userId)
  : await getOrCreateActiveThread(pool, workspaceId, userId, undefined, undefined);
```

Keep the current visible entity in the chat payload:

```ts
await runFleetGraphChat({
  threadId: thread.id,
  entityType: body.entityType,
  entityId: body.entityId,
  // ...
});
```

If `shared/src/types/fleetgraph.ts` needs a short contract comment, add one clarifying that chat threads are workspace-global and entity scope is a per-turn hint, not a thread key.

**Step 3: Re-run the route tests**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

Expected: PASS on the new workspace-thread assertions.

**Step 4: Commit**

```bash
git add api/src/routes/fleetgraph.ts api/src/fleetgraph/runtime/persistence.ts shared/src/types/fleetgraph.ts api/src/routes/fleetgraph.test.ts
git commit -m "fix: align fleetgraph chat thread scope with spec"
```

### Task 2: Carry forward the latest page context when follow-up turns omit it

**Files:**
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/fleetgraph/runtime/persistence.ts`
- Modify: `shared/src/types/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write the failing tests**

Add tests for:

- chat turns with `pageContext` persist the full latest page context on the thread
- a later chat turn without `pageContext` rehydrates that stored context into `runFleetGraphChat`
- stored context still respects the current `entityType` and `entityId` from the request

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

Expected: FAIL because the route currently forwards only `body.pageContext ?? null`.

**Step 2: Persist and rehydrate the latest page context**

Store the full latest page context on the thread helper instead of only the slim display fields:

```ts
type PersistedThreadPageContext = FleetGraphPageContext;
```

Build effective runtime context like this:

```ts
const effectivePageContext =
  body.pageContext
  ?? thread.lastPageContext
  ?? null;
```

Then pass:

```ts
await runFleetGraphChat({
  // ...
  pageContext: effectivePageContext,
});
```

Keep existing summary columns like `lastPageRoute` and `lastPageTitle` if they still support UI hydration, but make the JSON blob the source of truth for follow-up chat turns.

**Step 3: Re-run the route tests**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

Expected: PASS on the carry-forward assertions.

**Step 4: Commit**

```bash
git add api/src/routes/fleetgraph.ts api/src/fleetgraph/runtime/persistence.ts shared/src/types/fleetgraph.ts api/src/routes/fleetgraph.test.ts
git commit -m "fix: carry fleetgraph page context across chat turns"
```

### Task 3: Tighten sensitive-request denial to fail closed

**Files:**
- Modify: `api/src/fleetgraph/chat/runtime.ts`
- Test: `api/src/fleetgraph/chat/runtime.test.ts`

**Step 1: Write the failing tests**

Add blocked-phrase tests for neutral phrasings such as:

- `database url?`
- `prod access details?`
- `which env vars are used for deploy?`
- `hostinger config`

Each test should assert:

- branch is `inform_only`
- no tool calls
- no model call

Run:

```bash
pnpm --filter @ship/api exec vitest run src/fleetgraph/chat/runtime.test.ts
```

Expected: FAIL on at least one neutral phrasing because the current guard requires both a disclosure verb and a sensitive target.

**Step 2: Replace the phrase-dependent guard**

Use a direct sensitive-target classifier with a narrow allowlist for benign product questions if needed:

```ts
const sensitiveTarget = /(secret|password|api[\s_-]?key|token|credential|private key|ssh key|\.env|env vars?|database|database url|connection string|deployment|deploy config|prod server|infrastructure|hostinger|ssh access)/i;

if (sensitiveTarget.test(question)) {
  return buildImmediateResult(blockedAssessment);
}
```

If false positives appear, add explicit allowlisted product phrases in the test suite before relaxing the block.

**Step 3: Re-run the runtime tests**

Run:

```bash
pnpm --filter @ship/api exec vitest run src/fleetgraph/chat/runtime.test.ts
```

Expected: PASS on the expanded sensitive-request coverage and existing timeout tests.

**Step 4: Commit**

```bash
git add api/src/fleetgraph/chat/runtime.ts api/src/fleetgraph/chat/runtime.test.ts
git commit -m "fix: harden fleetgraph sensitive request blocking"
```

### Task 4: Make the scope chip always visible and typed in the floating launcher

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Modify: `web/src/hooks/useFleetGraphScope.ts`
- Test: `web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`
- Test: `web/src/hooks/useFleetGraphScope.test.ts`

**Step 1: Write the failing tests**

Add or update tests so they assert:

- collapsed launcher shows a scope chip, not just `Ship Chat`
- workspace scope also shows a chip
- scope labels are typed, for example `Issue: Issue 1`, `Sprint: Week 12`, `Workspace: Acme Corp`

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx src/hooks/useFleetGraphScope.test.ts
```

Expected: FAIL because the current launcher hides the chip and the current labels are title-only.

**Step 2: Implement the chip and label changes**

Prefer explicit typed labels from the hook:

```ts
const label = `Issue: ${title}`;
const workspaceLabel = `Workspace: ${currentWorkspace?.name ?? 'Workspace'}`;
```

Render the chip in both launcher states:

```tsx
<span className="chip">{scope.scopeLabel}</span>
```

Replace the entity-only green dot with the real chip so workspace fallback also satisfies the spec.

**Step 3: Re-run the focused web tests**

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx src/hooks/useFleetGraphScope.test.ts
```

Expected: PASS on launcher and typed-label coverage.

**Step 4: Commit**

```bash
git add web/src/components/fleetgraph/FleetGraphFloatingChat.tsx web/src/hooks/useFleetGraphScope.ts web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx web/src/hooks/useFleetGraphScope.test.ts
git commit -m "fix: show fleetgraph scope chip in launcher"
```

### Task 5: Cover the real floating-chat persistence path

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Step 1: Write the failing tests**

Add production-path coverage for:

- `persistAcrossScopes` surviving a scope change through `FleetGraphFloatingChat`
- `newThreadNonce` resetting the chat thread while keeping the launcher contract intact
- hydrated workspace-thread messages surviving route/scope changes in the production wrapper

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx src/components/fleetgraph/FleetGraphChat.test.tsx
```

Expected: FAIL because current coverage proves only the inner component behavior and still locks in the old launcher copy.

**Step 2: Implement only the minimal test-support changes**

If existing mocks are too shallow, expand them rather than changing production behavior just to satisfy the test:

```tsx
expect(chat).toHaveAttribute('data-persist-across-scopes', 'true');
expect(screen.getByText('Workspace: Acme Corp')).toBeInTheDocument();
```

Do not add browser e2e.

**Step 3: Re-run the focused web tests**

Run:

```bash
pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx src/components/fleetgraph/FleetGraphChat.test.tsx
```

Expected: PASS on the wrapper-level persistence assertions.

**Step 4: Commit**

```bash
git add web/src/components/fleetgraph/FleetGraphFloatingChat.test.tsx web/src/components/fleetgraph/FleetGraphChat.test.tsx
git commit -m "test: cover fleetgraph floating chat scope persistence"
```

### Task 6: Verification

Run the smallest meaningful gate for the touched surfaces:

```bash
pnpm --filter @ship/shared build
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts src/fleetgraph/chat/runtime.test.ts
pnpm --filter @ship/web exec vitest run src/components/fleetgraph/FleetGraphFloatingChat.test.tsx src/components/fleetgraph/FleetGraphChat.test.tsx src/hooks/useFleetGraphScope.test.ts
```

Expected:

- shared types build clean
- API tests pass on workspace-thread, page-context, and sensitive-request coverage
- web tests pass on scope chip and persistence behavior

### Done When

- first chat turn always lands in the workspace-global thread
- missing `pageContext` on follow-up turns still carries the latest stored context
- sensitive prompts fail before tool or model execution across neutral phrasings
- launcher chip is visible for issue, sprint, project, and workspace scopes
- tests assert the production spec instead of the older branch behavior
