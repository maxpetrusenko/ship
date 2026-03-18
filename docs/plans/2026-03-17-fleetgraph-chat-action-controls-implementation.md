# FleetGraph Chat Action Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show compact approve/dismiss controls for FleetGraph chat suggestions by carrying a stable `alertId` on each assistant message.

**Architecture:** Keep the resolve API and chat route shape mostly intact. Extend the chat message contract with an optional `alertId`, populate it in the route response after alert lookup, and let the web chat render icon buttons from that per-message id.

**Tech Stack:** TypeScript, React, Vitest, Express.

---

### Task 1: Add the failing chat UI test

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphChat.test.tsx`

**Step 1: Write the failing test**

Cover an assistant message with:

- `assessment.proposedAction`
- `message.alertId`
- one returned alert

Assert chat renders:

- `Suggested Change`
- `Approve`
- `Dismiss`

### Task 2: Carry alert ids through the shared contract and route

**Files:**
- Modify: `shared/src/types/fleetgraph.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Modify: `api/src/routes/fleetgraph.test.ts`

**Step 1: Write minimal implementation**

- add optional `alertId` to `FleetGraphChatMessage`
- set `assistantMessage.alertId` from the active alert created/fetched for the chat response
- lock the route response with a focused test

### Task 3: Render compact icon controls from per-message alert ids

**Files:**
- Modify: `web/src/components/fleetgraph/FleetGraphChat.tsx`

**Step 1: Write minimal implementation**

- remove shared latest-alert state
- feed `message.alertId` into each chat bubble
- replace text buttons with icon buttons
- preserve accessible labels `Approve` and `Dismiss`

### Task 4: Verify focused suites

Run:

```bash
pnpm --filter @ship/web test -- --run src/components/fleetgraph/FleetGraphChat.test.tsx
pnpm --filter @ship/api exec vitest run src/routes/fleetgraph.test.ts
```

### Done When

- chat suggestions show compact action controls
- controls remain keyboard and screen-reader accessible
- each chat message resolves the correct alert
