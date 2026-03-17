# FleetGraph Proof Pack

Date: 2026-03-17

## Closed in this pass

- Workspace scope is first class end to end. The launcher and chat send `entityType: "workspace"` instead of aliasing to `project`.
- Proactive scheduler fans out across sprint entities and issue entities, so stale issue and scope drift now have a real scheduled path.
- Manager missed-standup proof is deterministic. The route test freezes time and asserts the overdue path directly.
- Docs now match runtime on notification center status, proactive broadcast semantics, and HITL pause/resume wording.

## Local verification evidence

Ran:

```bash
DATABASE_URL=postgresql://localhost/ship_shipshape_test pnpm --filter @ship/api exec vitest run \
  src/routes/accountability-manager.test.ts \
  src/routes/fleetgraph.test.ts \
  src/fleetgraph/runtime/scheduler.test.ts \
  src/fleetgraph/graph/nodes.test.ts \
  src/fleetgraph/data/fetchers.test.ts \
  --reporter=dot

pnpm --filter @ship/web exec vitest run \
  src/components/fleetgraph/FleetGraphChat.test.tsx \
  src/hooks/useFleetGraphScope.test.ts \
  --reporter=dot

pnpm --filter @ship/api type-check
pnpm --filter @ship/web type-check
pnpm --filter @ship/shared type-check
```

Observed results:

- API tests: 5 files passed, 51 tests passed
- Web tests: 2 files passed, 17 tests passed
- Type-check: `@ship/api`, `@ship/web`, and `@ship/shared` exited `0`

Not run in this pass:

- E2E tests. Repo instruction currently says not to run them.

## Live proof still pending

The following submission artifacts still need a live environment run:

- Shared LangSmith trace links
- Notification center screenshot
- Confirm-action pause/resume screenshot or recording
- Workspace chat screenshot

Current blockers in shell env:

- `LANGCHAIN_API_KEY` missing
- `OPENAI_API_KEY` missing
- `FLEETGRAPH_API_TOKEN` missing
- `FLEETGRAPH_WORKSPACE_ID` missing
- `DATABASE_URL` missing

## Capture checklist once env is present

1. Export `LANGCHAIN_API_KEY`, `OPENAI_API_KEY`, `FLEETGRAPH_API_TOKEN`, `FLEETGRAPH_WORKSPACE_ID`, and `DATABASE_URL`.
2. Start Ship and generate traces from the scenarios in [`trace-links.md`](./trace-links.md).
3. Replace `[PENDING]` links in [`FLEETGRAPH.md`](../../FLEETGRAPH.md) and [`trace-links.md`](./trace-links.md).
4. Capture screenshots for notification center, confirm-action approval card, and workspace chat.
5. Attach those artifacts to the submission pack.
