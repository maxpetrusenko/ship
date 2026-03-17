# FleetGraph Implementation Rating

Date: 2026-03-17

Implementation-only review. `PRESEARCH.md` trigger-model drift intentionally skipped per request.

## CTO Summary

- MVP implementation score: **8.4/10**
- Full requirements implementation score: **8.3/10**
- Executive view: strong architecture, real runtime, incomplete proof layer
- Main score drag: missing LangSmith links, thin live FleetGraph proof, non-green durable HITL proof, no timed latency evidence
- Live deployment check performed on 2026-03-17:
  - `https://ship.187.77.7.226.sslip.io/docs` -> `200`
  - `https://ship.187.77.7.226.sslip.io/health` -> `200`

## MVP Requirements

| MVP requirement | Score | CTO view | How to test now | What still needed |
|---|---:|---|---|---|
| Graph running with proactive detection wired end to end | 8/10 | Real implementation, not just docs | Start API, confirm scheduler boot, verify sweeps enqueue sprint + issue runs, inspect audit rows | Capture one live proactive alert run |
| LangSmith tracing enabled with 2 shared links | 3/10 | Plumbing exists, deliverable missing | Set tracing env vars, run on-demand + proactive scenarios, confirm traces appear and `traceUrl` is returned or stored | Publish 2+ real public trace links |
| `FLEETGRAPH.md` Agent Responsibility complete | 10/10 | Clear ownership boundary, strong product framing | Review `FLEETGRAPH.md` Agent Responsibility against runtime behavior | None |
| `FLEETGRAPH.md` Use Cases complete, 5+ | 10/10 | Satisfies requirement cleanly | Review use-case table in `FLEETGRAPH.md` | None |
| Graph outline complete: nodes, edges, branching | 10/10 | Proper graph, visibly non-linear | Compare `api/src/fleetgraph/graph/builder.ts` and `api/src/fleetgraph/graph/edges.ts` to `FLEETGRAPH.md` | None |
| At least one HITL gate implemented | 8/10 | Approval flow is real, proof path incomplete | Exercise `POST /api/fleetgraph/alerts/:id/resolve`, verify CAS, expiry `410`, action execution path | Restore or refresh passing durable pause-resume proof |
| Running against real Ship data | 9/10 | Real REST fetches and real writes | Run with seeded/dev Ship API and real FleetGraph token, confirm fetchers and action executor hit real endpoints | One live authenticated FleetGraph run |
| Deployed and publicly accessible | 8/10 | Public app is live | Curl public app and health endpoints | Verify live FleetGraph endpoints too |
| Trigger model documented and defended | 10/10 | Clear, defensible, implementation-matched | Review trigger section in `FLEETGRAPH.md` against scheduler interval in code | None |

## Full Requirements

