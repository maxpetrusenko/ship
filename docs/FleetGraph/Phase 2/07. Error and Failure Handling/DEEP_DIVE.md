# Error and Failure Handling Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready specification for every failure mode FleetGraph can encounter, how each failure is classified, retried, degraded, or escalated, and how the system monitors and self-heals. After reading this document, a developer should be able to implement the complete error handling layer without ambiguity about retry counts, fallback behavior, or monitoring integration.

This document covers four external dependency classes (Ship API, OpenAI API, LangGraph/checkpoint infrastructure, business logic) and specifies behavior for both proactive and on-demand modes.

---

## 1. Error Taxonomy

Every error FleetGraph encounters falls into one of four classes. Each class has its own retry ceiling, backoff strategy, and degradation behavior.

### 1.1 Ship API Errors

Ship is the system of record. When Ship is unreachable or returns errors, FleetGraph loses its data source.

| HTTP Status | Meaning | Retryable | Max Retries | Backoff | Fallback |
|-------------|---------|:---------:|:-----------:|---------|----------|
| 401 | Unauthorized / session expired | No | 0 | N/A | Re-authenticate with `FLEETGRAPH_API_TOKEN`. If token invalid, halt and alert operator. |
| 403 | Forbidden / workspace access revoked | No | 0 | N/A | Log forbidden entity. Skip entity in proactive mode. Return permission error in on-demand. |
| 404 | Entity not found / deleted | No | 0 | N/A | Remove entity from sweep queue. In on-demand, return "entity no longer exists" message. |
| 429 | Rate limited | Yes | 3 | Exponential with jitter, starting at 1s | Respect `Retry-After` header. If exceeded max retries, defer to next sweep cycle. |
| 500 | Internal server error | Yes | 3 | Exponential with jitter, starting at 500ms | Log error. Skip entity this cycle. Mark for priority retry next sweep. |
| 502/503/504 | Gateway / service unavailable | Yes | 3 | Exponential with jitter, starting at 2s | Treat as transient outage. Circuit breaker activates after 5 consecutive failures. |
| ECONNREFUSED | Network unreachable | Yes | 2 | Fixed 5s delay | Trip circuit breaker immediately. All sweeps pause until health check passes. |
| ETIMEDOUT | Request timeout (>10s) | Yes | 2 | Double previous timeout up to 30s | Log slow endpoint. Skip entity if second attempt also times out. |

### 1.2 OpenAI API Errors

OpenAI is the reasoning layer. Failures here affect only the `reason_about_risk` node. Deterministic heuristics still run.

| Error Type | Meaning | Retryable | Max Retries | Backoff | Fallback |
|------------|---------|:---------:|:-----------:|---------|----------|
| 429 Rate Limit | Token or request rate exceeded | Yes | 2 | Respect `Retry-After` or exponential from 2s | Surface heuristic-only results for high-severity candidates. |
| 500 / 503 | OpenAI service error | Yes | 2 | Exponential from 1s | Surface heuristic-only results. Tag trace as `reasoning_skipped`. |
| 400 Context Length | Input exceeds model limit | No | 0 | N/A | Truncate context with `summarizeContext()` at 50% reduction. Retry once with reduced payload. |
| Invalid JSON response | Model returned unparseable output | Yes | 1 | Immediate | Re-prompt with stricter format instruction. If still invalid, fall back to heuristic-only. |
| ETIMEDOUT (>30s) | Model inference too slow | Yes | 1 | Immediate | Surface heuristic-only with `timeout` flag. |
| Authentication error | API key invalid or expired | No | 0 | N/A | Halt all reasoning. Alert operator. Heuristic-only mode for all runs until resolved. |

### 1.3 LangGraph Infrastructure Errors

LangGraph manages graph execution, checkpointing, and interrupt/resume. These failures affect graph state persistence.

| Error Type | Meaning | Retryable | Max Retries | Backoff | Fallback |
|------------|---------|:---------:|:-----------:|---------|----------|
| Checkpoint write failure | Postgres connection lost during state save | Yes | 1 | Immediate | Log and continue as stateless run. State is lost for this thread. |
| Checkpoint read failure | Cannot load prior state for resume | No | 0 | N/A | Abandon interrupted thread. Start fresh run. Notify user if on-demand. |
| State corruption | Deserialized state fails validation | No | 0 | N/A | Discard corrupted checkpoint. Start fresh. Log trace with `state_corrupted` tag. |
| Interrupt failure | Cannot pause graph for human gate | No | 0 | N/A | Skip HITL gate. Log the proposed action without executing. Alert operator. |
| Thread collision | Concurrent writes to same thread ID | Yes | 1 | 500ms jitter | Retry with fresh thread ID. Log collision for monitoring. |

### 1.4 Business Logic Errors

These are not infrastructure failures. They represent invalid state transitions or data inconsistencies within Ship.

| Error Type | Meaning | Retryable | Max Retries | Fallback |
|------------|---------|:---------:|:-----------:|----------|
| Missing entity | Referenced entity (issue, sprint, project) does not exist in fetched context | No | 0 | Skip signal for this entity. Log as `entity_missing`. |
| Invalid state transition | Approved action would create an invalid state (e.g., closing an already-closed issue) | No | 0 | Re-fetch entity. If state changed, discard action. Notify user the entity was updated externally. |
| Stale data conflict | Entity was modified between fetch and action execution | Yes | 1 | Re-fetch, re-evaluate. If action still valid, retry. If not, discard and notify. |
| Orphaned approval | Human gate was created but the thread expired or entity was deleted | No | 0 | Clean up the approval card. Log as `approval_orphaned`. |
| Fingerprint collision | Two different signals produce the same dedupe hash | No | 0 | Accept both. Improve hash function. Log for review. |

### Error Type Hierarchy (TypeScript)

