# Spec Kit Workflow

ShipShape now uses GitHub Spec Kit for spec-driven planning in Codex.

## Codex Setup

Run Codex from the repo root with:

```bash
export CODEX_HOME="$PWD/.codex"
```

The local `.codex/` folder contains the generated prompt files and stays ignored by git.

## Core Command Flow

1. `/speckit.constitution` to define project rules for the active effort
2. `/speckit.specify` to capture feature scope and requirements
3. `/speckit.plan` to turn scope into an implementation design
4. `/speckit.tasks` to break the plan into executable work
5. `/speckit.implement` to execute the task set

## Helpful Optional Commands

- `/speckit.clarify` for ambiguity cleanup before planning
- `/speckit.analyze` for cross-artifact consistency and readiness checks
- `/speckit.checklist` for custom quality gates
