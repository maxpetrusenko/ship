# PRESEARCH.md

Date: 2026-02-16
Source: `G4 Week 1 - CollabBoard.pdf`

## 1) Problem and Constraints
We need to ship a real-time collaborative whiteboard with an AI board agent in one sprint.

Hard deadlines:
- Pre-Search checkpoint: Monday, 2026-02-16 (first hour)
- MVP checkpoint: Tuesday, 2026-02-17 (24 hours)
- Early submission target: Friday, 2026-02-20
- Final deadline: Sunday, 2026-02-22, 10:59 PM CT

MVP hard gate (must all pass):
- Infinite board with pan/zoom
- Sticky notes with editable text
- At least one shape type
- Create/move/edit objects
- Real-time sync (2+ users)
- Multiplayer cursors with labels
- Presence awareness
- User authentication
- Public deployment

## 2) Phase 1: Define Constraints

### Scale and Load Profile (assumptions for sprint)
- Launch: 5-20 concurrent users per board.
- 6 months: 100-500 weekly active users if project extends.
- Traffic pattern: spiky (class demos / group sessions).
- Real-time: mandatory (sub-100ms object sync, sub-50ms cursor sync target from rubric).
- Cold starts: low tolerance on collaboration path.

### Budget and Cost Ceiling (initial)
- Dev/testing budget target: <= $150 for sprint week.
- Early production target (first 1,000 users): <= $700/month excluding optional enterprise add-ons.
- Trade money for time on auth + hosting + managed real-time infra.

### Time to Ship
- Primary priority this week: speed-to-market with stable multiplayer.
- Long-term maintainability: handled through typed contracts, tests, and decision log.
- Iteration cadence: daily cut + checkpoint review.

### Compliance and Regulatory
- No healthcare scope.
- Baseline privacy: least-privilege auth rules, no secrets in client.
- If later targeting enterprise/government hiring contexts: add SOC 2 controls and audit logging roadmap.

### Team and Skills
- Execution baseline: TypeScript-first team.
- Best velocity stack for team this week: React + Firebase + serverless AI action layer.

## 3) Phase 2: Architecture Discovery

## Option Comparison

| Option | Stack | Pros | Cons | Fit for 1-week sprint |
|---|---|---|---|---|
| A | React + Konva + Firebase (Auth + Firestore + RTDB presence) + Cloud Functions | Fastest setup, managed auth, real-time primitives, easy deploy | Vendor lock-in, Firestore modeling discipline needed | Best |
| B | React + Konva + Supabase (Auth + Postgres + Realtime) + Edge Functions | SQL flexibility, good DX | Realtime conflict handling takes more setup for board semantics | Good |
| C | React + custom WebSocket + Redis + Postgres | Max control/perf tuning | Highest implementation risk and ops load | Poor for this deadline |

Selected option: **A**.

### Hosting and Deployment
- Frontend: Firebase Hosting.
- API/AI actions: Firebase Cloud Functions (HTTP callable).
- CI: GitHub Actions (lint, tests, deploy preview or protected main deploy).

### Authentication and Authorization
- Firebase Auth with Google and/or email-link.
- Rules enforce board-level access.
- Presence is per authenticated user.

### Database and Data Layer
- Firestore:
  - `boards/{boardId}` metadata
  - `boards/{boardId}/objects/{objectId}` canonical board objects
  - `boards/{boardId}/events/{eventId}` optional event stream for debugging/replay
- Realtime Database:
  - `presence/{boardId}/{userId}` ephemeral online status + cursor position

### Backend/API Architecture
- Frontend writes authorized collaborative updates.
- Server action for AI commands:
  - validate intent
  - map to tool calls (`createStickyNote`, `moveObject`, etc.)
  - execute atomic updates

### Frontend Framework and Rendering
- React + TypeScript + Konva.
- SPA (no SEO requirement for MVP).
- Canvas-first rendering for smooth interactions.

### Third-Party Integrations
- LLM provider: OpenAI or Anthropic with function/tool calling.
- Optional analytics after MVP hard gate.

## 4) Phase 3: Post-Stack Refinement

### Security Risks and Mitigations
- Risk: over-permissive database rules.
  - Mitigation: deny-by-default rules; board membership checks.
- Risk: prompt injection via AI command text.
  - Mitigation: strict tool schema validation; no raw code execution.
- Risk: leaked API keys.
  - Mitigation: keep keys in server env only.

### Project Structure
- `apps/web/` React whiteboard app
- `apps/functions/` AI + server-side workflows
- `packages/shared/` types, schemas, shared utilities
- `docs/` optional later; this repo root currently stores planning docs

### Naming and Style
- TypeScript strict mode.
- ESLint + Prettier.
- Conventions: `camelCase` vars/functions, `PascalCase` components/types.

### Testing Strategy
- Unit: object transforms, reducers, command parsing.
- Integration: sync/persistence flows.
- E2E (critical):
  - 2 users simultaneous editing
  - refresh recovery
  - throttled network recovery
  - 5-user stability smoke test

### Tooling and DX
- Cursor + Claude + Codex workflow.
- Linear for task tracking.
- GitHub PR checks required for main.

## 5) Final Stack Decision
- Frontend: React + TypeScript + Konva
- Realtime and Auth: Firebase (Firestore + RTDB + Auth)
- AI: function-calling model through server actions
- Hosting: Firebase Hosting + Cloud Functions

Why this stack now:
- Minimum integration overhead for hard 24-hour MVP gate.
- Fastest path to stable realtime collaboration and authentication.
- Acceptable tradeoff: some lock-in for much lower delivery risk.