```typescript
/** Base error class for all FleetGraph errors */
class FleetGraphError extends Error {
  readonly errorClass: 'ship_api' | 'openai' | 'langgraph' | 'business_logic';
  readonly retryable: boolean;
  readonly node: string;
  readonly traceId: string;
  readonly timestamp: string;

  constructor(params: {
    message: string;
    errorClass: FleetGraphError['errorClass'];
    retryable: boolean;
    node: string;
    traceId: string;
  }) {
    super(params.message);
    this.name = 'FleetGraphError';
    this.errorClass = params.errorClass;
    this.retryable = params.retryable;
    this.node = params.node;
    this.traceId = params.traceId;
    this.timestamp = new Date().toISOString();
  }
}

/** Ship API specific error with HTTP status */
class ShipApiError extends FleetGraphError {
  readonly httpStatus: number;
  readonly endpoint: string;
  readonly retryAfterMs: number | null;

  constructor(params: {
    message: string;
    httpStatus: number;
    endpoint: string;
    node: string;
    traceId: string;
    retryAfterMs?: number;
  }) {
    super({
      message: params.message,
      errorClass: 'ship_api',
      retryable: [429, 500, 502, 503, 504].includes(params.httpStatus),
      node: params.node,
      traceId: params.traceId,
    });
    this.httpStatus = params.httpStatus;
    this.endpoint = params.endpoint;
    this.retryAfterMs = params.retryAfterMs ?? null;
  }
}

/** OpenAI API specific error */
class OpenAIError extends FleetGraphError {
  readonly openaiErrorType: string;
  readonly modelId: string;
  readonly inputTokens: number | null;

  constructor(params: {
    message: string;
    openaiErrorType: string;
    modelId: string;
    node: string;
    traceId: string;
    retryable: boolean;
    inputTokens?: number;
  }) {
    super({
      message: params.message,
      errorClass: 'openai',
      retryable: params.retryable,
      node: params.node,
      traceId: params.traceId,
    });
    this.openaiErrorType = params.openaiErrorType;
    this.modelId = params.modelId;
    this.inputTokens = params.inputTokens ?? null;
  }
}

/** LangGraph infrastructure error */
class LangGraphInfraError extends FleetGraphError {
  readonly threadId: string | null;
  readonly checkpointId: string | null;

  constructor(params: {
    message: string;
    node: string;
    traceId: string;
    retryable: boolean;
    threadId?: string;
    checkpointId?: string;
  }) {
    super({
      message: params.message,
      errorClass: 'langgraph',
      retryable: params.retryable,
      node: params.node,
      traceId: params.traceId,
    });
    this.threadId = params.threadId ?? null;
    this.checkpointId = params.checkpointId ?? null;
  }
}
```

---

## 2. Retry Strategy

### 2.1 Exponential Backoff with Jitter

All retries use exponential backoff with full jitter to prevent thundering herd on shared resources.

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Multiplier per retry: delay = baseDelay * (factor ^ attempt) */
  factor: number;
}

const RETRY_CONFIGS: Record<FleetGraphError['errorClass'], RetryConfig> = {
  ship_api: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    factor: 2,
  },
  openai: {
    maxRetries: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    factor: 3,
  },
  langgraph: {
    maxRetries: 1,
    baseDelayMs: 500,
    maxDelayMs: 2_000,
    factor: 2,
  },
  business_logic: {
    maxRetries: 0, // business logic errors are not retryable by default
    baseDelayMs: 0,
    maxDelayMs: 0,
    factor: 1,
  },
};

/**
 * Computes delay in milliseconds for a given retry attempt.
 * Uses full jitter: random value between 0 and the exponential ceiling.
 */
