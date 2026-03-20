/**
 * FleetGraph persistence layer.
 * All functions accept a pg.Pool parameter (no global import).
 * Parameterized queries throughout.
 */
import type pg from 'pg';
import type {
  FleetGraphAlert,
  FleetGraphAlertRecipient,
  FleetGraphAuditEntry,
  FleetGraphApproval,
  FleetGraphApprovalStatus,
  FleetGraphChatThread,
  FleetGraphChatMessage,
  FleetGraphEntityType,
  FleetGraphPageContext,
} from '@ship/shared';

// -------------------------------------------------------------------------
// Alerts
// -------------------------------------------------------------------------

/** Find a single active alert by workspace + fingerprint. */
export async function findActiveAlert(
  pool: pg.Pool,
  workspaceId: string,
  fingerprint: string,
): Promise<FleetGraphAlert | null> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_alerts
     WHERE workspace_id = $1 AND fingerprint = $2 AND status = 'active'
     LIMIT 1`,
    [workspaceId, fingerprint],
  );
  const found = result.rows[0] ? rowToAlert(result.rows[0]) : null;
  console.log(`[FleetGraph:Persist] findActiveAlert: fp=${fingerprint} found=${!!found}`);
  return found;
}

/** Create or update an alert (upsert on workspace + fingerprint for active). */
export async function upsertAlert(
  pool: pg.Pool,
  alert: Partial<FleetGraphAlert> & {
    workspaceId: string;
    fingerprint: string;
    signalType: string;
    entityType: string;
    entityId: string;
    summary: string;
  },
): Promise<FleetGraphAlert> {
  const result = await pool.query(
    `INSERT INTO fleetgraph_alerts (
       workspace_id, fingerprint, signal_type, entity_type, entity_id,
       severity, summary, recommendation, citations, owner_user_id,
       status, snoozed_until, last_surfaced_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (workspace_id, fingerprint) WHERE status = 'active'
     DO UPDATE SET
       severity = EXCLUDED.severity,
       summary = EXCLUDED.summary,
       recommendation = EXCLUDED.recommendation,
       citations = EXCLUDED.citations,
       owner_user_id = EXCLUDED.owner_user_id,
       last_surfaced_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      alert.workspaceId,
      alert.fingerprint,
      alert.signalType,
      alert.entityType,
      alert.entityId,
      alert.severity ?? 'medium',
      alert.summary,
      alert.recommendation ?? '',
      JSON.stringify(alert.citations ?? []),
      alert.ownerUserId ?? null,
      alert.status ?? 'active',
      alert.snoozedUntil ?? null,
    ],
  );
  const upserted = rowToAlert(result.rows[0]);
  console.log(`[FleetGraph:Persist] upsertAlert: id=${upserted.id} fp=${upserted.fingerprint} status=${upserted.status}`);
  return upserted;
}

/** Resolve an alert: dismiss, snooze, approve (resolved), or reject. */
export async function resolveAlert(
  pool: pg.Pool,
  alertId: string,
  workspaceId: string,
  outcome: 'dismiss' | 'snooze' | 'approve' | 'reject',
  snoozedUntilIso?: string,
  snoozeDurationMinutes?: number,
): Promise<FleetGraphAlert | null> {
  let status: string;
  let snoozedUntil: Date | null = null;

  switch (outcome) {
    case 'dismiss':
      status = 'dismissed';
      break;
    case 'snooze': {
      status = 'snoozed';
      if (snoozedUntilIso) {
        snoozedUntil = new Date(snoozedUntilIso);
      } else {
        const mins = snoozeDurationMinutes ?? 60;
        snoozedUntil = new Date(Date.now() + mins * 60_000);
      }
      break;
    }
    case 'approve':
      status = 'resolved';
      break;
    case 'reject':
      status = 'rejected';
      break;
    default:
      status = 'dismissed';
  }

  console.log(`[FleetGraph:Persist] resolveAlert: id=${alertId} outcome=${outcome} -> status=${status}`);
  const result = await pool.query(
    `UPDATE fleetgraph_alerts
     SET status = $2, snoozed_until = $3, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $4
     RETURNING *`,
    [alertId, status, snoozedUntil, workspaceId],
  );
  return result.rows[0] ? rowToAlert(result.rows[0]) : null;
}

