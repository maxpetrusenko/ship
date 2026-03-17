# LangGraph and LangSmith Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready reference for integrating LangGraph JS, LangSmith tracing, and the OpenAI SDK into the Ship TypeScript backend. After reading this document, a developer should be able to install packages, define the FleetGraph state graph, enable tracing, parse structured model outputs, wire Postgres persistence, implement human-in-the-loop interrupts, and run parallel fetch nodes without consulting external documentation.

## 1. Package Dependencies

### Required packages

```bash
pnpm add @langchain/langgraph @langchain/core openai
pnpm add @langchain/langgraph-checkpoint-postgres
```

### Version matrix (as of March 2026)

| Package | Version | Notes |
|---------|---------|-------|
| `@langchain/langgraph` | `^1.0.24` | Requires Node >= 20 |
| `@langchain/core` | `^1.0.1` | Peer dep of langgraph |
| `@langchain/langgraph-checkpoint-postgres` | `^1.0.1` | Peer deps: `@langchain/core ^1.0.1`, `@langchain/langgraph-checkpoint ^1.0.0` |
| `openai` | `^5.x` | The Responses API requires v5+ |
| `zod` | `^3.24.1` | Already installed in Ship API. LangGraph accepts `^3.25.32 \|\| ^4.1.0` |

### Already present in Ship API

These packages are already in `@ship/api` and do not need to be added:

- `zod` (^3.24.1)
- `pg` (^8.13.1) used by the checkpoint-postgres package
- `typescript` (^5.7.2)
- `tsx` for dev

### TypeScript configuration

LangGraph JS requires `"moduleResolution": "bundler"` or `"node16"` in tsconfig. Ship API uses ESM (`"type": "module"` in package.json), which is compatible. No tsconfig changes should be necessary. If type resolution fails for `@langchain/*` packages, add:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

### Node.js version

LangGraph requires Node 20+. Ship API should be running Node 20 or 22 LTS. Verify with `node --version` before installing.

---

## 2. Graph Definition Patterns

### State annotation

LangGraph JS uses `Annotation.Root` to define the graph's shared state schema. Each field is an `Annotation<T>` channel. By default, each channel uses last-write-wins semantics. For append semantics, provide a reducer function.

```typescript
import { Annotation } from "@langchain/langgraph";

// Simple last-write-wins channel
const MyState = Annotation.Root({
  count: Annotation<number>,
  name: Annotation<string>,
});

// Channel with a reducer (append semantics)
const AccumulatingState = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  lastSpeaker: Annotation<string>,
});
```

The `Annotation<T>` call without arguments creates a `LastValue` channel that stores the most recent value. The `Annotation<T>({ reducer, default })` overload creates a `BinaryOperatorAggregate` channel that merges values using the reducer function.

**Types extracted from state:**

```typescript
// The full state shape (all fields populated)
type State = typeof MyState.State;

// The update shape (all fields optional, used as node return type)
type Update = typeof MyState.Update;
```

### StateGraph construction

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";

const graph = new StateGraph(FleetGraphState)
  // Register nodes: name + async function
  .addNode("trigger_context", triggerContext)
  .addNode("fetch_core_context", fetchCoreContext)
  .addNode("fetch_parallel_signals", fetchParallelSignals)
  .addNode("heuristic_filter", heuristicFilter)
  .addNode("reason_about_risk", reasonAboutRisk)
  .addNode("prepare_notification", prepareNotification)
  .addNode("prepare_action", prepareAction)
  .addNode("human_gate", humanGate)
  .addNode("execute_action", executeAction)
  .addNode("error_fallback", errorFallback)

  // Linear edges
  .addEdge(START, "trigger_context")
  .addEdge("trigger_context", "fetch_core_context")
  .addEdge("fetch_core_context", "fetch_parallel_signals")
  .addEdge("fetch_parallel_signals", "heuristic_filter")
  .addEdge("heuristic_filter", "reason_about_risk")

  // Conditional edge after reasoning
  .addConditionalEdges("reason_about_risk", branchDecision, {
    no_issue: END,
    inform_only: "prepare_notification",
    confirm_action: "prepare_action",
    error: "error_fallback",
  })

  .addEdge("prepare_notification", END)
  .addEdge("prepare_action", "human_gate")

  // Conditional edge after human decision
  .addConditionalEdges("human_gate", postApprovalBranch, {
    execute_action: "execute_action",
    log_dismissed: END,
    log_snoozed: END,
  })

  .addEdge("execute_action", END)
  .addEdge("error_fallback", END);
