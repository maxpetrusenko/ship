/**
 * FleetGraph startup consolidation.
 *
 * Wraps runtime/index.ts startFleetGraph with:
 * - Env var validation (fail-fast on missing OPENAI_API_KEY)
 * - Ready status flag for route gating
 * - Graceful shutdown hooks
 *
 * The server MUST continue to boot even if this throws.
 */
import type pg from 'pg';
import { startFleetGraph, stopFleetGraph } from './runtime/index.js';
import type { BroadcastFn } from './runtime/scheduler.js';
import { canUseLangSmithTracing, getLangSmithApiKey, isLangSmithTracingRequested } from './runtime/langsmith.js';

// -------------------------------------------------------------------------
// Status flag
// -------------------------------------------------------------------------

let _ready = false;

/** True once FleetGraph has fully initialized. Routes can gate on this. */
export function isFleetGraphReady(): boolean {
  return _ready;
}

// -------------------------------------------------------------------------
// Env validation
// -------------------------------------------------------------------------

interface EnvCheckResult {
  ok: boolean;
  warnings: string[];
}

function validateEnv(): EnvCheckResult {
  const warnings: string[] = [];

  if (!process.env.OPENAI_API_KEY) {
    console.error('[FleetGraph] OPENAI_API_KEY is missing; cannot start');
    return { ok: false, warnings };
  }

  if (!getLangSmithApiKey(process.env)) {
    warnings.push('LANGSMITH_API_KEY or LANGCHAIN_API_KEY missing; LangSmith tracing disabled');
  }

  if (!process.env.FLEETGRAPH_API_TOKEN) {
    warnings.push('FLEETGRAPH_API_TOKEN missing; Ship API calls will fail');
  }

  if (canUseLangSmithTracing(process.env)) {
    console.log('[FleetGraph] LangSmith tracing enabled');
  } else if (isLangSmithTracingRequested(process.env)) {
    warnings.push('LangSmith tracing requested but no API key was found');
  }

  return { ok: true, warnings };
}

// -------------------------------------------------------------------------
// Bootstrap
// -------------------------------------------------------------------------

/**
 * Initialize FleetGraph in one shot.
 * Delegates to runtime/index.ts startFleetGraph which handles:
 *   data layer config, broadcast wiring, checkpointer, graph compile, scheduler.
 *
 * Throws on fatal error (caller wraps in try/catch).
 */
export async function bootstrapFleetGraph(
  pool: pg.Pool,
  broadcastFn: BroadcastFn,
): Promise<void> {
  // 1. Validate env before doing any heavy lifting
  const env = validateEnv();
  for (const w of env.warnings) {
    console.warn(`[FleetGraph] ${w}`);
  }
  if (!env.ok) {
    throw new Error('Missing required environment variables');
  }

  // 2. Delegate to runtime (data layer, broadcast, checkpointer, graph, scheduler)
  await startFleetGraph(pool, broadcastFn);

  // 3. Register graceful shutdown
  const shutdown = () => {
    console.log('[FleetGraph] Shutting down...');
    stopFleetGraph();
    _ready = false;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  _ready = true;
  console.log('[FleetGraph] Bootstrap complete');
}