/** All alerts tied to a specific entity (any status). */
export async function getAlertsByEntity(
  pool: pg.Pool,
  entityType: string,
  entityId: string,
): Promise<FleetGraphAlert[]> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_alerts
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC`,
    [entityType, entityId],
  );
  return result.rows.map(rowToAlert);
}

/** All active alerts for a workspace. */
export async function getActiveAlerts(
  pool: pg.Pool,
  workspaceId: string,
): Promise<FleetGraphAlert[]> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_alerts
     WHERE workspace_id = $1 AND status = 'active'
     ORDER BY last_surfaced_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToAlert);
}

/** Reactivate snoozed alerts whose snooze window has expired. */
export async function cleanExpiredSnoozed(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE fleetgraph_alerts
     SET status = 'active', snoozed_until = NULL, updated_at = NOW()
     WHERE status = 'snoozed' AND snoozed_until <= NOW()`,
  );
  return result.rowCount ?? 0;
}

// -------------------------------------------------------------------------
// Staleness check (page-view trigger)
// -------------------------------------------------------------------------

const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/** Check if an entity's last analysis is stale (no audit entry or older than threshold). */
export async function isEntityAnalysisStale(
  pool: pg.Pool,
  workspaceId: string,
  entityType: string,
  entityId: string,
  thresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT created_at FROM fleetgraph_audit_log
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, entityType, entityId],
  );
  if (result.rows.length === 0) return true;
  const lastRun = new Date(result.rows[0].created_at as string).getTime();
  return Date.now() - lastRun > thresholdMs;
}

// -------------------------------------------------------------------------
// Audit log
// -------------------------------------------------------------------------

/** Insert a single audit row for a graph run. */
export async function logAuditEntry(
  pool: pg.Pool,
  entry: FleetGraphAuditEntry,
): Promise<void> {
  console.log(`[FleetGraph:Persist] audit: runId=${entry.runId} branch=${entry.branch} duration=${entry.durationMs}ms tokens=${entry.tokenUsage ? JSON.stringify(entry.tokenUsage) : 'n/a'}`);
  await pool.query(
    `INSERT INTO fleetgraph_audit_log (
       workspace_id, run_id, mode, entity_type, entity_id,
       branch, candidate_count, duration_ms, token_usage, trace_url
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.workspaceId,
      entry.runId,
      entry.mode,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.branch,
      entry.candidateCount,
      entry.durationMs,
      entry.tokenUsage ? JSON.stringify(entry.tokenUsage) : null,
      entry.traceUrl ?? null,
    ],
  );
}

// -------------------------------------------------------------------------
// Entity digests (change detection cache)
// -------------------------------------------------------------------------

/** Get cached digest for an entity. */
export async function getEntityDigest(
  pool: pg.Pool,
  workspaceId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT digest FROM fleetgraph_entity_digests
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [workspaceId, entityType, entityId],
  );
  return result.rows[0]?.digest ?? null;
}

/** Upsert digest for an entity. */
export async function setEntityDigest(
  pool: pg.Pool,
  workspaceId: string,
  entityType: string,
  entityId: string,
  digest: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_entity_digests (workspace_id, entity_type, entity_id, digest, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, entity_type, entity_id)
     DO UPDATE SET digest = $4, updated_at = NOW()`,
    [workspaceId, entityType, entityId, digest],
  );
}

// -------------------------------------------------------------------------
// Approvals (HITL gate)
// -------------------------------------------------------------------------

/** Create a pending approval record when the graph reaches the human gate. */
export async function createApproval(
  pool: pg.Pool,
  approval: Omit<FleetGraphApproval, 'id' | 'decidedBy' | 'decidedAt' | 'createdAt' | 'updatedAt'>,
): Promise<FleetGraphApproval> {
  const result = await pool.query(
    `INSERT INTO fleetgraph_approvals (
       workspace_id, alert_id, run_id, thread_id, checkpoint_id,
       action_type, target_entity_type, target_entity_id,
       description, payload, status, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      approval.workspaceId,
      approval.alertId,
      approval.runId,
      approval.threadId,
      approval.checkpointId ?? null,
      approval.actionType,
      approval.targetEntityType,
      approval.targetEntityId,
      approval.description,
      JSON.stringify(approval.payload),
      approval.status,
      approval.expiresAt,
    ],
  );
  const created = rowToApproval(result.rows[0]);
  console.log(`[FleetGraph:Persist] createApproval: id=${created.id} action=${created.actionType} target=${created.targetEntityType}:${created.targetEntityId} expires=${created.expiresAt}`);
  return created;
}

/** Find a pending approval by ID. */
export async function findPendingApproval(
  pool: pg.Pool,
  approvalId: string,
): Promise<FleetGraphApproval | null> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_approvals WHERE id = $1 AND status = 'pending' LIMIT 1`,
    [approvalId],
  );
  return result.rows[0] ? rowToApproval(result.rows[0]) : null;
}

