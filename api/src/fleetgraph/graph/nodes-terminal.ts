/**
 * FleetGraph terminal/logging graph nodes.
 *
 * Split from nodes.ts to stay under the 500 LOC limit.
 * These nodes handle delivery, action execution, human gate,
 * audit logging, and error fallback.
 */

import type {
  FleetGraphBranch,
  FleetGraphErrorLog,
  FleetGraphAlertEvent,
  HumanGateOutcome,
} from '@ship/shared';
import type { FleetGraphStateType } from './state.js';
import { interrupt } from '@langchain/langgraph';
import {
  executeShipAction,
  persistAuditEntry,
} from '../data/fetchers.js';
import { traceable } from 'langsmith/traceable';
import {
  canUseLangSmithTracing,
  getLangSmithProjectName,
  resolveLangSmithRunUrl,
} from '../runtime/langsmith.js';
import {
  createAlertWithRecipients,
  createApprovalFromAction,
  resolveAlertRecipients,
} from '../runtime/alert-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute elapsed ms since run started; 0 if not set. */
function computeDuration(state: FleetGraphStateType): number {
  return state.runStartedAt ? Date.now() - state.runStartedAt : 0;
}

function makeErrorLog(
  state: FleetGraphStateType,
  failedNode: string,
  errorClass: string,
  retryable: boolean = false,
): FleetGraphErrorLog {
  return {
    runId: state.runId,
    traceId: state.traceId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    workspaceId: state.workspaceId,
    failedNode,
    failedRoute: null,
    errorClass,
    retryable,
    inputFingerprint: null,
    partialAnswerReturned: false,
    followUpAction: 'retry',
  };
}

// ---------------------------------------------------------------------------
// 6. prepare_notification
// ---------------------------------------------------------------------------

export async function prepareNotification(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  // Assessment already holds everything the alert needs.
  // This node exists as a waypoint for tracing and future enrichment
  // (e.g., formatting for Slack, email, in-app toast).
  return {};
}

// ---------------------------------------------------------------------------
// 7. deliver_alert
// ---------------------------------------------------------------------------

/** Callback type: the runtime wires this to broadcastToUser. */
export type BroadcastFn = (
  workspaceId: string,
  userId: string | null,
  event: string,
  payload: FleetGraphAlertEvent,
) => void;

/** Default no-op broadcast; overridden at graph compile time. */
let _broadcast: BroadcastFn = () => {};

export function setBroadcastFn(fn: BroadcastFn): void {
  _broadcast = fn;
}

export async function deliverAlert(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  if (!state.assessment) return {};

  const candidate = state.candidates[0];
  if (!candidate) return {};
  console.log(`[FleetGraph:Node7] deliver_alert: ${candidate.signalType} severity=${candidate.severity} entity=${candidate.entityType}:${candidate.entityId}`);

  // Persist alert + create recipient rows via shared helper
  const alertId = _gatePool
    ? await createAlertWithRecipients({ pool: _gatePool, candidate, assessment: state.assessment, state })
    : 'no-pool';

  // Broadcast to each resolved recipient
  const recipients = resolveAlertRecipients(candidate, state);
  const event: FleetGraphAlertEvent = {
    alertId,
    signalType: candidate.signalType,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    severity: candidate.severity,
    summary: state.assessment.summary,
    ownerUserId: candidate.ownerUserId,
  };
  for (const userId of recipients) {
    _broadcast(state.workspaceId, userId, 'fleetgraph:alert', event);
  }
  // Fallback: if no recipients resolved, broadcast to actor or workspace
  if (recipients.length === 0) {
    _broadcast(state.workspaceId, state.actorUserId, 'fleetgraph:alert', event);
  }
  console.log(`[FleetGraph:Node7] alert delivered: id=${alertId} recipients=${recipients.length}`);

  return {};
}

// ---------------------------------------------------------------------------
// 8. prepare_action
// ---------------------------------------------------------------------------