```

### Node function signature

Every node receives the current state and returns a partial state update:

```typescript
async function triggerContext(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  return {
    mode: "proactive",
    traceId: crypto.randomUUID(),
  };
}
```

### Conditional edge function

The routing function receives state and returns a string key that maps to a node name:

```typescript
function branchDecision(
  state: typeof FleetGraphState.State
): "no_issue" | "inform_only" | "confirm_action" | "error" {
  if (state.error) return "error";
  if (state.candidates.length === 0) return "no_issue";
  if (state.riskAssessment?.overallSeverity === "none") return "no_issue";
  if (
    state.riskAssessment?.suggestedAction.type === "mutate" &&
    state.riskAssessment.confidence >= 60
  ) {
    return "confirm_action";
  }
  return "inform_only";
}
```

The second argument to `addConditionalEdges` maps each return value to a node name (or `END`). If the map is omitted, the return value must exactly match a registered node name.

### Compilation

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const checkpointer = new PostgresSaver(pool);
await checkpointer.setup(); // Creates tables on first run

const app = graph.compile({
  checkpointer,
  interruptBefore: ["human_gate"], // Pause before this node
});
```

The compiled graph is invoked with:

```typescript
const result = await app.invoke(
  {
    entityId: "issue-uuid",
    entityType: "issue",
    workspaceId: "workspace-uuid",
  },
  {
    configurable: { thread_id: "unique-thread-id" },
  }
);
```

### addSequence shorthand

For strictly linear sections of the graph, `addSequence` avoids repetitive `addEdge` calls:

```typescript
graph.addSequence([
  ["trigger_context", triggerContext],
  ["fetch_core_context", fetchCoreContext],
  ["fetch_parallel_signals", fetchParallelSignals],
  ["heuristic_filter", heuristicFilter],
  ["reason_about_risk", reasonAboutRisk],
]);
```

This registers all five nodes and automatically wires edges between them in order.

---

## 3. LangSmith Tracing Integration

### Environment variables

```bash
# Required
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGCHAIN_PROJECT=fleetgraph-dev

# Optional: custom endpoint (default: https://api.smith.langchain.com)
LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
```

Set these in the Ship API `.env.local` file. When `LANGCHAIN_TRACING_V2=true` is set, all LangGraph executions are automatically traced. No code changes are required for basic tracing.

### How traces appear with LangGraph

LangGraph integrates with LangSmith out of the box when the environment variables above are set. Each `graph.invoke()` call produces a trace containing:

- A root run for the graph invocation
- Child runs for each node execution (named after the node)
- Input and output state for each node
- The conditional edge decisions
- Timing for each step
- Any LLM calls made within nodes (if using LangChain model wrappers)

The trace tree mirrors the graph execution path, making it easy to see which branch was taken.

### Custom metadata and tags per run

Pass metadata and tags through the `configurable` object or the run config:

```typescript
const result = await app.invoke(
  { entityId: "issue-123", entityType: "issue", workspaceId: "ws-1" },
  {
    configurable: { thread_id: "thread-abc" },
    metadata: {
      mode: "proactive",
      entityType: "issue",
      entityId: "issue-123",
      workspaceId: "ws-1",
      decisionBranch: "pending", // Updated by branch_decision at runtime
    },
    tags: ["fleetgraph", "proactive", "issue"],
  }
);
```

Metadata is searchable in the LangSmith dashboard. Tags enable filtering traces by category.

### Adding metadata from within a node

