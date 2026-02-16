# MVP.md

Date: 2026-02-16
MVP deadline: Tuesday, 2026-02-17 (24-hour gate)

## Hard-Gate Checklist
- [ ] Infinite board with pan/zoom
- [ ] Sticky notes with editable text
- [ ] At least one shape type (rectangle/circle/line)
- [ ] Create, move, and edit objects
- [ ] Real-time sync between 2+ users
- [ ] Multiplayer cursors with name labels
- [ ] Presence awareness (who is online)
- [ ] User authentication
- [ ] Deployed and publicly accessible

All items above are required to pass MVP.

## Definition of Done (MVP)
- All hard-gate checklist items complete.
- Tested in at least 2 browsers with separate authenticated users.
- Basic failure handling for refresh/disconnect works.
- Deployment is live and accessible via public URL.
- Known issues captured in `TASKS.md` with severity labels.

## Test Plan (MVP)

### Required test scenarios
1. Two users edit simultaneously in separate browsers.
2. One user refreshes during active edit; state remains consistent.
3. Rapid create/move of sticky notes and shapes syncs correctly.
4. Network throttle + temporary disconnect recovers gracefully.
5. Five concurrent users can join and interact without severe degradation.

### MVP performance targets
- Cursor sync latency: <50ms target.
- Object sync latency: <100ms target.
- Canvas interaction: smooth under normal load.

## MVP Cut Line
If time runs short, keep only:
- Sticky notes + 1 shape type.
- Reliable object sync + cursor sync + presence.
- Auth + deploy.

Defer until after gate:
- Connectors, advanced transforms, rich templates.
- Complex AI orchestration.

## Build Order
1. Auth bootstrapping.
2. Presence + cursor channels.
3. Object CRUD + real-time sync.
4. Pan/zoom + basic interactions.
5. Deploy and multi-browser verification.
6. Add minimal AI command path only after multiplayer core is stable.
