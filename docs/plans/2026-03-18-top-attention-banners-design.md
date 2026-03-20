# Top Attention Banners Design

## Goal

Restore the top-of-shell proactive visibility pattern by rendering FleetGraph sweep findings in the same top attention region as accountability, while keeping accountability first and FleetGraph second.

## Decision

- keep the existing accountability banner unchanged as the first row
- add a second FleetGraph banner row directly below it
- source FleetGraph banner data from the existing modal feed so server priority stays canonical
- click on either row opens the existing action items modal
- do not replace the bell
- do not change bolt behavior in this task

## Behavior

- accountability renders first whenever accountability already says it should render
- FleetGraph renders second when the modal feed has at least one visible item
- FleetGraph count equals modal-feed item count
- FleetGraph urgency color is derived from the highest-priority item, which is the first item in the server-sorted feed
- rows are independent; one can render without the other

## Copy

- `1 FleetGraph finding needs attention.`
- `N FleetGraph findings need attention.`

## Implementation Notes

- create a small top-banner stack component instead of growing `App.tsx`
- reuse `AccountabilityBanner` for the first row
- add a dedicated FleetGraph banner for the second row
- keep ordering in the UI only; sorting remains backend-owned

## Out Of Scope

- merging accountability and FleetGraph into one message
- changing the proactive scheduler cadence
- making the bolt trigger a proactive sweep
- replacing the bell or modal structure
