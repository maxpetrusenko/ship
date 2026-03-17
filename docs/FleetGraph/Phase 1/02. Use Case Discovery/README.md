# 2. Use Case Discovery
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


We should optimize around these use cases first.

| # | Role | Trigger | Agent detects or produces | Human decides | Why choose it |
| --- | --- | --- | --- | --- | --- |
| 1 | Engineer | Opens a blocked issue or gets a proactive nudge | Explains why the issue is stale, who is waiting on it, and what changed recently | Whether to unblock, re-scope, or escalate | High-value issue-level context, easy to prove |
| 2 | PM | Issue added after week start | Detects scope creep against the saved plan snapshot | Whether to accept the scope change or de-scope something else | Uses Ship's plan-driven model directly |
| 3 | Manager | Plan or retro approval is still pending or has `changes_requested` | Detects approval bottlenecks and routes accountability correctly | Whether to approve, request changes, or follow up with the owner | Strong human-in-the-loop fit tied to real Ship approval states |
| 4 | Director | Multiple active signals on one project | Produces a concise project health brief with top risks and recommended next step | Whether to escalate, reassign, or wait | Shows why a graph agent is better than a static dashboard |
| 5 | Engineer or PM | Opens FleetGraph from week view and asks about current-user standup or action-item follow-through | Uses page context plus actor-scoped reads to explain what is missing for that user and what matters next | Whether to post, update, or ignore the recommendation | Keeps standup or accountability support inside token scope instead of pretending workspace-wide proactive coverage exists |
| 6 | Any role | User invokes FleetGraph from issue, week, or project view | Answers a context-aware question or proposes a context-aware action from the current entity | Whether to act on one of the recommendations | Satisfies the embedded chat requirement without collapsing into a generic summary bot |

Why these six:

- They cover Director, PM, and Engineer
- They mix push and pull behavior
- They can branch into clearly different traces
- They rely on real Ship relationships instead of fabricated data
- The proactive MVP stays inside signals the current service-token surface can evaluate workspace-wide
