#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_A11Y=false
FULL_GATE=false
BASE_URL="${DEMO_PROOF_BASE_URL:-http://localhost:5174}"
BASE_ANY=273
BASE_AS=691
BASE_NONNULL=329
BASE_TS_DIRECTIVES=1
BASE_MAIN_CHUNK_KB=2073.74

for arg in "$@"; do
  case "$arg" in
    --with-a11y)
      WITH_A11Y=true
      ;;
    --full-gate)
      FULL_GATE=true
      ;;
  esac
done

run_step() {
  local title="$1"
  shift

  printf '\n== %s ==\n' "$title"
  printf 'Command:'
  printf ' %q' "$@"
  printf '\n\n'

  (
    cd "$ROOT_DIR"
    "$@"
  )
}

run_step_with_retry() {
  local title="$1"
  local attempts="$2"
  shift 2

  local try=1
  while (( try <= attempts )); do
    if run_step "$title (attempt $try/$attempts)" "$@"; then
      return 0
    fi

    if (( try == attempts )); then
      return 1
    fi

    printf 'Retrying %s after attempt %d failed.\n' "$title" "$try"
    try=$((try + 1))
  done
}

type_safety_json="$(
  cd "$ROOT_DIR"
  node scripts/type-safety-count.js --json
)"
current_any="$(node -e "const counts = JSON.parse(process.argv[1]); console.log(counts.any)" "$type_safety_json")"
current_as="$(node -e "const counts = JSON.parse(process.argv[1]); console.log(counts.as)" "$type_safety_json")"
current_nonnull="$(node -e "const counts = JSON.parse(process.argv[1]); console.log(counts.nonnull)" "$type_safety_json")"
current_ts_directives="$(node -e "const counts = JSON.parse(process.argv[1]); console.log(counts.tsDirectives)" "$type_safety_json")"

run_step "Type-check" corepack pnpm type-check
run_step \
  "Runtime regression proof" \
  corepack pnpm --filter @ship/web exec vitest run \
  src/components/RuntimeLoadErrorStates.test.tsx \
  src/hooks/useSessionTimeout.test.ts
run_step "Web test suite" corepack pnpm --filter @ship/web test

if [[ "$FULL_GATE" == true ]]; then
  run_step "API full test suite" corepack pnpm test
else
  run_step_with_retry \
    "API focused proof" \
    2 \
    corepack pnpm --filter @ship/api exec vitest run \
    src/routes/search.test.ts \
    src/routes/weeks.test.ts \
    src/routes/standups.test.ts \
    src/routes/documents-visibility.test.ts \
    src/collaboration/__tests__/api-content-preservation.test.ts
fi

run_step "Web production build" corepack pnpm build:web

largest_main_chunk_bytes=0
largest_main_chunk_file=""

for file in "$ROOT_DIR"/web/dist/assets/index-*.js; do
  if [[ -e "$file" ]]; then
    file_bytes="$(stat -f '%z' "$file")"
    if (( file_bytes > largest_main_chunk_bytes )); then
      largest_main_chunk_bytes="$file_bytes"
      largest_main_chunk_file="$(basename "$file")"
    fi
  fi
done

current_main_chunk_kb="$(awk -v bytes="$largest_main_chunk_bytes" 'BEGIN { printf "%.2f", bytes / 1000 }')"

if [[ "$WITH_A11Y" == true ]]; then
  printf '\n== Accessibility rerun ==\n'
  printf 'Command: DEMO_PROOF_BASE_URL=%s node --input-type=module <inline axe script>\n\n' "$BASE_URL"

  (
    cd "$ROOT_DIR"
    DEMO_PROOF_BASE_URL="$BASE_URL" node --input-type=module <<'EOF'
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseUrl = process.env.DEMO_PROOF_BASE_URL ?? 'http://localhost:5174';
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
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  }));
  console.log(target, summary);
}

await context.close();
await browser.close();
EOF
  )
fi

printf '\nDemo proof complete.\n'
printf 'Type safety AST counts: any %s -> %s, as %s -> %s, ! %s -> %s, @ts-* %s -> %s\n' \
  "$BASE_ANY" "$current_any" \
  "$BASE_AS" "$current_as" \
  "$BASE_NONNULL" "$current_nonnull" \
  "$BASE_TS_DIRECTIVES" "$current_ts_directives"
printf 'Main entry chunk: %.2f kB -> %s kB' "$BASE_MAIN_CHUNK_KB" "$current_main_chunk_kb"
if [[ -n "$largest_main_chunk_file" ]]; then
  printf ' (%s)' "$largest_main_chunk_file"
fi
printf '\n'
if [[ "$FULL_GATE" == true ]]; then
  printf 'Expected visible results: type-check pass, runtime regressions green, web 164/164, API 454/454, build pass.\n'
else
  printf 'Expected visible results: type-check pass, runtime regressions green, web 164/164, focused API proof green, build pass.\n'
  printf 'For the recorded full API gate, run: corepack pnpm demo:proof:full\n'
fi
printf 'Test surface note: repo-root pnpm test covers the API Vitest suite only; web Vitest and Playwright E2E are separate verification layers.\n'
printf 'Recorded full Playwright rerun: 862 passed, 1 failed, 6 flaky (see docs/submission/e2e-verification-2026-03-09.md).\n'
