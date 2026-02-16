# TASKS.md

Date initialized: 2026-02-16
Cadence: 1-hour deliverables with hard deadlines
Source: `G4 Week 1 - CollabBoard.pdf`

## Priority Lanes
- Lane A: MVP hard gate (must pass first)
- Lane B: AI board agent
- Lane C: Submission artifacts and documentation
- Lane D: Operations (Linear, transcripts, OpenClaw readiness)

## Hourly Execution Plan

| ID | Deadline (CT) | Task | Lane | Owner | Status |
|---|---|---|---|---|---|
| T-001 | 2026-02-16 14:30 | Finalize `PRESEARCH.md` from PDF rubric | C | Max | Done |
| T-002 | 2026-02-16 15:00 | Finalize `PRD.md`, `MVP.md`, `DECISIONS.md` | C | Max | Done |
| T-003 | 2026-02-16 15:30 | Break implementation work into Linear tickets | D | Max | Done |
| T-004 | 2026-02-16 16:30 | Initialize app scaffold (web + backend functions) | A | Max | Todo |
| T-005 | 2026-02-16 17:30 | Implement authentication flow | A | Max | Todo |
| T-006 | 2026-02-16 18:30 | Implement presence and multiplayer cursors | A | Max | Todo |
| T-007 | 2026-02-16 19:30 | Implement object create/move/edit + realtime sync | A | Max | Todo |
| T-008 | 2026-02-16 20:30 | Implement infinite pan/zoom + shape support | A | Max | Todo |
| T-009 | 2026-02-16 21:30 | Run 2-browser and refresh/disconnect tests | A | Max | Todo |
| T-010 | 2026-02-17 09:30 | Deploy MVP public URL + verify hard gate checklist | A | Max | Todo |
| T-011 | 2026-02-17 12:00 | Add AI command dispatcher and 3 basic commands | B | Max | Todo |
| T-012 | 2026-02-18 12:00 | Expand to 6+ commands including layout + complex | B | Max | Todo |
| T-013 | 2026-02-19 18:00 | Add automated tests for core collaboration flows | A | Max | Todo |
| T-014 | 2026-02-20 18:00 | Prepare early submission package (video + docs) | C | Max | Todo |
| T-015 | 2026-02-22 20:00 | Final polish, cost analysis, social post assets | C | Max | Todo |
| T-016 | 2026-02-22 22:00 | Final submission freeze and upload | C | Max | Todo |

## Dependency Map
- T-004 blocks T-005, T-006, and T-007.
- T-005 blocks T-006 (identity labels) and T-010 (auth hard-gate).
- T-006 and T-007 block T-009.
- T-008 depends on baseline object model from T-007.
- T-009 blocks T-010.
- T-010 blocks T-011 and T-012 for post-MVP AI expansion.

## Execution Roles
- Max: accountable owner and final decision maker.
- Codex: architecture/docs/review support and implementation assistance.
- Cursor: implementation acceleration and rapid edits.
- Claude: adversarial review and prompt iteration support.

## Linear Integration Status
- Integration confirmed for team `Maxpetrusenko`.
- Created issues:
  - T-004 -> `MAX-19`
  - T-005 -> `MAX-20`
  - T-006 -> `MAX-21`
  - T-007 -> `MAX-22`
  - T-008 -> `MAX-23`
  - T-009 -> `MAX-24`
  - T-010 -> `MAX-25`

## Required Artifacts Checklist
- [ ] Public deployed URL
- [ ] Demo video (3-5 minutes)
- [ ] Pre-Search checklist completion
- [ ] AI Development Log (1 page)
- [ ] AI Cost Analysis (dev spend + projections)
- [ ] Architecture overview + setup guide in repo
- [ ] Social post draft with screenshots

## Linear Ticket Skeleton
Use this template for each ticket:
- Title: `[Lane] <Feature/Task>`
- Description:
  - Goal
  - Scope in/out
  - Acceptance criteria
  - Test plan
  - Deadline

## Operations Tasks
- [ ] Export session transcripts and keep in `Sessions/`.
- [ ] Publish curriculum/transcript package to Notion.
- [ ] Confirm OpenClaw read/push access remains functional.
- [ ] Keep `DECISIONS.md` updated whenever architecture changes.