Use `getConfig()` to access the current run config from inside a node:

```typescript
import { getConfig } from "@langchain/langgraph";

async function reasonAboutRisk(state: typeof FleetGraphState.State) {
  const config = getConfig();
  // config.metadata, config.tags are available

  // To update metadata for downstream visibility, include it in state
  // LangSmith captures state updates automatically
  return { riskAssessment: assessment };
}
```

### Tracing OpenAI calls (without LangChain wrappers)

When using the native `openai` SDK directly (not LangChain's `ChatOpenAI`), calls are not automatically traced by LangSmith. To trace them, use the LangSmith `wrapOpenAI` wrapper:

```typescript
import { wrapOpenAI } from "langsmith/wrappers";
import OpenAI from "openai";

const openai = wrapOpenAI(new OpenAI());

// All openai.responses.* and openai.chat.completions.* calls are now traced
const response = await openai.responses.parse({
  model: "gpt-4.1",
  input: [{ role: "user", content: "Analyze this" }],
  text: { format: zodResponseFormat(RiskAssessmentSchema, "risk_assessment") },
});
```

The `wrapOpenAI` function patches the OpenAI client to emit LangSmith trace spans for every API call, capturing request/response payloads, latency, and token usage.

### Getting shareable trace links programmatically

LangSmith trace URLs follow a predictable format. The run ID is available from the graph's response metadata:

```typescript
import { Client as LangSmithClient } from "langsmith";

const langsmith = new LangSmithClient();

// After a graph invocation, get the run URL
const result = await app.invoke(input, config);

// The run ID is available in the callback metadata
// Construct the URL from the project and run ID
const traceUrl = `https://smith.langchain.com/o/${orgId}/projects/p/${projectId}/r/${runId}`;
```

Alternatively, use the LangSmith client to fetch recent runs:

```typescript
const runs = langsmith.listRuns({
  projectName: "fleetgraph-dev",
  filter: 'has(metadata, "entityId") and eq(metadata["entityId"], "issue-123")',
  limit: 1,
});

for await (const run of runs) {
  console.log(run.url); // Direct link to the trace
}
```

### Trace link helper for FleetGraph

```typescript
function buildTraceLink(traceId: string): string {
  const project = process.env.LANGCHAIN_PROJECT || "fleetgraph-dev";
  // Use traceId as thread_id, then look up the run in LangSmith
  // In practice, store the mapping traceId -> runId after invocation
  return `https://smith.langchain.com/projects/${project}?filter=has(metadata,"traceId") and eq(metadata["traceId"],"${traceId}")`;
}
```

---

## 4. OpenAI SDK Integration with LangGraph

### Why the native OpenAI SDK instead of LangChain's ChatOpenAI

The Ship API does not use LangChain's model wrappers. The decision (from the Presearch README) is to use the `openai` npm package directly because:

1. `responses.parse()` integrates natively with Zod, which Ship already uses everywhere
2. No extra abstraction layer between Ship's existing patterns and the model call
3. The OpenAI Responses API offers features (structured outputs, reasoning tokens) that LangChain wrappers may lag behind on
4. LangGraph nodes are just async functions. They can call any SDK.

### Using the OpenAI Responses API in a LangGraph node

```typescript
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { wrapOpenAI } from "langsmith/wrappers";

// Wrap once at module scope for LangSmith tracing
const openai = wrapOpenAI(new OpenAI());

// Define the response schema with Zod
const RiskAssessmentSchema = z.object({
  overallSeverity: z.enum(["none", "low", "medium", "high", "critical"]),
  explanation: z.string().describe("2-3 sentence explanation"),
  recommendation: z.string().describe("Concrete next action"),
  suggestedAction: z.object({
    type: z.enum(["no_action", "notify", "mutate"]),
    target: z.string().optional().describe("Entity ID to act on"),
    payload: z.record(z.unknown()).optional(),
  }),
  confidence: z.number().int().min(0).max(100),
});

type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// The LangGraph node
async function reasonAboutRisk(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  if (state.candidates.length === 0) {
    return { riskAssessment: null };
  }

  const response = await openai.responses.parse({
    model: "gpt-4.1",
    instructions: buildSystemPrompt(state.entityType, state.mode),
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidates: state.candidates,
          context: summarizeContext(state.coreContext),
        }),
      },
    ],
    text: {
      format: zodResponseFormat(RiskAssessmentSchema, "risk_assessment"),
    },
  });

  return {
    riskAssessment: response.output_parsed as RiskAssessment,
  };
}
```

### How responses.parse() works

1. `zodResponseFormat(schema, name)` converts the Zod schema to a JSON Schema and wraps it in the `response_format` structure that OpenAI expects
2. The model is constrained to produce output matching that JSON Schema (strict mode)
3. `responses.parse()` calls `responses.create()` internally, then validates and parses the response through the Zod schema
4. The parsed result is available at `response.output_parsed` as a fully typed TypeScript object
5. If parsing fails (model produced invalid JSON, or Zod validation fails), an error is thrown

### Differences from LangChain model wrappers

| Aspect | Native OpenAI SDK | LangChain ChatOpenAI |
|--------|------------------|---------------------|
| Structured output | `responses.parse()` + `zodResponseFormat()` | `.withStructuredOutput(zodSchema)` |
| Tracing | Requires `wrapOpenAI()` | Automatic with LangSmith env vars |
| Model access | All OpenAI features immediately | May lag behind new API features |
| Type safety | Zod schema inference (`z.infer<>`) | LangChain's own type system |
| Import | `import OpenAI from "openai"` | `import { ChatOpenAI } from "@langchain/openai"` |
| Extra deps | None beyond `openai` | `@langchain/openai` package |

### Chat completions alternative (if not using Responses API)

The `chat.completions.parse()` method also supports structured outputs:

```typescript
const completion = await openai.chat.completions.parse({
  model: "gpt-4.1",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ],
  response_format: zodResponseFormat(RiskAssessmentSchema, "risk_assessment"),
});

