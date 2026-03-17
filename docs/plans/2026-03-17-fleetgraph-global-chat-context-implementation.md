# FleetGraph Global Chat Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a restart-safe global FleetGraph chat that preserves thread history, injects live page context on every turn, respects user access rules, supports `+` and `/new`, and makes `confirm_action` responses visibly actionable.

**Architecture:** Replace the process-local FleetGraph conversation `Map` with database-backed threads and messages. Extend the chat contract to carry page context from the web app into the API, verify that context through existing document access rules, and update the floating chat UI to show current page state and create fresh threads on demand. Keep the feature fully inside current app and API patterns; no screenshot dependence and no browser e2e for AI chat.

**Tech Stack:** TypeScript, PostgreSQL, Express, React, React Query, Vitest, Testing Library.

---

## Working decisions

1. One active FleetGraph thread per user and workspace.
2. Current page context is injected every turn and overrides older page assumptions.
3. The thread persists in the database and survives API restarts.
4. FleetGraph only uses page context the current user can access through normal app auth.
5. `+` and `/new` both create a new thread.
6. Skip Playwright for this feature per repo temp note. Use API, unit, and component tests.

## Task 1: Add persistent FleetGraph chat tables

**Files:**
- Create: `api/src/db/migrations/045_fleetgraph_chat_threads.sql`
- Modify: `api/src/db/schema.sql`
- Test: `api/src/db/migrate.ts`

**Step 1: Write the migration**

Create the tables:

- `fleetgraph_chat_threads`
- `fleetgraph_chat_messages`

Include indexes for:

- `workspace_id, user_id, status`
- `thread_id, created_at`

**Step 2: Run migration locally**

Run:

```bash
pnpm db:migrate
```

Expected:

- migration `045_fleetgraph_chat_threads.sql` applies successfully
- no schema errors

**Step 3: Sync schema snapshot**

Update `api/src/db/schema.sql` so a fresh local setup includes the new tables.

**Step 4: Re-run migrate on a clean local DB if needed**

Run:

```bash
pnpm db:migrate
```

Expected:

- no-op or success

**Step 5: Commit**

```bash
git add api/src/db/migrations/045_fleetgraph_chat_threads.sql api/src/db/schema.sql
git commit -m "feat: add fleetgraph chat persistence tables"
```

## Task 2: Extend shared FleetGraph chat contracts

**Files:**
- Modify: `shared/src/types/fleetgraph.ts`
- Test: `shared/src/types/index.ts`

**Step 1: Add page-context and thread types**

Add:

```ts
export interface FleetGraphPageContext {
  route: string;
  surface: 'docs' | 'issue' | 'project' | 'sprint' | 'workspace';
  documentId?: string;
  title?: string;
  documentType?: string;
  isEmpty?: boolean;
  breadcrumbs?: Array<{ id: string; title: string; type: string }>;
  belongsTo?: Array<{ id: string; title: string; type: string }>;
}
```

Also add thread contracts:

- `FleetGraphChatThread`
- `FleetGraphChatThreadResponse`
- `FleetGraphCreateChatThreadResponse`

Update request and response types so chat requests can carry:

- `threadId`
- `pageContext`

**Step 2: Type-check shared package**

Run:

```bash
pnpm --filter @ship/shared build
```

Expected:

- shared types compile cleanly

**Step 3: Commit**

```bash
git add shared/src/types/fleetgraph.ts
git commit -m "feat: extend fleetgraph chat contracts"
```

## Task 3: Add server-side persistence helpers and access gate

