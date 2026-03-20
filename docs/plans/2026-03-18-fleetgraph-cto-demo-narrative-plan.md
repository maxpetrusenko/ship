# FleetGraph CTO Demo Narrative Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a short, story-driven FleetGraph demo narrative that Max can read aloud while scrolling architecture docs and showing the live app.

**Architecture:** Keep the required submission structure intact, but add a stronger narrative layer on top of it. Use one companion story doc for the spoken walkthrough, update the short demo script to match that tone, and add a concise north-star narrative near the top of `FLEETGRAPH.md` so the architecture file itself is presentation-friendly.

**Tech Stack:** Markdown docs in the existing ShipShape repo.

---

### Task 1: Add presentation-friendly north-star language to FleetGraph

**Files:**
- Modify: `FLEETGRAPH.md`

**Step 1: Read the opening of `FLEETGRAPH.md`**

Confirm the current intro, runtime line, and section order so the new prose does not disrupt required submission sections.

**Step 2: Add a short narrative section near the top**

Write a compact CTO-friendly section that frames FleetGraph as a north-star guardrail for execution, not a generic chatbot.

**Step 3: Verify required sections remain intact**

Check that `Agent Responsibility`, `Graph Diagram`, `Use Cases`, `Trigger Model`, `Test Cases`, `Architecture Decisions`, and `Cost Analysis` still exist and remain easy to find.

### Task 2: Rewrite the short demo script as spoken prose

**Files:**
- Modify: `docs/Audit/submission/demo-script-short.md`

**Step 1: Replace checklist-style copy with a spoken story**

Write a 2 to 3 minute script in paragraph form with no bullet-heavy delivery.

**Step 2: Align the script to the live demo flow**

Make the script usable while Max scrolls architecture and then shows the live in-app alert and embedded chat.

### Task 3: Add a polished CTO fallback reading surface

**Files:**
- Create: `docs/FleetGraph/CTO_DEMO_STORY.md`

**Step 1: Write a concise narrative brief**

Create a one-page story doc that explains the problem, north star, architecture, guardrails, and value in a way a CTO can skim or Max can read aloud.

**Step 2: Keep the language consistent with the script**

Use the same core framing so the story doc, the short script, and `FLEETGRAPH.md` reinforce each other.

### Task 4: Verify the final artifacts

**Files:**
- Verify: `FLEETGRAPH.md`
- Verify: `docs/Audit/submission/demo-script-short.md`
- Verify: `docs/FleetGraph/CTO_DEMO_STORY.md`

**Step 1: Read all three docs**

Check for tone consistency, speaking flow, and submission compatibility.

**Step 2: Confirm no unrelated files changed**

Run `git status --short` and make sure only the intended doc files are part of this pass.
