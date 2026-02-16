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
  - conflict behavior under simultaneous edits
  - AI command execution (single-step and multi-step)
  - architecture overview and decisions summary
- Recording link: TBD

## 3) Pre-Search Document
Status: Complete and strengthened
- File: `PRESEARCH.md`
- Source requirements: `G4 Week 1 - CollabBoard-requirements.pdf`
- Added based on feedback:
  - explicit `BoardObject` and `CursorPresence` schemas
  - explicit LWW/version conflict model
  - sync throughput and listener/index strategy
  - AI execution architecture with idempotency and FIFO ordering
  - offline/reconnect strategy details
  - concrete AI cost modeling and projections

## 4) AI Development Log (1 Page)
Status: Draft started

### Tools and Workflow
- Tools used: Codex, Cursor, Claude, MCP integrations (Linear).
- Workflow:
  1. Extract official rubric and hard-gate requirements from provided PDF.
  2. Create structured planning docs (`PRESEARCH`, `PRD`, `MVP`, `DECISIONS`, `TASKS`).
  3. Create Linear issues mapped to execution timeline.
  4. Apply structured architecture feedback across docs and regenerate submission PDFs.

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
  - manual edits and architecture decisions: medium

### Strengths and Limitations
- Strengths:
  - fast structure creation
  - clear rubric traceability
  - explicit architecture defense points
- Limitations:
  - final score depends on implementation quality and test execution

### Key Learnings
- Explicit technical contracts reduce mid-build ambiguity.
- AI concurrency/idempotency must be designed early, not added later.

## 5) LinkedIn/X Post Draft (1 Week Summary)
Status: Draft

Draft text:
"Week 1 at Gauntlet Cohort G4: we built a real-time collaborative whiteboard + AI board agent foundation with rubric-driven Pre-Search, PRD/MVP specs, decision logging, and Linear execution mapping. We upgraded architecture docs with explicit conflict strategy, sync performance model, AI command concurrency handling, and cost projections. Next: finalize MVP hard gate and demo. #GauntletAI #BuildInPublic"

## 6) AI Cost Analysis
Status: Draft with initial numbers

Assumptions:
- 6 commands/session
- 8 sessions/user/month
- 1520 average tokens/command
- blended token cost: $3.20 per 1M tokens

| Scale | LLM Tokens/Month | LLM Cost | Infra Cost | Total |
|---|---:|---:|---:|---:|
| 100 users | 7.296M | $23 | $90 | $113 |
| 1,000 users | 72.96M | $233 | $220 | $453 |
| 10,000 users | 729.6M | $2,335 | $1,250 | $3,585 |
| 100,000 users | 7.296B | $23,347 | $7,500 | $30,847 |

Dev spend tracking fields:
- Provider(s): TBD
- Total API calls: TBD
- Total tokens (input/output): TBD
- Total dev spend: TBD

## 7) Documentation Submission Format
- This package is provided in Markdown and PDF.
- PDF file: `SUBMISSION_PACKAGE.pdf`
- All document PDFs are in `mvp-1-collab-board/submission/`.

## 8) GitHub PAT Token Note
- If repository automation cannot use existing auth, use a PAT with least privilege for repo read/write.
- Store PAT only in secure secret managers or local environment variables.
- Never commit tokens to source control.
