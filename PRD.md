# PRD.md

Date: 2026-02-16
Product: CollabBoard AI
Source of truth: `G4 Week 1 - CollabBoard.pdf`

## 1) Product Summary
CollabBoard AI is a real-time collaborative whiteboard where multiple authenticated users can co-edit board objects and use natural-language AI commands to generate and manipulate board content.

## 2) Goals
- Pass MVP hard gate by 2026-02-17.
- Deliver stable multiplayer collaboration (2+ users, target 5+ concurrent users).
- Deliver AI board agent with 6+ command types and shared output visibility.
- Ship publicly accessible deployed app by final deadline.

## 3) Non-Goals (for this sprint)
- Enterprise RBAC and advanced org administration.
- Full offline/PWA mode.
- Complex template marketplace.
- Multi-region disaster recovery.

## 4) Users
- Primary: cohort evaluators and project team.
- Secondary: workshop facilitators and collaborators.

## 5) User Stories
- As a user, I can sign in and join a board.
- As a user, I can pan/zoom an infinite canvas and create/edit objects.
- As a user, I can see who is online and where collaborators' cursors are.
- As a user, I can refresh and keep board state intact.
- As a user, I can issue AI commands to create and arrange board content.
- As a collaborator, I can see AI-generated changes in real time.

## 6) Functional Requirements

### 6.1 Authentication
- FR-1: System supports user authentication before board collaboration.
- FR-2: Authenticated users are identified in presence/cursor labels.

### 6.2 Whiteboard Core
- FR-3: Infinite board with smooth pan/zoom.
- FR-4: Sticky notes with editable text and color changes.
- FR-5: At least one shape type in MVP; full pass aims for rectangle/circle/line.
- FR-6: Users can create, move, edit, delete, duplicate, and copy/paste objects.
- FR-7: Support single-select and multi-select.
- FR-8: Support frames/connectors/text elements in post-MVP phase.

### 6.3 Realtime Collaboration
- FR-9: Object changes sync instantly across users.
- FR-10: Multiplayer cursors with name labels.
- FR-11: Presence awareness (online users).
- FR-12: Conflict handling documented (LWW acceptable).
- FR-13: Graceful disconnect/reconnect.
- FR-14: Persistence across full board disconnect/rejoin.

### 6.4 AI Board Agent
- FR-15: AI agent supports at least 6 command types across creation/manipulation/layout/complex templates.
- FR-16: AI command latency target <2s for single-step commands.
- FR-17: Tool schema includes: `createStickyNote`, `createShape`, `createFrame`, `createConnector`, `moveObject`, `resizeObject`, `updateText`, `changeColor`, `getBoardState`.
- FR-18: Multi-step commands execute sequentially and predictably.
- FR-19: AI outputs are visible to all users in shared state.

## 7) Non-Functional Requirements
- NFR-1: 60 FPS target during pan/zoom/manipulation.
- NFR-2: Object sync latency target <100ms.
- NFR-3: Cursor sync latency target <50ms.
- NFR-4: 500+ objects without major degradation.
- NFR-5: 5+ concurrent users without major degradation.

## 8) Acceptance Criteria (Rubric-Aligned)
- AC-1: All MVP hard-gate items completed and demoable.
- AC-2: Collaboration test scenarios pass:
  - 2-browser simultaneous edits
  - refresh mid-edit
  - rapid object creation/movement
  - throttled/disconnect recovery
  - 5+ user run
- AC-3: AI demonstrates 6+ valid command types including 1+ multi-step command.
- AC-4: Public deployment accessible with auth.

## 9) Milestones
- M1 (2026-02-16): Pre-Search complete + architecture locked.
- M2 (2026-02-17): MVP hard gate complete.
- M3 (2026-02-20): full feature set and early submission package.
- M4 (2026-02-22 10:59 PM CT): final polish + full submission.

## 10) Deliverables
- GitHub repo with setup guide and architecture overview.
- Public deployed app URL.
- Demo video (3-5 min).
- Pre-Search document.
- AI Development Log (1 page).
- AI Cost Analysis (dev spend + 100/1K/10K/100K projections).
- Social post with demo/screenshots tagging `@GauntletAI`.

## 11) Risks and Mitigations
- Risk: realtime instability under load.
  - Mitigation: prioritize cursor/object sync first and test continuously in multi-window mode.
- Risk: AI action inconsistency.
  - Mitigation: strict tool schema, deterministic execution layer, clear fallback errors.
- Risk: missed deadline due to scope creep.
  - Mitigation: strict MVP cut line and daily checkpoint review.
