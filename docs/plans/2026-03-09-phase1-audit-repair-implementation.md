# Phase 1 Audit Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `presearch-codex.md` into a submission-grade Phase 1 audit document backed by fresh measurements and exact blockers.

**Architecture:** Work in two passes. First complete the appendix and static baselines from file and repo inspection. Then run the highest-value live measurements for categories 3 to 7 and fold the results into the report with exact commands, outputs, and caveats.

**Tech Stack:** Markdown, ripgrep, pnpm, Node.js, Playwright, local shell tooling, ShipShape monorepo

---

### Task 1: Complete the audit checklist map

**Files:**
- Modify: `presearch-codex.md`
- Test: `requirements.md`

**Step 1: Diff requirements against the current report**

Check every required appendix and category deliverable against the current report.

**Step 2: Record missing items before editing**

Capture which sections need new evidence:
- orientation checklist prompts
- per-package type-safety breakdown
- bundle visualization/dependency/unused-dependency gaps
- categories 3 to 7 live measurement gaps

### Task 2: Establish the runnable audit environment

**Files:**
- Test: `package.json`
- Test: `docker-compose.yml`
- Test: `docs/developer-workflow-guide.md`
- Test: `docs/shadow-env-testing.md`

**Step 1: Run environment discovery**

Run the repo setup, database, and test commands needed to learn whether local measurement is possible.

**Step 2: Capture exact blockers if setup fails**

Record command, exit status, and error text for any missing env, service, or dependency.

### Task 3: Re-measure static baselines and orientation evidence

**Files:**
- Modify: `presearch-codex.md`
- Test: `api/`
- Test: `web/`
- Test: `shared/`
- Test: `docs/`

**Step 1: Recompute current inventory and structure**

Refresh counts and code references:
- routes
- e2e files
- docs files
- shared package usage
- middleware chain
- TS pattern examples
- test DB setup/teardown
- CI/CD flow
- 10x-users failure mode

**Step 2: Add evidence-backed appendix content**

Patch the report with exact file references and current counts.

### Task 4: Run live category measurements

**Files:**
- Modify: `presearch-codex.md`
- Test: `api/`
- Test: `web/`
- Test: `e2e/`

**Step 1: Run category measurements in priority order**

Priority:
1. Category 5 test runtime/pass-fail data
2. Category 7 accessibility scans
3. Category 6 runtime/error probes
4. Category 3 API timings
5. Category 4 DB query logging and `EXPLAIN ANALYZE`

**Step 2: Replace placeholders with actual evidence**

For each category, either insert the measured baseline or the exact reproducible blocker.

### Task 5: Final report verification

**Files:**
- Modify: `presearch-codex.md`
- Test: `presearch-codex.md`

**Step 1: Re-run all cited commands**

Re-run the commands quoted in the final document to confirm numbers and outputs.

**Step 2: Re-check against `requirements.md`**

Verify every appendix prompt and category deliverable is either measured or explicitly blocked with proof.
