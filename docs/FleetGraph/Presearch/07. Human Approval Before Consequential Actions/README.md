# 7. Human Approval Before Consequential Actions
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Choice

Autonomy stops at notifications, draft recommendations, and low-risk summaries. Any mutation to canonical project state pauses for human confirmation.

## Why

That is both an assignment requirement and the safer product choice. Ship is a planning tool; silent edits to plans, issues, ownership, or approvals would be too aggressive.

## What This Means We Have To Do

- Define an action risk policy
- Build a confirmation UI in Ship
- Record whether a human approved, dismissed, or snoozed the suggestion

## Deep Dive

- [Phase 1 / 01. Agent Responsibility Scoping](../../Phase%201/01.%20Agent%20Responsibility%20Scoping/README.md)
- [Phase 2 / 06. Human-in-the-Loop Design](../../Phase%202/06.%20Human-in-the-Loop%20Design/README.md)
