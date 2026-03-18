/**
 * FleetGraph alert helpers.
 *
 * Shared logic for creating alerts with recipient rows and resolving
 * who should receive an alert. Used by both graph terminal nodes and
 * route handlers.
 */
import type pg from 'pg';
import type {
  FleetGraphCandidate,
  FleetGraphAssessment,
  FleetGraphApproval,
} from '@ship/shared';
import type { FleetGraphStateType } from '../graph/state.js';
import { upsertAlert, createApproval, createRecipients } from './persistence.js';

// -------------------------------------------------------------------------
// Recipient resolver
// -------------------------------------------------------------------------

/**
 * Determine who should receive an alert based on signal type + context.
 * Returns deduplicated user IDs.
 */
export function resolveAlertRecipients(
  candidate: FleetGraphCandidate,
  state: FleetGraphStateType,
): string[] {
  const recipients = new Set<string>();

  // Owner always gets the alert (entity assignee/owner)
  if (candidate.ownerUserId) {
    recipients.add(candidate.ownerUserId);
  }

  // Actor gets it too (on-demand requester)
  if (state.actorUserId) {
    recipients.add(state.actorUserId);
  }

  // Manager signals: employee (targetUserId) also receives
  if (candidate.signalType === 'manager_missing_standup') {
    const evidence = candidate.evidence as { targetUserId?: string };
    if (evidence.targetUserId) {
      recipients.add(evidence.targetUserId);
    }
  }

  return [...recipients];
}

// -------------------------------------------------------------------------
// Alert + recipients creation
// -------------------------------------------------------------------------

/**
 * Persist an alert and create recipient rows in one operation.
 * Returns the alert ID.
 */
export async function createAlertWithRecipients(params: {
  pool: pg.Pool;
  candidate: FleetGraphCandidate;
  assessment: FleetGraphAssessment;
  state: FleetGraphStateType;
}): Promise<string> {
  const { pool, candidate, assessment, state } = params;

  const saved = await upsertAlert(pool, {
    workspaceId: state.workspaceId,
    fingerprint: candidate.fingerprint,
    signalType: candidate.signalType,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    severity: candidate.severity,
    summary: assessment.summary,
    recommendation: assessment.recommendation,
    citations: assessment.citations,
    ownerUserId: candidate.ownerUserId,
    status: 'active',
  });

  const recipients = resolveAlertRecipients(candidate, state);
  if (recipients.length > 0) {
    await createRecipients(pool, saved.id, recipients);
  }

  return saved.id;
}

// -------------------------------------------------------------------------
// Approval creation helper
// -------------------------------------------------------------------------

const APPROVAL_EXPIRY_MS = 72 * 60 * 60_000; // 72 hours

/**
 * Create an approval record from a proposed action.
 * Returns the approval, or null if no proposed action exists.
 */
export async function createApprovalFromAction(params: {
  pool: pg.Pool;
  alertId: string;
  state: FleetGraphStateType;
}): Promise<FleetGraphApproval | null> {
  const { pool, alertId, state } = params;
  const action = state.assessment?.proposedAction;
  if (!action) return null;

  return createApproval(pool, {
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
    expiresAt: new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString(),
  });
}
