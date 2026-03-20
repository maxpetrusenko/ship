# FleetGraph CTO Demo Script

Date: 2026-03-18

Use this version when you need a spoken 2 to 3 minute walkthrough for a CTO-style audience.

## Spoken Script

`The north star for FleetGraph is simple: Ship should not only record work, it should help teams stay on course. In most project systems, the data is there, but the signal arrives too late. A sprint is already drifting, an approval has already stalled, or an issue has already gone cold before anyone notices. FleetGraph closes that gap.`

`What I built is not a standalone chatbot and not a dashboard summary. It is an execution-drift agent embedded directly inside Ship. It runs in two modes on one shared graph. Proactively, it watches for regression signals like stale issues, missing standups, approval bottlenecks, and scope drift. On demand, it starts from the page the user is already on and answers in that exact context, whether that is an issue, a sprint, a project, or the workspace as a whole.`

`The architecture matters because it keeps the system disciplined. FleetGraph starts with deterministic checks, fetches Ship context through the REST API, and only calls the model when there is something worth reasoning about. From there it branches cleanly. If nothing is wrong, it exits cleanly. If something needs attention, it creates an alert. If it wants to propose a consequential action, it stops at a human gate. That means the system is proactive, but it is never reckless.`

`The live value is straightforward. Instead of making a manager hunt through tickets and history to figure out why momentum slipped, FleetGraph surfaces the regression early, explains why it matters with evidence, and points to the next decision. It is a control layer for keeping execution aligned with the plan, not just another place to read status.`

`For the live demo, I now have a deterministic way to show that flow. In the North Star panel, the title icon runs scoped analysis for the current page. Right next to it, the break-test icon backdates a few real issues tied to that scope and creates actionable FleetGraph approvals in the same chat thread. That immediately lights up the existing orange banner and the Action Items modal, so I can open a finding, read the summary, and approve a real priority or state change through the existing human gate.`

`So when I show the app, the important thing to watch is not just that the chat responds. The important thing is that the system understands the current context, detects when work is bending away from the north star, and helps the team recover course while keeping every important action visible, traceable, and human-approved.`

## Close

`The outcome is a Ship experience that does more than show the work. It protects the trajectory of the work.`