const parsed = completion.choices[0]?.message?.parsed;
```

The Responses API (`responses.parse`) is preferred for FleetGraph because it supports `instructions` (system prompt) and `input` (messages) as distinct fields, aligning with how LangGraph nodes structure their prompts.

---

## 5. Persistence with PostgresSaver

### Why Postgres checkpointing

FleetGraph needs persistence for two reasons:

1. **Interrupt/resume**: The `human_gate` node pauses the graph and resumes hours or days later when the user responds. The graph state must survive process restarts.
2. **Audit trail**: Every graph execution is a checkpoint that can be inspected retroactively.

### Setup

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

// Reuse the Ship API's existing pg pool, or create a dedicated one
const checkpointPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const checkpointer = new PostgresSaver(checkpointPool);

// Must be called once before first use.
// Creates checkpoint tables if they don't exist and runs migrations.
await checkpointer.setup();
```

### Schema option

By default, PostgresSaver creates its tables in the `public` schema. To isolate FleetGraph tables:

```typescript
const checkpointer = new PostgresSaver(checkpointPool, undefined, {
  schema: "fleetgraph",
});
```

This creates tables like `fleetgraph.checkpoints` and `fleetgraph.checkpoint_writes` instead of polluting the public schema that Ship uses for its own tables.

### Tables created by setup()

PostgresSaver creates and manages these tables automatically:

- **checkpoints**: Stores serialized graph state keyed by `(thread_id, checkpoint_id)`
- **checkpoint_writes**: Stores intermediate node outputs for a given checkpoint
- **checkpoint_blobs** and version-specific auxiliary tables: Store library-managed checkpoint artifacts

You do not need to create these tables manually. Calling `checkpointer.setup()` handles creation and migrations.

### How thread_id works

Every graph invocation requires a `thread_id` in the config:

```typescript
const result = await app.invoke(input, {
  configurable: { thread_id: "fleet-issue-abc-123" },
});
```

The `thread_id` is the primary key for resumable execution:

