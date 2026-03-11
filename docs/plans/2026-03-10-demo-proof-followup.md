# Demo Proof Followup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the demo narrative and proof path fast, honest, and repeatable from one command.

**Architecture:** Keep the spoken demo flow in docs, keep the proof command in repo scripts, and separate stable demo proof from the heavier full gate. Use docs as the presentation surface; use source files only as backup.

**Tech Stack:** Markdown docs, Bash script, pnpm workspace scripts, Vitest, Vite, Playwright axe

---

### Task 1: Verify the revised demo proof path

**Files:**
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/scripts/run-demo-proof.sh`
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/package.json`
- Test: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/scripts/run-demo-proof.sh`

**Step 1: Run the default demo proof command**

Run: `cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape && corepack pnpm demo:proof`

Expected:
- `type-check` passes
- runtime proof shows green targeted regressions
- web suite shows `164/164`
- focused API proof passes
- `build:web` passes

**Step 2: If the default path fails, inspect the failing command only**

Run the exact failing subcommand from the script.

Expected:
- either the command is flaky and should move behind `--full-gate`
- or the script needs a small path/command fix

**Step 3: Re-run the default proof path**

Run: `cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape && corepack pnpm demo:proof`

Expected: clean exit `0`

### Task 2: Verify the full gate path separately

**Files:**
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/scripts/run-demo-proof.sh`
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/package.json`
- Test: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/api/src/routes/workspaces.test.ts`

**Step 1: Run the full gate command once**

Run: `cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape && corepack pnpm demo:proof:full`

Expected:
- either full pass
- or exact failing suite identified

**Step 2: If the full gate flakes again, document it as non-demo path**

Keep `demo:proof` as the live walkthrough command and leave `demo:proof:full` as optional recorded verification.

Expected:
- honest separation between stable demo proof and exhaustive gate

### Task 3: Align docs to the proof commands

**Files:**
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/demo-script.md`
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/verification-record.md`
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/demo-script.md`
- Modify: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape/docs/submission/verification-record.md`

**Step 1: Confirm docs point to the stable command**

Check:
- `demo-script.md` recording notes
- `verification-record.md` quick rerun section

Expected:
- live demo docs point to `corepack pnpm demo:proof`
- full gate is labeled separately

**Step 2: Confirm all counts match the latest verified run**

Check:
- web count
- API count
- build/type-check wording

Expected:
- no stale `451/451` in active demo docs

### Task 4: Add a tiny presenter cheat sheet if needed

**Files:**
- Create: `/Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/docs/demo-proof-card.md`

**Step 1: Add one line per category**

Each line should include:
- claim
- before -> after
- proof command or proof doc

**Step 2: Keep it local-first**

Do not depend on scrolling source files during the demo.

Expected:
- one-screen backup card for live presentation