function computeBackoffMs(config: RetryConfig, attempt: number): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(config.factor, attempt);
  const clampedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // Full jitter: uniform random in [0, clampedDelay]
  return Math.floor(Math.random() * clampedDelay);
}
```

### 2.2 Retry Wrapper

Every async operation that can fail uses this wrapper. It integrates with LangSmith tracing to record each attempt.

```typescript
interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: FleetGraphError;
  attempts: number;
  totalDelayMs: number;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  errorClass: FleetGraphError['errorClass'],
  context: { node: string; traceId: string; label: string }
): Promise<RetryResult<T>> {
  const config = RETRY_CONFIGS[errorClass];
  let lastError: FleetGraphError | undefined;
  let totalDelay = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const data = await operation();
      return { success: true, data, attempts: attempt + 1, totalDelayMs: totalDelay };
    } catch (err: unknown) {
      const fgError = classifyError(err, context.node, context.traceId);
      lastError = fgError;

      // Trace each failed attempt
      logRetryAttempt({
        label: context.label,
        attempt,
        maxRetries: config.maxRetries,
        errorClass: fgError.errorClass,
        message: fgError.message,
        traceId: context.traceId,
      });

      // Do not retry if error is not retryable
      if (!fgError.retryable) break;

      // Do not retry if we've exhausted attempts
      if (attempt >= config.maxRetries) break;

      // Respect Retry-After header for rate limits
      let delayMs: number;
      if (fgError instanceof ShipApiError && fgError.retryAfterMs) {
        delayMs = fgError.retryAfterMs;
      } else {
        delayMs = computeBackoffMs(config, attempt);
      }

      totalDelay += delayMs;
      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: config.maxRetries + 1,
    totalDelayMs: totalDelay,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 2.3 Error Classification

Converts raw errors from HTTP clients and SDKs into typed `FleetGraphError` instances.

```typescript
function classifyError(
  err: unknown,
  node: string,
  traceId: string
): FleetGraphError {
  // Axios-style HTTP error
  if (isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const endpoint = err.config?.url ?? 'unknown';
    const retryAfterHeader = err.response?.headers?.['retry-after'];
    const retryAfterMs = retryAfterHeader
      ? parseInt(retryAfterHeader, 10) * 1000
      : undefined;

    return new ShipApiError({
      message: `Ship API ${status}: ${err.message}`,
      httpStatus: status,
      endpoint,
      node,
      traceId,
      retryAfterMs,
    });
  }

  // OpenAI SDK error
  if (isOpenAIError(err)) {
    return new OpenAIError({
      message: err.message,
      openaiErrorType: err.type ?? 'unknown',
      modelId: 'gpt-4.1',
      node,
      traceId,
      retryable: ['rate_limit_error', 'server_error', 'timeout'].includes(
        err.type ?? ''
      ),
      inputTokens: err.usage?.input_tokens,
    });
  }

  // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
  if (err instanceof Error && 'code' in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return new ShipApiError({
      message: `Network error: ${code} - ${err.message}`,
      httpStatus: 0,
      endpoint: 'unknown',
      node,
      traceId,
    });
  }

  // Fallback
  return new FleetGraphError({
    message: err instanceof Error ? err.message : String(err),
    errorClass: 'business_logic',
    retryable: false,
    node,
    traceId,
  });
}
```

### 2.4 Circuit Breaker

Prevents FleetGraph from hammering a degraded dependency. The breaker tracks consecutive failures per dependency and opens the circuit when a threshold is reached.

```typescript
interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half_open';
  nextRetryAt: Date | null;
}

const CIRCUIT_BREAKER_CONFIG = {
  ship_api: {
    failureThreshold: 5,    // consecutive failures to open
    resetTimeoutMs: 60_000, // 1 minute before half-open probe
    halfOpenMaxProbes: 1,   // single probe request in half-open
  },
  openai: {
    failureThreshold: 3,
    resetTimeoutMs: 120_000, // 2 minutes (OpenAI outages tend to last longer)
    halfOpenMaxProbes: 1,
  },
};

class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();

  isOpen(dependency: string): boolean {
    const state = this.states.get(dependency);
    if (!state || state.state === 'closed') return false;

    if (state.state === 'open' && state.nextRetryAt && new Date() >= state.nextRetryAt) {
      // Transition to half-open
      state.state = 'half_open';
      return false; // allow one probe
    }

    return state.state === 'open';
  }

  recordSuccess(dependency: string): void {
    this.states.set(dependency, {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      nextRetryAt: null,
    });
  }

  recordFailure(dependency: string): void {
    const config = CIRCUIT_BREAKER_CONFIG[dependency as keyof typeof CIRCUIT_BREAKER_CONFIG];
    if (!config) return;

    const current = this.states.get(dependency) ?? {
      failures: 0,
      lastFailure: null,
      state: 'closed' as const,
      nextRetryAt: null,
    };

    current.failures += 1;
    current.lastFailure = new Date();

    if (current.failures >= config.failureThreshold) {
      current.state = 'open';
      current.nextRetryAt = new Date(Date.now() + config.resetTimeoutMs);
    }

    this.states.set(dependency, current);
  }

  getState(dependency: string): CircuitBreakerState | undefined {
    return this.states.get(dependency);
  }
}

// Singleton instance shared across all graph runs
const circuitBreaker = new CircuitBreaker();
```

Usage in fetch nodes:

```typescript
async function fetchCoreContext(state: typeof FleetGraphState.State) {
  if (circuitBreaker.isOpen('ship_api')) {
    return {
      error: {
        message: 'Ship API circuit breaker is open. Skipping fetch.',
        node: 'fetch_core_context',
        recoverable: true,
      },
    };
  }

  const result = await withRetry(
    () => loadCoreContext(state),
    'ship_api',
    { node: 'fetch_core_context', traceId: state.traceId, label: 'core_context_fetch' }
  );

  if (result.success) {
    circuitBreaker.recordSuccess('ship_api');
    return { coreContext: result.data };
  }

  circuitBreaker.recordFailure('ship_api');
  return {
    error: {
      message: result.error!.message,
      node: 'fetch_core_context',
      recoverable: result.error!.retryable,
    },
  };
}
```

---

## 3. Error Fallback Node

The `error_fallback` node is the terminal handler for any failure that propagates through the graph. It is responsible for logging to LangSmith, responding to the user (on-demand) or silently recording (proactive), and routing unrecoverable failures to the dead letter queue.

### 3.1 What Gets Logged to LangSmith

Every error fallback invocation produces a structured trace payload:

```typescript
interface ErrorTracePayload {
  traceId: string;
  errorClass: FleetGraphError['errorClass'];
  node: string;
  message: string;
  retryable: boolean;
  mode: 'proactive' | 'on_demand';
  entityId: string;
  entityType: string;
  workspaceId: string;
  timestamp: string;
  retryAttempts: number;
  circuitBreakerState: string;
  partialResultsAvailable: boolean;
}
```

This payload is attached as metadata on the LangSmith trace run. The trace is tagged with `branch: error` and `error_class: <class>` for filtering in the LangSmith dashboard.

### 3.2 What Gets Returned to the User (On-Demand Mode)

On-demand users see a degraded response, never a raw error.

```typescript
interface DegradedResponse {
  type: 'fleet_graph_degraded';
  severity: 'warning' | 'error';
  title: string;
  body: string;
  partialResults: Record<string, unknown> | null;
  traceLink: string;
  suggestedAction: string;
}
```

Mapping:

| Error Class | Severity | Title | Body | Suggested Action |
|-------------|----------|-------|------|-----------------|
| Ship API (retryable) | warning | "Some Ship data unavailable" | "Analysis is based on partial data. Results may be incomplete." | "Try again in a moment." |
| Ship API (non-retryable) | error | "Cannot access this entity" | "The entity may have been deleted or you may lack permission." | "Check that the entity still exists." |
| OpenAI (any) | warning | "Analysis limited" | "AI reasoning is temporarily unavailable. Showing heuristic-based signals only." | "Full analysis will resume automatically." |
| LangGraph | error | "Session error" | "Your conversation state could not be loaded." | "Start a new conversation." |
| Business logic | warning | "Data inconsistency detected" | "Some relationships could not be resolved." | "The team is aware of this issue." |

### 3.3 What Gets Skipped Silently (Proactive Mode)

Proactive mode suppresses user-facing notifications on error. It records the failure internally.

| Error Class | Proactive Behavior |
|-------------|-------------------|
| Ship API (transient) | Skip entity this sweep. Mark for priority retry next cycle. |
| Ship API (permanent) | Remove entity from sweep queue. Log removal. |
| OpenAI (transient) | Skip reasoning. If candidates had severity >= high, surface heuristic-only alert with `reasoning_unavailable` tag. |
| OpenAI (permanent) | Halt reasoning for all entities. Alert operator. Continue deterministic sweeps. |
| LangGraph | Log and continue. No persistent state for this run. |
| Business logic | Log anomaly. Do not alert users about internal inconsistencies. |

### 3.4 Partial Results Handling

When some fetch calls succeed and others fail, FleetGraph preserves the successful results and marks the failed ones.

```typescript
interface PartialFetchResult {
  succeeded: Record<string, unknown>;
  failed: Array<{
    endpoint: string;
    error: string;
    httpStatus: number | null;
  }>;
  completeness: number; // 0.0 to 1.0
}

function mergePartialResults(
  results: Array<{ key: string; result: RetryResult<unknown> }>
): PartialFetchResult {
  const succeeded: Record<string, unknown> = {};
  const failed: PartialFetchResult['failed'] = [];

  for (const { key, result } of results) {
    if (result.success) {
      succeeded[key] = result.data;
    } else {
      failed.push({
        endpoint: key,
        error: result.error?.message ?? 'Unknown',
        httpStatus:
          result.error instanceof ShipApiError
            ? result.error.httpStatus
            : null,
      });
    }
  }

  const total = results.length;
  const completeness = total > 0 ? Object.keys(succeeded).length / total : 0;

  return { succeeded, failed, completeness };
}
```

Decision rules for partial results:

| Completeness | On-Demand | Proactive |
|:------------:|-----------|-----------|
| >= 0.75 | Proceed with warning banner. Indicate which data is missing. | Proceed with heuristic filter. Tag trace as `partial_data`. |
| 0.50 to 0.74 | Proceed with prominent warning. Disable mutation suggestions. | Proceed with heuristic filter only. Skip reasoning node. |
| < 0.50 | Return degraded response. Do not attempt analysis. | Skip entity entirely. Record for next cycle. |

### 3.5 Full Implementation

```typescript
async function errorFallback(state: typeof FleetGraphState.State) {
  const err = state.error;
  if (!err) return {};

  // 1. Structured logging
  const tracePayload: ErrorTracePayload = {
    traceId: state.traceId,
    errorClass: classifyErrorClass(err),
    node: err.node,
    message: err.message,
    retryable: err.recoverable,
    mode: state.mode,
    entityId: state.entityId,
    entityType: state.entityType,
    workspaceId: state.workspaceId,
    timestamp: new Date().toISOString(),
    retryAttempts: 0, // populated by retry wrapper metadata
    circuitBreakerState: circuitBreaker.getState('ship_api')?.state ?? 'closed',
    partialResultsAvailable: !!state.coreContext,
  };

  console.error(
    `[FleetGraph] error_fallback node=${err.node} trace=${state.traceId} class=${tracePayload.errorClass}: ${err.message}`
  );

  // 2. Record for monitoring
  await recordErrorMetric(tracePayload);

  // 3. Route unrecoverable to DLQ
  if (!err.recoverable && state.candidates.length > 0) {
    await routeToDLQ({
      traceId: state.traceId,
      entityId: state.entityId,
      entityType: state.entityType,
      workspaceId: state.workspaceId,
      candidates: state.candidates,
      error: err,
      createdAt: new Date().toISOString(),
    });
  }

  // 4. Mode-specific response
  if (state.mode === 'proactive') {
    await recordFailedSweep(state.entityId, state.traceId, err);
    // No user-facing output
    return { branchPath: 'error' as const };
  }

  // On-demand: build degraded response
  const degraded = buildDegradedResponse(err, state);
  return {
    notification: degraded,
    branchPath: 'error' as const,
  };
}

function buildDegradedResponse(
  err: { message: string; node: string; recoverable: boolean },
  state: typeof FleetGraphState.State
): DegradedResponse {
  const errorClass = classifyErrorClass(err);

  const templates: Record<string, Omit<DegradedResponse, 'traceLink' | 'partialResults'>> = {
    ship_api_retryable: {
      type: 'fleet_graph_degraded',
      severity: 'warning',
      title: 'Some Ship data unavailable',
      body: 'Analysis is based on partial data. Results may be incomplete.',
      suggestedAction: 'Try again in a moment.',
    },
    ship_api_permanent: {
      type: 'fleet_graph_degraded',
      severity: 'error',
      title: 'Cannot access this entity',
      body: 'The entity may have been deleted or you may lack permission.',
      suggestedAction: 'Check that the entity still exists.',
    },
    openai: {
      type: 'fleet_graph_degraded',
      severity: 'warning',
      title: 'Analysis limited',
      body: 'AI reasoning is temporarily unavailable. Showing heuristic-based signals only.',
      suggestedAction: 'Full analysis will resume automatically.',
    },
    langgraph: {
      type: 'fleet_graph_degraded',
      severity: 'error',
      title: 'Session error',
      body: 'Your conversation state could not be loaded.',
      suggestedAction: 'Start a new conversation.',
    },
    business_logic: {
      type: 'fleet_graph_degraded',
      severity: 'warning',
      title: 'Data inconsistency detected',
      body: 'Some relationships could not be resolved.',
      suggestedAction: 'The team is aware of this issue.',
    },
  };

  const key = errorClass === 'ship_api'
    ? (err.recoverable ? 'ship_api_retryable' : 'ship_api_permanent')
    : errorClass;

  const template = templates[key] ?? templates.business_logic;

  return {
    ...template,
    partialResults: state.coreContext ?? null,
    traceLink: buildTraceLink(state.traceId),
  };
}
```

---

## 4. Graceful Degradation Matrix

This matrix defines FleetGraph behavior for every failure scenario across both modes.

| Failure Scenario | Proactive Mode | On-Demand Mode |
|-----------------|----------------|----------------|
| **Ship API fully down** | Circuit breaker opens. All sweeps pause. Retry probe every 60s. Resume sweeps on success. | Return "Ship is temporarily unavailable" error. No analysis attempted. |
| **Ship API intermittent (single endpoint)** | Skip the affected fetch. Proceed with partial data if completeness >= 50%. Tag trace. | Show warning banner. Proceed with available data. Disable mutation suggestions. |
| **Ship API 401 (token expired)** | Attempt token refresh. If refresh fails, halt all proactive runs. Alert operator. | Return auth error. Suggest re-login. |
| **Ship API 429 (rate limited)** | Back off per Retry-After. Queue entity for delayed retry. Do not skip permanently. | Retry twice with backoff. If still limited, show "system is busy" message. |
| **OpenAI API timeout** | Skip reasoning. Surface heuristic-only alert if candidates have severity >= high. | Retry once. If timeout persists, return heuristic-only results with "limited analysis" label. |
| **OpenAI API rate limit** | Skip reasoning for this sweep. All candidates deferred to next cycle. | Retry twice. Fall back to heuristic-only. Queue full reasoning for background retry. |
| **OpenAI context length exceeded** | Truncate context to 50%. Retry once. If still too long, skip reasoning. | Truncate and retry. If still failing, return heuristic-only results. |
| **OpenAI returns invalid JSON** | Skip reasoning. Log malformed response for debugging. Surface heuristic-only if high severity. | Retry once with stricter prompt. Fall back to heuristic-only. |
| **OpenAI API key invalid** | Halt all reasoning. Alert operator immediately. Continue deterministic sweeps. | Return "analysis unavailable" error. Log for operator. |
| **Checkpoint write failure** | Log and continue. Run is stateless (no resume possible). Acceptable for sweep runs. | Log error. Current message is lost. Chat history from prior turns is preserved in frontend. |
| **Checkpoint read failure** | N/A (proactive runs do not resume from checkpoint). | Cannot resume interrupted thread. Start fresh run. User must re-approve if action was pending. |
| **State corruption** | Discard corrupted state. Start fresh sweep for this entity. | Return "session error" and prompt user to start new conversation. |
| **Interrupt failure (human gate)** | Log the action FleetGraph wanted to take. Do not execute. Alert operator. | Return "approval system unavailable" error. Show what would have been proposed as read-only. |
| **Entity deleted mid-run** | Remove from sweep queue. No alert. | Return "this entity no longer exists" message. |
| **Concurrent thread collision** | Retry with new thread ID. | Retry with new thread ID. Transparent to user. |

---

## 5. Dead Letter Queue

### 5.1 What Goes Into the DLQ

A candidate enters the DLQ when:

1. It passed the heuristic filter (was a real candidate)
2. The downstream processing failed after max retries
3. The error is classified as non-recoverable, or retries were exhausted

The DLQ preserves enough context to replay the candidate later without re-fetching stale data.

### 5.2 DLQ Table Design

```sql
CREATE TABLE fleetgraph_dead_letter_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id      TEXT NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  entity_id     UUID NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('issue', 'sprint', 'project')),
  candidates    JSONB NOT NULL,    -- serialized CandidateSignal[]
  error_class   TEXT NOT NULL,     -- ship_api | openai | langgraph | business_logic
  error_message TEXT NOT NULL,
  error_node    TEXT NOT NULL,     -- which graph node failed
  retry_count   INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'retrying', 'resolved', 'abandoned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ,      -- when auto-retry should attempt
  resolved_at   TIMESTAMPTZ,      -- when operator marked resolved
  resolved_by   UUID REFERENCES users(id),
  resolution    TEXT               -- operator notes on resolution
);

CREATE INDEX idx_dlq_status ON fleetgraph_dead_letter_queue(status);
CREATE INDEX idx_dlq_workspace ON fleetgraph_dead_letter_queue(workspace_id);
CREATE INDEX idx_dlq_next_retry ON fleetgraph_dead_letter_queue(next_retry_at)
  WHERE status = 'pending';
CREATE INDEX idx_dlq_entity ON fleetgraph_dead_letter_queue(entity_id, entity_type);
```

### 5.3 Operator Review Workflow

Operators interact with the DLQ through a Ship admin endpoint.

```
GET  /api/fleetgraph/admin/dlq
     ?status=pending
     &workspace_id=<uuid>
     &error_class=ship_api
     &limit=50

GET  /api/fleetgraph/admin/dlq/:id
     Returns full DLQ entry with candidates and error context

POST /api/fleetgraph/admin/dlq/:id/retry
     Moves entry to 'retrying'. Kicks off a fresh graph run with
     the original candidates pre-loaded.

POST /api/fleetgraph/admin/dlq/:id/resolve
     Body: { resolution: "Entity was deleted. No action needed." }
     Marks entry as 'resolved'. Records operator and timestamp.

POST /api/fleetgraph/admin/dlq/:id/abandon
     Body: { reason: "Stale data. Not worth retrying." }
     Marks entry as 'abandoned'. Stops auto-retry.
```

### 5.4 Auto-Retry from DLQ

A background job runs every 4 minutes and processes DLQ entries eligible for retry.

```typescript
async function processDLQRetries(): Promise<void> {
  const entries = await pool.query(
    `SELECT * FROM fleetgraph_dead_letter_queue
     WHERE status = 'pending'
       AND next_retry_at <= NOW()
       AND retry_count < max_retries
     ORDER BY created_at ASC
     LIMIT 10`,
  );

  for (const entry of entries.rows) {
    // Check circuit breaker before retrying
    if (circuitBreaker.isOpen(entry.error_class)) {
      continue; // skip, will be picked up next cycle
    }

    await pool.query(
      `UPDATE fleetgraph_dead_letter_queue
       SET status = 'retrying', retry_count = retry_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [entry.id],
    );

    try {
      // Replay the graph run with pre-loaded candidates
      await fleetGraph.invoke({
        mode: 'proactive',
        entityId: entry.entity_id,
        entityType: entry.entity_type,
        workspaceId: entry.workspace_id,
        // DLQ replay flag: skip heuristic filter, use stored candidates
        dlqReplay: true,
        candidates: entry.candidates,
      });

      await pool.query(
        `UPDATE fleetgraph_dead_letter_queue
         SET status = 'resolved', resolved_at = NOW(), resolution = 'auto-retry succeeded', updated_at = NOW()
         WHERE id = $1`,
        [entry.id],
      );
    } catch (retryErr) {
      const nextDelay = computeBackoffMs(
        { baseDelayMs: 60_000, maxDelayMs: 3_600_000, factor: 2, maxRetries: 3 },
        entry.retry_count,
      );
      const nextRetryAt = new Date(Date.now() + nextDelay);

      await pool.query(
        `UPDATE fleetgraph_dead_letter_queue
         SET status = $1, next_retry_at = $2, error_message = $3, updated_at = NOW()
         WHERE id = $4`,
        [
          entry.retry_count + 1 >= entry.max_retries ? 'abandoned' : 'pending',
          nextRetryAt,
          retryErr instanceof Error ? retryErr.message : String(retryErr),
          entry.id,
        ],
      );
    }
  }
}
```

---

## 6. Monitoring and Alerting

### 6.1 Error Rate Per Node Per Hour

Track error counts by node and error class. This enables detection of patterns like "fetch_core_context fails every time the sprint endpoint is called."

```typescript
interface ErrorMetric {
  node: string;
  errorClass: string;
  workspaceId: string;
  hour: string; // ISO date-hour: "2026-03-16T14"
  count: number;
}