export async function prepareAction(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node8] prepare_action: hasAction=${!!state.assessment?.proposedAction} hasPool=${!!_gatePool}`);
  // Persist alert + approval BEFORE the human_gate interrupt.
  if (_gatePool && state.assessment?.proposedAction) {
    const candidate = state.candidates[0];
    if (candidate) {
      // Create alert + recipient rows via shared helper
      const alertId = await createAlertWithRecipients({
        pool: _gatePool,
        candidate,
        assessment: state.assessment,
        state,
      });

      // Create approval record
      const approval = await createApprovalFromAction({
        pool: _gatePool,
        alertId,
        state,
      });
      if (approval) {
        console.log(`[FleetGraph:Node8] approval created: id=${approval.id} action=${approval.actionType} target=${approval.targetEntityType}:${approval.targetEntityId}`);
      }

      // Broadcast to resolved recipients
      const recipients = resolveAlertRecipients(candidate, state);
      const event: FleetGraphAlertEvent = {
        alertId,
        signalType: candidate.signalType,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        severity: candidate.severity,
        summary: state.assessment.summary,
        ownerUserId: candidate.ownerUserId,
      };
      for (const userId of recipients) {
        _broadcast(state.workspaceId, userId, 'fleetgraph:alert', event);
      }
      if (recipients.length === 0) {
        _broadcast(state.workspaceId, state.actorUserId, 'fleetgraph:alert', event);
      }
    }
  }

  return {};
}

// ---------------------------------------------------------------------------
// 9. human_gate (HITL interrupt via LangGraph interrupt())
// ---------------------------------------------------------------------------

/** Module-level pool reference for approval persistence. */
let _gatePool: import('pg').Pool | null = null;

export function setGatePool(pool: import('pg').Pool): void {
  _gatePool = pool;
}

/**
 * Human-in-the-loop gate.
 *
 * Calls `interrupt()` which:
 *   1. On first invocation: throws GraphInterrupt, pausing execution at
 *      the checkpoint. The interrupt value carries the proposed action
 *      summary so callers can inspect what's pending.
 *   2. On resume (via Command({ resume: gateOutcome })): returns the
 *      resume value (the HumanGateOutcome string).
 *
 * The resolved outcome is written into state so the downstream
 * conditional edge (afterGate) routes to execute_action, log_dismissal,
 * or log_snooze.
 */
export async function humanGate(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node9] human_gate: awaiting interrupt (runId=${state.runId})`);

  // interrupt() pauses on first call; returns resume value on second.
  const gateOutcome = interrupt<
    { runId: string; action: unknown },
    HumanGateOutcome
  >({
    runId: state.runId,
    action: state.assessment?.proposedAction ?? null,
  });

  console.log(`[FleetGraph:Node9] human_gate resumed: outcome=${gateOutcome}`);

  return {
    gateOutcome,
    snoozeUntil: state.snoozeUntil,
  };
}

// ---------------------------------------------------------------------------
// 10. execute_action
// ---------------------------------------------------------------------------

export async function executeAction(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  if (!state.assessment?.proposedAction) {
    return {};
  }

  const action = state.assessment.proposedAction;
  console.log(`[FleetGraph:Node10] execute_action: ${action.actionType} on ${action.targetEntityType}:${action.targetEntityId}`);
  try {
    await executeShipAction(
      state.workspaceId,
      action.actionType,
      action.targetEntityType,
      action.targetEntityId,
      action.payload,
    );

    await persistAuditEntry({
      workspaceId: state.workspaceId,
      runId: state.runId,
      mode: state.mode,
      entityType: state.entityType,
      entityId: state.entityId,
      branch: 'confirm_action',
      candidateCount: state.candidates.length,
      durationMs: computeDuration(state),
      tokenUsage: state.tokenUsage ?? null,
      traceUrl: state.traceUrl ?? null,
      createdAt: new Date().toISOString(),
    });
    console.log(`[FleetGraph:Node10] action executed OK: ${action.actionType}`);
  } catch (err) {
    console.error(`[FleetGraph:Node10] execute_action failed:`, err);
    const error = makeErrorLog(
      state,
      'execute_action',
      err instanceof Error ? err.message : 'action_execution_error',
      true,
    );
    return { error };
  }

  return {};
}

