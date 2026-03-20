import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/client.js';
import { seedFleetGraphDemoFlow } from './demo-seed.js';
import {
  appendChatMessage,
  createApproval,
  createRecipients,
  getOrCreateActiveThread,
  getPendingApprovals,
  getUserAlerts,
  loadRecentMessages,
  upsertAlert,
} from './runtime/persistence.js';
import { buildModalFeed, lookupEntityTitles, lookupIssueParents } from './modal-feed.js';

describe('seedFleetGraphDemoFlow integration', () => {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const workspaceName = `FleetGraph Demo Seed ${runId}`;

  let workspaceId: string;
  let userId: string;
  let projectId: string;
  let relatedIssueAId: string;
  let relatedIssueBId: string;
  let unrelatedIssueId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [workspaceName],
    );
    workspaceId = workspaceResult.rows[0].id as string;

    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'FleetGraph Seeder')
       RETURNING id`,
      [`fleetgraph-demo-${runId}@ship.local`],
    );
    userId = userResult.rows[0].id as string;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId],
    );

    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'project', 'Demo Scope Project', 'workspace', $2, '{}'::jsonb)
       RETURNING id`,
      [workspaceId, userId],
    );
    projectId = projectResult.rows[0].id as string;

    const relatedIssueAResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Scoped issue A', 'workspace', $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, userId, JSON.stringify({ state: 'todo', priority: 'medium' })],
    );
    relatedIssueAId = relatedIssueAResult.rows[0].id as string;

    const relatedIssueBResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Scoped issue B', 'workspace', $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, userId, JSON.stringify({ state: 'backlog', priority: 'low' })],
    );
    relatedIssueBId = relatedIssueBResult.rows[0].id as string;

    const unrelatedIssueResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Unrelated issue', 'workspace', $2, $3::jsonb)
       RETURNING id`,
      [workspaceId, userId, JSON.stringify({ state: 'todo', priority: 'low' })],
    );
    unrelatedIssueId = unrelatedIssueResult.rows[0].id as string;

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'project'), ($3, $2, 'project')`,
      [relatedIssueAId, projectId, relatedIssueBId],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM fleetgraph_chat_messages
       WHERE thread_id IN (
         SELECT id FROM fleetgraph_chat_threads WHERE workspace_id = $1
       )`,
      [workspaceId],
    );
    await pool.query(`DELETE FROM fleetgraph_chat_threads WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(
      `DELETE FROM fleetgraph_alert_recipients
       WHERE alert_id IN (
         SELECT id FROM fleetgraph_alerts WHERE workspace_id = $1
       )`,
      [workspaceId],
    );
    await pool.query(`DELETE FROM fleetgraph_approvals WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM fleetgraph_alerts WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM document_history WHERE document_id IN (
      SELECT id FROM documents WHERE workspace_id = $1
    )`, [workspaceId]);
    await pool.query(`DELETE FROM document_associations WHERE document_id IN (
      SELECT id FROM documents WHERE workspace_id = $1
    ) OR related_id IN (
      SELECT id FROM documents WHERE workspace_id = $1
    )`, [workspaceId]);
    await pool.query(`DELETE FROM documents WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [workspaceId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
  });

  it('uses scoped real issues only and persists actionable chat items into Postgres', async () => {
    const invokeRuns: string[] = [];

    const response = await seedFleetGraphDemoFlow({
      pool,
      workspaceId,
      userId,
      entityType: 'project',
      entityId: projectId,
      invokeGraph: async (initialState) => {
        invokeRuns.push(initialState.entityId ?? 'missing');
        return { state: initialState, interrupted: false };
      },
      upsertAlert,
      createRecipients,
      createApproval,
      getOrCreateActiveThread,
      appendChatMessage,
    });

    expect(response.seededIssueIds).toHaveLength(2);
    expect(response.seededIssueIds).toEqual(expect.arrayContaining([relatedIssueAId, relatedIssueBId]));
    expect(response.seededIssueIds).not.toContain(unrelatedIssueId);
    expect(invokeRuns).toEqual(expect.arrayContaining([relatedIssueAId, relatedIssueBId]));

    const thread = await getOrCreateActiveThread(pool, workspaceId, userId);
    const messages = await loadRecentMessages(pool, thread.id);
    const alerts = await getUserAlerts(pool, userId, workspaceId);
    const approvals = await getPendingApprovals(pool, workspaceId);
    const entityTitles = await lookupEntityTitles(pool, alerts.map((alert) => alert.entityId), workspaceId);
    const parentEntityMap = await lookupIssueParents(
      pool,
      alerts.filter((alert) => alert.entityType === 'issue').map((alert) => alert.entityId),
      workspaceId,
    );
    const feed = buildModalFeed(alerts, approvals, { entityTitles, parentEntityMap });

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.role === 'assistant')).toBe(true);
    expect(messages.every((message) => message.alertId)).toBe(true);
    expect(messages.some((message) => message.assessment?.proposedAction?.actionType === 'escalate_priority')).toBe(true);
    expect(messages.some((message) => message.assessment?.proposedAction?.actionType === 'change_state')).toBe(true);

    expect(approvals).toHaveLength(2);
    expect(approvals.every((approval) => approval.threadId === `chat:${thread.id}`)).toBe(true);

    expect(feed.total).toBe(2);
    expect(feed.items.every((item) => item.isActionable)).toBe(true);
    expect(feed.items.map((item) => item.entityId)).toEqual(
      expect.arrayContaining([relatedIssueAId, relatedIssueBId]),
    );

    const stateResult = await pool.query(
      `SELECT id, properties->>'state' AS state
       FROM documents
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[relatedIssueAId, relatedIssueBId, unrelatedIssueId]],
    );
    const stateById = new Map(stateResult.rows.map((row) => [row.id as string, row.state as string | null]));

    expect(stateById.get(relatedIssueAId)).toBe('in_progress');
    expect(stateById.get(relatedIssueBId)).toBe('in_progress');
    expect(stateById.get(unrelatedIssueId)).not.toBe('in_progress');
  });
});