// In-memory ring buffer for current hour, flushed to persistent storage each hour
const errorMetrics: Map<string, ErrorMetric> = new Map();

function recordErrorMetric(payload: ErrorTracePayload): void {
  const hour = payload.timestamp.slice(0, 13); // "2026-03-16T14"
  const key = `${payload.node}:${payload.errorClass}:${payload.workspaceId}:${hour}`;

  const existing = errorMetrics.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    errorMetrics.set(key, {
      node: payload.node,
      errorClass: payload.errorClass,
      workspaceId: payload.workspaceId,
      hour,
      count: 1,
    });
  }

  // Check alert thresholds
  checkAlertThresholds(key);
}
```

### 6.2 Consecutive Failure Tracking

Tracks consecutive failures per dependency to detect sustained outages, separate from the circuit breaker.

```typescript
interface ConsecutiveFailureTracker {
  dependency: string;
  consecutiveFailures: number;
  firstFailureAt: Date | null;
  lastFailureAt: Date | null;
  alertSent: boolean;
}

const CONSECUTIVE_FAILURE_THRESHOLDS = {
  ship_api: 10,  // 10 consecutive failures -> operator alert
  openai: 5,     // 5 consecutive failures -> operator alert
};

function checkConsecutiveFailures(
  tracker: ConsecutiveFailureTracker,
): void {
  const threshold = CONSECUTIVE_FAILURE_THRESHOLDS[
    tracker.dependency as keyof typeof CONSECUTIVE_FAILURE_THRESHOLDS
  ];

  if (!threshold) return;

  if (tracker.consecutiveFailures >= threshold && !tracker.alertSent) {
    sendOperatorAlert({
      severity: 'high',
      title: `FleetGraph: ${tracker.dependency} sustained failure`,
      body: `${tracker.consecutiveFailures} consecutive failures since ${tracker.firstFailureAt?.toISOString()}`,
      action: 'Check dependency health. Review DLQ for affected entities.',
    });
    tracker.alertSent = true;
  }
}
```

### 6.3 Health Endpoint Additions

Ship currently exposes `GET /health` which returns `{ status: 'ok' }`. FleetGraph adds a detailed health sub-endpoint.

The existing Ship health check at `/health` is a simple liveness probe (`health.test.ts` verifies it returns `{ status: 'ok' }`). FleetGraph extends this with a dependency-aware readiness check.

```typescript
/**
 * GET /api/fleetgraph/health
 *
 * Returns the health of FleetGraph and its dependencies.
 */
