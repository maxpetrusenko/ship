# FleetGraph Proof Pack

Date: 2026-03-17

## Closed in this pass

- Workspace scope is first class end to end. The launcher and chat send `entityType: "workspace"` instead of aliasing to `project`.
- Proactive scheduler fans out across sprint entities, live sprint issues, and linked project rollups, so stale issue and upstream scope drift have a real scheduled path.
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

## Live proof (captured 2026-03-20)

### Deployment verified
- `GET /health` -> `200 {"status":"ok"}`
- `GET /api/fleetgraph/status` -> `200 {"running":true,"lastSweepAt":"2026-03-20T18:33:16.036Z","sweepIntervalMs":240000,"alertsActive":6}`

### LangSmith traces (7 shared links)
All trace links are live in [`FLEETGRAPH.md`](../../FLEETGRAPH.md) Test Cases table. Branch diversity:
- `clean`: on-demand healthy issue (0 tokens, 349ms)
- `inform_only`: proactive scope_drift sweep (3 successful runs, ~1900 tokens each, 9-12s)
- `confirm_action`: on-demand scope_drift with proposed action (1911 tokens, 6.7s, traceUrl returned)
- `error`: pre-fix constraint violation trace (shows error fallback path)
- `workspace chat`: workspace-scope chat with 4 due-today items (9s, tool calls visible)

### Latency measurements
| Scenario | Latency | Method |
|----------|---------|--------|
| Clean on-demand (no LLM) | 349ms | `POST /on-demand` timed |
| Inform-only proactive | 9.9-12.3s | LangSmith trace `end_time - start_time` |
| Confirm-action on-demand | 6,707ms | `POST /on-demand` timed |
| Workspace chat | 8,996ms | `POST /chat` timed |
| Full sweep (3 issues) | 33,608ms | Server log `Sweep complete in` |
| Sweep interval | 240,000ms | 4 minutes, well under 5-min detection SLA |

### Token costs (observed)
- Average per LLM run: ~1,880 tokens (1,740 input + 150 output)
- Cost per run: ~$0.00027 (gpt-4o-mini)
- Clean runs: 0 tokens (heuristic exit before LLM)
- Total 28 pre-fix runs: $0.007625

### Bug fix deployed
- `idx_fleetgraph_approvals_pending` constraint violation fixed (approval upsert)
- Pre-fix: 26/28 runs errored. Post-fix: 3/3 runs succeeded.