**Files:**
- Modify: `api/src/fleetgraph/runtime/persistence.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/routes/documents.ts`
- Optional create: `api/src/fleetgraph/runtime/chat-access.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write a failing route test for persistence**

Add tests for:

- creating an active thread
- storing user and assistant messages
- loading existing thread on next request
- rejecting a thread from another user or workspace

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- FAIL because thread persistence helpers do not exist yet

**Step 2: Add persistence helpers**

Implement helpers for:

- get or create active thread
- create thread
- append message
- load recent messages
- update thread last-page metadata

Use SQL in existing API style. Keep message window bounded when loading into prompts.

**Step 3: Add page-context access verification**

Before enriching from `pageContext.documentId`, verify the document is readable through existing auth and visibility rules.

Rules:

- same user session
- same workspace
- existing visibility rules today
- future narrowing hook for role-based filtering

**Step 4: Replace in-memory conversation store**

Remove:

- `conversations` map
- timestamp pruning logic

Load thread history from the database instead.

**Step 5: Re-run API route tests**

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- PASS for persistence and access cases

**Step 6: Commit**

```bash
git add api/src/fleetgraph/runtime/persistence.ts api/src/routes/fleetgraph.ts api/src/routes/fleetgraph.test.ts api/src/routes/documents.ts api/src/fleetgraph/runtime/chat-access.ts
git commit -m "feat: persist fleetgraph chat threads"
```

## Task 4: Add active-thread API endpoints

**Files:**
- Modify: `api/src/routes/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write failing tests for thread endpoints**

Add tests for:

- `GET /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat` with explicit `threadId`

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- FAIL for missing routes or mismatched payloads

**Step 2: Implement endpoints**

Add:

- `GET /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat/thread`

Update `POST /api/fleetgraph/chat` to:

- accept `threadId`
- accept `pageContext`
- return thread metadata with the assistant message

**Step 3: Re-run tests**

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- PASS

**Step 4: Commit**

```bash
git add api/src/routes/fleetgraph.ts api/src/routes/fleetgraph.test.ts
git commit -m "feat: add fleetgraph chat thread endpoints"
```

## Task 5: Add client page-context builder

**Files:**
- Modify: `web/src/hooks/useFleetGraph.ts`
- Create: `web/src/hooks/useFleetGraphPageContext.ts`
- Test: `web/src/hooks/useFleetGraphScope.test.ts`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Step 1: Write failing client tests**

Cover:

- document page context includes title and empty state
- workspace fallback context works
- hidden or missing document context is omitted safely

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- FAIL because page-context builder does not exist

**Step 2: Implement page-context builder**

Use:

- route pathname
- `CurrentDocumentContext`
- `GET /api/documents/:id`
- `GET /api/documents/:id/context`

Detect emptiness conservatively for wiki-style pages:

- no meaningful text content
- no substantial structured content

**Step 3: Thread page context into chat mutation**

Update `useFleetGraphChat()` and callers so each send includes:

- `threadId`
- current FleetGraph entity scope
- `pageContext`

**Step 4: Re-run web tests**

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add web/src/hooks/useFleetGraph.ts web/src/hooks/useFleetGraphPageContext.ts web/src/components/fleetgraph/FleetGraphChat.test.tsx web/src/hooks/useFleetGraphScope.test.ts
git commit -m "feat: add fleetgraph page context payloads"
```

## Task 6: Update FleetGraph chat UI for global persistence

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphChat.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphPanel.tsx`
- Modify: `web/src/pages/App.tsx`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Step 1: Write failing UI tests**

Add tests for:

- header `+` button starts a new chat
- `/new` starts a new chat
- existing thread loads on mount
- page chip shows current title and empty state

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- FAIL on missing UI behavior

**Step 2: Load active thread on mount**

On component mount:

- fetch the active thread
- hydrate recent messages
- retain thread id in component state

**Step 3: Add `+` and `/new`**

Implement:

- header `+` button
- `/new` command in input

Both should:

- create a new thread through the API
- clear the visible transcript
- focus the input

**Step 4: Show page-awareness in header and prompts**

Add:

- page surface label
- page title
- `Empty` chip when applicable

If the page is empty and wiki-like, bias quick prompts toward drafting help.

**Step 5: Re-run UI tests**

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- PASS

**Step 6: Commit**

```bash
git add web/src/components/fleetgraph/FleetGraphChat.tsx web/src/components/fleetgraph/FleetGraphFloatingChat.tsx web/src/components/fleetgraph/FleetGraphPanel.tsx web/src/pages/App.tsx web/src/components/fleetgraph/FleetGraphChat.test.tsx
git commit -m "feat: persist fleetgraph chat in the ui"
```

