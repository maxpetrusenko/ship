# Login Visibility And Chat Rate Limit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the login helper blocks visible in all environments and add burst-only rate limiting to FleetGraph chat AI calls.

**Architecture:** The login page removes environment gates around the demo credentials and USWDS icon fixture so prod renders the same helper content as local. FleetGraph chat adds a per-user in-memory burst limiter immediately before the runtime invocation so only real AI calls count toward the cap.

**Tech Stack:** React, Vite, Express, Vitest

---

### Task 1: Keep Login Helpers Always Visible

**Files:**
- Modify: `web/src/pages/Login.tsx`
- Test: `web/src/pages/Login.test.tsx`

**Implementation notes:**
- Remove the `import.meta.env.DEV` guard around the demo credentials block.
- Remove the `import.meta.env.VITE_APP_ENV !== 'production'` guard around the USWDS icon verification block.
- Keep existing copy and icon markup unchanged.

### Task 2: Add Burst Limiting To FleetGraph Chat

**Files:**
- Create: `api/src/services/user-burst-rate-limit.ts`
- Modify: `api/src/routes/fleetgraph.ts`
- Test: `api/src/routes/fleetgraph.test.ts`

**Implementation notes:**
- Use a lightweight in-memory per-user counter keyed by limiter namespace plus user id.
- Apply the limiter only to `POST /api/fleetgraph/chat`.
- Increment the limiter immediately before `runFleetGraphChat(...)` so invalid requests and non-chat routes are unaffected.
- Return `429` plus `Retry-After` when the user exceeds the burst cap.
- Defaults:
  - `production`: `12` requests per `60_000` ms
  - `development`: `60` requests per `60_000` ms
  - `test`: `1000` requests per `60_000` ms unless overridden
- Optional overrides:
  - `FLEETGRAPH_CHAT_RATE_LIMIT_MAX`
  - `FLEETGRAPH_CHAT_RATE_LIMIT_WINDOW_MS`

### Task 3: Verification

**Commands:**
- `pnpm --dir web test src/pages/Login.test.tsx`
- `pnpm --dir api test src/routes/fleetgraph.test.ts`

**Expected result:**
- Login page tests pass.
- FleetGraph route tests pass, including the new `429` burst-limit case.
