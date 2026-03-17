# FleetGraph Presearch
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Sources

- **Grader-facing source of truth:** `requirements.md`
- Supplemental source: `FleetGraph_PRD.pdf` (use for fuller wording where the repo handout is abbreviated)
- Cross-document reconciliation: [`CANONICAL_RECONCILIATION.md`](./CANONICAL_RECONCILIATION.md)

When `requirements.md` and the PDF diverge, follow `requirements.md` and verify grader expectations before implementation.

## Reconciliation Note

- README files in this folder carry the reconciled design decisions
- Deep-dive code blocks are implementation sketches, not competing sources of truth
- Where an older deep dive example disagrees with a README after this pass, follow the README

## Evidence Ranking

1. `requirements.md`
2. concrete Ship file and route references
3. external vendor docs for pricing and API behavior
4. proposed FleetGraph design and explicit assumptions

## Working Thesis

FleetGraph should be an execution drift agent for Ship.

Why this choice:

- Ship already models weeks, standups, issues, approvals, ownership, and accountability
- Those signals are high-value, time-sensitive, and expensive for humans to watch manually
- The current REST surface appears sufficient for a strong proactive MVP for stale issues, scope drift, approval bottlenecks, ownership gaps, and multi-signal drift where PRESEARCH cites concrete Ship routes
- Standup coverage and inferred accountability stay current-user or future-admin-surface concerns until Ship exposes workspace-wide service-token reads
- They lead to actions that feel native to Ship instead of bolted-on chatbot behavior

Core job:

- Proactively detect when a project or week is drifting
- Explain why it is drifting
- Propose the next best action
- Execute only low-risk actions automatically
- Require human confirmation for consequential changes

## Requirement-by-Requirement Decisions

1. [Complete Presearch Before Code](./01.%20Complete%20Presearch%20Before%20Code/README.md)
2. [Proactive and On-Demand Modes](./02.%20Proactive%20and%20On-Demand%20Modes/README.md)
3. [Context-Aware Embedded Chat](./03.%20Context-Aware%20Embedded%20Chat/README.md)
4. [LangGraph and LangSmith](./04.%20LangGraph%20and%20LangSmith/README.md)
5. [Required Node Types](./05.%20Required%20Node%20Types/README.md)
6. [Ship REST API Data Source](./06.%20Ship%20REST%20API%20Data%20Source/README.md)
7. [Human Approval Before Consequential Actions](./07.%20Human%20Approval%20Before%20Consequential%20Actions/README.md)
8. [Real Data and Public Deployment](./08.%20Real%20Data%20and%20Public%20Deployment/README.md)
9. [Detection Latency Under 5 Minutes](./09.%20Detection%20Latency%20Under%205%20Minutes/README.md)
10. [Cost Analysis](./10.%20Cost%20Analysis/README.md)

## Deep Dives

- [Phase 1: Define Your Agent](./Phase%201/README.md)
- [Phase 2: Graph Architecture](./Phase%202/README.md)
- [Phase 3: Stack and Deployment](./Phase%203/README.md)

## Planning Workflow

- Canonical drafting workflow: [`PLANNING_WORKFLOW.md`](./PLANNING_WORKFLOW.md)
- Locked stack decision: LangGraph plus LangChain
- Phase 2 should be drafted as one coherent solution-design pass, then split into docs 04 through 07
- Phase 3 should research unknowns first, then clean up into docs 08 through 10
- Run advanced elicitation after each phase draft
- Run implementation-readiness review before epics, stories, or build work begin

## Architecture Decisions To Carry Forward

- Use LangGraph JS in the TypeScript backend
- Use the OpenAI SDK on the backend
- Use the Responses API with Zod structured outputs via `responses.parse()`
- Keep FleetGraph on a single backend-native OpenAI SDK path
- Keep the server-only chat flow simple and backend-native
- Build one shared graph for proactive and on-demand modes
- Use hybrid triggering: event plus 4-minute sweep
- Persist trigger candidates through a worker queue instead of reasoning inline from request handlers
- Read project state through Ship REST APIs only
- Limit proactive MVP to signals a service token can evaluate workspace-wide today
- Restrict autonomous behavior to surfacing and low-risk draft actions
- Require confirmation for consequential writes
- Use project, week, and issue context as the primary embedded chat surfaces
- Use deterministic heuristics before LLM reasoning
- Track every run in LangSmith from the first milestone

## What We Will Have To Build

### Product and Docs

- `FLEETGRAPH.md` with responsibility, graph diagram, use cases, trigger model, test cases, architecture decisions, and cost analysis
- Final use-case table with at least 5 tested scenarios
- LangSmith trace links for different branches

### Backend

- FleetGraph graph module
- Leader-elected worker and candidate queue
- Service auth using a Ship API token
- Read-side API client for Ship endpoints
- Alert dedupe and snooze state
- Audit trail for automated suggestions and approved actions

### Frontend

- Embedded FleetGraph entry point in issue, week, and project contexts
- Contextual assistant UI
- Human confirmation card for recommended actions
- Surface for proactive alerts

### Verification

- Proactive trace with no-issue path
- Proactive trace with issue-detected path
- On-demand trace from a contextual page
- One approved action trace through the human gate
- Latency proof for a time-sensitive signal
- Cost tracking during development

## Final Position

The most defensible FleetGraph for this repo is not a general chatbot.

It is a focused execution drift agent that watches issues, week scope, approvals, ownership, and multi-signal drift; surfaces only meaningful risk; explains why the risk matters; and asks for approval before changing project state.

Standup coverage and inferred accountability remain valuable, but they are stretch or on-demand surfaces until Ship exposes workspace-wide service-token reads for them.
