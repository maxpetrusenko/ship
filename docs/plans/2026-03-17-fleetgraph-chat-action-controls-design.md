# FleetGraph Chat Action Controls Design

## Goal

Make suggested chat actions visibly actionable inside chat, with compact controls that fit narrow cards.

## Current Problem

The chat card already supports `Approve` and `Dismiss`, but those controls only render when the UI has a linked `alertId`. Chat suggestions created on the fly can return a proposed action while the rendered message still lacks a stable alert link, so the controls disappear.

## Decision

- keep semantics: `Approve` and `Dismiss`
- make the controls compact: green check + red x icon buttons
- preserve accessibility with explicit labels
- attach `alertId` directly to the assistant chat message so each message carries its own actionable link
- keep the existing resolve endpoint and outcome flow

## Expected Behavior

- a chat reply with `Suggested Change` shows compact approve/dismiss controls
- controls stay visible for ad hoc chat suggestions, not only pre-existing alerts
- each message resolves its own alert instead of relying on a shared "latest alert" state
- processing and completed states still render inline

## Testing

- add a failing chat test for a suggested change with a returned alert id
- assert `Approve` and `Dismiss` are visible by accessible name
- assert the controls are compact icon buttons in the DOM