## Task 7: Make `confirm_action` visibly actionable

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphChat.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphApprovalCard.tsx`
- Modify: `api/src/routes/fleetgraph.ts`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Step 1: Write failing action-card tests**

Add tests for:

- `Approve`
- `Dismiss`
- `Snooze`
- unsupported direct action shows `Suggested only`

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- FAIL because buttons are missing from chat message rendering

**Step 2: Implement actionable controls**

Reuse existing FleetGraph resolve mechanics where possible.

For chat-rendered `confirm_action`:

- show explicit controls
- wire to resolve endpoint when the action is supported
- show disabled or informational state when only suggestion text exists

**Step 3: Re-run tests**

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

Expected:

- PASS

**Step 4: Commit**

```bash
git add web/src/components/fleetgraph/FleetGraphChat.tsx web/src/components/fleetgraph/FleetGraphApprovalCard.tsx api/src/routes/fleetgraph.ts web/src/components/fleetgraph/FleetGraphChat.test.tsx
git commit -m "feat: add actionable fleetgraph confirmations"
```

## Task 8: Add access-policy tests and non-admin narrowing hook

**Files:**
- Create: `api/src/fleetgraph/runtime/chat-access.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write failing access tests**

Add tests for:

- private document inaccessible to another user
- cross-workspace thread rejected
- future narrowing hook can deny a visible workspace document

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- FAIL on missing policy hook or missing checks

**Step 2: Implement central access helper**

Create one helper that:

- verifies readable document access
- scopes thread ownership
- provides one extension point for future custom roles such as `dev`

Keep current default behavior aligned with normal app auth.

**Step 3: Re-run tests**

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- PASS

**Step 4: Commit**

```bash
git add api/src/fleetgraph/runtime/chat-access.ts api/src/routes/fleetgraph.ts api/src/routes/fleetgraph.test.ts
git commit -m "refactor: centralize fleetgraph chat access checks"
```

## Task 9: Run focused verification

**Files:**
- Test: `api/src/routes/fleetgraph.test.ts`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`
- Test: `web/src/hooks/useFleetGraphScope.test.ts`

**Step 1: Run API suite**

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

Expected:

- PASS

**Step 2: Run web FleetGraph tests**

```bash
pnpm --filter @ship/web test -- FleetGraphChat
pnpm --filter @ship/web test -- useFleetGraphScope
```

Expected:

- PASS

**Step 3: Run package type-checks**

```bash
pnpm --filter @ship/shared build
pnpm --filter @ship/api type-check
pnpm --filter @ship/web type-check
```

Expected:

- PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "test: verify fleetgraph persistent chat flow"
```

Use repo judgment here: stage only the files from this feature if unrelated workspace changes are present.

## Task 10: Update docs and gap tracking

**Files:**
- Modify: `docs/FleetGraph/README.md`
- Modify: `FLEETGRAPH.md`
- Modify: `docs/plans/2026-03-17-fleetgraph-global-chat-context-design.md`

**Step 1: Document shipped behavior**

Add:

- global persistent chat
- page-aware prompting
- `+` and `/new`
- access-safe context rules

**Step 2: Record partial gaps if any remain**

Examples:

- role narrowing beyond current visibility rules
- unsupported direct action buttons
- thread history browser

**Step 3: Commit**

```bash
git add docs/FleetGraph/README.md FLEETGRAPH.md docs/plans/2026-03-17-fleetgraph-global-chat-context-design.md
git commit -m "docs: record fleetgraph persistent chat behavior"
```

## Final verification checklist

- `pnpm db:migrate`
- `pnpm --filter @ship/shared build`
- `pnpm --filter @ship/api test -- fleetgraph.test.ts`
- `pnpm --filter @ship/web test -- FleetGraphChat`
- `pnpm --filter @ship/web test -- useFleetGraphScope`
- `pnpm --filter @ship/api type-check`
- `pnpm --filter @ship/web type-check`

Do not run browser e2e for AI chat in this pass.

## Notes for the implementing engineer

- Keep edits narrow. This repo is already dirty.
- Do not reintroduce process-local chat state after the database tables exist.
- Reuse existing document access checks where possible.
- Prefer loading only the recent message window into the LLM prompt.
- If emptiness detection becomes unreliable, ship a conservative heuristic first and document the limitation.