router.get('/health', async (_req: Request, res: Response) => {
  const shipApiState = circuitBreaker.getState('ship_api');
  const openaiState = circuitBreaker.getState('openai');

  const dlqPending = await pool.query(
    `SELECT COUNT(*) as count FROM fleetgraph_dead_letter_queue WHERE status = 'pending'`
  );

  const recentErrors = await pool.query(
    `SELECT COUNT(*) as count FROM fleetgraph_error_log
     WHERE created_at > NOW() - INTERVAL '1 hour'`
  );

  const health = {
    status: determineOverallHealth(shipApiState, openaiState),
    dependencies: {
      ship_api: {
        circuitBreaker: shipApiState?.state ?? 'closed',
        consecutiveFailures: shipApiState?.failures ?? 0,
        lastFailure: shipApiState?.lastFailure?.toISOString() ?? null,
      },
      openai: {
        circuitBreaker: openaiState?.state ?? 'closed',
        consecutiveFailures: openaiState?.failures ?? 0,
        lastFailure: openaiState?.lastFailure?.toISOString() ?? null,
      },
      checkpoint_store: {
        status: 'ok', // TODO: verify Postgres reachability for checkpoints
      },
    },
    queues: {
      dlqPending: parseInt(dlqPending.rows[0].count, 10),
    },
    metrics: {
      errorsLastHour: parseInt(recentErrors.rows[0].count, 10),
    },
    timestamp: new Date().toISOString(),
  };

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

function determineOverallHealth(
  shipApi: CircuitBreakerState | undefined,
  openai: CircuitBreakerState | undefined,
): 'healthy' | 'degraded' | 'unhealthy' {
  if (shipApi?.state === 'open') return 'unhealthy';
  if (openai?.state === 'open') return 'degraded';
  if ((shipApi?.failures ?? 0) > 2 || (openai?.failures ?? 0) > 1) return 'degraded';
  return 'healthy';
}
```

### 6.4 Integration with Existing Ship Health Checks

The main `/health` endpoint should include a FleetGraph summary so that infrastructure monitoring picks up FleetGraph degradation.

```typescript
// In the existing health route handler
router.get('/health', async (_req, res) => {
  const fleetGraphHealthy = circuitBreaker.getState('ship_api')?.state !== 'open';

  res.json({
    status: 'ok',
    fleetgraph: fleetGraphHealthy ? 'ok' : 'degraded',
  });
});
```

### 6.5 Alert Threshold Configuration

```typescript
const ALERT_THRESHOLDS = {
  /** Errors per node per hour that trigger an operator alert */
  errorsPerNodePerHour: 20,
  /** DLQ entries pending for more than 1 hour */
  dlqStalePendingMinutes: 60,
  /** Total errors across all nodes per hour */
  totalErrorsPerHour: 50,
  /** Consecutive sweep failures for a single entity */
  consecutiveEntityFailures: 3,
};
```

---

## 7. Testing Error Paths

### 7.1 Mock Ship API Errors

Use a configurable HTTP client wrapper that allows error injection in test mode.

```typescript
/**
 * Test helper: creates a Ship API client that fails on specified endpoints.
 */
function createFailingShipApi(
  failures: Map<string, { status: number; after?: number }>
): ShipApiClient {
  const callCounts = new Map<string, number>();

  return {
    async get(endpoint: string) {
      const count = (callCounts.get(endpoint) ?? 0) + 1;
      callCounts.set(endpoint, count);

      const failure = failures.get(endpoint);
      if (failure && (!failure.after || count <= failure.after)) {
        const error = new Error(`Mock Ship API error: ${failure.status}`);
        (error as any).response = { status: failure.status, headers: {} };
        (error as any).config = { url: endpoint };
        throw error;
      }

      return realShipApi.get(endpoint);
    },
  };
}

// Test: Ship API 500 on issues endpoint, succeeds on retry
describe('fetch_core_context with Ship API 500', () => {
  it('retries and succeeds on second attempt', async () => {
    const mockApi = createFailingShipApi(
      new Map([['/api/issues/test-id', { status: 500, after: 1 }]])
    );

    const result = await runGraphWithApi(mockApi, {
      entityId: 'test-id',
      entityType: 'issue',
    });

    expect(result.coreContext).toBeDefined();
    expect(result.error).toBeNull();
  });

  it('enters error_fallback after 3 failures', async () => {
    const mockApi = createFailingShipApi(
      new Map([['/api/issues/test-id', { status: 500 }]])
    );

    const result = await runGraphWithApi(mockApi, {
      entityId: 'test-id',
      entityType: 'issue',
    });

    expect(result.branchPath).toBe('error');
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('fetch_core_context');
  });
});

// Test: Ship API 429 respects Retry-After
describe('fetch_core_context with Ship API 429', () => {
  it('waits for Retry-After duration', async () => {
    const mockApi = createFailingShipApi(
      new Map([['/api/issues/test-id', { status: 429, after: 1 }]])
    );

    const startTime = Date.now();
    const result = await runGraphWithApi(mockApi, {
      entityId: 'test-id',
      entityType: 'issue',
    });
    const elapsed = Date.now() - startTime;

    expect(result.coreContext).toBeDefined();
    expect(elapsed).toBeGreaterThan(500); // backoff was applied
  });
});
```

### 7.2 Mock OpenAI Errors

```typescript
/**
 * Test helper: creates an OpenAI client mock that fails on demand.
 */
function createFailingOpenAI(
  errorType: 'rate_limit' | 'context_length' | 'invalid_json' | 'timeout'
): OpenAIMock {
  return {
    async parse(params: any) {
      switch (errorType) {
        case 'rate_limit': {
          const err = new Error('Rate limit exceeded');
          (err as any).type = 'rate_limit_error';
          (err as any).status = 429;
          throw err;
        }
        case 'context_length': {
          const err = new Error('Context length exceeded');
          (err as any).type = 'invalid_request_error';
          (err as any).code = 'context_length_exceeded';
          throw err;
        }
        case 'invalid_json':
          return { output_parsed: null, output_text: 'not valid json {{{' };
        case 'timeout': {
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), 100)
          );
        }
      }
    },
  };
}

