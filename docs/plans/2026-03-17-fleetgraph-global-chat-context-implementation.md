# FleetGraph Global Chat Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the current DB-backed FleetGraph chat implementation so page awareness is correct, active-thread behavior is unambiguous, and remaining UX gaps are tracked as incremental work instead of re-planning persistence from scratch.

**Architecture:** Use the current thread persistence and thread endpoints as the baseline. Focus follow-up work on three gaps: DB-enforced single-active-thread behavior, correct empty-page detection from normalized content, and richer page-context construction for docs/wiki pages.

**Tech Stack:** TypeScript, PostgreSQL, Express, React, React Query, Vitest, Testing Library.

---

## Current Branch Baseline

Already implemented on this branch:

1. `fleetgraph_chat_threads` and `fleetgraph_chat_messages`
2. `GET /api/fleetgraph/chat/thread`
3. `POST /api/fleetgraph/chat/thread`
4. `POST /api/fleetgraph/chat` with `threadId` and `pageContext`
5. DB-backed thread hydration in API and web
6. `New Thread` button and `/new`
7. inline `Approve` and `Dismiss` controls in chat

This plan starts after that work. Do not re-add persistence or re-describe chat as process-local.

## Working Decisions

1. One active FleetGraph thread per user and workspace remains the product model.
2. The database should enforce that invariant, not only application code.
3. Empty-page detection uses normalized document content, not metadata routes.
4. Reuse editor-side cached document content when available.
5. `GET /api/documents/:id/content` is the fallback source for emptiness checks.
6. Skip Playwright for this feature per repo temp note. Use API, unit, and component tests.

## Task 1: Harden the active-thread invariant

**Files:**
- Create: `api/src/db/migrations/046_fleetgraph_chat_active_thread_unique.sql`
- Modify: `api/src/db/schema.sql`
- Modify: `api/src/fleetgraph/runtime/persistence.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Why:**

Current `createThread()` archives existing active rows before insert, and `getActiveThread()` resolves ambiguity with `ORDER BY updated_at DESC LIMIT 1`. That is useful, but the database still allows multiple active rows.

**Step 1: Write failing tests**

Cover:

- repeated `POST /api/fleetgraph/chat/thread` leaves exactly one active thread
- concurrent create attempts still leave one active thread
- `GET /api/fleetgraph/chat/thread` always resolves to the unique active row

Run:

```bash
pnpm --filter @ship/api test -- fleetgraph.test.ts
```

**Step 2: Add DB enforcement**

Add a partial unique index equivalent to:

```sql
CREATE UNIQUE INDEX ... ON fleetgraph_chat_threads (workspace_id, user_id)
WHERE status = 'active';
```

**Step 3: Make creation atomic**

Update thread creation logic so archive + insert happens safely with the new uniqueness rule. Transaction or equivalent CTE-based flow is fine.

**Step 4: Re-run tests**

Expected:

- active-thread tests pass

## Task 2: Fix empty-page detection source

**Files:**
- Modify: `web/src/hooks/useFleetGraphPageContext.ts`
- Modify: `api/src/routes/documents.ts` only if a helper extraction improves reuse
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`
- Test: `web/src/hooks/useFleetGraphScope.test.ts`

**Why:**

`GET /api/documents/:id` returns metadata and associations. It is not the correct signal for page emptiness, especially when content lives in `yjs_state`.

**Step 1: Write failing tests**

Cover:

- collaborative doc with `content = null` and `yjs_state` content is treated as non-empty
- truly empty docs/wiki pages are treated as empty
- missing or inaccessible content fails closed and omits emptiness-based drafting bias

Run:

```bash
pnpm --filter @ship/web test -- FleetGraphChat
```

**Step 2: Use the right source**

Implement this order:

1. reuse editor-side cached TipTap JSON when already available
2. otherwise fetch `GET /api/documents/:id/content`
3. use `GET /api/documents/:id/context` or similar lightweight routes only for associations/breadcrumbs

Never use `GET /api/documents/:id` as the emptiness source.

**Step 3: Re-run tests**

Expected:

- Yjs-backed and empty-doc cases pass

## Task 3: Expand page-context builder from current thin payload

**Files:**
- Modify: `web/src/hooks/useFleetGraphPageContext.ts`
- Modify: `shared/src/types/fleetgraph.ts`
- Test: `web/src/hooks/useFleetGraphScope.test.ts`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Why:**

Current page context is limited to route, scope-derived surface, document id, and title. Docs/wiki pages still need correct surface, type, emptiness, and light breadcrumb context.

**Step 1: Write failing tests**

Cover:

- docs/wiki page maps to `surface: 'docs'`
- page context includes `documentType` where available
- empty docs/wiki pages set `isEmpty`
- breadcrumbs or `belongsTo` only appear when available and accessible

**Step 2: Implement richer context**

Keep the payload small:

- `route`
- `surface`
- `documentId`
- `title`
- `documentType`
- `isEmpty`
- lightweight breadcrumb or association context

**Step 3: Re-run web tests**

Expected:

- page-context coverage passes

## Task 4: Decide whether per-message page context must be persisted

**Files:**
- Optional create: `api/src/db/migrations/047_fleetgraph_chat_message_page_context.sql`
- Optional modify: `api/src/db/schema.sql`
- Optional modify: `api/src/fleetgraph/runtime/persistence.ts`
- Optional modify: `shared/src/types/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Why:**

Current branch stores last-page metadata on the thread row. If that is enough, keep it and document the choice. If turn-by-turn auditability matters, persist `pageContext` with each message.

**Decision gate:**

- If debugging, replay, or summarization needs past page context, implement `page_context_json`.
- If current UX only needs latest page identity, keep thread-level metadata and mark message-level storage out of scope.

**Step 1: Record the decision**

Update this plan and the design doc with the chosen scope.

**Step 2: Implement only if needed**

If chosen, add the column, write persistence tests, and store page context with each appended message.

## Task 5: Finish page-aware UX polish

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphChat.tsx`
- Modify: `web/src/components/fleetgraph/FleetGraphFloatingChat.tsx`
- Test: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Why:**

Thread persistence is already present. The remaining UX work is page-aware framing.

**Step 1: Write failing tests**

Cover:

- page header or chip reflects docs/wiki identity
- empty docs/wiki pages bias quick prompts toward drafting help
- non-empty docs/wiki pages avoid false drafting prompts

**Step 2: Implement UI polish**

Add only what the richer page context can support truthfully.

Keep suggestion-only states explicit when action wiring is incomplete.

**Step 3: Re-run tests**

Expected:

- page-aware UI tests pass

## Task 6: Verification

Run the smallest relevant gate for the changed surface:

```bash
pnpm --filter @ship/shared build
pnpm --filter @ship/api test -- fleetgraph.test.ts
pnpm --filter @ship/web test -- FleetGraphChat
```

Add more targeted test commands if the touched files require them.

## Done When

- docs stop claiming FleetGraph chat is process-local
- implementation steps treat DB persistence and thread endpoints as baseline
- empty-page detection depends on normalized content
- active-thread uniqueness is either DB-enforced or explicitly tracked as the next blocking task
- remaining optional work, like per-message `pageContext`, is called out as a scoped decision instead of implicit drift