- **First invocation**: Creates a new checkpoint thread. State is saved after each node completes.
- **Interrupt**: When the graph hits `interrupt()`, the current state is persisted under this thread_id. The invocation returns with the interrupt payload.
- **Resume**: Invoking again with the same `thread_id` loads the persisted state and continues from where it paused.

For FleetGraph, the `thread_id` should encode enough context to be unique per execution:

```typescript
// Proactive sweep run
const threadId = `fleet-proactive-${entityId}-${Date.now()}`;

// On-demand analysis
const threadId = `fleet-ondemand-${entityId}-${actorId}-${Date.now()}`;
```

### Key methods on PostgresSaver

| Method | Purpose |
|--------|---------|
| `setup()` | Create tables and run migrations. Call once at startup. |
| `getTuple(config)` | Retrieve a specific checkpoint by thread_id and checkpoint_id |
| `list(config, options)` | Async generator yielding checkpoint history for a thread |
| `put(config, checkpoint, metadata, newVersions)` | Save a checkpoint (called automatically by LangGraph) |
| `putWrites(config, writes, taskId)` | Save intermediate writes (called automatically) |
| `deleteThread(threadId)` | Remove all checkpoints for a thread (cleanup) |
| `end()` | Close the database pool |

In normal usage, you only call `setup()` at startup and `deleteThread()` for cleanup. LangGraph handles `put`, `putWrites`, `getTuple`, and `list` internally.

### Cleanup strategy

FleetGraph proactive sweeps produce many short-lived threads. Implement a cleanup job that removes completed threads older than a retention period:

```typescript
async function cleanupOldThreads(retentionDays: number = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);

  // List all threads, check metadata for completion timestamp
  // Delete threads that are complete and older than cutoff
  // This prevents unbounded growth of the checkpoint tables
}
```

---

## 6. Interrupt / Human-in-the-Loop Pattern

### The interrupt() function

`interrupt()` is imported from `@langchain/langgraph` and called inside a node to pause graph execution:

```typescript
import { interrupt } from "@langchain/langgraph";

async function humanGate(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  // Pause execution and surface the approval payload
  const decision = interrupt<HumanDecision>(state.approvalPayload);

  // This line only executes after the graph is resumed
  return { humanDecision: decision };
}
```

### How interrupt() works internally

1. `interrupt(value)` checks the current execution context for a resume value
2. **First invocation (no resume)**: It throws a `GraphInterrupt` error internally. LangGraph catches this, persists the current state to the checkpointer, and returns the interrupt payload to the caller.
3. **Resume invocation**: When the graph is re-invoked with a `Command({ resume })`, the `interrupt()` call returns the resume value instead of throwing.

**Critical constraint**: Never wrap `interrupt()` in a try/catch block. If you must use try/catch in the same function, re-throw `GraphInterrupt` errors:

```typescript
import { GraphInterrupt } from "@langchain/langgraph";

async function humanGate(state: typeof FleetGraphState.State) {
  try {
    const decision = interrupt<HumanDecision>(state.approvalPayload);
    return { humanDecision: decision };
  } catch (err) {
    if (err instanceof GraphInterrupt) throw err; // Must re-throw
    return { error: { message: err.message, node: "human_gate", recoverable: false } };
  }
}
```

### Compile with interruptBefore

Instead of calling `interrupt()` inside the node, you can declare interrupt points at compile time:

```typescript
const app = graph.compile({
  checkpointer,
  interruptBefore: ["human_gate"],
});
```

This pauses the graph before `human_gate` executes, rather than inside it. The node's input state is persisted. When resumed, the node runs from the beginning.

**For FleetGraph, calling `interrupt()` inside the node is preferred** because:
- The approval payload is computed by `prepare_action` and stored in state before `human_gate` runs
- The interrupt value (the approval payload) is what gets surfaced to the frontend
- The resume value (the human decision) is what `interrupt()` returns

### Resuming after approval

The frontend calls a Ship API endpoint, which resumes the graph:

