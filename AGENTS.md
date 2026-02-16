# Gauntlet Cohort G4: Operating Guide

## Mission
Ship a real-time collaborative whiteboard with an AI board agent for the G4 sprint.
Project completion is required for Austin admission.

## Official Deadline and Checkpoints
- Final deadline: Sunday, February 22, 2026 at 10:59 PM CT.
- Pre-Search checkpoint: Monday (first hour).
- MVP checkpoint: Tuesday (24 hours).
- Early submission checkpoint: Friday (day 4).

## Portal and Team Access
- Project portal: https://gauntlet-portal.web.app/login
- Team email: `max.petrusenko@gfachallenger.gauntletai.com`
- Available models: Gemini Pro, Nano Banana Pro, and other Google models on team account.

## Core Principles
- Think with Claude, move fast with Cursor, verify and review with Codex.
- Every major system decision must be defended in writing.
- If a decision changes, log why it changed and what tradeoff caused it.
- Optimize for scale, performance, and maintainability from day one.
- Keep transcripts and screenshots in `Sessions/` for auditability.
- Use typed, componentized UI patterns (React 17+ if React is chosen).
- Use indexing/docs tooling in Cursor.

## Required Repository Files
- `PRESEARCH.md`: architecture and stack tradeoff research.
- `PRD.md`: product requirements and user-facing scope.
- `MVP.md`: hard-gate MVP checklist and acceptance criteria.
- `DECISIONS.md`: decision log with date, choice, alternatives, rationale, and impact.
- `TASKS.md`: 1-hour deliverables with owners and deadlines.
- `Sessions/`: session transcripts and screenshots.

## Engineering Requirements
- Build tests for every new feature.
- Use end-to-end TDD mindset for collaboration flows (do not force this on front-end styling work).
- Do not rewrite tests just to make them pass.
- Track work in Linear tickets.
- Revisit docs when scope changes to prevent duplication and drift.
- Track maintenance cost as part of technical decisions.

## Build Order (Execution Priority)
1. Multiplayer cursor sync.
2. Object sync for sticky notes and shapes.
3. Conflict handling for simultaneous edits.
4. Persistence across refresh/reconnect.
5. Board operations and transforms.
6. AI commands (single-step).
7. AI commands (multi-step templates).

## Research and Review Workflow
1. Complete Pre-Search first and challenge it with multiple AI systems.
2. Confirm stack choice with explicit reasons.
3. Confirm hosting with security, data, and scale implications.
4. Validate naming, file structure, refactorability, and legacy tolerance.
5. Re-check requirements coverage before each milestone.

## Questions to Answer Early
- Time to ship and non-negotiable deadlines?
- Scale and load profile at launch and 6 months?
- Budget and monthly cost ceiling?
- Team size and execution capacity?
- Authentication model and access control?
- Compliance scope (if targeting enterprise/government)?

## Notes for Lera
- Zack generated a Pre-Search doc and asked key architecture questions.
- Run Pre-Search through multiple AI perspectives before finalizing.
- Use Google Deep Research first, Perplexity as backup.
- Save research package to Drive and PDF before PRD/stack lock.
- Review open questions with the team before implementation lock.

## Active Task Backlog (Mirror in `TASKS.md`)
1. Download transcripts and publish curriculum to Gauntlet Notion.
2. Run 1-hour deliverables cadence with hard deadlines.
3. Collect high-signal system design resources (Meta/OpenAI/Anthropic and top forked repos).
4. Clarify IP posture if selecting a hiring partner.
5. Define Cursor rules and skills usage for the project.
6. Ensure OpenClaw can read the repo and create boards.
7. Prefer Aqua + Whisper voice flow when practical.