// ---------------------------------------------------------------------------
// 11. log_clean_run
// ---------------------------------------------------------------------------

export async function logCleanRun(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node11] log_clean_run: duration=${computeDuration(state)}ms`);

  let traceUrl: string | null = null;

  if (canUseLangSmithTracing(process.env)) {
    let traceRunId: string | null = null;
    let traceClient: {
      readRunSharedLink: (runId: string) => Promise<string | undefined>;
      shareRun: (runId: string) => Promise<string>;
    } | null = null;

    const traced = traceable(
      async (payload: { entityType: string; entityId: string; branch: string }) => payload,
      {
        name: 'fleetgraph_clean_run',
        run_type: 'chain',
        project_name: getLangSmithProjectName(process.env) ?? undefined,
        tags: ['fleetgraph', 'clean'],
        on_start(runTree) {
          if (runTree) {
            traceRunId = runTree.id;
            traceClient = runTree.client;
          }
        },
      },
    );

    try {
      await traced({ entityType: state.entityType ?? 'unknown', entityId: state.entityId ?? 'unknown', branch: 'clean' });
    } catch (err) {
      console.warn('[FleetGraph:Node11] clean run trace capture failed:', err);
    }

    if (traceRunId) {
      traceUrl = await resolveLangSmithRunUrl(traceRunId, traceClient ?? undefined);
    }
  }

  await persistAuditEntry({
    workspaceId: state.workspaceId,
    runId: state.runId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    branch: 'clean',
    candidateCount: 0,
    durationMs: computeDuration(state),
    tokenUsage: state.tokenUsage ?? null,
    traceUrl,
    createdAt: new Date().toISOString(),
  });
  return {};
}

// ---------------------------------------------------------------------------
// 12. log_dismissal
// ---------------------------------------------------------------------------

export async function logDismissal(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node12] log_dismissal: branch=${state.branch} duration=${computeDuration(state)}ms`);
  await persistAuditEntry({
    workspaceId: state.workspaceId,
    runId: state.runId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    branch: state.branch,
    candidateCount: state.candidates.length,
    durationMs: computeDuration(state),
    tokenUsage: state.tokenUsage ?? null,
    traceUrl: null,
    createdAt: new Date().toISOString(),
  });
  return {};
}

// ---------------------------------------------------------------------------
// 13. log_snooze
// ---------------------------------------------------------------------------

export async function logSnooze(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node13] log_snooze: snoozeUntil=${state.snoozeUntil} duration=${computeDuration(state)}ms`);
  await persistAuditEntry({
    workspaceId: state.workspaceId,
    runId: state.runId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    branch: state.branch,
    candidateCount: state.candidates.length,
    durationMs: computeDuration(state),
    tokenUsage: state.tokenUsage ?? null,
    traceUrl: null,
    createdAt: new Date().toISOString(),
  });
  return { snoozeUntil: state.snoozeUntil };
}

// ---------------------------------------------------------------------------
// 14. error_fallback
// ---------------------------------------------------------------------------

export async function errorFallback(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.error(`[FleetGraph:Node14] error_fallback: failedNode=${state.error?.failedNode ?? 'unknown'} errorClass=${state.error?.errorClass ?? 'unhandled'} duration=${computeDuration(state)}ms`);
  const error: FleetGraphErrorLog = state.error ?? {
    runId: state.runId,
    traceId: state.traceId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    workspaceId: state.workspaceId,
    failedNode: 'unknown',
    failedRoute: null,
    errorClass: 'unhandled_error',
    retryable: false,
    inputFingerprint: null,
    partialAnswerReturned: false,
    followUpAction: 'inspect_schema',
  };

  await persistAuditEntry({
    workspaceId: state.workspaceId,
    runId: state.runId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    branch: 'error',
    candidateCount: state.candidates?.length ?? 0,
    durationMs: computeDuration(state),
    tokenUsage: state.tokenUsage ?? null,
    traceUrl: null,
    createdAt: new Date().toISOString(),
  });

  return { error, branch: 'error' as FleetGraphBranch };
}
