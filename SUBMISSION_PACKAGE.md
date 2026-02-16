# CollabBoard Week 1 Submission Package

Date: 2026-02-16
Project: Gauntlet Cohort G4 - CollabBoard
Repository: https://github.com/appDevelopment-tech/gauntlet-cohort-1

## Deliverables (Required)
- Deployed apps
- Demo video
- Pre-Search doc
- AI development log (1 page)
- LinkedIn or X post about what was done in 1 week
- AI cost analysis
- Doc submission in PDF format

## 1) Deployed Apps
Status: In progress
- Production URL: TBD
- Preview URL: TBD
- Auth mode for MVP: Google OAuth (Firebase Auth)

## 2) Demo Video
Status: In progress
- Target length: 3-5 minutes
- Must show:
  - real-time collaboration (2+ users)
  - multiplayer cursors + presence
  - AI command execution
  - architecture overview
- Recording link: TBD

## 3) Pre-Search Document
Status: Complete
- File: PRESEARCH.md
- Source requirements: G4 Week 1 - CollabBoard.pdf
- Includes:
  - constraints and load assumptions
  - stack comparison and selected stack
  - security/test strategy
  - final architecture decision

## 4) AI Development Log (1 Page)
Status: Draft started

### Tools and Workflow
- Tools used: Codex, Cursor, Claude, MCP integrations (Linear).
- Workflow:
  1. Extract official rubric and hard-gate requirements from provided PDF.
  2. Create structured planning docs (PRESEARCH, PRD, MVP, DECISIONS, TASKS).
  3. Create Linear issues mapped to execution timeline.
  4. Refine requirements to close identified coverage gaps.

### MCP Usage
- Linear MCP used to create and track implementation tickets:
  - MAX-19 through MAX-25

### Effective Prompts (examples)
- "Review this requirements PDF and confirm whether it is the project requirements doc."
- "Generate PRD, MVP, decisions log, and tasks from this rubric with hard deadlines."
- "Identify missing requirements coverage and patch docs to close gaps."

### Code/Docs Analysis
- Approximate split at this stage:
  - AI-generated planning/docs: high
  - manual editing and decisions: medium

### Strengths and Limitations
- Strengths:
  - fast structure creation
  - clear traceability from rubric to requirements
- Limitations:
  - final product still depends on execution quality and test coverage

### Key Learnings
- Locking constraints early reduces scope drift.
- Decision logs improve architecture defense and change clarity.

## 5) LinkedIn/X Post Draft (1 Week Summary)
Status: Draft

Draft text:
"Week 1 at Gauntlet Cohort G4: built the planning and execution foundation for a real-time collaborative whiteboard + AI board agent. We completed rubric-driven Pre-Search, PRD/MVP docs, decision logging, and Linear execution mapping. Next: ship MVP hard-gate (auth, realtime sync, cursors, presence, deploy) then expand AI commands. #GauntletAI #BuildInPublic"

## 6) AI Cost Analysis
Status: Draft template

### Development Cost Tracking
- Provider(s): TBD
- Total API calls: TBD
- Total tokens (input/output): TBD
- Total dev spend: TBD

### Production Cost Projection Template
| Scale | Estimated Monthly Cost |
|---|---|
| 100 users | TBD |
| 1,000 users | TBD |
| 10,000 users | TBD |
| 100,000 users | TBD |

Assumptions to fill:
- average commands per user session
- average sessions per user per month
- average tokens per command type

## 7) Documentation Submission Format
- This standalone package is provided as Markdown and PDF.
- PDF file: SUBMISSION_PACKAGE.pdf

## 8) GitHub PAT Token Note
- If repository automation or external tooling cannot use existing GitHub auth, use a PAT with least privilege required for repo read/write operations.
- Store PAT only in secure secret managers or local env variables, never in source control.
