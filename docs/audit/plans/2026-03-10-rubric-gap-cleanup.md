# Rubric Gap Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the submission docs with the literal rubric by fixing the Category 5 overclaim, adding broader keyboard evidence for Category 7, and making Category 6 baseline deliverables easier to audit.

**Architecture:** Treat this as a documentation integrity pass, not a product change. Update the audit baseline, final narrative, checklist-style language, and verification record together so all summary docs say the same thing about what was measured, what remains weaker, and what still needs hard evidence.

**Tech Stack:** Markdown docs, ripgrep, submission package docs

---

### Task 1: Plan the doc corrections

**Files:**
- Create: `ShipShape/docs/plans/2026-03-10-rubric-gap-cleanup.md`
- Test: `ShipShape/docs/submission/requirements.md`

**Step 1: Confirm the rubric targets**

Run: `rg -n "Category 5|Category 6|Category 7|keyboard|Playwright|full test suite" ShipShape/docs/submission/requirements.md`

**Step 2: Confirm the current overclaims**

Run: `rg -n "all 7 rubric categories are now met|target met|keyboard|pnpm test" ShipShape/docs/submission/presearch-codex.md ShipShape/docs/submission/final-narrative.md ShipShape/docs/submission/verification-record.md`

### Task 2: Fix Category 5 framing

**Files:**
- Modify: `ShipShape/docs/submission/presearch-codex.md`
- Modify: `ShipShape/docs/submission/final-narrative.md`
- Modify: `ShipShape/docs/submission/submission-checklist.md`
- Modify: `ShipShape/docs/submission/submission-pack.md`

**Step 1: Make the baseline description literal**

Update the Category 5 baseline so it clearly says:
- repo-root `pnpm test` was API-only in this repo
- web coverage was measured separately
- Playwright suite structure and isolation were reviewed, but a full Playwright rerun is not currently recorded in the verification package

**Step 2: Remove the unsupported “all 7 are met” summary language**

Replace it with wording that says the package is strong but Category 5 remains a documentation/evidence gap on a literal rubric read.

### Task 3: Tighten Category 6 and Category 7 evidence

**Files:**
- Modify: `ShipShape/docs/submission/presearch-codex.md`
- Modify: `ShipShape/docs/submission/verification-record.md`

**Step 1: Reshape Category 6 baseline outputs**

Convert:
- missing error boundaries into a short location list
- silent failures into a table with reproduction steps

**Step 2: Add a keyboard matrix for Category 7**

Document keyboard coverage for the major pages already used in the accessibility pass:
- `/login`
- `/issues`
- `/team/allocation`
- `/docs`
- `/programs`

### Task 4: Verify consistency

**Files:**
- Test: `ShipShape/docs/submission/presearch-codex.md`
- Test: `ShipShape/docs/submission/final-narrative.md`
- Test: `ShipShape/docs/submission/verification-record.md`
- Test: `ShipShape/docs/submission/submission-checklist.md`
- Test: `ShipShape/docs/submission/submission-pack.md`

**Step 1: Re-scan for stale claims**

Run: `rg -n "all 7 rubric categories are now met|target met|keyboard|pnpm test|Playwright" ShipShape/docs/submission`

**Step 2: Commit**

```bash
git add ShipShape/docs/submission/presearch-codex.md ShipShape/docs/submission/final-narrative.md ShipShape/docs/submission/verification-record.md ShipShape/docs/submission/submission-checklist.md ShipShape/docs/submission/submission-pack.md ShipShape/docs/plans/2026-03-10-rubric-gap-cleanup.md
git commit -m "docs: align submission package with rubric evidence"
```