/** Transition an approval to a new status.
 *  Uses CAS: only transitions from 'pending' for approve/dismiss/expired
 *  to prevent duplicate-approve races. Returns null if already transitioned. */
export async function updateApprovalStatus(
  pool: pg.Pool,
  approvalId: string,
  status: FleetGraphApprovalStatus,
  decidedBy: string | null,
): Promise<FleetGraphApproval | null> {
  // For terminal transitions, require current status = 'pending' (CAS guard)
  const requirePending = ['approved', 'dismissed', 'expired'].includes(status);
  const query = requirePending
    ? `UPDATE fleetgraph_approvals
       SET status = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`
    : `UPDATE fleetgraph_approvals
       SET status = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`;
  const result = await pool.query(query, [approvalId, status, decidedBy]);
  const updated = result.rows[0] ? rowToApproval(result.rows[0]) : null;
  console.log(`[FleetGraph:Persist] updateApprovalStatus: id=${approvalId} -> ${status} CAS=${requirePending ? (updated ? 'OK' : 'RACE') : 'skip'}`);
  return updated;
}

/** Expire all stale pending approvals (72h window). */
export async function expirePendingApprovals(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE fleetgraph_approvals
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at <= NOW()`,
  );
  return result.rowCount ?? 0;
}

/** Get pending approvals for a workspace (dashboard). */
export async function getPendingApprovals(
  pool: pg.Pool,
  workspaceId: string,
): Promise<FleetGraphApproval[]> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_approvals
     WHERE workspace_id = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToApproval);
}

// -------------------------------------------------------------------------
// Alert recipients (per-user notification state)
// -------------------------------------------------------------------------

/** Upsert a single recipient row. */
export async function createRecipient(
  pool: pg.Pool,
  alertId: string,
  userId: string,
): Promise<FleetGraphAlertRecipient> {
  const result = await pool.query(
    `INSERT INTO fleetgraph_alert_recipients (alert_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (alert_id, user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [alertId, userId],
  );
  return rowToRecipient(result.rows[0]);
}

/** Bulk upsert recipient rows. */
export async function createRecipients(
  pool: pg.Pool,
  alertId: string,
  userIds: string[],
): Promise<FleetGraphAlertRecipient[]> {
  if (userIds.length === 0) return [];
  const results: FleetGraphAlertRecipient[] = [];
  for (const userId of userIds) {
    results.push(await createRecipient(pool, alertId, userId));
  }
  return results;
}

/**
 * Get alerts for a specific user in a workspace.
 * Joins through recipients table; returns only visible alerts
 * (not dismissed, not currently snoozed).
 */
export async function getUserAlerts(
  pool: pg.Pool,
  userId: string,
  workspaceId: string,
): Promise<FleetGraphAlert[]> {
  const result = await pool.query(
    `SELECT a.*, r.read_at AS recipient_read_at
     FROM fleetgraph_alerts a
     JOIN fleetgraph_alert_recipients r ON r.alert_id = a.id
     WHERE r.user_id = $1
       AND a.workspace_id = $2
       AND a.status = 'active'
       AND r.dismissed_at IS NULL
       AND (r.snoozed_until IS NULL OR r.snoozed_until <= NOW())
     ORDER BY a.last_surfaced_at DESC`,
    [userId, workspaceId],
  );
  return result.rows.map((row) => ({
    ...rowToAlert(row),
    readAt: row.recipient_read_at ? (row.recipient_read_at as Date).toISOString() : null,
  }));
}

/** Count unread alerts for a user in a workspace. */
export async function getUnreadCount(
  pool: pg.Pool,
  userId: string,
  workspaceId: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM fleetgraph_alert_recipients r
     JOIN fleetgraph_alerts a ON a.id = r.alert_id
     WHERE r.user_id = $1
       AND a.workspace_id = $2
       AND a.status = 'active'
       AND r.read_at IS NULL
       AND r.dismissed_at IS NULL
       AND (r.snoozed_until IS NULL OR r.snoozed_until <= NOW())`,
    [userId, workspaceId],
  );
  return parseInt(result.rows[0]?.cnt as string, 10) || 0;
}

/** Mark recipient rows as read. If alertIds is null/empty, marks all unread. */
export async function markRecipientsRead(
  pool: pg.Pool,
  userId: string,
  alertIds?: string[],
): Promise<number> {
  if (alertIds && alertIds.length > 0) {
    const result = await pool.query(
      `UPDATE fleetgraph_alert_recipients
       SET read_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND alert_id = ANY($2) AND read_at IS NULL`,
      [userId, alertIds],
    );
    return result.rowCount ?? 0;
  }
  const result = await pool.query(
    `UPDATE fleetgraph_alert_recipients
     SET read_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

/** Dismiss a recipient's view of an alert (recipient-level, not global). */
export async function dismissRecipient(
  pool: pg.Pool,
  alertId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE fleetgraph_alert_recipients
     SET dismissed_at = NOW(), updated_at = NOW()
     WHERE alert_id = $1 AND user_id = $2 AND dismissed_at IS NULL`,
    [alertId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Snooze a recipient's view of an alert until a given time. */
export async function snoozeRecipient(
  pool: pg.Pool,
  alertId: string,
  userId: string,
  until: Date,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE fleetgraph_alert_recipients
     SET snoozed_until = $3, updated_at = NOW()
     WHERE alert_id = $1 AND user_id = $2`,
    [alertId, userId, until],
  );
  return (result.rowCount ?? 0) > 0;
}

// -------------------------------------------------------------------------
// Chat threads (persistent conversation store)
// -------------------------------------------------------------------------

/** Max messages loaded into LLM prompt window. */
const CHAT_MESSAGE_WINDOW = 20;

/** Get the active thread for a user+workspace. */
export async function getActiveThread(
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
  entityType?: FleetGraphEntityType | null,
  entityId?: string | null,
): Promise<FleetGraphChatThread | null> {
  void entityType;
  void entityId;
  const result = await pool.query(
    `SELECT * FROM fleetgraph_chat_threads
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [workspaceId, userId],
  );
  return result.rows[0] ? rowToThread(result.rows[0]) : null;
}

/** Get a thread by ID, scoped to user+workspace for ownership check. */
export async function getThreadById(
  pool: pg.Pool,
  threadId: string,
  workspaceId: string,
  userId: string,
): Promise<FleetGraphChatThread | null> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_chat_threads
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [threadId, workspaceId, userId],
  );
  return result.rows[0] ? rowToThread(result.rows[0]) : null;
}

/** Create a new active thread. Archives any prior active thread in the workspace. */
export async function createThread(
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
  entityType?: FleetGraphEntityType | null,
  entityId?: string | null,
): Promise<FleetGraphChatThread> {
  await pool.query(
    `UPDATE fleetgraph_chat_threads
     SET status = 'archived', updated_at = NOW()
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
    [workspaceId, userId],
  );

  const result = await pool.query(
    `INSERT INTO fleetgraph_chat_threads (workspace_id, user_id, status, entity_type, entity_id)
     VALUES ($1, $2, 'active', $3, $4)
     RETURNING *`,
    [workspaceId, userId, entityType ?? null, entityId ?? null],
  );
  return rowToThread(result.rows[0]);
}

/** Get or create the active workspace thread for a user+workspace. */
export async function getOrCreateActiveThread(
  pool: pg.Pool,
  workspaceId: string,
  userId: string,
  entityType?: FleetGraphEntityType | null,
  entityId?: string | null,
): Promise<FleetGraphChatThread> {
  const existing = await getActiveThread(pool, workspaceId, userId);
  if (existing) return existing;
  return createThread(pool, workspaceId, userId, entityType, entityId);
}

/** Append a message to a thread. */
export async function appendChatMessage(
  pool: pg.Pool,
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  assessment?: unknown,
  debug?: unknown,
  alertId?: string,
  traceUrl?: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO fleetgraph_chat_messages (thread_id, role, content, assessment, debug, alert_id, trace_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      threadId,
      role,
      content,
      assessment ? JSON.stringify(assessment) : null,
      debug ? JSON.stringify(debug) : null,
      alertId ?? null,
      traceUrl ?? null,
    ],
  );
  // Touch thread updated_at
  await pool.query(
    `UPDATE fleetgraph_chat_threads SET updated_at = NOW() WHERE id = $1`,
    [threadId],
  );
}

