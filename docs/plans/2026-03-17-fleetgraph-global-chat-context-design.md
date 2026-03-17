# FleetGraph Global Chat Persistence and Live Context Design

## Goal

Keep FleetGraph as one global chat per user and workspace, preserve the conversation across refreshes and server restarts, inject live page context on every turn, and ensure the assistant only sees data the current user can access.

## Problem

Current FleetGraph chat is session-local in the browser and process-local on the server.

- Refresh loses visible state in the UI.
- API restart loses thread history because chat state lives in an in-memory `Map` in `api/src/routes/fleetgraph.ts`.
- Scope is derived correctly for FleetGraph analysis, but the assistant does not reliably acknowledge the actual page the user is on.
- `confirm_action` messages read like suggestions more than actionable controls.
- There is no explicit `New chat` affordance.

This leads to a bad UX for long-running work: the user can move around the app, come back after a restart, and lose the conversation or have the assistant ignore the current page.

## Product Decisions

### 1. One global chat

FleetGraph keeps one active chat thread per `user + workspace`.

- The thread persists in the database.
- The user can explicitly start a fresh thread with a header `+` button or `/new` in the input.
- Scope changes do not clear the thread.
- The current page is injected into each turn as runtime context.

This is intentionally different from a per-page or per-entity thread model. The thread is global; the context is per turn.

### 2. Page context is first-class

Every message send includes a page envelope describing where the user currently is.

Minimum fields:

- route
- page surface: `docs`, `issue`, `project`, `sprint`, or `workspace`
- document id when present
- title when present
- document type when present
- empty or non-empty state
- lightweight breadcrumb and association context when available

This allows replies like:

- `You're in Docs / Architecture Guide. This page is empty. Need help drafting?`
- `You're in Project X / Week 11 retro. I can summarize risks or help rewrite this.`

### 3. No screenshot dependence

The assistant should use app and API state, not screenshots, for routine page awareness.

Primary sources already exist:

- route plus `CurrentDocumentContext`
- `GET /api/documents/:id`
- `GET /api/documents/:id/context`

Screenshots remain optional debugging evidence, not the normal context path.

### 4. Access policy must be real

FleetGraph should not invent a broader access model than the rest of the app.

Today, current access is primarily:

- workspace member: workspace-visible documents
- creator: own private documents
- admin: full workspace visibility

Future role policy can narrow this further, for example:

- `dev`: assigned projects, assigned issues, and related sprint context only

FleetGraph must respect the same access rules the user already has through normal routes. If context cannot be read through the authenticated session, FleetGraph cannot use it.

### 5. Action confirmations must be actionable

`confirm_action` cards need real controls, not only text.

Minimum controls:

- `Approve`
- `Dismiss`
- `Snooze`

If a proposed domain action is fully wired, show the direct action CTA. If it is not fully wired, the UI should say so explicitly rather than pretending the feature exists.

### 6. Missing capability must be traceable

If page-aware prompting, role policy, or executable action coverage is only partial in a given milestone, the gap should be documented in `docs/plans` and implementation notes so the team can trace what shipped and what remains.

## Current System Constraints

### Existing page context sources

- `web/src/contexts/CurrentDocumentContext.tsx`
- `web/src/pages/UnifiedDocumentPage.tsx`
- `web/src/hooks/useFleetGraphScope.ts`
- `api/src/routes/documents.ts`
- `api/src/routes/associations.ts`

### Existing FleetGraph chat path

- `web/src/components/fleetgraph/FleetGraphChat.tsx`
- `web/src/hooks/useFleetGraph.ts`
- `api/src/routes/fleetgraph.ts`
- `shared/src/types/fleetgraph.ts`

### Main limitation

`api/src/routes/fleetgraph.ts` stores conversation history in a process-local `Map`. That makes the feature inherently non-persistent and restart-unsafe.

## Architecture

## A. Persistence model

Add two FleetGraph chat tables:

### `fleetgraph_chat_threads`

- `id`
- `workspace_id`
- `user_id`
- `title` nullable
- `status` as `active | archived`
- `created_at`
- `updated_at`
- `last_page_type` nullable
- `last_page_id` nullable
- `last_page_title` nullable
- `last_route` nullable

### `fleetgraph_chat_messages`

- `id`
- `thread_id`
- `role`
- `content`
- `assessment_json` nullable
- `debug_json` nullable
- `page_context_json` nullable
- `created_at`