describe('reason_about_risk with OpenAI failures', () => {
  it('falls back to heuristic-only on rate limit', async () => {
    const result = await runGraphWithOpenAI(
      createFailingOpenAI('rate_limit'),
      {
        candidates: [mockHighSeverityCandidate],
        mode: 'on_demand',
      }
    );

    expect(result.riskAssessment).toBeNull();
    expect(result.branchPath).toBe('inform_only'); // heuristic fallback
    expect(result.notification?.body).toContain('heuristic');
  });

  it('truncates and retries on context length exceeded', async () => {
    let callCount = 0;
    const mockOpenAI = {
      async parse(params: any) {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Context length exceeded');
          (err as any).type = 'invalid_request_error';
          throw err;
        }
        return { output_parsed: mockRiskAssessment };
      },
    };

    const result = await runGraphWithOpenAI(mockOpenAI, {
      candidates: [mockCandidate],
    });

    expect(callCount).toBe(2);
    expect(result.riskAssessment).toBeDefined();
  });
});
```

### 7.3 Force Checkpoint Failures

```typescript
/**
 * Test helper: creates a checkpointer that fails on write.
 */
function createFailingCheckpointer(failOn: 'write' | 'read'): Checkpointer {
  const realCheckpointer = new PostgresSaver(pool);

  return {
    async put(config: any, checkpoint: any, metadata: any) {
      if (failOn === 'write') {
        throw new Error('Checkpoint write failed: connection lost');
      }
      return realCheckpointer.put(config, checkpoint, metadata);
    },
    async get(config: any) {
      if (failOn === 'read') {
        throw new Error('Checkpoint read failed: data corrupted');
      }
      return realCheckpointer.get(config);
    },
    // ... other methods delegate to real
  };
}

