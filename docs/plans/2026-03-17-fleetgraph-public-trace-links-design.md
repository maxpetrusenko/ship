# FleetGraph Public Trace Links Design

## Goal

Make every FleetGraph trace link surfaced in the product usable by end users without requiring LangSmith workspace access.

## Problem

FleetGraph currently resolves trace links with LangSmith's canonical run URL helper. Those links open the authenticated LangSmith run view, which works for internal operators but fails the product requirement for user-facing debug access.

Current affected surfaces:

- `POST /api/fleetgraph/on-demand`
- `POST /api/fleetgraph/chat`
- chat debug popover
- floating chat latest-trace link
- any other UI that consumes `traceUrl` from FleetGraph responses

## Decision

Use the LangSmith SDK's run-sharing API for every FleetGraph trace URL.

Implementation rule:

- when a FleetGraph run has a LangSmith run ID, resolve `traceUrl` with `Client.readRunSharedLink(runId)` first
- if the run is not already shared, call `Client.shareRun(runId)`
- return the resulting public `/public/<token>/r` URL

This keeps the change server-side and preserves the existing `traceUrl` contract for API and UI consumers.

## Why This Approach

### 1. Correct visibility boundary

The debug link itself becomes the access mechanism. Users no longer need to belong to the LangSmith workspace.

### 2. Small blast radius

Only the shared LangSmith resolver changes. The graph nodes, routes, shared types, and UI components can keep consuming `traceUrl` as they do today.

### 3. Idempotent behavior

`readRunSharedLink()` avoids creating a new share token when one already exists. `shareRun()` covers first-time runs.

## Trade-offs

### Accepted

- Any holder of the public link can view the trace, consistent with LangSmith's public share model.
- Trace data that appears in LangSmith becomes user-shareable by URL.

### Rejected

- Keeping private run URLs and asking users to authenticate in LangSmith.
- Building a custom trace proxy in ShipShape just to avoid LangSmith's public-share feature.

## Safety Notes

- This design assumes FleetGraph traces do not contain secrets that should stay internal-only.
- If stricter control is needed later, add an environment flag or role gate around sharing, but that is out of scope for this change.

## Testing Strategy

Cover the shared resolver directly:

- existing public share link is reused
- missing public share link triggers `shareRun()`
- shared URL is returned to downstream FleetGraph callers

Keep existing UI and route tests that already assert `traceUrl` propagation.
