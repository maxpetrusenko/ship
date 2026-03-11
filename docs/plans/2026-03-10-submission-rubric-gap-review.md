# Submission Rubric Gap Review

Date: 2026-03-10

## Scope

This review compares the literal submission requirements in `docs/submission/requirements.md` against the current audit, narrative, checklist, and verification artifacts:

- `docs/submission/presearch-codex.md`
- `docs/submission/final-narrative.md`
- `docs/submission/verification-record.md`
- `docs/submission/submission-checklist.md`
- `docs/submission/submission-pack.md`

It also reviews the current E2E runtime strategy because Category 5 depends on defensible test evidence.

## Overall Assessment

The package is close, but it is not yet literally aligned with the rubric in one important area.

The biggest issue is Category 5. The current docs describe a Playwright-heavy testing story, but the recorded commands and metrics are mostly API plus web unit/integration suites. That is good engineering evidence, but it is not the same as documenting a full Playwright-backed category baseline and reliability story.

Most other categories are defensible, but a few audit deliverables are satisfied only narratively rather than in the exact structure the rubric asks for.

## Findings

### P1: Category 5 evidence does not literally match the rubric

Requirement:
- `docs/submission/requirements.md` says Category 5 is about understanding the Playwright suite, its gaps, and its reliability.
- It also says to run the full test suite, record pass/fail/runtime, identify flaky tests over 3 runs, map critical flows against coverage, and report package coverage if measured.

Current state:
- `docs/submission/presearch-codex.md` explicitly states that repo-root `pnpm test` runs only the API suite.
- The baseline numbers in that same section are therefore API-centric, not full-suite or Playwright-centric.
- `docs/submission/verification-record.md` records green results for:
  - `corepack pnpm --filter @ship/web test`
  - `corepack pnpm test`
  - `corepack pnpm build:web`
  - accessibility probes
- None of those entries document a full Playwright rerun.
- `docs/submission/final-narrative.md` still says all 7 rubric categories are met.

Why this matters:
- The current package can be challenged on a literal reading of the rubric.
- The issue is not that the testing work is weak. The issue is that the recorded evidence and the category framing are misaligned.

Recommended fix:
- Either rerun and document a defensible Playwright baseline and reliability slice for Category 5, or explicitly rewrite the Category 5 narrative to say what was measured, what was blocked, and why.
- Do not keep the current wording that implies the literal Category 5 requirement is fully closed if the evidence remains API/web-test centric.

### P2: Accessibility evidence is strong, but keyboard coverage is narrower than the rubric wording

Requirement:
- Category 7 asks for keyboard navigation testing across the application's major pages, not just one flow.

Current state:
- `docs/submission/presearch-codex.md` records only a login tab-order pass in the baseline section.
- The rest of the accessibility package is solid: Lighthouse scores, axe severity totals, contrast counts, and a documented VoiceOver pass.
- The after-state proof in `docs/submission/verification-record.md` focuses on axe and screen-reader evidence, not a broader keyboard matrix.

Why this matters:
- This is probably not a fatal blocker by itself, but it leaves one rubric bullet weakly evidenced.

Recommended fix:
- Add a short keyboard matrix for the same major pages already used in the accessibility rerun.
- Document whether navigation was full, partial, or broken for each page.

### P2: Category 6 satisfies the spirit of the rubric, but some required audit deliverables are embedded in prose instead of surfaced as explicit baseline outputs

Requirement:
- Category 6 asks for:
  - console errors during normal usage
  - unhandled promise rejections
  - network disconnect recovery
  - missing error boundaries with locations
  - silent failures with reproduction steps

Current state:
- `docs/submission/presearch-codex.md` captures the core evidence.
- Missing error boundaries are described in the error-boundary inventory.
- Silent failures are listed below the baseline table.
- Reproduction detail is present for the implementation fixes, but thinner in the baseline section itself.

Why this matters:
- Reviewers can find the evidence, but they have to read across multiple paragraphs instead of seeing one clean deliverable block.

Recommended fix:
- Reshape the baseline section into a more literal audit table:
  - missing error boundaries: list exact locations
  - silent failures: list each issue plus reproduction steps

### P3: Bundle and benchmark artifacts depend on `/tmp` more than the submission package should

Requirement:
- Several categories ask for reproducible before/after proof.

Current state:
- Category 2 and some baseline measurements point at `/tmp` artifacts.
- The summary docs keep the headline numbers, but some raw artifacts are not packaged inside the submission tree.

Why this matters:
- This is mostly a durability issue, not a correctness issue.

Recommended fix:
- Move the most important generated artifacts or excerpts into `docs/submission/` or summarize them inline with enough detail that `/tmp` is not required to trust the claim.

## E2E Runtime Strategy Review

### Finding

The current Playwright harness is isolation-heavy by design:

- each worker gets its own PostgreSQL container
- each worker gets its own API server
- each worker gets its own Vite preview server
- each worker gets its own browser context

That is visible in:
- `playwright.config.ts`
- `e2e/global-setup.ts`
- `e2e/fixtures/isolated-env.ts`

This is a sound correctness strategy, but it makes worker count a real infrastructure constraint, not a free speed knob.

### Why 24 workers timed out

The repo comments budget roughly `~500MB` per worker. At 24 workers, the local footprint is large enough to cause:

- Docker contention
- CPU contention
- memory pressure and swap
- slower process start
- slower browser actions
- inflated timeout rates

This matches the reported behavior:
- many workers -> timeouts
- very low workers -> suite becomes slow

That does not indicate a product regression by itself. It indicates an overloaded local E2E runtime strategy.

### Recommendation

For local use:
- keep worker count conservative
- prefer focused specs over whole-suite reruns
- use Playwright only for flows that truly need browser-level proof

For full-suite confidence:
- shard in CI or across machines instead of pushing one local machine to very high worker counts

For documentation:
- Category 5 should explicitly separate:
  - Playwright E2E reliability findings
  - API suite stability findings
  - web test coverage findings

## Category Status Snapshot

### Likely Defensible Now

- Category 1: Type Safety
- Category 2: Bundle Size
- Category 3: API Response Time
- Category 4: Database Query Efficiency
- Category 6: Runtime Error Handling
- Category 7: Accessibility

### Needs Literal Rubric Cleanup

- Category 5: Test Coverage and Quality

### Needs Small Documentation Hardening

- Category 6: make baseline outputs more explicit
- Category 7: add broader keyboard evidence
- Category 2: reduce reliance on `/tmp` artifact references

## Recommended Cleanup Order

1. Fix Category 5 wording and evidence first. This is the only finding that can reasonably undercut the claim that all 7 categories are fully met.
2. Add a concise keyboard-navigation matrix for Category 7.
3. Reshape Category 6 baseline outputs so missing boundaries and silent failures are easier to audit.
4. Promote the most important temporary artifacts into the submission tree or summarize them inline.

## Bottom Line

The package looks strong as an engineering submission, but the docs currently overstate literal rubric closure for Category 5.

If only one thing gets corrected, correct that.