describe('graph with checkpoint failures', () => {
  it('continues as stateless run on write failure', async () => {
    const graph = buildFleetGraph({
      checkpointer: createFailingCheckpointer('write'),
    });

    const result = await graph.invoke(mockProactiveInput);

    // Graph should still complete
    expect(result.branchPath).toBeDefined();
    expect(result.branchPath).not.toBe('error');
  });

  it('starts fresh on read failure for on-demand resume', async () => {
    const graph = buildFleetGraph({
      checkpointer: createFailingCheckpointer('read'),
    });

    const result = await graph.invoke(mockOnDemandResume, {
      configurable: { thread_id: 'corrupted-thread' },
    });

    // Should detect checkpoint failure and start fresh
    expect(result.error).toBeDefined();
    expect(result.notification?.title).toBe('Session error');
  });
});
```

### 7.4 Verify LangSmith Traces Show Error Branches

```typescript
describe('LangSmith trace verification', () => {
  it('tags error branch traces correctly', async () => {
    const mockApi = createFailingShipApi(
      new Map([['/api/issues/test-id', { status: 500 }]])
    );

    const { traceId } = await runGraphWithApi(mockApi, {
      entityId: 'test-id',
      entityType: 'issue',
    });

    // Verify trace metadata
    const trace = await langsmith.readRun(traceId);
    expect(trace.tags).toContain('branch:error');
    expect(trace.tags).toContain('error_class:ship_api');
    expect(trace.extra?.metadata?.errorNode).toBe('fetch_core_context');
  });

  it('records retry attempts in trace metadata', async () => {
    const mockApi = createFailingShipApi(
      new Map([['/api/issues/test-id', { status: 500, after: 2 }]])
    );

    const { traceId } = await runGraphWithApi(mockApi, {
      entityId: 'test-id',
      entityType: 'issue',
    });

    const trace = await langsmith.readRun(traceId);
    // Should show 3 attempts (original + 2 retries) before success
    expect(trace.extra?.metadata?.retryAttempts).toBe(3);
  });
});
```

### 7.5 Integration Test Checklist

| Test | What It Proves | Error Path |
|------|---------------|------------|
| Ship API 500 x3 then success | Retry with backoff works | `fetch_core_context` retry loop |
| Ship API 500 x4 (exceeds max) | Error fallback activates | `fetch_core_context` to `error_fallback` |
| Ship API 404 on entity | Non-retryable classification | Immediate `error_fallback` |
| Ship API 429 with Retry-After | Respects server backoff | Retry with server-specified delay |
| OpenAI rate limit | Heuristic-only fallback | `reason_about_risk` skip to `prepare_notification` |
| OpenAI invalid response | Re-prompt and fallback | `reason_about_risk` retry then heuristic-only |
| Checkpoint write failure | Stateless continuation | Graph completes without persistence |
| Checkpoint read failure | Fresh run initiation | Error response to user |
| Circuit breaker open | Immediate skip | `fetch_core_context` short-circuits |
| Circuit breaker half-open recovery | Single probe succeeds | Circuit closes, normal operation resumes |
| DLQ entry created | Unrecoverable failure captured | `error_fallback` to DLQ write |
| DLQ auto-retry success | Self-healing works | Background job replays graph |
| Partial data (2 of 4 fetches fail) | Degraded analysis | Completeness < 0.75, warning banner |
| Proactive mode error suppression | No user notification | `error_fallback` returns empty |
| On-demand mode degraded response | User sees explanation | `error_fallback` returns `DegradedResponse` |

---

## 8. Recovery Patterns

### 8.1 Sweep Retry on Next Cycle

When a proactive sweep fails for an entity, the sweep scheduler marks the entity for priority processing on the next 4-minute cycle.

```typescript
interface FailedSweepRecord {
  entityId: string;
  entityType: string;
  workspaceId: string;
  traceId: string;
  failedAt: Date;
  consecutiveFailures: number;
  lastErrorClass: string;
  lastErrorMessage: string;
}

// In-memory map, persisted to Postgres for restart safety
const failedSweeps: Map<string, FailedSweepRecord> = new Map();

async function recordFailedSweep(
  entityId: string,
  traceId: string,
  error: { message: string; node: string; recoverable: boolean },
): Promise<void> {
  const existing = failedSweeps.get(entityId);
  const record: FailedSweepRecord = {
    entityId,
    entityType: '', // populated from state
    workspaceId: '', // populated from state
    traceId,
    failedAt: new Date(),
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    lastErrorClass: classifyErrorClass(error),
    lastErrorMessage: error.message,
  };

  failedSweeps.set(entityId, record);

  // If consecutive failures exceed threshold, route to DLQ
  if (record.consecutiveFailures >= ALERT_THRESHOLDS.consecutiveEntityFailures) {
    await routeToDLQ({
      traceId,
      entityId,
      entityType: record.entityType,
      workspaceId: record.workspaceId,
      candidates: [],
      error,
      createdAt: new Date().toISOString(),
    });
    failedSweeps.delete(entityId); // DLQ takes over
  }
}

