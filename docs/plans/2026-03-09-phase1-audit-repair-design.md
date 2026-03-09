# Phase 1 Audit Repair Design

## Goal

Turn `presearch-codex.md` into the strongest possible Phase 1 submission artifact by filling structural gaps, correcting stale provenance, and replacing "blocked" placeholders with real measurements wherever the local environment supports them.

## Scope

- Keep `presearch-codex.md` as the submission document
- Preserve Codex's evidence discipline: `Verified`, `Inferred`, `Not yet measured`
- Import missing orientation coverage required by `requirements.md`
- Re-run measurements in the local `ShipShape` repo
- Document exact blockers only when a required live measurement cannot be completed locally

## Non-Goals

- Phase 2 implementation work
- Source-code fixes in `ShipShape` unless required only to run the audit
- Invented or estimated baseline numbers

## Approach

Start by reconciling the assignment checklist in `requirements.md` against the current `presearch-codex.md` shape. Patch the orientation section first so the appendix is complete and current.

Then probe the local runtime path for categories 3 to 7: app boot, database availability, test setup, browser automation, and accessibility tooling. For each category, either collect the required baseline measurements or capture the exact command, failure point, and reason the requirement remains blocked.

Finally, rewrite `presearch-codex.md` so every requirement has one of three states: measured with evidence, inferred from code review and explicitly labeled, or blocked with exact repro details.

## Verification

- Re-run the count commands used in the report
- Re-run any live measurement commands cited in the report
- Re-check `requirements.md` line by line against the updated document
