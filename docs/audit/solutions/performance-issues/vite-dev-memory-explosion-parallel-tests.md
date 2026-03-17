---
title: "Vite Dev Server Memory Explosion in Parallel E2E Tests"
date: 2025-01-03
category: performance-issues
tags: [playwright, vite, testcontainers, memory, parallel-testing]
symptom: "90GB memory usage, system freeze, 'Your system has run out of application memory'"
root_cause: "Running multiple Vite dev servers (vite dev) instead of preview servers (vite preview)"
source: debugging-session
---

# Vite Dev Server Memory Explosion in Parallel E2E Tests

## Problem

When running Playwright tests with per-worker isolation (each worker gets its own PostgreSQL container + API server + Vite server), the system ran out of memory and crashed with 90GB swap usage.

**Error observed:**
- macOS "Force Quit Applications" dialog
- "Your system has run out of application memory"
- Terminal using 90.47 GB
- 16 orphaned PostgreSQL containers left behind

## Root Cause

The test fixture was spawning `vite dev` for each Playwright worker:

```typescript
// BAD - caused 90GB memory explosion
const proc = spawn('pnpm', ['dev:web'], {
  shell: true,
  // ...
});
```

**Why `vite dev` is a memory hog (per instance):**

| Resource | Memory |
|----------|--------|
| HMR WebSocket server | ~50MB |
| File watchers (chokidar) | ~100MB |
| Dependency pre-bundling (esbuild) | ~100MB |
| React refresh plugin | ~50MB |
| Module graph in memory | ~100MB |
| **Total per instance** | **~400MB** |

With 8 workers × 400MB = 3.2GB baseline. But the real killer was the **runaway effect**:

1. Memory pressure builds → macOS starts swapping
2. Processes slow down → tests timeout
3. Playwright may retry → more processes spawn
4. Docker containers respond slowly → more memory buffered
5. Vite file watchers thrash on same files across 8 instances
6. Swap fills up → 90GB → system freeze

## Solution

Use `vite preview` (lightweight static file server) instead of `vite dev` (heavy HMR server).

### 1. Update fixture to use vite preview

```typescript
// GOOD - ~30-50MB per instance instead of ~400MB
const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
  cwd: path.join(PROJECT_ROOT, 'web'),
  env: {
    ...process.env,
    API_PORT: apiPort, // For proxy config
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  // NO shell: true - direct process control
});
```

### 2. Build web app in global setup

```typescript
// e2e/global-setup.ts
export default async function globalSetup() {
  // Build API (existing)
  execSync('pnpm build:api', { cwd: PROJECT_ROOT, stdio: 'inherit' });

  // Build Web (new - required for vite preview)
  execSync('pnpm build:web', { cwd: PROJECT_ROOT, stdio: 'inherit' });
}
```

### 3. Configure vite preview proxy

```typescript
// web/vite.config.ts
export default defineConfig({
  server: {
    proxy: proxyConfig,
  },
  // Add preview config - same proxy settings
  preview: {
    port: parseInt(env.VITE_PORT || '4173'),
    strictPort: true,
    proxy: proxyConfig,  // Same as server.proxy
  },
});
```

### 4. Add memory-aware worker limits

```typescript
// playwright.config.ts
function getWorkerCount(): number {
  if (process.env.PLAYWRIGHT_WORKERS) {
    return parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
  }
  if (process.env.CI) return 4;

  const freeMemGB = os.freemem() / (1024 * 1024 * 1024);
  const memPerWorker = 0.5; // 500MB per worker
  const reserveGB = 2; // Keep 2GB free for OS
  const memoryBasedLimit = Math.floor((freeMemGB - reserveGB) / memPerWorker);
  const cpuCores = os.cpus().length;
  // Use smaller of memory limit or CPU cores (no arbitrary cap)
  return Math.max(1, Math.min(memoryBasedLimit, cpuCores));
}

export default defineConfig({
  workers: getWorkerCount(),
  // 'line' reporter shows real-time progress: [1/N] ✓ test.spec.ts:15 (2.3s)
  reporter: [['line'], ['html', { open: 'never' }]],
});
```

## Memory Comparison

| Server Type | Memory/Instance | 4 Workers | 8 Workers |
|-------------|-----------------|-----------|-----------|
| `vite dev` | ~400MB | 1.6GB | 3.2GB+ (runaway) |
| `vite preview` | ~40MB | 160MB | 320MB |

## Prevention

1. **Never use `vite dev` in parallel test fixtures** - always use `vite preview`
2. **Build once, serve many** - global setup builds, workers serve static files
3. **Cap worker count** - use memory-aware limits, not hardcoded values
4. **Add memory warnings** - log available memory at startup
5. **Clean up on crash** - check for orphaned containers: `docker ps -a --filter "ancestor=postgres:15"`

## Related

- Playwright testcontainers isolation pattern
- Vite preview vs dev server differences
- Docker container cleanup after test failures
