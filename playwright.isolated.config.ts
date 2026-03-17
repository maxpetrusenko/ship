/**
 * Playwright config for isolated E2E tests (spike only)
 *
 * Uses testcontainers for per-worker isolation.
 * Run with: npx playwright test --config=playwright.isolated.config.ts
 *
 * NOTE: This is a separate config for testing the isolated fixture.
 * The main playwright.config.ts is the production config.
 */

import { defineConfig, devices } from "@playwright/test";
import os from "os";

// Calculate safe worker count (same logic as main config)
function getWorkerCount(): number {
  if (process.env.PLAYWRIGHT_WORKERS) {
    return parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
  }
  if (process.env.CI) return 4;

  const freeMemGB = os.freemem() / (1024 * 1024 * 1024);
  const memoryBasedLimit = Math.floor((freeMemGB - 2) / 0.5);
  const cpuCores = os.cpus().length;
  const localWorkerCap = 4;
  return Math.max(1, Math.min(memoryBasedLimit, cpuCores, localWorkerCap));
}

export default defineConfig({
  testDir: "./e2e",
  // Only run tests that use the isolated fixture
  testMatch: ["**/spike-isolated.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: getWorkerCount(),
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["./e2e/progress-reporter.ts"]]
    : [["list"], ["html", { open: "never" }], ["./e2e/progress-reporter.ts"]],
  use: {
    // baseURL is provided by the isolated-env fixture
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  timeout: 120000, // Longer timeout for container startup and worker-scoped isolated fixtures
  // Global setup builds API and Web once
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // NO webServer - the fixture handles server startup per worker
});