| # | Requirement | Score | CTO view | How to test now | What still needed |
|---|---|---:|---|---|---|
| 1 | Graph running with proactive detection e2e | 8/10 | End-to-end shape is real | Boot server, wait for sweep, verify queue drain and alerts/audit activity | Live proactive alert proof |
| 2 | LangSmith tracing enabled | 5/10 | Technically wired, operational proof absent | Trigger runs with LangSmith env set, confirm `traceUrl` in response or audit log | Real traced runs with public URLs |
| 3 | Agent Responsibility | 10/10 | Mature and specific | Read `FLEETGRAPH.md` and compare to runtime behavior | None |
| 4 | Use Cases 5+ | 10/10 | Complete | Review use-case table | None |
| 5 | Graph outline: nodes, edges, branching | 10/10 | Complete and consistent | Compare docs to graph builder | None |
| 6 | Human-in-the-loop gate | 8/10 | Strong implementation, medium proof | Route tests plus manual approval, expiry, and CAS checks | Green durable checkpoint proof |
| 7 | Real Ship data, no mocks | 9/10 | Real data path | Inspect `ShipApiClient`, typed fetchers, and action executor; run against real token | Live execution evidence |
| 8 | Deployed and publicly accessible | 8/10 | Public app confirmed | Curl app plus `/health` on deploy | FleetGraph route smoke on deploy |
| 9 | Trigger model documented | 10/10 | Strong | Review final trigger section | None |
| 10 | Context-aware embedded chat | 9/10 | Good UX architecture | Validate scope resolution and entity-fenced chat in UI and unit tests | Live screenshot or recording |
| 11 | Both proactive and on-demand modes | 9/10 | Both exist on one shared graph | Test scheduler path plus `POST /api/fleetgraph/on-demand` and `/chat` | Live proof of both modes |
| 12 | Conditional edges with different paths | 10/10 | Proper graph branching | Exercise `clean`, `inform_only`, `confirm_action`, and `error` paths | None |
| 13 | Error and fallback nodes | 9/10 | Good failure handling | Force API failure or invalid token, verify `error_fallback` and no speculative alert | Live fallback trace |
| 14 | Action nodes with real execution | 9/10 | Real writes, validated payloads | Approve action and inspect resulting Ship write | One live confirm-action execution |
| 15 | `<5 min` detection latency | 7/10 | Plausible by design, unproven in operation | Introduce stale or missed state and measure time to surfaced alert from sweep boundary | Timed proof run |
| 16 | Cost analysis documented | 8/10 | Good planning, limited measured data | Compare cost table with audit `tokenUsage` and traces | Replace assumptions with observed numbers |
| 17 | Test cases with trace links | 3/10 | Matrix exists, evidence absent | Review test-case table in `FLEETGRAPH.md` | Fill every trace link |
| 18 | Architecture decisions | 10/10 | Strong | Review architecture decisions table | None |
| 19 | Chat scoped to entity context | 9/10 | Correctly threaded end to end | Open issue, project, sprint, and workspace contexts and inspect requests | Live scope-switch proof |
| 20 | Parallel fetch nodes | 10/10 | Implemented correctly | Inspect `Promise.all()` fanout in `api/src/fleetgraph/data/fetchers.ts` | None |
| 21 | LangSmith trace links submitted | 2/10 | Missing submission artifact | Open `docs/FleetGraph/trace-links.md` and replace placeholders with public URLs | Submit real links |
| 22 | `PRESEARCH.md` completed | 10/10 | Complete | Read file | None |

## Best Current Test Strategy

| Area | Best test path |
|---|---|
| Scheduler and proactive mode | API tests plus manual seeded run |
| Chat scope | Web unit tests plus manual UI validation |
| HITL gate | Route tests first, then manual API resolve flow |
| Real execution | Manual dev or staging action against a safe test entity |
| Tracing | Live run with LangSmith env, then open and share traces |
| Deployment | Curl smoke against app, `/health`, then FleetGraph routes |
| Latency | Timed manual scenario on running scheduler |

## Recommended Commands

```bash
# API FleetGraph coverage
DATABASE_URL=postgresql://localhost/ship_shipshape_test \
corepack pnpm --filter @ship/api exec vitest run \
  src/routes/fleetgraph.test.ts \
  src/fleetgraph/runtime/scheduler.test.ts \
  src/fleetgraph/graph/nodes.test.ts \
  src/fleetgraph/data/fetchers.test.ts \
  src/fleetgraph/runtime/langsmith.test.ts

# Web FleetGraph coverage
corepack pnpm --filter @ship/web exec vitest run \
  src/components/fleetgraph/FleetGraphChat.test.tsx \
  src/components/fleetgraph/FleetGraphNotificationBell.test.tsx \
  src/hooks/useFleetGraphScope.test.ts

# Type safety
corepack pnpm --filter @ship/api type-check
corepack pnpm --filter @ship/web type-check
corepack pnpm --filter @ship/shared type-check

# Public deploy smoke
curl -I https://ship.187.77.7.226.sslip.io/health
curl -I https://ship.187.77.7.226.sslip.io/docs
```

## CTO Verdict

- Build quality: strong
- MVP completeness: good
- Submission readiness: medium
- Fastest path to raise scores:
  - real LangSmith links
  - live FleetGraph smoke on deployed env
  - green durable HITL proof
  - timed latency evidence
