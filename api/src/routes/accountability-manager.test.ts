/**
 * Tests for GET /api/accountability/manager-action-items
 *
 * Validates the manager-scoped missed-standup signal endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Manager Accountability Action Items', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testWorkspaceName = `MgrAcct Test ${testRunId}`;
  const fixedNow = new Date('2026-03-17T10:30:00Z');
  const fixedToday = '2026-03-17';

  let testWorkspaceId: string;
  let managerUserId: string;
  let managerCookie: string;
  let reportUserId: string;
  let reportCookie: string;
  let managerPersonDocId: string;
  let reportPersonDocId: string;
  let testSprintId: string;
  let testProjectId: string;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    // Create workspace with a sprint_start_date aligned to the frozen clock
    // so current sprint number = 1 and the manager threshold path is stable.
    const wsResult = await pool.query(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, $2::date)
       RETURNING id`,
      [testWorkspaceName, fixedToday]
    );
    testWorkspaceId = wsResult.rows[0].id;

    // Create manager user
    const mgrResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Manager User')
       RETURNING id`,
      [`mgr-acct-${testRunId}@ship.local`]
    );
    managerUserId = mgrResult.rows[0].id;

    // Create direct report user
    const reportResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Report User')
       RETURNING id`,
      [`report-acct-${testRunId}@ship.local`]
    );
    reportUserId = reportResult.rows[0].id;

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [testWorkspaceId, managerUserId, reportUserId]
    );

    // Create manager person document
    const mgrPersonResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Manager User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, managerUserId, JSON.stringify({ user_id: managerUserId })]
    );
    managerPersonDocId = mgrPersonResult.rows[0].id;

    // Create report person document with reports_to = manager
    const reportPersonResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Report User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, reportUserId, JSON.stringify({
        user_id: reportUserId,
        reports_to: managerPersonDocId,
      })]
    );
    reportPersonDocId = reportPersonResult.rows[0].id;

    // Create a project
    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'project', 'Test Project', 'workspace', '{}') RETURNING id`,
      [testWorkspaceId]
    );
    testProjectId = projectResult.rows[0].id;

    // Create a sprint (sprint_number = 1, matching our workspace start date)
    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Week 1', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, managerUserId, JSON.stringify({
        sprint_number: 1,
        status: 'active',
        owner_id: managerPersonDocId,
      })]
    );
    testSprintId = sprintResult.rows[0].id;

    // Associate sprint with project
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'project')`,
      [testSprintId, testProjectId]
    );

    // Create an issue assigned to the report user in the sprint
    const issueResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Test Issue', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, reportUserId, JSON.stringify({
        assignee_id: reportUserId,
        state: 'in_progress',
        priority: 'medium',
      })]
    );
    const testIssueId = issueResult.rows[0].id;

    // Associate issue with sprint
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'sprint')`,
      [testIssueId, testSprintId]
    );

    // Create sessions
    const mgrSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [mgrSessionId, managerUserId, testWorkspaceId]
    );
    managerCookie = `session_id=${mgrSessionId}`;

    const reportSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [reportSessionId, reportUserId, testWorkspaceId]
    );
    reportCookie = `session_id=${reportSessionId}`;

    // Get CSRF tokens (needed for session middleware to wire connect.sid)
    const mgrCsrfRes = await request(app).get('/api/csrf-token').set('Cookie', managerCookie);
    const mgrConnectSid = mgrCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (mgrConnectSid) managerCookie = `${managerCookie}; ${mgrConnectSid}`;

    const reportCsrfRes = await request(app).get('/api/csrf-token').set('Cookie', reportCookie);
    const reportConnectSid = reportCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    if (reportConnectSid) reportCookie = `${reportCookie}; ${reportConnectSid}`;
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)',
      [testWorkspaceId]
    );
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [managerUserId, reportUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  describe('GET /api/accountability/manager-action-items', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/accountability/manager-action-items');

      expect(res.status).toBe(401);
    });

    it('should return correct response shape', async () => {
      const res = await request(app)
        .get('/api/accountability/manager-action-items')
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('should return empty when user has no direct reports', async () => {
      // The report user has no one reporting to them
      const res = await request(app)
        .get('/api/accountability/manager-action-items')
        .set('Cookie', reportCookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('should return items when direct report has missed standup', async () => {
      const res = await request(app)
        .get('/api/accountability/manager-action-items')
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);

      const item = res.body.items.find(
        (i: Record<string, unknown>) => i.employeeId === reportUserId
      );
      expect(item).toBeDefined();
      expect(item.employeeName).toBe('Report User');
      expect(item.sprintId).toBe(testSprintId);
      expect(item.sprintTitle).toBe('Week 1');
      expect(typeof item.overdueMinutes).toBe('number');
      expect(item.overdueMinutes).toBeGreaterThanOrEqual(5);
      expect(item.dueTime).toBe('2026-03-17T09:00:00.000Z');
      expect(item.projectId).toBe(testProjectId);
      expect(item.projectTitle).toBe('Test Project');
    });

    it('should not return items after direct report posts standup', async () => {
      // Create a standup for today from the report user
      // Explicitly set created_at to the faked clock because vi.useFakeTimers
      // only affects JS Date, not the database's DEFAULT now().
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, parent_id, properties, created_at)
         VALUES ($1, 'standup', 'Daily Standup', 'workspace', $2, $3, $4, $5)`,
        [testWorkspaceId, reportUserId, testSprintId, JSON.stringify({
          author_id: reportUserId,
        }), fixedNow.toISOString()]
      );

      const res = await request(app)
        .get('/api/accountability/manager-action-items')
        .set('Cookie', managerCookie);

      expect(res.status).toBe(200);

      // Should not find the report user anymore (standup was posted)
      const item = res.body.items.find(
        (i: Record<string, unknown>) => i.employeeId === reportUserId
      );
      expect(item).toBeUndefined();
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });
});