function getRetryPriorityEntities(): string[] {
  return Array.from(failedSweeps.values())
    .filter((r) => r.consecutiveFailures < ALERT_THRESHOLDS.consecutiveEntityFailures)
    .sort((a, b) => a.failedAt.getTime() - b.failedAt.getTime())
    .map((r) => r.entityId);
}
```

Sweep scheduler integration:

```typescript
async function runProactiveSweep(): Promise<void> {
  // Priority: retry previously failed entities first
  const retryEntities = getRetryPriorityEntities();
  const normalEntities = await getScheduledEntities();

  // Interleave retries at the front of the queue
  const sweepQueue = [...retryEntities, ...normalEntities];

  for (const entityId of sweepQueue) {
    if (circuitBreaker.isOpen('ship_api')) {
      console.warn('[FleetGraph] Ship API circuit breaker open. Pausing sweep.');
      break;
    }

    await fleetGraph.invoke({
      mode: 'proactive',
      entityId,
      // ... other params
    });
  }
}
```

### 8.2 Checkpoint Cleanup for Corrupted State

Corrupted checkpoints can accumulate from failed writes or partial transactions. A cleanup job runs daily.

```typescript
async function cleanupCorruptedCheckpoints(): Promise<void> {
  // 1. Find checkpoints older than 24 hours with no valid state
  const staleCheckpoints = await pool.query(
    `SELECT thread_id, checkpoint_id FROM langgraph_checkpoints
     WHERE created_at < NOW() - INTERVAL '24 hours'
       AND thread_id NOT IN (
         SELECT DISTINCT thread_id FROM langgraph_checkpoints
         WHERE created_at > NOW() - INTERVAL '24 hours'
       )`,
  );

  // 2. Validate each checkpoint can be deserialized
  for (const row of staleCheckpoints.rows) {
    try {
      const checkpoint = await checkpointer.get({
        configurable: { thread_id: row.thread_id },
      });

      // Attempt to validate state shape
      validateFleetGraphState(checkpoint);
    } catch {
      // Corrupted or invalid: delete
      await pool.query(
        `DELETE FROM langgraph_checkpoints WHERE thread_id = $1`,
        [row.thread_id],
      );

      console.warn(
        `[FleetGraph] Deleted corrupted checkpoint for thread ${row.thread_id}`
      );
    }
  }

  // 3. Clean up orphaned writes (checkpoints with no associated DLQ or active thread)
  await pool.query(
    `DELETE FROM langgraph_writes
     WHERE thread_id NOT IN (SELECT thread_id FROM langgraph_checkpoints)
       AND created_at < NOW() - INTERVAL '48 hours'`,
  );
}
```

### 8.3 Alert State Reset After Extended Outage

After a sustained outage (circuit breaker was open for > 10 minutes), the alert state needs recalibration because entity states may have changed significantly during the outage.

```typescript
async function resetAfterOutage(dependency: string): Promise<void> {
  console.warn(`[FleetGraph] Resetting state after ${dependency} outage recovery`);

  // 1. Clear entity digest cache (forces fresh fetches)
  entityDigestCache.clear();

  // 2. Clear failed sweep records (will be re-evaluated fresh)
  failedSweeps.clear();

  // 3. Reset alert fingerprint freshness
  // Alerts generated before the outage may reference stale state.
  // Mark them as "needs revalidation" so next sweep re-checks.
  await pool.query(
    `UPDATE fleetgraph_alert_state
     SET needs_revalidation = true
     WHERE last_surfaced_at < NOW() - INTERVAL '10 minutes'`,
  );

  // 4. Reset consecutive failure trackers
  consecutiveFailureTrackers.delete(dependency);

  // 5. Log recovery event
  console.info(
    `[FleetGraph] Post-outage reset complete for ${dependency}. Next sweep will re-evaluate all entities.`
  );
}

// Called when circuit breaker transitions from open/half-open to closed
circuitBreaker.onRecovery = (dependency: string) => {
  const state = circuitBreaker.getState(dependency);
  if (state && state.lastFailure) {
    const outageMs = Date.now() - state.lastFailure.getTime();
    if (outageMs > 10 * 60 * 1000) {
      resetAfterOutage(dependency);
    }
  }
};
```

### 8.4 Recovery Decision Tree

```
Failure detected
  |
  +-- Is it retryable?
  |     |
  |     +-- Yes: retry with backoff
  |     |     |
  |     |     +-- Retry succeeded? -> record success, continue
  |     |     |
  |     |     +-- Retries exhausted? -> check consecutive failures
  |     |           |
  |     |           +-- < threshold -> record for next sweep
  |     |           |
  |     |           +-- >= threshold -> route to DLQ
  |     |
  |     +-- No: classify permanent failure
  |           |
  |           +-- Entity-specific (404, deleted)? -> remove from queue
  |           |
  |           +-- Auth failure? -> alert operator, halt
  |           |
  |           +-- Data inconsistency? -> log, skip entity
  |
  +-- Is circuit breaker tripped?
        |
        +-- Yes: pause all operations for this dependency
        |     |
        |     +-- Probe after reset timeout
        |     |     |
        |     |     +-- Probe succeeds? -> close breaker, check outage duration
        |     |     |     |
        |     |     |     +-- Outage > 10min? -> run post-outage reset
        |     |     |     |
        |     |     |     +-- Outage <= 10min -> resume normal
        |     |     |
        |     |     +-- Probe fails? -> stay open, extend timeout
        |
        +-- No: continue normal operation
```

---

## Relationship to Other Phase 2 Documents

| Document | Relationship |
|----------|-------------|
| [04. Node Design](../04.%20Node%20Design/README.md) | Defines the `error_fallback` node this document fully specifies |
| [05. State Management](../05.%20State%20Management/README.md) | Error state fields (`error`, `branchPath: 'error'`) are part of the graph state shape |
| [06. Human-in-the-Loop Design](../06.%20Human-in-the-Loop%20Design/README.md) | Interrupt failure handling and orphaned approval cleanup are specified here |
| [Presearch / 05. Required Node Types / DEEP_DIVE](../../Presearch/05.%20Required%20Node%20Types/DEEP_DIVE.md) | Early node inventory and usage examples. This document is the canonical source for `error_fallback` and `withErrorHandling`. |
| [Presearch / PRESEARCH.md Section 7](../../PRESEARCH.md) | The error taxonomy from PRESEARCH is expanded here into a full classification with retry configs |
