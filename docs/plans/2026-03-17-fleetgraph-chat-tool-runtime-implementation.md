# FleetGraph Chat Tool Runtime Implementation

## Summary

FleetGraph chat now uses a dedicated server-side tool runtime instead of stuffing preloaded entity blobs directly into a single prompt.

The external `POST /api/fleetgraph/chat` contract stays stable:

- thread persistence still uses `fleetgraph_chat_threads` and `fleetgraph_chat_messages`
- request still accepts `entityType`, `entityId`, `question`, `threadId`, and tiny `pageContext`
- response still returns `threadId`, `branch`, `assessment`, `alerts`, and `message`

## What Changed

New backend runtime under `api/src/fleetgraph/chat/`:

- `runtime.ts`: bounded OpenAI Responses API loop
- `tools.ts`: FleetGraph chat tool registry and dispatch
- `data.ts`: chat data-access orchestration
- `data-queries.ts`: user/workspace-scoped DB query helpers
- `data-utils.ts`: compact summarizers and drift helpers
- `prompt.ts`: server instructions for the chat runtime
- `schema.ts`: structured output schema for final assessment JSON

Route integration in `api/src/routes/fleetgraph.ts` now:

- keeps thread resolution, message persistence, page-context persistence, and alert fetches
- calls the new chat runtime for `/api/fleetgraph/chat`
- maps tool results back into the existing `FleetGraphChatDebugInfo` shape
- still persists `chat_suggestion` alerts when the runtime proposes an action

## Current Retrieval Shape

The runtime exposes these tools:

- `fetch_issue_context`
- `fetch_sprint_context`
- `fetch_project_context`
- `fetch_workspace_signals`
- `fetch_entity_drift`
- `fetch_related_documents`

Design intent:

- keep `pageContext` hint-only
- let the model request deeper context on demand
- keep tool outputs compact and high-signal
- cap tool loops with a max-step guard

## Follow-up Hardening

The chat tool runtime follow-up is complete:

- chat tool reads no longer use the FleetGraph internal service-token client
- issue, sprint, project, workspace, drift, and related-document reads now resolve directly from server-side DB helpers
- root document reads enforce `userId` + `workspaceId` visibility via `getVisibilityContext` and `VISIBILITY_FILTER_SQL`
- related-document expansion also filters joined related rows by caller visibility
- auth-sensitive coverage now includes cross-scope issue rejection and per-user workspace signal reads

Residual work remains outside the chat runtime:

1. extract shared auth-aware query helpers so route handlers and chat stop duplicating visibility logic
2. harden older route surfaces like `/api/claude/context` and generic association helpers with the same related-row filtering rules
3. add broader auth regression coverage for private linked docs and sprint/project retro context across legacy routes

## Verification

Verified locally:

- `pnpm --filter @ship/api type-check`
- `DATABASE_URL=postgresql://localhost/ship_shipshape_test pnpm --filter @ship/api exec vitest run src/fleetgraph/chat/data.test.ts src/fleetgraph/chat/runtime.test.ts src/routes/fleetgraph.test.ts`