```typescript
import { Command } from "@langchain/langgraph";

// Ship API route handler
async function handleApproval(req: Request, res: Response) {
  const { threadId } = req.params;
  const decision: HumanDecision = req.body;

  // Resume the paused graph with the human's decision
  const result = await app.invoke(
    new Command({ resume: decision }),
    { configurable: { thread_id: threadId } }
  );

  res.json({ status: "resumed", result });
}
```

### The Command class

`Command` is the mechanism for sending control signals to a paused graph:

```typescript
import { Command } from "@langchain/langgraph";

// Resume with a value (returned by interrupt())
new Command({ resume: { action: "approve" } });

// Resume and navigate to a specific node
new Command({
  resume: { action: "approve" },
  goto: "execute_action",
});

// Resume with state updates
new Command({
  resume: { action: "approve" },
  update: { humanDecision: { action: "approve" } },
});
```

For FleetGraph, the simple `resume` form is sufficient. The graph's conditional edges handle routing after the human decision is recorded in state.

### Frontend API endpoints

```
POST /api/fleetgraph/approvals/:threadId/approve
  Response: 200 { status: "executed", actionResult: {...} }

POST /api/fleetgraph/approvals/:threadId/dismiss
  Body: { reason?: string }
  Response: 200 { status: "dismissed" }

POST /api/fleetgraph/approvals/:threadId/snooze
  Body: { until: string }  // ISO 8601 timestamp
  Response: 200 { status: "snoozed", until: "2026-03-20T09:00:00Z" }
```

### Retrieving pending approvals

Query the checkpointer for interrupted threads:

```typescript
async function getPendingApprovals(workspaceId: string) {
  // Query checkpoint table for threads in interrupted state
  // Filter by workspace metadata
  // Return the interrupt values (approval payloads)
}
```

The approval payload stored in the interrupt contains all the context the frontend needs to render the approval card: evidence summary, recommended action, risk tier, and trace link.

---

## 7. Parallel Node Execution

### LangGraph parallel patterns

LangGraph JS supports two patterns for parallel execution:

#### Pattern A: Fan-out with Send (native graph parallelism)

Use `Send` objects in a conditional edge to dispatch multiple nodes in parallel:

```typescript
import { Send } from "@langchain/langgraph";

function fanOutSignalFetches(
  state: typeof FleetGraphState.State
): Send[] {
  const sends: Send[] = [];

  if (state.entityType === "sprint" || state.entityType === "project") {
    sends.push(new Send("fetch_standups", state));
    sends.push(new Send("fetch_sprint_issues", state));
  }
  if (state.entityType === "issue") {
    sends.push(new Send("fetch_associations", state));
  }

  sends.push(new Send("fetch_activity", state));

  return sends;
}

graph.addConditionalEdges("fetch_core_context", fanOutSignalFetches);
```

Each `Send` dispatches its target node in parallel. When all dispatched nodes complete, execution continues to the next node.

**Tradeoff**: Each parallel branch appears as a separate node in LangSmith traces (high granularity). But it requires defining a separate node per signal source and adds graph complexity.

#### Pattern B: Promise.all inside a single node (recommended for FleetGraph)

Use standard JavaScript parallelism within a single LangGraph node:

```typescript
async function fetchParallelSignals(
  state: typeof FleetGraphState.State
): Promise<Partial<typeof FleetGraphState.Update>> {
  const fetches: Record<string, Promise<unknown>> = {};

  if (state.entityType === "sprint" || state.entityType === "project") {
    fetches.standups = shipApi.get(`/api/standups?date_from=...`);
    fetches.sprintIssues = shipApi.get(`/api/issues?sprint_id=...`);
  }

  if (state.entityType === "issue") {
    fetches.associations = shipApi.get(`/api/documents/${state.entityId}/associations`);
  }

  // Resolve all in parallel
  const keys = Object.keys(fetches);
  const values = await Promise.all(Object.values(fetches));
  const signals: Record<string, unknown> = {};
  keys.forEach((key, i) => { signals[key] = values[i]; });

  return { signals };
}
```