This supports:

- restart-safe persistence
- future chat history UI
- turn-by-turn auditability of what page context was present

## B. Request flow

### On the client

When the user submits a message:

1. Resolve current page context from route and app state.
2. If on a document page, fetch document and document-context data only if not already cached.
3. Send:
   - `threadId`
   - `question`
   - current FleetGraph entity scope
   - `pageContext`

### On the server

1. Authenticate user and workspace as usual.
2. Verify the requested thread belongs to `user + workspace`.
3. Verify any supplied `documentId` is readable by that user.
4. Load recent thread history from the database.
5. Build the graph input with:
   - prior thread history
   - current page context
   - current question
   - current entity scope
6. Persist both user and assistant messages.
7. Return assistant message plus updated thread metadata.

## C. Prompt assembly

The assistant should receive two layers of context:

### Stable thread history

What the user asked earlier and what FleetGraph answered earlier.

### Current-turn page context

Where the user is right now. This should be treated as current truth even when the thread itself is older.

This allows a single global thread to move across pages without losing continuity or pretending the page never changed.

## D. Access policy layer

Add one server-side access helper for FleetGraph chat hydration.

Responsibilities:

- resolve whether the user can access a document or entity
- filter page-context enrichment to accessible records only
- support future custom role narrowing such as `dev -> assigned projects only`
- centralize permission logic so FleetGraph does not drift from app behavior

This helper should gate:

- page context hydration
- thread restoration
- suggested follow-up data fetches
- proactive and on-demand action suggestions

## E. UI behavior

### Header

The floating chat header should show both FleetGraph identity and page identity.

Suggested structure:

- `FleetGraph`
- workspace chip
- page chip:
  - `Docs`
  - `Architecture Guide`
  - `Empty`

### New chat

Add:

- a `+` button in the header
- `/new` input command

Both create a fresh active thread.

### Empty page behavior

If the current page is a wiki or docs page with effectively empty content, the assistant should bias toward drafting help.

Quick prompts can become page-aware:

- `Draft outline`
- `Write intro`
- `Create architecture template`

### Action confirmations

`confirm_action` cards should surface executable controls and explicit unsupported states:

- `Approve`
- `Dismiss`
- `Snooze`
- domain action button when available
- `Suggested only` label when not available

## API Changes

### Shared types

Extend `shared/src/types/fleetgraph.ts` with:

- `FleetGraphPageContext`
- persistent thread response shapes
- thread metadata

### API routes

Add or extend these routes in `api/src/routes/fleetgraph.ts`:

- `GET /api/fleetgraph/chat/thread`
  - return current active thread plus recent messages
- `POST /api/fleetgraph/chat/thread`
  - create a new thread
- `POST /api/fleetgraph/chat`
  - append message to existing or active thread using `pageContext`

The current in-memory conversation store should be removed once database-backed storage is in place.

## Data Contract

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

This should stay intentionally small. It is enough to guide the assistant without turning every message send into a full document export.

## Testing Strategy

Per current repo guidance, skip browser e2e for AI chat. Use API, component, and unit coverage.

Required coverage:

- thread survives route change and reload
- server restart simulation restores persisted thread
- page context changes without clearing the thread
- empty docs page produces drafting-oriented assistant framing
- inaccessible document context is not injected
- `+` creates new thread
- `/new` creates new thread
- `confirm_action` renders actionable controls
- custom access policy can narrow visible scope for non-admin roles

## Rollout Notes

### Milestone 1

- DB-backed persistence
- active-thread APIs
- client page-context payload
- `+` and `/new`

### Milestone 2

- page-aware quick prompts
- empty-page drafting bias
- action-card improvements

### Milestone 3

- explicit FleetGraph role-policy helper
- future thread history picker
- message compaction and summaries

## Known Gaps to Track If Only Partially Shipped

- custom role narrowing beyond current workspace and visibility rules
- per-action execution coverage for all suggested actions
- thread history browser beyond single active thread

## Final Position

FleetGraph should behave like a persistent workspace assistant with live page awareness, not a disposable per-refresh widget and not a screenshot-driven chatbot.

One global thread plus strict per-turn page context is the cleanest model for this repo:

- stable user continuity
- accurate current-page awareness
- access-safe data use
- room for future role-based narrowing

