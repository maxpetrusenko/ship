# Agent Usage Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repo-local command that snapshots Claude and Codex usage into machine-readable and human-readable files.

**Architecture:** A single Node script calls CodexBar per provider, normalizes the results, appends one JSONL snapshot, and rewrites a markdown report from the latest snapshot. Tests use `node:test` and stub command execution so behavior stays deterministic.

**Tech Stack:** Node.js, CommonJS, `node:test`, CodexBar CLI, pnpm

---

### Task 1: Add the failing regression test

**Files:**
- Create: `scripts/track-agent-usage.test.js`
- Test: `scripts/track-agent-usage.test.js`

**Step 1: Write the failing test**

Write a test that expects:
- a snapshot record to be appended to JSONL
- markdown output to contain branch, commit, provider sections, and provider errors

**Step 2: Run test to verify it fails**

Run: `node --test scripts/track-agent-usage.test.js`

Expected: FAIL because `scripts/track-agent-usage.js` does not exist yet.

### Task 2: Implement the snapshot writer

**Files:**
- Create: `scripts/track-agent-usage.js`
- Modify: `package.json`

**Step 1: Write minimal implementation**

Implement:
- provider command runner
- git metadata loader
- snapshot append
- markdown generator
- CLI entrypoint

**Step 2: Run test to verify it passes**

Run: `node --test scripts/track-agent-usage.test.js`

Expected: PASS

### Task 3: Wire repo docs

**Files:**
- Create: `docs/metrics/agent-usage.snapshots.jsonl`
- Create: `docs/agent-usage.md`
- Modify: `docs/ship-claude-cli-integration.md`

**Step 1: Run real snapshot**

Run: `node scripts/track-agent-usage.js`

Expected: repo files created or updated with current data

**Step 2: Add doc link**

Add a short note in the Claude integration doc pointing to the usage snapshot doc.

### Task 4: Verify end to end

**Files:**
- Test: `scripts/track-agent-usage.test.js`
- Test: `docs/agent-usage.md`
- Test: `docs/metrics/agent-usage.snapshots.jsonl`

**Step 1: Run focused checks**

Run:
- `node --test scripts/track-agent-usage.test.js`
- `node scripts/track-agent-usage.js`

Expected:
- test passes
- script exits 0
- snapshot file appended
- markdown regenerated
