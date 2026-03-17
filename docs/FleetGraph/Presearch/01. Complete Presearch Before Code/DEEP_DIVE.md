# Deep Dive Research for Presearch 01
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


As of March 16, 2026.

This folder is the umbrella requirement: do the research first, then code. The linked Phase 1 to Phase 3 folders already capture the first-pass decisions. This document goes deeper across the 10 implementation categories linked from this folder, validates them against the current Ship repo, and tightens the implementation guidance with primary-source research.

## Scope Of This Document

This deep dive is for the categories nested under Presearch item `01. Complete Presearch Before Code`, not for all top-level presearch folders.

The 10 categories covered here are:

1. Agent Responsibility Scoping
2. Use Case Discovery
3. Trigger Model Decision
4. Node Design
5. State Management
6. Human-in-the-Loop Design
7. Error and Failure Handling
8. Deployment Model
9. Performance
10. Cost Analysis

## Evidence Base

### Local repo evidence

- [`../PRESEARCH.md`](../PRESEARCH.md)
- [`../../README.md`](../../README.md)
- [`../../Phase 1/01. Agent Responsibility Scoping/README.md`](../../Phase%201/01.%20Agent%20Responsibility%20Scoping/README.md)
- [`../../Phase 1/02. Use Case Discovery/README.md`](../../Phase%201/02.%20Use%20Case%20Discovery/README.md)
- [`../../Phase 1/03. Trigger Model Decision/README.md`](../../Phase%201/03.%20Trigger%20Model%20Decision/README.md)
- [`../../Phase 2/04. Node Design/README.md`](../../Phase%202/04.%20Node%20Design/README.md)
- [`../../Phase 2/05. State Management/README.md`](../../Phase%202/05.%20State%20Management/README.md)
- [`../../Phase 2/06. Human-in-the-Loop Design/README.md`](../../Phase%202/06.%20Human-in-the-Loop%20Design/README.md)
- [`../../Phase 2/07. Error and Failure Handling/README.md`](../../Phase%202/07.%20Error%20and%20Failure%20Handling/README.md)
- [`../../Phase 3/08. Deployment Model/README.md`](../../Phase%203/08.%20Deployment%20Model/README.md)
- [`../../Phase 3/09. Performance/README.md`](../../Phase%203/09.%20Performance/README.md)
- [`../../Phase 3/10. Cost Analysis/README.md`](../../Phase%203/10.%20Cost%20Analysis/README.md)
- [`../../../api/src/routes/claude.ts`](../../../api/src/routes/claude.ts)
- [`../../../api/src/services/ai-analysis.ts`](../../../api/src/services/ai-analysis.ts)
- [`../../../api/openapi.yaml`](../../../api/openapi.yaml)
- [`../../../package.json`](../../../package.json)
- [`../../../terraform/README.md`](../../../terraform/README.md)

### External primary sources

