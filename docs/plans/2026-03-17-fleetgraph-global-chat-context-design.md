# FleetGraph Global Chat Context Design

## Goal

Keep FleetGraph as one global chat per user and workspace, preserve the thread across refreshes and API restarts, inject live page context on every turn, and harden the current branch so page awareness stays correct and active-thread lookup stays unambiguous.

## Current Branch Baseline

This plan starts from the code already on this branch.

Already present:

- DB-backed `fleetgraph_chat_threads` and `fleetgraph_chat_messages`
- `GET /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat` with `threadId`
- server-side thread hydration from Postgres
- client thread hydration plus `New Thread` and `/new`
- per-turn `pageContext` payload in chat requests

Key references:

- `api/src/routes/fleetgraph.ts`
- `api/src/fleetgraph/runtime/persistence.ts`
- `shared/src/types/fleetgraph.ts`
- `web/src/hooks/useFleetGraph.ts`
- `web/src/components/fleetgraph/FleetGraphChat.tsx`

This doc describes the delta from that baseline. It is not a plan to re-introduce persistence from scratch.

## Remaining Problems

### 1. Page context is still too thin

The current client hook sends route, scope-derived surface, document id, and title. That is enough for continuity, but it is still missing the richer page-awareness this feature wants:

- docs/wiki surface detection
- empty-page detection
- breadcrumbs and associations
- explicit document type

Current code also falls back to `workspace` when the scope is outside `issue | project | sprint | workspace`, so docs pages are not described precisely enough yet.

### 2. Empty-page detection must use normalized content

`GET /api/documents/:id` is the wrong source for deciding whether a page is empty. That route returns metadata and associations. It does not normalize collaborative content from `yjs_state`.

For emptiness and drafting bias, use one of:

- editor-side cached TipTap content when the current page is already loaded in the app
- `GET /api/documents/:id/content` when cached editor content is unavailable

`GET /api/documents/:id/content` is the route that converts `yjs_state` into TipTap JSON when `content` is null, so it matches the real document body the user sees.

### 3. Single active thread needs a database invariant

Current code archives existing active threads before inserting a new one, and `GET /chat/thread` resolves ambiguity with `ORDER BY updated_at DESC LIMIT 1`.

That is helpful, but it is still application-level enforcement. The design requirement is stronger:

- exactly one active thread per `user + workspace`
- `/new` archives the previous active thread before the new one becomes active
- `GET /chat/thread` is deterministic because the database guarantees the invariant

This should be enforced with a partial unique index on active threads, plus thread-creation logic that archives and inserts atomically.

### 4. Per-turn page context auditability is partial

The branch stores last-page metadata on the thread row, which is enough for current UX. It does not yet persist full `pageContext` alongside each message.

If turn-by-turn auditability matters for debugging, replay, or future summarization, add `page_context_json` to `fleetgraph_chat_messages`. If thread-level last-page metadata is sufficient, keep the simpler model and state that choice explicitly.

### 5. Action confirmations are partly shipped already

The branch already has inline `Approve` and `Dismiss` controls in chat and fuller approval controls elsewhere in FleetGraph UI. Any remaining design work here is incremental:

- add `Snooze` in chat if desired
- expose direct executable CTAs only when wired
- keep `Suggested only` labeling when there is no linked alert

## Product Decisions

### 1. Keep the global-thread model

One active thread per `user + workspace` remains the right model.

- scope changes do not clear the thread
- current page context is injected per turn
- the active thread persists across refreshes and restarts

### 2. Rebase future work on the current branch

No design or implementation note should describe chat as process-local anymore. Persistence, thread endpoints, and `threadId` support are part of the baseline.

### 3. Empty-page detection uses content, not metadata

The source of truth for page emptiness is normalized document content:

- first choice: editor-side cached TipTap JSON
- fallback: `GET /api/documents/:id/content`

`GET /api/documents/:id` can still supply title or associations, but never emptiness.

### 4. Active-thread uniqueness is a hard invariant

The system should guarantee one active thread per `user + workspace` at the database level.

Minimum requirement:

- partial unique index for rows where `status = 'active'`
- archive previous active thread before or within the same transaction as new-thread creation
- tests that cover repeated `/new` and concurrent creation attempts

### 5. Page context stays small but correct

Recommended page-context shape:

```ts
type FleetGraphPageContext = {
  route: string;
  surface: 'docs' | 'issue' | 'project' | 'sprint' | 'workspace';
  documentId?: string;
  title?: string;
  documentType?: string;
  isEmpty?: boolean;
  breadcrumbs?: Array<{ id: string; title: string; type: string }>;
  belongsTo?: Array<{ id: string; title: string; type: string }>;
};
```

This remains intentionally small. The goal is correct page framing, not full document export.

### 6. Access rules stay aligned with document routes

FleetGraph should only use page data the authenticated user can already access through the normal app.

That applies to:

- page-context enrichment
- content-based emptiness checks
- any breadcrumb or association hydration

## Architecture Delta

### A. Thread persistence

Keep the existing DB-backed thread model. Harden it with:

- DB-enforced active-thread uniqueness
- deterministic archive/create behavior
- clear docs on whether per-message page context is required

### B. Client page-context builder

Extend the current client hook so it can:

1. detect docs/wiki pages explicitly
2. reuse editor-side content when already loaded
3. fetch `/api/documents/:id/content` only when needed
4. fetch association/context data only for lightweight page framing

### C. Server-side validation

Before using any supplied `pageContext.documentId`, verify the document is readable for the current user and workspace through the same access rules as document routes.

### D. Prompt assembly

Stable thread history comes from the persisted thread.

Current-turn page context comes from the current route and accessible page data.

If the two disagree, current-turn page context wins.

## API Notes

Current routes already exist:

- `GET /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat/thread`
- `POST /api/fleetgraph/chat`

Current documents routes already exist:

- `GET /api/documents/:id`
- `GET /api/documents/:id/content`

Design implication:

- thread APIs are baseline
- `/api/documents/:id/content` is the required route for emptiness checks
- `/api/documents/:id` stays metadata-only for this feature

## Testing Strategy

Per repo guidance, skip browser e2e for AI chat. Use API, unit, and component coverage.

Required coverage:

- active thread survives reload and route change
- repeated `/new` archives the previous active thread
- concurrent thread creation keeps one active thread
- page context changes without clearing the thread
- Yjs-backed docs are not misclassified as empty
- inaccessible document context is dropped
- docs/wiki page context reports the correct surface
- drafting-oriented prompts only appear when normalized content is actually empty

## Final Position

FleetGraph already crossed the persistence line on this branch. The remaining work is hardening and richer page-awareness:

- keep the DB-backed global thread model
- stop describing chat as in-memory or restart-unsafe
- derive emptiness from normalized document content
- enforce one active thread with a DB invariant
- enrich page context without broadening access
