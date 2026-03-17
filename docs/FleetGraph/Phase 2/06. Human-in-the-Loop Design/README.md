# 6. Human-in-the-Loop Design
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


Implementation detail, frontend mechanics, and approval state handling live in [`DEEP_DIVE.md`](./DEEP_DIVE.md).

## Actions That Require Confirmation

- Any write to issues, weeks, projects, or approvals
- Any reassignment
- Any plan or retro workflow action

## Confirmation UX

- Contextual FleetGraph card in Ship
- Evidence summary
- Recommended action
- Buttons for `Approve`, `Dismiss`, `Snooze`

## If The Human Dismisses

Mark the alert resolved for that fingerprint unless the underlying state materially changes.

## If The Human Snoozes

Suppress resurfacing until the snooze expires.

## Approval Expiry

- Approval rows stay pending for up to 72 hours
- Expiry is explicit state, not an implicit disappearance
- Approved actions transition to `executed` or `execution_failed`

## Why

The user should see what the agent saw, why it chose the action, and how to stay in control.
