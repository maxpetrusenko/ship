# FleetGraph Action Items Modal Design

## Goal

Extend the existing `ActionItemsModal` so proactive FleetGraph findings appear in the same modal shell the user already sees on login, below the current accountability items list and above the existing `Got it` footer.

## Scope

This is a V1 integration for proactive surfacing only.

- keep the existing modal shell
- keep the current accountability section and navigation behavior
- append a FleetGraph section below it
- use the modal as the proactive triage surface
- keep deeper chat on the issue page only

Out of scope for this change:

- a second modal
- toast overlays
- banner replacement
- artifact expansion beyond current FleetGraph entity support
- turning chat into the primary proactive surface

## Current Problem

Ship currently has two separate proactive surfaces:

- the accountability banner + `ActionItemsModal`
- FleetGraph bell + dropdown notifications

That split makes proactive drift findings easy to miss. The user asked for one familiar place to look on login and after sweeps. At the same time, the requirements still expect FleetGraph to be proactive, context-aware, and human-gated before any consequential write.

## Decision

- keep the existing `ActionItemsModal` container in [ActionItemsModal.tsx](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/web/src/components/ActionItemsModal.tsx)
- keep accountability items as the first section
- add a second section labeled `FleetGraph`
- render FleetGraph findings between the current modal content and the existing footer with `Got it`
- continue using the existing `fleetgraph:alert` realtime event and per-user alert queries
- keep the accountability banner as-is for this scope
- keep FleetGraph chat off the modal; the modal links out to the issue page for deeper discussion

## Information Architecture

The modal keeps one shell:

- existing header
- existing accountability content
- new FleetGraph section
- existing footer

Within the FleetGraph section:

1. section heading with count
2. prioritized list of FleetGraph items
3. each item collapsed by default
4. expand in place to reveal diagnosis

Collapsed row fields:

- issue or entity title
- signal label
- severity
- one-line summary of what changed

Expanded row fields:

- `What changed`
- `Why this matters`
- `Owner`
- `Next decision`
- `Explain`
- `Show reasoning`

Expanded row actions:

- `Open issue` or entity context link
- `Approve`, `Deny`, `Snooze` only when the row has an explicit pending approval / proposed action
- `Skip` or `Snooze` for inform-only findings

Implementation note:

- UI label `Skip` should map to backend `dismiss` so we keep the existing resolve contract

## Prioritization Rules

Prioritization belongs on the server, not in the frontend.

The modal must not sort raw alerts independently. The server feed should emit display-ready items with:

- `displayPriority`
- `supersededBy`
- `rollupKey`
- `isActionable`

V1 prioritization rules:

1. actionable pending approval beats inform-only signal
2. higher-level parent signal beats lower-level child noise
3. critical beats high beats medium beats low
4. newer materially changed item beats unchanged resurfacing item

Examples:

- closed or no-longer-relevant sprint demotes an issue-level stale signal
- scope drift on the sprint or project outranks a single stale issue under it
- multiple stale issues under the same parent can roll up into one top item when the parent signal is stronger

## Snooze

`Snooze` is per-user, not global.

- applies to the current alert fingerprint for the current user
- suppresses resurfacing across sweeps until expiry
- default options stay `30 min`, `1 hr`, `1 day`
- a materially changed alert or a stronger replacement alert can appear as a new item

## Approve Semantics

Approve must stay explicit.

- no write on stale issue detection alone
- approve only appears when FleetGraph has already created a concrete proposed action and pending approval
- button copy should be action-specific when possible
- the backend remains the source of truth for CAS / idempotency

Examples:

- `Approve reassignment`
- `Approve priority change`
- `Approve comment`

## Delivery Path

Use the existing proactive path:

- server sweep every 4 minutes
- recipient-based FleetGraph alerts
- existing `fleetgraph:alert` WebSocket event
- login fetch + realtime invalidation thereafter

For this change, the modal should open when either of these are true:

- the user has accountability items
- the user has unsnoozed, displayable FleetGraph modal items

## Relationship To Existing Surfaces

### Accountability banner

Unchanged in V1. It still opens the same modal.

### FleetGraph bell

Still exists. It remains the durable notification center and history surface.

### FleetGraph chat

Still exists, but not in the modal. The modal should route the user to the issue page if they want to investigate further.

## Requirements Fit

This design stays inside the FleetGraph requirements in [requirements.md](/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/FleetGraph/requirements.md):

- proactive mode still pushes findings
- on-demand contextual chat still exists
- chat remains embedded and scoped to what the user is looking at
- human-in-the-loop still gates consequential writes

## V2 Notes

Documented only, not in scope for this implementation:

- first-class program scope
- first-class wiki / plan / retro / review artifact scopes
- page-diagnosis cards outside the modal
- richer cross-entity rollups
