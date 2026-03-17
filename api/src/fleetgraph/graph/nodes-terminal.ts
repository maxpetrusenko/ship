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
  persistAlert,
  persistAuditEntry,
} from '../data/fetchers.js';
import {
  createApproval,
} from '../runtime/persistence.js';

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

  // Persist alert record
  const alertId = await persistAlert({
    workspaceId: state.workspaceId,
    fingerprint: candidate.fingerprint,
    signalType: candidate.signalType,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    severity: candidate.severity,
    summary: state.assessment.summary,
    recommendation: state.assessment.recommendation,
    citations: state.assessment.citations,
    ownerUserId: candidate.ownerUserId,
    status: 'active',
    snoozedUntil: null,
    lastSurfacedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Broadcast realtime event
  const event: FleetGraphAlertEvent = {
    alertId,
    signalType: candidate.signalType,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    severity: candidate.severity,
    summary: state.assessment.summary,
  };
  _broadcast(state.workspaceId, state.actorUserId, 'fleetgraph:alert', event);
  console.log(`[FleetGraph:Node7] alert delivered: id=${alertId} broadcast to=${state.actorUserId ?? 'workspace'}`);

  return {};
}

// ---------------------------------------------------------------------------
// 8. prepare_action
// ---------------------------------------------------------------------------

export async function prepareAction(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node8] prepare_action: hasAction=${!!state.assessment?.proposedAction} hasPool=${!!_gatePool}`);
  // Persist the pending approval BEFORE the human_gate interrupt.
  // The human_gate node pauses via interrupt(), so the approval must exist
  // before that node runs so the UI and /resolve route can find it.
  if (_gatePool && state.assessment?.proposedAction) {
    const candidate = state.candidates[0];
    if (candidate) {
      const alertId = await persistAlert({
        workspaceId: state.workspaceId,
        fingerprint: candidate.fingerprint,
        signalType: candidate.signalType,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        severity: candidate.severity,
        summary: state.assessment.summary,
        recommendation: state.assessment.recommendation,
        citations: state.assessment.citations,
        ownerUserId: candidate.ownerUserId,
        status: 'active',
      });

      const action = state.assessment.proposedAction;
      const approval = await createApproval(_gatePool, {
        workspaceId: state.workspaceId,
        alertId,
        runId: state.runId,
        threadId: state.runId,
        checkpointId: null,
        actionType: action.actionType,
        targetEntityType: action.targetEntityType,
        targetEntityId: action.targetEntityId,
        description: action.description,
        payload: action.payload,
        status: 'pending',
        expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      });
      console.log(`[FleetGraph:Node8] approval created: id=${approval.id} action=${action.actionType} target=${action.targetEntityType}:${action.targetEntityId}`);

      // Broadcast the alert so UI renders it immediately
      _broadcast(state.workspaceId, state.actorUserId, 'fleetgraph:alert', {
        alertId,
        signalType: candidate.signalType,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        severity: candidate.severity,
        summary: state.assessment.summary,
      });
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
    traceUrl: null,
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