/** Load recent messages for a thread (bounded to CHAT_MESSAGE_WINDOW). */
export async function loadRecentMessages(
  pool: pg.Pool,
  threadId: string,
): Promise<FleetGraphChatMessage[]> {
  const result = await pool.query(
    `SELECT * FROM fleetgraph_chat_messages
     WHERE thread_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [threadId, CHAT_MESSAGE_WINDOW],
  );
  // Reverse so oldest is first
  return result.rows.reverse().map(rowToChatMessage);
}

/** Update thread page metadata (called each chat turn). */
export async function updateThreadPageContext(
  pool: pg.Pool,
  threadId: string,
  pageContext: FleetGraphPageContext,
): Promise<void> {
  await pool.query(
    `UPDATE fleetgraph_chat_threads
     SET last_page_route = $2,
         last_page_surface = $3,
         last_page_document_id = $4,
         last_page_title = $5,
         last_page_context = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      threadId,
      pageContext.route,
      pageContext.surface,
      pageContext.documentId ?? null,
      pageContext.title ?? null,
      JSON.stringify(pageContext),
    ],
  );
}

// -------------------------------------------------------------------------
// Row mappers
// -------------------------------------------------------------------------

function rowToThread(row: Record<string, unknown>): FleetGraphChatThread {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    status: row.status as 'active' | 'archived',
    lastPageRoute: (row.last_page_route as string) ?? null,
    lastPageSurface: (row.last_page_surface as string) ?? null,
    lastPageDocumentId: (row.last_page_document_id as string) ?? null,
    lastPageTitle: (row.last_page_title as string) ?? null,
    lastPageContext: (row.last_page_context as FleetGraphPageContext) ?? null,
    entityType: (row.entity_type as FleetGraphChatThread['entityType']) ?? null,
    entityId: (row.entity_id as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function rowToChatMessage(row: Record<string, unknown>): FleetGraphChatMessage {
  const baseDebug = (row.debug as FleetGraphChatMessage['debug']) ?? undefined;
  const traceUrl = (row.trace_url as string | null) ?? null;

  return {
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    alertId: (row.alert_id as string | null) ?? undefined,
    assessment: (row.assessment as FleetGraphChatMessage['assessment']) ?? undefined,
    debug: baseDebug ? { ...baseDebug, traceUrl: traceUrl ?? baseDebug.traceUrl } : undefined,
    timestamp: (row.created_at as Date).toISOString(),
  };
}

function rowToApproval(row: Record<string, unknown>): FleetGraphApproval {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    alertId: row.alert_id as string,
    runId: row.run_id as string,
    threadId: row.thread_id as string,
    checkpointId: (row.checkpoint_id as string) ?? null,
    actionType: row.action_type as string,
    targetEntityType: row.target_entity_type as FleetGraphApproval['targetEntityType'],
    targetEntityId: row.target_entity_id as string,
    description: row.description as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as FleetGraphApproval['status'],
    decidedBy: (row.decided_by as string) ?? null,
    decidedAt: row.decided_at ? (row.decided_at as Date).toISOString() : null,
    expiresAt: (row.expires_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function rowToRecipient(row: Record<string, unknown>): FleetGraphAlertRecipient {
  return {
    id: row.id as string,
    alertId: row.alert_id as string,
    userId: row.user_id as string,
    readAt: row.read_at ? (row.read_at as Date).toISOString() : null,
    dismissedAt: row.dismissed_at ? (row.dismissed_at as Date).toISOString() : null,
    snoozedUntil: row.snoozed_until ? (row.snoozed_until as Date).toISOString() : null,
    deliveredAt: (row.delivered_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function rowToAlert(row: Record<string, unknown>): FleetGraphAlert {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    fingerprint: row.fingerprint as string,
    signalType: row.signal_type as FleetGraphAlert['signalType'],
    entityType: row.entity_type as FleetGraphAlert['entityType'],
    entityId: row.entity_id as string,
    severity: row.severity as FleetGraphAlert['severity'],
    summary: row.summary as string,
    recommendation: row.recommendation as string,
    citations: (row.citations ?? []) as string[],
    ownerUserId: (row.owner_user_id as string) ?? null,
    status: row.status as FleetGraphAlert['status'],
    snoozedUntil: row.snoozed_until ? (row.snoozed_until as Date).toISOString() : null,
    lastSurfacedAt: (row.last_surfaced_at as Date).toISOString(),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    readAt: null,
  };
}