**Why this is preferred for FleetGraph**: The fetch calls share authentication context, error handling, and the resulting `signals` object is a single coherent state update. The trace still shows `fetch_parallel_signals` as one node with clear input/output, and the actual HTTP calls are visible in server logs.

#### Pattern C: Fan-out with multiple static edges

If two nodes need to run in parallel and converge, wire them from the same source:

```typescript
graph
  .addEdge("trigger_context", "fetch_core_context")
  .addEdge("trigger_context", "fetch_metadata")
  // Both nodes run in parallel after trigger_context
  .addEdge(["fetch_core_context", "fetch_metadata"], "heuristic_filter");
  // heuristic_filter waits for both to complete (join)
```

The array syntax in `addEdge` creates a join. `heuristic_filter` only runs after both `fetch_core_context` and `fetch_metadata` have completed.

---

## 8. Putting It All Together: FleetGraph Entry Point

### File structure

```
api/src/fleetgraph/
  graph.ts              # StateGraph definition and compilation
  state.ts              # FleetGraphState annotation
  nodes/
    trigger-context.ts
    fetch-core-context.ts
    fetch-parallel-signals.ts
    heuristic-filter.ts
    reason-about-risk.ts
    branch-decision.ts
    prepare-notification.ts
    prepare-action.ts
    human-gate.ts
    execute-action.ts
    error-fallback.ts
  schemas/
    risk-assessment.ts    # Zod schema for OpenAI structured output
    signals.ts            # CandidateSignal, HumanDecision types
  checkpointer.ts         # PostgresSaver setup
  tracing.ts              # LangSmith helpers (metadata, trace links)
```

### graph.ts (complete example)

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { FleetGraphState } from "./state.js";
import { triggerContext } from "./nodes/trigger-context.js";
import { fetchCoreContext } from "./nodes/fetch-core-context.js";
import { fetchParallelSignals } from "./nodes/fetch-parallel-signals.js";
import { heuristicFilter } from "./nodes/heuristic-filter.js";
import { reasonAboutRisk } from "./nodes/reason-about-risk.js";
import { branchDecision } from "./nodes/branch-decision.js";
import { prepareNotification } from "./nodes/prepare-notification.js";
import { prepareAction } from "./nodes/prepare-action.js";
import { humanGate } from "./nodes/human-gate.js";
import { executeAction } from "./nodes/execute-action.js";
import { errorFallback } from "./nodes/error-fallback.js";
import { postApprovalBranch } from "./nodes/branch-decision.js";
import { withErrorHandling } from "./nodes/error-fallback.js";

// Build the graph
const workflow = new StateGraph(FleetGraphState)
  .addNode("trigger_context", withErrorHandling("trigger_context", triggerContext))
  .addNode("fetch_core_context", withErrorHandling("fetch_core_context", fetchCoreContext))
  .addNode("fetch_parallel_signals", withErrorHandling("fetch_parallel_signals", fetchParallelSignals))
  .addNode("heuristic_filter", withErrorHandling("heuristic_filter", heuristicFilter))
  .addNode("reason_about_risk", withErrorHandling("reason_about_risk", reasonAboutRisk))
  .addNode("prepare_notification", withErrorHandling("prepare_notification", prepareNotification))
  .addNode("prepare_action", withErrorHandling("prepare_action", prepareAction))
  .addNode("human_gate", humanGate) // No error wrapper: must not catch GraphInterrupt
  .addNode("execute_action", withErrorHandling("execute_action", executeAction))
  .addNode("error_fallback", errorFallback)

  // Linear path: entry through reasoning
  .addEdge(START, "trigger_context")
  .addEdge("trigger_context", "fetch_core_context")
  .addEdge("fetch_core_context", "fetch_parallel_signals")
  .addEdge("fetch_parallel_signals", "heuristic_filter")
  .addEdge("heuristic_filter", "reason_about_risk")

  // Branch after reasoning
  .addConditionalEdges("reason_about_risk", branchDecision, {
    no_issue: END,
    inform_only: "prepare_notification",
    confirm_action: "prepare_action",
    error: "error_fallback",
  })

  .addEdge("prepare_notification", END)
  .addEdge("prepare_action", "human_gate")

  // Branch after human decision
  .addConditionalEdges("human_gate", postApprovalBranch, {
    execute_action: "execute_action",
    log_dismissed: END,
    log_snoozed: END,
  })

  .addEdge("execute_action", END)
  .addEdge("error_fallback", END);

