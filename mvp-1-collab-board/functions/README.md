# CollabBoard Functions

HTTP function endpoint:
- `POST /api/ai/command`

Provided by Firebase function export:
- `api`

## What it does
- Accepts AI command requests with Firebase bearer auth + `boardId`, `command`, `clientCommandId`.
- Stores command status in `boards/{boardId}/aiCommands/{clientCommandId}`.
- Applies per-board FIFO sequencing + lock for deterministic command execution.
- Enforces idempotency via `clientCommandId`.
- Executes dispatcher tools:
  - `createStickyNote`
  - `createShape`
  - `createFrame`
  - `createConnector` (acknowledged in MVP; render not implemented)
  - `moveObject`
  - `resizeObject`
  - `updateText`
  - `changeColor`
  - `getBoardState`

## Local install
```bash
npm install
```

## Deploy with Firebase
From `mvp-1-collab-board/` root:
```bash
firebase deploy --only functions
```
