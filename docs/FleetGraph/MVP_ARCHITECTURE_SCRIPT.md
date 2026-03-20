# FleetGraph MVP Architecture Script

## Audience

Professor, CTO, or technical reviewer who wants the shortest credible explanation of the current FleetGraph MVP.

## Executive Summary

FleetGraph is a scoped project-health agent inside Ship.

Today, the MVP is built as a LangGraph runtime on the TypeScript backend. It gathers Ship context, applies deterministic filters, runs one reasoning step when needed, and then branches into either:

- clean exit
- informational alert
- human-approved action

That means the MVP is already more than chat. It supports proactive runs, page-aware on-demand runs, contextual follow-up chat, traceability, and pause-resume approval flow.

## Review Of The Main Runtime Doc

[`LANGGRAPH_RUNTIME_ARCHITECTURE.md`](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/FleetGraph/LANGGRAPH_RUNTIME_ARCHITECTURE.md) is strong on runtime flow, branching, and HITL checkpointing.

What it explains well:

- why LangGraph fits Ship
- current node flow
- where branching happens
- why pause-resume matters

What a live MVP explanation still needed:

- current stack in one place
- current tool surface in one place
- what the MVP can do now, in user-facing terms
- a short spoken script for demo or review

This document fills that gap.

## MVP Stack Today

FleetGraph is currently a hybrid TypeScript stack:

- frontend: React plus Vite in the Ship web app
- backend: Express API in TypeScript
- runtime orchestration: LangGraph JS
- graph checkpointing: `@langchain/langgraph-checkpoint-postgres`
- graph reasoning node: `@langchain/openai` `ChatOpenAI`
- chat runtime: native OpenAI SDK with Responses-style tool loop
- tracing: LangSmith
- persistence: PostgreSQL
- shared contracts: `@ship/shared`

Important nuance:

- the graph runtime is LangGraph plus LangChain OpenAI wrappers for the main reasoning node
- the embedded chat runtime uses the native OpenAI SDK and explicit tool schemas

So the architecture is LangGraph-centered, but the model layer is currently hybrid rather than a single pure SDK path.

## How LangGraph Fits The MVP

LangGraph gives FleetGraph four things the MVP already uses:

1. Shared typed state across the full run
2. Conditional edges for clean, alert, and action branches
3. Durable interrupt and resume for human approval
4. Traceable node execution for review and grading

The current graph flow is:

1. `trigger_context`
2. `fetch_core_context`
3. `fetch_parallel_signals`
4. `heuristic_filter`
5. `reason_about_risk`
6. notification path or approval path

That keeps the runtime disciplined:

- deterministic first
- reasoning second
- action only after approval when consequences exist

## Tools Available Today

The embedded FleetGraph chat currently exposes these tools:

- `fetch_issue_context`
- `fetch_sprint_context`
- `fetch_project_context`
- `fetch_workspace_signals`
- `fetch_entity_drift`
- `fetch_related_documents`
- `fetch_document_content`

What those tools let the MVP do:

- inspect the active issue, sprint, or project
- pull workspace-level accountability or sprint signals
- check drift on an entity
- traverse related documents
- read active document body text for page-aware questions

This is why the assistant can answer both health questions and page-content questions inside the current Ship surface.

## What The MVP Can Do Now

Today’s MVP can already demonstrate:

- proactive scheduler sweep on a short interval
- page-view triggered analysis when a user opens an entity
- on-demand analysis from the UI
- embedded contextual chat with follow-up turns
- conversation context tied to the current entity and page state
- evidence-backed issue, sprint, project, and workspace reads
- informational findings with citations
- human approval before consequential actions
- paused graph resume after approve, dismiss, or snooze
- LangSmith trace links for review

In plain terms:

FleetGraph can watch for execution drift, explain what looks wrong, answer questions in context, and gate risky actions behind a human.

## Current MVP Limits

This is still an MVP, so the current limits matter:

- graph topology is mostly linear, with parallelism concentrated inside data-fetch nodes
- reasoning is single-entity focused per run
- tool coverage is strong for Ship context, but not broad autonomous planning
- some proactive coverage still depends on what Ship APIs expose cleanly

## 1 To 3 Minute Spoken Script

`FleetGraph is a LangGraph-based project-health agent embedded inside Ship. The important design choice is that it is not a free-form chatbot. It is a structured runtime that starts from the current Ship entity, gathers evidence, filters for meaningful signals, and only then runs a reasoning step if needed.`

`The current MVP stack is a TypeScript monorepo with a React and Vite frontend, an Express API backend, PostgreSQL for persistence, LangGraph for orchestration, Postgres checkpointing for pause and resume, and LangSmith for traces. On the model side, the graph reasoning node currently uses LangChain OpenAI, while the chat runtime uses the native OpenAI SDK with explicit tool calls.`

`What that gives us today is a working proactive and on-demand assistant. It can run on a scheduler sweep, on page view, or from an explicit user chat request. It understands issue, sprint, project, workspace, related-document, drift, and document-content context through its current tool set.`

`In practice, the MVP can already detect execution drift, answer page-aware questions, explain why something looks risky, and branch into either a clean result, an informational alert, or a human-approved action. If the action is consequential, the graph pauses at a human gate, stores state in Postgres, and resumes only after approve, dismiss, or snooze.`

`So the reason LangGraph matters here is simple: FleetGraph already has real branching, real state, and real approval flow. The MVP proves that Ship can support a context-aware operational agent with traceable reasoning and controlled actions, not just another chat panel.`

## Optional Live Demo Order

If you need to show this live, use this order:

1. Show FleetGraph status or a working trigger path
2. Open an entity page and ask a context-bound question
3. Show that the answer uses document or entity context
4. Trigger a finding that returns `inform_only` or `confirm_action`
5. Show approval gating
6. Open the LangSmith trace

## Bottom Line

The MVP architecture is already credible because it combines:

- Ship-native data
- LangGraph state and branching
- tool-based contextual retrieval
- human approval for consequential steps
- traceable execution

That is enough to defend FleetGraph as an MVP architecture today.
