# Verification Record

Date: 2026-03-09

## Quick Rerun

For a fast local proof pass before a demo:

```bash
cd ShipShape
corepack pnpm demo:proof
```

This command is demo-focused: it reruns the fast, stable checks tied to the live walkthrough, not the entire API suite.

It also prints a short summary for the demo:
- current type-safety counts versus the audit baseline
- current main entry chunk versus the audit baseline
- current green verification commands for runtime, web, API-focused proof, and build

If you want the recorded full gate as well:

```bash
cd ShipShape
corepack pnpm demo:proof:full
```

Optional accessibility rerun if the local app is already running:

```bash
cd ShipShape
DEMO_PROOF_BASE_URL=http://localhost:5174 corepack pnpm demo:proof:a11y
```

## Commands Run

1. `corepack pnpm --filter @ship/web exec vitest run src/lib/presenceColors.test.ts src/components/ui/ErrorBoundary.test.tsx src/pages/Login.test.tsx`
Result:
- `3` files passed
- `6` tests passed

2. `corepack pnpm --filter @ship/web test`
Result:
- `20` files passed
- `164` tests passed
- known stderr noise still present in unrelated expected-failure paths:
  - `useSessionTimeout.test.ts` React `act(...)` warnings
  - `SelectionPersistenceContext.test.tsx` expected provider-guard throw logs
  - `ErrorBoundary.test.tsx` expected render-crash logs from the crash harness

3. `corepack pnpm build:web`
Result:
- pass
- current build still emits chunk-size and mixed static/dynamic-import warnings already tracked in the performance lane

4. `corepack pnpm type-check`
Result:
- pass

5. `corepack pnpm test`
Result:
- `28` files passed
- `454` tests passed

6. Live headless axe rerun against the running local app at `http://localhost:5174`
Command:
```bash
node --input-type=module <<'EOF'
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseUrl = 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

async function login() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const setupButton = page.getByRole('button', { name: /create admin account/i });
  const signInButton = page.getByRole('button', { name: 'Sign in', exact: true });

  if (await setupButton.isVisible().catch(() => false)) {
    await page.locator('#name').fill('Dev User');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.locator('#confirmPassword').fill('admin123');
    await setupButton.click();
    await page.waitForLoadState('networkidle');
    return;
  }

  if (await signInButton.isVisible().catch(() => false)) {
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await signInButton.click();
    await page.waitForLoadState('networkidle');
  }
}

await login();

for (const target of ['/login', '/issues', '/team', '/docs', '/programs']) {
  await page.goto(`${baseUrl}${target}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).analyze();
  console.log(target, results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  })));
}

await context.close();
await browser.close();
EOF
```
Result:
- `/login` -> `0` critical, `0` serious
- `/issues` -> `0` critical, `0` serious
- `/team` -> `0` critical, `0` serious
- `/docs` -> `0` critical, `0` serious
- `/programs` -> `0` critical, `0` serious

7. Manual screen-reader pass
Result:
- tool: `VoiceOver`
- browser: `Brave`
- date: `2026-03-09`
- path notes:
  - `/login` authenticated into `/docs`
  - team path reached at `http://localhost:5173/team/allocation`
- pages checked:
  - `/login` to `/docs`
  - `/issues`
  - `/team/allocation`
  - `/docs`
  - `/programs`
- findings matrix:
  - `/login` -> credentials flow remained understandable; no obvious label or announcement issue observed
  - `/docs` -> post-login landing remained understandable during VoiceOver navigation
  - `/issues` -> headings and controls remained understandable in the covered scan
  - `/team/allocation` -> structure remained understandable enough to move through the allocation view
  - `/programs` -> no obvious naming or focus-order issue observed in the covered scan
- outcome:
  - no issues observed in the manual pass

## Touched Files Verified

- `ShipShape/web/src/lib/presenceColors.ts`
- `ShipShape/web/src/lib/presenceColors.test.ts`
- `ShipShape/web/src/components/Editor.tsx`
- `ShipShape/web/src/components/ui/ErrorBoundary.tsx`
- `ShipShape/web/src/components/ui/ErrorBoundary.test.tsx`
- `ShipShape/web/src/pages/Login.tsx`
- `ShipShape/web/src/pages/Login.test.tsx`
