import crypto from 'node:crypto';
import type pg from 'pg';
import {
  DEFAULT_THRESHOLDS,
  type FleetGraphAlert,
  type FleetGraphApproval,
  type FleetGraphChatDebugInfo,
  type FleetGraphDemoSeedResponse,
  type FleetGraphEntityType,
  type FleetGraphRunState,
} from '@ship/shared';

type DemoIssueRow = {
  id: string;
  title: string;
  state: string;
};

type GraphInvoker = (initialState: FleetGraphRunState) => Promise<unknown>;
type DemoAlertInput = Partial<FleetGraphAlert> & {
  workspaceId: string;
  fingerprint: string;
  signalType: string;
  entityType: string;
  entityId: string;
  summary: string;
};
type DemoApprovalInput = Omit<
  FleetGraphApproval,
  'id' | 'createdAt' | 'updatedAt' | 'decidedBy' | 'decidedAt'
>;
type AlertUpserter = (pool: pg.Pool, alert: DemoAlertInput) => Promise<{ id: string }>;
type RecipientCreator = (pool: pg.Pool, alertId: string, userIds: string[]) => Promise<unknown>;
type ApprovalCreator = (pool: pg.Pool, approval: DemoApprovalInput) => Promise<unknown>;
type ActiveThreadGetter = (pool: pg.Pool, workspaceId: string, userId: string) => Promise<{ id: string }>;
type ChatAppender = (
  pool: pg.Pool,
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  assessment?: unknown,
  debug?: unknown,
  alertId?: string,
  traceUrl?: string | null,
) => Promise<void>;

const MAX_DEMO_ISSUES = 3;
const MAX_DEMO_APPROVALS = 2;
const DAY_MS = 86_400_000;

function buildInitialRunState(
  workspaceId: string,
  userId: string,
  entityId: string,
): FleetGraphRunState {
  const runId = crypto.randomUUID();
  return {
    runId,
    traceId: runId,
    mode: 'on_demand',
    workspaceId,
    actorUserId: userId,
    entityType: 'issue',
    entityId,
    pageContext: null,
    coreContext: {},
    parallelSignals: {},
    candidates: [],
    branch: 'clean',
    assessment: null,
    gateOutcome: null,
    snoozeUntil: null,
    error: null,
    runStartedAt: Date.now(),
    tokenUsage: null,
    chatQuestion: null,
    chatHistory: null,
    traceUrl: null,
    trigger: 'on_demand',
  };
}

