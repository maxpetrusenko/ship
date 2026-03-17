# FleetGraph Planning Workflow

This document is the canonical drafting workflow for FleetGraph planning artifacts. Use it to reduce drift between phase docs, deep dives, and later implementation planning.

## Locked Stack Decision

- LangGraph plus LangChain is the locked orchestration stack decision.
- Phase planning should refine design around that choice rather than reopening the framework decision.

## Drafting Order

1. Finish Presearch reconciliation and keep `requirements.md` as the grader-facing source of truth.
2. Draft Phase 2 as one coherent solution-design pass.
3. Split that Phase 2 pass into the four phase documents after the design is internally consistent.
4. Draft Phase 3 by researching unknowns first, then convert findings into deployable system decisions.
5. Run a readiness check before implementation planning begins.
6. Create epics, stories, and story context only after Phases 1 through 3 are stable.

## Phase 2 Workflow

Primary skill: `bmad-create-architecture`

Goal:
Produce one coherent graph-architecture solution design, then split it into the existing Phase 2 doc surfaces:

- `Phase 2/04. Node Design`
- `Phase 2/05. State Management`
- `Phase 2/06. Human-in-the-Loop Design`
- `Phase 2/07. Error and Failure Handling`

Expected output of the initial pass:

- node boundaries and edge conditions
- graph state shape and persistence boundaries
- approval and resume lifecycle
- retry, degradation, and operator escalation rules
- cross-cutting decisions that all four docs must share

Split rule:
Write cross-cutting decisions once in the coherent pass, then copy only the phase-relevant subset into each folder README and deep dive.

## Phase 3 Workflow

Primary skill for unknowns: `bmad-technical-research`

Cleanup pass:
Use `bmad-tech-writer` style cleanup after research decisions land.

Goal:
Turn open deployment, performance, and cost questions into concrete implementation decisions for:

- `Phase 3/08. Deployment Model`
- `Phase 3/09. Performance`
- `Phase 3/10. Cost Analysis`

Research-first topics:

- deployment topology tradeoffs
- worker lifetime and multi-instance safety
- latency budgets and bottlenecks
- cost assumptions, telemetry, and model policy

Cleanup expectations:

- remove duplicated assumptions
- align terminology across docs
- keep one canonical statement per policy
- point repeated policy references back to the canonical doc

## Tightening Pass After Each Phase Draft

Required skill: `bmad-advanced-elicitation`

Use it after each phase draft to pressure-test:

- weak assumptions
- missing edge cases
- contradictions across docs
- vague ownership boundaries
- hidden implementation dependencies

Acceptance bar:
The phase should read as if one system designer wrote it, even if multiple docs carry the details.

## Readiness Gate Before Implementation

Required skill: `bmad-check-implementation-readiness`

Run this after Phases 1 through 3 are drafted and reconciled.

Goal:
Confirm the planning set is sufficient to implement without reopening core product, architecture, or operational questions.

Minimum readiness checks:

- requirements trace cleanly into phases
- architecture decisions are specific enough for implementation
- unresolved unknowns are explicit and small
- deployment and cost constraints are actionable
- human approval and failure paths are fully specified

## Implementation Planning Sequence

When implementation starts:

1. Run `bmad-create-epics-and-stories`
2. Run `bmad-create-story` for each concrete build slice

Story creation should inherit from the reconciled phase docs rather than re-deriving architecture inside each story.

## Operating Notes

- Prefer updating the existing phase folders over creating parallel planning docs that can drift.
- Keep cross-phase policy in one canonical location and link to it.
- If a phase draft changes a shared decision, update the canonical source and the affected phase docs in the same pass.
