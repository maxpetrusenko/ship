# 4. LangGraph and LangSmith
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Use LangGraph JS in the TypeScript backend, with LangSmith tracing from day one, and the OpenAI SDK via the Responses API.

## Why

- This repo is already TypeScript end to end
- LangGraph JS fits the repo better than adding a separate Python service
- LangSmith is easier to wire cleanly with LangGraph than with a custom orchestrator
- Backend-only chat can stay on a simple backend-native OpenAI integration path
- `responses.parse()` fits the repo's existing Zod and TypeScript patterns

## What This Means We Have To Do

- Add LangGraph and OpenAI SDK dependencies
- Create a graph entrypoint under the backend
- Define response schemas in zod and parse them with `responses.parse()`
- Ensure every run has trace metadata: mode, entity, workspace, decision branch

## Deep Dive

- [Phase 2 / 04. Node Design](../../Phase%202/04.%20Node%20Design/README.md)
- [Phase 3 / 08. Deployment Model](../../Phase%203/08.%20Deployment%20Model/README.md)
