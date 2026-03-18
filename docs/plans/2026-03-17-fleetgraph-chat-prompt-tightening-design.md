# FleetGraph Chat Prompt Tightening Design

## Goal

Keep public traces fully visible while making FleetGraph chat narrower, shorter, and Ship-only.

## Current Problem

The current reasoning prompt is too long and explicitly allows answering unrelated questions like trivia or math. That conflicts with the desired product behavior:

- shorter replies
- no off-topic conversation
- keep answers inside Ship context and user-visible scope

## Decision

Keep LangSmith public traces as-is. Do not redact prompt or inputs.

Change only the reasoning prompt:

- shorten it
- tell FleetGraph to answer only Ship and project-health questions
- tell FleetGraph to refuse unrelated questions with a short redirect
- keep page context authoritative
- keep accountability counts first when relevant
- keep recommendations inside current visible scope

## Expected Behavior

For related questions:

- concise answer
- grounded in provided entity, page context, signals, and chat history
- no claims outside current workspace/entity context

For unrelated questions:

- one short sentence
- redirect back to Ship
- no actual answer to the unrelated topic

## Testing

Add a prompt-contract unit test so the prompt:

- contains the Ship-only restriction
- contains the short unrelated-question redirect behavior
- no longer contains the old "answer unrelated questions briefly" rule