async function selectScopedIssues(
  pool: pg.Pool,
  workspaceId: string,
  entityType: FleetGraphEntityType,
  entityId: string,
): Promise<DemoIssueRow[]> {
  if (entityType === 'project' || entityType === 'sprint') {
    const result = await pool.query<DemoIssueRow>(
      `SELECT id, title, state
       FROM (
         SELECT d.id, d.title, COALESCE(d.properties->>'state', 'backlog') AS state, d.updated_at
         FROM documents d
         JOIN document_associations da
           ON da.document_id = d.id
          AND da.relationship_type = $2
         WHERE d.workspace_id = $1
           AND d.document_type = 'issue'
           AND d.deleted_at IS NULL
           AND d.archived_at IS NULL
           AND COALESCE(d.properties->>'state', 'backlog') NOT IN ('done', 'cancelled')
           AND da.related_id = $3
         GROUP BY d.id, d.title, COALESCE(d.properties->>'state', 'backlog'), d.updated_at
       ) scoped_issues
       ORDER BY updated_at DESC
       LIMIT $4`,
      [workspaceId, entityType, entityId, MAX_DEMO_ISSUES],
    );
    return result.rows;
  }

  if (entityType === 'issue') {
    const result = await pool.query<DemoIssueRow>(
      `WITH related_context AS (
         SELECT related_id
         FROM document_associations
         WHERE document_id = $2
           AND relationship_type IN ('project', 'sprint')
       )
       SELECT id, title, state
       FROM (
         SELECT
           d.id,
           d.title,
           COALESCE(d.properties->>'state', 'backlog') AS state,
           CASE WHEN d.id = $2 THEN 0 ELSE 1 END AS scope_rank,
           d.updated_at
         FROM documents d
         LEFT JOIN document_associations da
           ON da.document_id = d.id
          AND da.relationship_type IN ('project', 'sprint')
         WHERE d.workspace_id = $1
           AND d.document_type = 'issue'
           AND d.deleted_at IS NULL
           AND d.archived_at IS NULL
           AND COALESCE(d.properties->>'state', 'backlog') NOT IN ('done', 'cancelled')
           AND (
             d.id = $2
             OR da.related_id IN (SELECT related_id FROM related_context)
           )
         GROUP BY
           d.id,
           d.title,
           COALESCE(d.properties->>'state', 'backlog'),
           CASE WHEN d.id = $2 THEN 0 ELSE 1 END,
           d.updated_at
       ) scoped_issues
       ORDER BY scope_rank ASC, updated_at DESC
       LIMIT $3`,
      [workspaceId, entityId, MAX_DEMO_ISSUES],
    );
    return result.rows;
  }

  const result = await pool.query<DemoIssueRow>(
    `SELECT id, title, COALESCE(properties->>'state', 'backlog') AS state
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND deleted_at IS NULL
       AND archived_at IS NULL
       AND COALESCE(properties->>'state', 'backlog') NOT IN ('done', 'cancelled')
     ORDER BY updated_at DESC
     LIMIT $2`,
    [workspaceId, MAX_DEMO_ISSUES],
  );
  return result.rows;
}

async function fillFallbackIssues(
  pool: pg.Pool,
  workspaceId: string,
  excludeIds: string[],
  limit: number,
): Promise<DemoIssueRow[]> {
  if (limit <= 0) {
    return [];
  }

  const result = await pool.query<DemoIssueRow>(
    `SELECT id, title, COALESCE(properties->>'state', 'backlog') AS state
     FROM documents
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND deleted_at IS NULL
       AND archived_at IS NULL
       AND COALESCE(properties->>'state', 'backlog') NOT IN ('done', 'cancelled')
       AND NOT (id = ANY($2::uuid[]))
     ORDER BY updated_at DESC
     LIMIT $3`,
    [workspaceId, excludeIds, limit],
  );
  return result.rows;
}

