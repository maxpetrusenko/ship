# Agent Usage Tracking Design

## Goal

Track full Claude and Codex usage snapshots in this repository using CodexBar and persist them in repo files for later review.

## Scope

- Read provider usage from `codexbar usage`
- Read provider local token/cost history from `codexbar cost` as a fallback and supplemental detail
- Append machine-readable snapshots to a repo file
- Regenerate a human-readable markdown summary in the repo
- Add a package script so the snapshot can be refreshed on demand

## Non-Goals

- True repo-scoped token attribution
- CI-based tracking
- Ship API integration
- Background daemons or git hooks

## Approach

Use a small Node script in `scripts/track-agent-usage.js`. The script will call CodexBar separately for `codex` and `claude`, capture both `usage` and `cost` payloads, and append a normalized snapshot record to `docs/metrics/agent-usage.snapshots.jsonl`.

The same script will also generate `docs/agent-usage.md` from the latest snapshot. This avoids hand-editing docs and keeps one machine source of truth plus one human view.

Provider calls should be isolated so one provider failure does not block the other. Failures should be recorded in the snapshot payload and rendered in markdown.

## Data Shape

Each snapshot record should include:

- timestamp
- repository root
- git branch
- git commit
- provider results for `codex` and `claude`
- per-provider `usage`
- per-provider `cost`
- per-provider error metadata when a command fails

## Testing

Use `node:test` for a small regression test that:

- verifies snapshot append behavior
- verifies markdown generation
- verifies provider failure rendering

## Verification

- run the new node test first red then green
- run the script once against the real local CodexBar install
- inspect generated files
