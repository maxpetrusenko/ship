# Screen Reader Checklist

Date: 2026-03-09

## Why This Exists

`requirements.md` asks for real screen-reader validation. Headless axe and Lighthouse runs do not satisfy that item by themselves.

## Recommended Setup

- macOS: VoiceOver
- Windows: NVDA
- browser: same app build used for the audited Lighthouse / axe reruns

## Pages To Check

- `/login`
- `/issues`
- `/team`
- `/docs`
- `/programs`
- one editor surface with the lazy-loaded editor

## What To Verify On Each Page

- page landmark announced correctly
- page title makes sense
- main navigation announced in usable order
- headings exposed in logical hierarchy
- buttons and links have clear names
- forms announce labels, errors, and required state
- focus order matches keyboard order
- dynamic content changes are announced when they matter
- no keyboard trap

## Evidence Template

For each page, capture:

- page path
- screen reader used
- browser used
- pass/fail summary
- 1 to 3 concrete notes
- any bug found with repro steps

Example note block:

```md
Page: /login
Reader: VoiceOver on macOS
Browser: Chrome
Result: Pass
Notes:
- main landmark announced
- email and password fields have clear labels
- loading state announced as "Login loading"
```

## Where To Paste Results

Update Category 7 in `docs/presearch-codex.md`:

- replace `true screen-reader run: Not yet measured`
- add one short findings block per page
- update the final hard-gate status table

## Minimum Close Condition

The screen-reader blocker is closed only when:

- at least one real screen reader was used directly
- findings are written into `docs/presearch-codex.md`
- Category 7 status changes from `Partial` to `Yes` only if the run is actually complete