export async function seedFleetGraphDemoFlow({
  pool,
  workspaceId,
  userId,
  entityType,
  entityId,
  invokeGraph,
  upsertAlert,
  createRecipients,
  createApproval,
  getOrCreateActiveThread,
  appendChatMessage,
}: {
  pool: pg.Pool;
  workspaceId: string;
  userId: string;
  entityType: FleetGraphEntityType;
  entityId: string;
  invokeGraph: GraphInvoker;
  upsertAlert: AlertUpserter;
  createRecipients: RecipientCreator;
  createApproval: ApprovalCreator;
  getOrCreateActiveThread: ActiveThreadGetter;
  appendChatMessage: ChatAppender;
}): Promise<FleetGraphDemoSeedResponse> {
  const scopedIssues = await selectScopedIssues(pool, workspaceId, entityType, entityId);
  const shouldUseWorkspaceFallback = entityType === 'workspace';
  const fallbackIssues = shouldUseWorkspaceFallback
    ? await fillFallbackIssues(
      pool,
      workspaceId,
      scopedIssues.map((issue) => issue.id),
      MAX_DEMO_ISSUES - scopedIssues.length,
    )
    : [];
  const issues = [...scopedIssues, ...fallbackIssues].slice(0, MAX_DEMO_ISSUES);
  if (issues.length === 0) {
    return {
      seededIssueCount: 0,
      seededApprovalCount: 0,
      seededIssueIds: [],
    };
  }

  for (const [index, issue] of issues.entries()) {
    const staleDays = DEFAULT_THRESHOLDS.staleIssueDays + index + 1;
    const staleAt = new Date(Date.now() - staleDays * DAY_MS).toISOString();

    await pool.query(
      `UPDATE documents
       SET properties = CASE
             WHEN COALESCE(properties->>'state', 'backlog') IN ('in_progress', 'in_review')
               THEN properties
             ELSE jsonb_set(properties, '{state}', '"in_progress"'::jsonb, true)
           END,
           started_at = COALESCE(started_at, $2::timestamptz),
           updated_at = $2::timestamptz
       WHERE id = $1 AND workspace_id = $3`,
      [issue.id, staleAt, workspaceId],
    );

    const historyResult = await pool.query(
      `UPDATE document_history
       SET created_at = $2::timestamptz
       WHERE document_id = $1`,
      [issue.id, staleAt],
    );

    if ((historyResult.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by, automated_by, created_at)
         VALUES ($1, 'state', NULL, 'in_progress', $2, 'fleetgraph_demo_seed', $3::timestamptz)`,
        [issue.id, userId, staleAt],
      );
    }

    await invokeGraph(buildInitialRunState(workspaceId, userId, issue.id));
  }

  const actionableIssues = issues.slice(0, MAX_DEMO_APPROVALS);
  const thread = await getOrCreateActiveThread(pool, workspaceId, userId);

  for (const [index, issue] of actionableIssues.entries()) {
    const isPriorityAction = index === 0;
    const summary = isPriorityAction
      ? `Demo: ${issue.title} should be escalated before it slips further.`
      : `Demo: ${issue.title} should move forward so execution does not stall.`;
    const recommendation = isPriorityAction
      ? 'Approve to raise priority and surface it in the queue.'
      : 'Approve to move the issue into review and make progress visible.';
    const proposedAction = {
      actionType: isPriorityAction ? 'escalate_priority' : 'change_state',
      targetEntityType: 'issue' as const,
      targetEntityId: issue.id,
      description: isPriorityAction
        ? 'Raise issue priority to high for the demo flow.'
        : 'Advance the issue to in review for the demo flow.',
      payload: isPriorityAction
        ? { priority: 'high' }
        : { state: 'in_review' },
    };
    const alert = await upsertAlert(pool, {
      workspaceId,
      fingerprint: `demo:${workspaceId}:${issue.id}:approval:${index + 1}:${Date.now()}`,
      signalType: 'chat_suggestion',
      entityType: 'issue',
      entityId: issue.id,
      severity: 'high',
      summary,
      recommendation,
      citations: ['demo:seed-flow'],
      ownerUserId: userId,
      status: 'active',
    });

    await createRecipients(pool, alert.id, [userId]);
    await createApproval(pool, {
      workspaceId,
      alertId: alert.id,
      runId: `demo-run:${issue.id}:${index + 1}`,
      threadId: `chat:${thread.id}`,
      checkpointId: null,
      actionType: proposedAction.actionType,
      targetEntityType: proposedAction.targetEntityType,
      targetEntityId: proposedAction.targetEntityId,
      description: proposedAction.description,
      payload: proposedAction.payload,
      status: 'pending',
      expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
    });

    const debug: FleetGraphChatDebugInfo = {
      traceUrl: null,
      branch: 'confirm_action',
      entityType: 'issue',
      entityId: issue.id,
      candidateSignals: ['chat_suggestion'],
      accountability: {
        total: 0,
        overdue: 0,
        dueToday: 0,
      },
      managerActionItems: 0,
    };

    await appendChatMessage(
      pool,
      thread.id,
      'assistant',
      summary,
      {
        summary,
        recommendation,
        branch: 'confirm_action',
        proposedAction,
        citations: ['demo:seed-flow'],
      },
      debug,
      alert.id,
      null,
    );
  }

  return {
    seededIssueCount: issues.length,
    seededApprovalCount: actionableIssues.length,
    seededIssueIds: issues.map((issue) => issue.id),
  };
}