// Checkpointer
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const checkpointer = new PostgresSaver(pool, undefined, {
  schema: "fleetgraph",
});

// Export compiled graph
export async function createFleetGraph() {
  await checkpointer.setup();

  return workflow.compile({
    checkpointer,
  });
}

// Singleton
let _graph: Awaited<ReturnType<typeof createFleetGraph>> | null = null;

export async function getFleetGraph() {
  if (!_graph) {
    _graph = await createFleetGraph();
  }
  return _graph;
}
```

### Invocation from a Ship API route

```typescript
import { getFleetGraph } from "../fleetgraph/graph.js";
import { Command } from "@langchain/langgraph";

// On-demand analysis endpoint
router.post("/api/fleetgraph/analyze", async (req, res) => {
  const { entityId, entityType, workspaceId } = req.body;
  const actorId = req.session.userId;

  const graph = await getFleetGraph();
  const threadId = `fleet-${entityId}-${Date.now()}`;

  const result = await graph.invoke(
    { entityId, entityType, workspaceId, actorId },
    {
      configurable: { thread_id: threadId },
      metadata: {
        mode: "on_demand",
        entityType,
        entityId,
        workspaceId,
        actorId,
      },
      tags: ["fleetgraph", "on_demand", entityType],
    }
  );

  res.json(result);
});

// Resume approval endpoint
router.post("/api/fleetgraph/approvals/:threadId/approve", async (req, res) => {
  const { threadId } = req.params;
  const graph = await getFleetGraph();

  const result = await graph.invoke(
    new Command({ resume: { action: "approve" } }),
    { configurable: { thread_id: threadId } }
  );

  res.json({ status: "executed", actionResult: result.actionResult });
});
```

---

## 9. Checklist Before Implementation

- [ ] Verify Node.js >= 20 (`node --version`)
- [ ] Install packages: `@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint-postgres`, `openai`, `langsmith`
- [ ] Set environment variables: `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`, `OPENAI_API_KEY`
- [ ] Create `api/src/fleetgraph/` directory structure
- [ ] Define `FleetGraphState` annotation with all node fields
- [ ] Implement each node as a standalone async function
- [ ] Wire the graph: nodes, edges, conditional edges
- [ ] Set up PostgresSaver with the `fleetgraph` schema
- [ ] Compile graph with checkpointer
- [ ] Wrap OpenAI client with `wrapOpenAI` for trace visibility
- [ ] Add Ship API routes for invocation and approval
- [ ] Verify traces appear in LangSmith dashboard
- [ ] Test interrupt/resume flow end to end

## Relationship to Other Presearch Docs

| Document | Relationship |
|----------|-------------|
| [05. Required Node Types / DEEP_DIVE](../05.%20Required%20Node%20Types/DEEP_DIVE.md) | Node implementations that live inside this graph framework |
| [07. Human Approval Before Consequential Actions](../07.%20Human%20Approval%20Before%20Consequential%20Actions/README.md) | Approval UX spec that the interrupt/resume pattern implements |
| [Phase 2 / 05. State Management](../../Phase%202/05.%20State%20Management/README.md) | State design decisions formalized as the `FleetGraphState` annotation |
| [Phase 2 / 06. Human-in-the-Loop Design](../../Phase%202/06.%20Human-in-the-Loop%20Design/README.md) | HITL policy that the `interrupt()` pattern implements |
| [Phase 3 / 08. Deployment Model](../../Phase%203/08.%20Deployment%20Model/README.md) | How the compiled graph is deployed and scaled |