- LangChain, [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph)
- LangChain, [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- LangChain, [Durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)
- LangChain, [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- LangChain, [Tracing quickstart](https://docs.langchain.com/langsmith/observability-quickstart)
- LangChain, [LangSmith pricing](https://www.langchain.com/pricing)
- OpenAI, [Migrate to the Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- OpenAI, [Structured model outputs](https://platform.openai.com/docs/guides/structured-outputs)
- AWS, [Elastic Beanstalk worker environments](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/concepts-worker.html)
- AWS, [Amazon EventBridge Scheduler](https://docs.aws.amazon.com/eventbridge/latest/userguide/using-eventbridge-scheduler.html)
- AWS, [EventBridge Scheduler CreateSchedule](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateSchedule.html)
- AWS, [Amazon SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue.html)
- AWS, [Amazon SQS message deduplication ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagededuplicationid-property.html)

## Executive Position

The original thesis still holds: FleetGraph should stay a narrow execution-drift workflow, not a general-purpose chatbot.

External research strengthens that position:

- The simplest architecture that can meet the product need is still the right starting point.
- LangGraph is a good fit when the system must be stateful, interruptible, durable, and inspectable.
- Ship already has the right substrate: TypeScript monorepo, REST APIs, AWS deployment, and an existing context endpoint pattern at `/api/claude/context`.

One important observation from the original presearch:

- For FleetGraph and embedded chat, the chosen path is the OpenAI SDK on the backend with the Responses API for structured outputs.

## Category-by-Category Deep Dive

### 1. Complete Presearch Before Code

#### What the research confirms

- The design guidance is direct: use the simplest architecture that works, and only add agentic complexity when it measurably improves outcomes.
- LangGraph is a low-level orchestration layer, not a product architecture. That means the business framing still has to be done in docs first.
- The existing repo already contains several examples where design documentation drove implementation shape. FleetGraph should follow that pattern.

#### What this means for FleetGraph

- Keep the scope to execution drift in weeks, issues, approvals, and ownership.
- Treat `PRESEARCH.md` plus this deep dive as design inputs to `FLEETGRAPH.md`, not as optional notes.
- Define measurable acceptance criteria before coding:
  - one proactive no-issue trace
  - one proactive issue-detected trace
  - one on-demand context trace
  - one approval-gated action trace
  - one latency measurement under the 5-minute SLA

#### Decision

Presearch remains a hard gate. Do not start implementation until the graph responsibilities, trigger model, state model, and cost model are frozen in docs.

### 2. Agent Responsibility Scoping

#### What the research confirms

- FleetGraph's drift detection problem is mostly workflow-shaped, with small reasoning pockets rather than fully open-ended agent behavior.
- That argues for narrow, deterministic detection followed by selective LLM reasoning, not "let the model roam through the product."

#### What Ship specifically supports

- Ship already models sprint or week context, project ownership, issue status, approvals, and member relationships.
- The current context endpoint in [`../../../api/src/routes/claude.ts`](../../../api/src/routes/claude.ts) proves the product already thinks in "entity plus surrounding context" rather than free-form chat history.

#### Stronger responsibility boundary

FleetGraph should own:

- detection of fresh or worsening delivery risk
- evidence synthesis across related Ship entities
- recommended next action
- low-risk user-facing surfacing

FleetGraph should not own:

- broad project management advice
- open-ended brainstorming
- document generation unrelated to drift
- silent mutation of canonical Ship state

#### Decision

Keep the agent as a workflow-first execution-drift specialist. Use the model for explanation and recommendation, not for primary detection.

### 3. Use Case Discovery

#### What the research confirms

- Workflow patterns support the current split:
  - routing for different signal families
  - parallelization for independent evidence gathering
  - evaluator style reasoning only after evidence exists
- Their own examples also reinforce that agents work best when outcomes are measurable and feedback loops exist. Ship has that property because issue state, approvals, and week plans are inspectable.

#### Better initial use-case ranking

Highest-confidence launch set:

1. Missing standups for active weeks
2. Blocked issues with no progress beyond threshold
3. Approval bottlenecks
4. Scope creep against saved week plan snapshot
5. Project risk brief when multiple signals converge

Lower-confidence for sprint one:

- generalized cross-project health narratives
- large-scale multi-agent planning
- auto-escalation to broad audiences

#### Why this ranking is better

- Each launch case has crisp evidence.
- Each has a clear owner.
- Each can be evaluated against actual Ship state.
- Each can branch cleanly into inform-only or confirm-action flows.

#### Decision

Preserve the six use cases in Phase 1, but implement them in the order above. Start with the signals that are easiest to verify and hardest to dispute.

### 4. Trigger Model Decision

#### What the research confirms

- The hybrid model in presearch is still the correct shape.
- EventBridge Scheduler supports both `rate(...)` and `cron(...)` schedules and is the AWS-native way to run recurring jobs.
- Elastic Beanstalk worker environments are designed around SQS-backed asynchronous work, which matches proactive FleetGraph processing well.
- SQS supports message deduplication and DLQ routing, which reduces repeat analysis and gives a clean failure lane.

#### Better architecture split

Use two proactive lanes:

- event lane: write-side events enqueue candidate checks immediately
- sweep lane: EventBridge Scheduler triggers a 4-minute sweep for "missing activity" signals that events alone cannot catch

Use one pull lane:

- on-demand lane: user opens FleetGraph from issue, week, or project context

#### Important operational consequence

Do not call the LLM directly from every event. Instead:

1. normalize event into candidate work item
2. dedupe by risk fingerprint
3. run deterministic heuristics
4. invoke the OpenAI reasoning step only if the candidate survives

#### Decision

Hybrid stays. Implementation should use scheduled sweep plus queue-backed candidate processing, not a polling loop inside a web request process.

### 5. Node Design

#### What the research confirms

- LangGraph is strongest when the state transitions are explicit and inspectable.
- Composable patterns are a better fit than hiding behavior behind opaque abstractions.
- That aligns with the current planned-node list in Phase 2.

#### Better node contract

Recommended top-level graph:

1. `ingest_trigger`
2. `load_base_context`
3. `load_parallel_signals`
4. `score_heuristics`
5. `decide_if_reasoning_needed`
6. `reason_about_risk`
7. `branch_outcome`
8. `prepare_notification_or_action`
9. `interrupt_for_approval`
10. `execute_approved_action`
11. `record_outcome`
12. `handle_failure`

#### Why this is stronger than the current draft

- It splits "decision to use the model" from "model reasoning."
- It adds an explicit `record_outcome` node for auditability and dedupe freshness.
- It makes the interrupt boundary obvious in traces.

#### LangGraph-specific guidance

- Keep fetch-heavy work in deterministic nodes or tasks.
- Use parallel branches for independent reads.
- Keep model calls isolated to a small number of nodes.
- Keep node outputs structured and reducer-friendly.

#### Decision

Use a visibly rubric-shaped graph. Every required node family from the assignment should be obvious in the trace tree.

### 6. State Management

#### What the research confirms

- LangGraph persistence is central, not optional, for human approval, replay, time travel, and failure recovery.
- A `thread_id` is required for durable resume semantics.
- LangGraph recommends a database-backed checkpointer for production; Postgres is the documented production-grade path in JS.

#### Best fit for Ship

Use two persistence layers:

- LangGraph checkpoint state for thread-level execution state
- normal Ship tables for durable product state such as alerts, snoozes, fingerprints, approvals, and audit rows

#### Practical recommendation

- Use `PostgresSaver` for graph checkpoints.
- Store `thread_id` on the FleetGraph alert or approval record so UI and backend can resume the same execution.
- Keep graph state small:
  - entity IDs
  - fetched summaries
  - heuristic outputs
  - model conclusions
  - approval payload
  - trace metadata

Do not keep:

- full raw documents unless strictly needed
- long conversational transcripts by default
- repeated copies of unchanged issue and week payloads

#### Decision

Persist execution state in Postgres-backed LangGraph checkpoints. Persist product decisions separately in Ship tables. Do not conflate the two.

### 7. Human-in-the-Loop Design

#### What the research confirms

- LangGraph interrupts are purpose-built for approval workflows.
- Interrupts require persistent checkpointing and a stable `thread_id`.
- On resume, the interrupted node restarts from the beginning, so any side effects before `interrupt()` must be idempotent or moved after the interrupt.

#### Stronger approval design

Approval payload should include:

- action type
- target entity IDs
- evidence summary
- recommended effect
- risk tier
- generated-at timestamp
- fingerprint hash
- trace link

Available human responses:

- approve
- dismiss
- snooze until time
- edit recommendation then approve

#### Important engineering guardrail

The node that calls `interrupt()` should perform no write-side side effects before the interrupt. Generate the candidate action, pause, then write only after approval.

#### Decision

Use LangGraph interrupts for consequential actions. Model the approval UI and API around resumable thread IDs and immutable approval payloads.

### 8. Error and Failure Handling

#### What the research confirms

- LangGraph durable execution plus pending writes help recover after failures without rerunning every successful branch.
- AWS gives clean primitives for queue failure handling:
  - retries on the main queue
  - DLQ for poison work items
- OpenAI SDK calls plus bounded app-level retries and rate-limit handling can improve throughput and resilience.

#### Better failure taxonomy

Split failures into four classes:

1. read failure
2. model failure
3. approval failure
4. action execution failure

#### Recommended behavior by class

- Read failure:
  - retry with bounded backoff
  - degrade on-demand UX with explicit stale or partial state
  - skip proactive notification until evidence quality recovers
- Model failure:
  - retry once or twice with the same input and trace metadata
  - fall back to heuristics-only surfacing if confidence is still high
- Approval failure:
  - keep the checkpoint resumable
  - show pending state in UI
- Action failure:
  - re-fetch fresh state before retry
  - require idempotency key on mutation path
  - route exhausted retries to DLQ and operator review

#### Decision

Treat failures as product states, not just log lines. Every failed branch should be inspectable, resumable, or explicitly dead-lettered.

### 9. Deployment Model

#### What the research confirms

- LangGraph JS fits the TypeScript repo.
- The OpenAI SDK integrates cleanly with LangGraph JS and plain TypeScript services.
- Elastic Beanstalk worker environments are a natural fit for proactive queue processing.
- EventBridge Scheduler is the right AWS-native sweep trigger.

#### Stronger deployment recommendation

Split deployment responsibilities:

- web tier:
  - on-demand FleetGraph entry points
  - approval APIs
  - trace-link surfacing
- worker tier:
  - candidate queue consumption
  - scheduled sweep processing
  - proactive alert generation

#### Why this is better than "just run a loop with the backend"

- clearer isolation between request handling and background work
- easier queue-driven backpressure
- cleaner retries and DLQ handling
- closer to how AWS Elastic Beanstalk worker tier is intended to operate

#### Provider recommendation

Use the OpenAI SDK directly on the backend.

Reasons:

- Responses is OpenAI's recommended API path for new projects.
- `responses.parse()` fits the repo's existing Zod and TypeScript patterns for structured outputs.
- FleetGraph chat is server-only and backend-native, so the integration can stay simple.
- A single OpenAI provider path keeps the implementation and operations simpler.

#### Decision

Deploy FleetGraph as a shared TypeScript module plus dedicated worker runtime in the existing AWS footprint. Use the OpenAI SDK and Responses API for all FleetGraph reasoning calls.

### 10. Performance

#### What the research confirms

- OpenAI recommends Responses as the primary API for new work, but the same caution still applies: agentic flexibility costs latency and tokens.
- LangGraph durability adds overhead, so use it where it buys recovery or HITL value.
- Structured outputs plus stable instructions reduce parse retries, and repeated Responses calls benefit from improved cache utilization when prompts and schemas stay stable.

#### Better performance plan

Latency budget should be allocated like this:

- candidate detection: deterministic and cheap
- context fetch: parallelized and bounded
- model reasoning: only on filtered candidates
- approval wait: outside SLA for proactive detection

#### Concrete tactics

- parallelize independent Ship API fetches
- hash entity digests to skip unchanged context
- summarize long documents before the reasoning node
- keep instructions and schema shapes stable so repeated Responses calls benefit from cache utilization
- keep proactive model outputs short and structured

#### Decision

The under-5-minute SLA should apply to "candidate detected and surfaced," not "full end-to-end human approval completed." Optimize the detection path first.

### 11. Cost Analysis

#### What the research confirms

- OpenAI recommends the Responses API for new projects, which keeps FleetGraph on the provider's forward path.
- OpenAI's JavaScript SDK supports Zod-backed structured outputs, which reduces parse errors and extra retry cost for typed reasoning results.
- LangSmith pricing currently includes a free developer tier with 5,000 base traces per month, and a Plus tier at $39 per seat per month with 10,000 base traces included.

#### Important local note

The current direction is to use the OpenAI SDK for FleetGraph and chat, so production budgeting should use OpenAI direct pricing as the primary cost model.

#### Recommended budgeting model

Track four lines separately:

1. model tokens
2. cache-sensitive prompt and schema reuse
3. observability traces
4. infrastructure and queue costs

#### Suggested spreadsheet inputs

- proactive candidates per day
- percentage promoted to LLM reasoning
- average input tokens per proactive run
- average output tokens per proactive run
- on-demand sessions per day
- average turns per on-demand session
- approval-gated actions per day
- average trace volume per run

#### Example planning stance

- Default model: the current OpenAI Responses model selected for FleetGraph reasoning
- Escalation model: add a second OpenAI model tier only if evals prove the win
- On-demand: larger budget than proactive
- Proactive: aggressively filtered, structured, and short

#### Decision

Keep the single-provider OpenAI recommendation. Add OpenAI direct-pricing budgeting tables before implementation freeze, covering 100, 1,000, and 10,000 user tiers as required by the PRD.

## Concrete Changes To Carry Into `FLEETGRAPH.md`

- Reframe FleetGraph as a workflow-first drift system with selective agentic reasoning.
- Confirm the OpenAI SDK plus Responses API as the integration path for FleetGraph reasoning and chat.
- Add queue-backed worker architecture to the deployment section.
- Add Postgres-backed LangGraph checkpointing to the state section.
- Add interrupt idempotency rules to the HITL section.
- Add DLQ, dedupe key, and retry policy to the failure section.
- Add `responses.parse()` and Zod structured outputs to the implementation notes.
- Add a cost table using OpenAI direct pricing and a trace-volume table.

## Recommended Build Order

1. Docs freeze: `FLEETGRAPH.md` and eval plan
2. Deterministic signal detector and risk fingerprinting
3. Queue plus scheduler plumbing
4. LangGraph state model and checkpointing
5. On-demand graph path
6. Proactive graph path
7. Approval interrupt flow
8. LangSmith tracing and dashboards
9. Cost instrumentation
10. Demo traces and acceptance tests

## Bottom Line

The current presearch direction is mostly right.

The strongest refinements after research are:

- stay narrow
- stay workflow-first
- use the OpenAI SDK via the Responses API on the backend
- use LangGraph for persistence, interrupts, and inspectable branching
- make approval, retries, dedupe, and cost tracking first-class design objects

That combination is the fastest path to a defensible, demoable FleetGraph in this codebase.
