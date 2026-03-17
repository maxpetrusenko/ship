/**
 * FleetGraph route tests.
 *
 * Mocks the fleetgraph runtime module so tests run without a live
 * database, LangGraph, or OpenAI keys. The routes now use invokeGraph()
 * and resumeGraph() from the runtime instead of inline graph/action calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { FleetGraphAlert, FleetGraphApproval } from '@ship/shared';

// ---------------------------------------------------------------------------
// Module mocks (must be declared before the module under test is imported)
// ---------------------------------------------------------------------------

vi.mock('../db/client.js', () => ({ pool: {} }));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = 'user-1';
    req.workspaceId = 'ws-1';
    next();
  },
}));

const mockResolveAlert = vi.fn();
const mockGetAlertsByEntity = vi.fn();
const mockGetActiveAlerts = vi.fn();
const mockGetScheduler = vi.fn();
const mockUpdateApprovalStatus = vi.fn();
const mockGetPendingApprovals = vi.fn();
const mockInvokeGraph = vi.fn();
const mockResumeGraph = vi.fn();
const mockGetActiveThread = vi.fn();
const mockGetThreadById = vi.fn();
const mockCreateThread = vi.fn();
const mockGetOrCreateActiveThread = vi.fn();
const mockAppendChatMessage = vi.fn();
const mockLoadRecentMessages = vi.fn();
const mockUpdateThreadPageContext = vi.fn();

vi.mock('../fleetgraph/runtime/index.js', () => ({
  resolveAlert: (...args: unknown[]) => mockResolveAlert(...args),
  getAlertsByEntity: (...args: unknown[]) => mockGetAlertsByEntity(...args),
  getActiveAlerts: (...args: unknown[]) => mockGetActiveAlerts(...args),
  getScheduler: () => mockGetScheduler(),
  updateApprovalStatus: (...args: unknown[]) => mockUpdateApprovalStatus(...args),
  getPendingApprovals: (...args: unknown[]) => mockGetPendingApprovals(...args),
  invokeGraph: (...args: unknown[]) => mockInvokeGraph(...args),
  resumeGraph: (...args: unknown[]) => mockResumeGraph(...args),
  getActiveThread: (...args: unknown[]) => mockGetActiveThread(...args),
  getThreadById: (...args: unknown[]) => mockGetThreadById(...args),
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  getOrCreateActiveThread: (...args: unknown[]) => mockGetOrCreateActiveThread(...args),
  appendChatMessage: (...args: unknown[]) => mockAppendChatMessage(...args),
  loadRecentMessages: (...args: unknown[]) => mockLoadRecentMessages(...args),
  updateThreadPageContext: (...args: unknown[]) => mockUpdateThreadPageContext(...args),
}));

const mockIsFleetGraphReady = vi.fn();

vi.mock('../fleetgraph/bootstrap.js', () => ({
  isFleetGraphReady: () => mockIsFleetGraphReady(),
}));

// Import route after mocks are set up
import { fleetgraphRoutes } from './fleetgraph.js';

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/fleetgraph', fleetgraphRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<FleetGraphAlert> = {}): FleetGraphAlert {
  return {
    id: 'alert-1',
    workspaceId: 'ws-1',
    fingerprint: 'ws-1:issue:iss-1',
    signalType: 'stale_issue',
    entityType: 'issue',
    entityId: 'iss-1',
    severity: 'medium',
    summary: 'Issue is stale',
    recommendation: 'Follow up',
    citations: [],
    ownerUserId: null,
    status: 'active',
    snoozedUntil: null,
    lastSurfacedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApproval(overrides: Partial<FleetGraphApproval> = {}): FleetGraphApproval {
  return {
    id: 'appr-1',
    workspaceId: 'ws-1',
    alertId: 'alert-1',
    runId: 'run-1',
    threadId: 'thread-1',
    checkpointId: null,
    actionType: 'reassign',
    targetEntityType: 'issue',
    targetEntityId: 'iss-1',
    description: 'Reassign to active member',
    payload: { assignee: 'user-2' },
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFleetGraphReady.mockReturnValue(true);
});

// ===========================================================================
// POST /api/fleetgraph/on-demand
// ===========================================================================

describe('POST /api/fleetgraph/on-demand', () => {
  const app = createTestApp();

  it('invokes graph and returns run results', async () => {
    mockInvokeGraph.mockResolvedValue({
      state: {
        runId: 'ignored',
        traceId: 'ignored',
        mode: 'on_demand',
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        entityType: 'issue',
        entityId: 'iss-1',
        coreContext: {},
        parallelSignals: {},
        candidates: [],
        branch: 'inform_only',
        assessment: {
          summary: 'Issue stale 5 days',
          recommendation: 'Ping assignee',
          branch: 'inform_only',
          citations: ['activity feed'],
        },
        gateOutcome: null,
        snoozeUntil: null,
        error: null,
      },
      interrupted: false,
      threadId: 'ignored',
    });
    mockGetAlertsByEntity.mockResolvedValue([makeAlert()]);

    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(200);
    expect(res.body.branch).toBe('inform_only');
    expect(res.body.assessment).toBeTruthy();
    expect(res.body.assessment.summary).toBe('Issue stale 5 days');
    expect(res.body.alerts).toHaveLength(1);
    expect(mockInvokeGraph).toHaveBeenCalledOnce();
  });

  it('returns confirm_action branch when graph interrupts at human_gate', async () => {
    mockInvokeGraph.mockResolvedValue({
      state: {
        branch: 'inform_only',
        assessment: {
          summary: 'Reassign recommended',
          recommendation: 'confirm_action',
          branch: 'confirm_action',
          proposedAction: { actionType: 'reassign' },
          citations: ['workload data'],
        },
        traceUrl: null,
      },
      interrupted: true,
      threadId: 'thread-abc',
    });
    mockGetAlertsByEntity.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(200);
    expect(res.body.branch).toBe('confirm_action');
    expect(res.body.assessment.summary).toBe('Reassign recommended');
  });

  it('returns 400 when entityType is missing', async () => {
    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityId: 'iss-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('entityType');
  });

  it('returns 400 when entityId is missing', async () => {
    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'issue', workspaceId: 'ws-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('entityId');
  });

  it('returns 503 when FleetGraph is not ready', async () => {
    mockIsFleetGraphReady.mockReturnValue(false);

    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(503);
  });

  it('returns partial state when graph invocation fails', async () => {
    mockInvokeGraph.mockRejectedValue(new Error('LLM timeout'));
    mockGetAlertsByEntity.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(200);
    expect(res.body.branch).toBe('clean');
    expect(res.body.assessment).toBeNull();
    expect(res.body.alerts).toEqual([]);
  });

  it('accepts workspace scope without rewriting it to project', async () => {
    mockInvokeGraph.mockResolvedValue({
      state: {
        runId: 'ignored',
        traceId: 'ignored',
        mode: 'on_demand',
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        entityType: 'workspace',
        entityId: 'ws-1',
        coreContext: {},
        parallelSignals: {},
        candidates: [],
        branch: 'inform_only',
        assessment: {
          summary: 'Workspace is healthy',
          recommendation: 'Keep monitoring',
          branch: 'inform_only',
          citations: ['workspace-signal'],
        },
        gateOutcome: null,
        snoozeUntil: null,
        error: null,
      },
      interrupted: false,
      threadId: 'ignored',
    });
    mockGetAlertsByEntity.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/on-demand')
      .send({ entityType: 'workspace', entityId: 'ws-1', workspaceId: 'ws-1' });

    expect(res.status).toBe(200);
    expect(mockInvokeGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityType: 'workspace',
        entityId: 'ws-1',
      }),
    );
    expect(res.body.branch).toBe('inform_only');
  });
});

// ===========================================================================
// POST /api/fleetgraph/chat
// ===========================================================================

const makeThread = (overrides: Record<string, unknown> = {}) => ({
  id: 'thread-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  status: 'active',
  lastPageRoute: null,
  lastPageSurface: null,
  lastPageDocumentId: null,
  lastPageTitle: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('POST /api/fleetgraph/chat', () => {
  const app = createTestApp();

  it('passes prior conversation history from DB without duplicating the current question', async () => {
    // First call: empty history
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValueOnce([]);
    mockAppendChatMessage.mockResolvedValue(undefined);

    mockInvokeGraph.mockImplementation(async (state: { chatHistory: Array<{ role: string; content: string }> | null }) => ({
      state: {
        ...state,
        branch: 'inform_only',
        traceUrl: 'https://smith.langchain.com/runs/run-1',
        candidates: [
          {
            signalType: 'missing_standup',
          },
        ],
        parallelSignals: {
          accountability: {
            items: [
              { days_overdue: 2 },
              { days_overdue: 0 },
            ],
          },
          managerActionItems: [{ employeeId: 'emp-1' }],
        },
        assessment: {
          summary: 'Issue needs a quick follow-up',
          recommendation: 'Ping the assignee today',
          branch: 'inform_only',
          citations: ['history'],
        },
      },
      interrupted: false,
      threadId: 'thread-1',
    }));
    mockGetAlertsByEntity.mockResolvedValue([]);

    const first = await request(app)
      .post('/api/fleetgraph/chat')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1', question: 'What changed?' });

    expect(first.status).toBe(200);
    expect(first.body.threadId).toBe('thread-1');
    expect(mockInvokeGraph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatQuestion: 'What changed?',
        chatHistory: [],
      }),
    );

    // Second call: explicit threadId → goes through getThreadById path
    mockGetThreadById.mockResolvedValueOnce(makeThread());
    mockLoadRecentMessages.mockResolvedValueOnce([
      { role: 'user', content: 'What changed?', timestamp: '2025-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Issue needs a quick follow-up', timestamp: '2025-01-01T00:00:01.000Z' },
    ]);

    const second = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'issue',
        entityId: 'iss-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        question: 'Is it stale?',
      });

    expect(second.status).toBe(200);
    expect(mockInvokeGraph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chatQuestion: 'Is it stale?',
        chatHistory: [
          expect.objectContaining({ role: 'user', content: 'What changed?' }),
          expect.objectContaining({ role: 'assistant', content: 'Issue needs a quick follow-up' }),
        ],
      }),
    );

    const secondCallState = mockInvokeGraph.mock.calls[1]?.[0] as {
      chatHistory: Array<{ role: string; content: string }>;
    };
    expect(secondCallState.chatHistory.filter((msg) => msg.content === 'Is it stale?')).toHaveLength(0);
    expect(second.body.message.debug).toMatchObject({
      traceUrl: 'https://smith.langchain.com/runs/run-1',
      branch: 'inform_only',
      candidateSignals: ['missing_standup'],
      accountability: {
        total: 2,
        overdue: 1,
        dueToday: 1,
      },
      managerActionItems: 1,
    });
  });

  it('accepts workspace chat scope and preserves the workspace entity type', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread({ id: 'thread-ws' }));
    mockLoadRecentMessages.mockResolvedValue([]);
    mockAppendChatMessage.mockResolvedValue(undefined);

    mockInvokeGraph.mockResolvedValue({
      state: {
        runId: 'ignored',
        traceId: 'ignored',
        mode: 'on_demand',
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        entityType: 'workspace',
        entityId: 'ws-1',
        coreContext: {},
        parallelSignals: {},
        candidates: [],
        branch: 'inform_only',
        assessment: {
          summary: 'Workspace summary',
          recommendation: 'Monitor workspace',
          branch: 'inform_only',
          citations: ['workspace-signal'],
        },
        gateOutcome: null,
        snoozeUntil: null,
        error: null,
      },
      interrupted: false,
      threadId: 'thread-2',
    });
    mockGetAlertsByEntity.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'workspace',
        entityId: 'ws-1',
        workspaceId: 'ws-1',
        question: 'What needs attention?',
      });

    expect(res.status).toBe(200);
    expect(mockInvokeGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityType: 'workspace',
        entityId: 'ws-1',
        chatQuestion: 'What needs attention?',
      }),
    );
    expect(res.body.message.content).toBe('Workspace summary');
  });

  it('returns 404 when threadId belongs to another user/workspace', async () => {
    mockGetThreadById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'issue',
        entityId: 'iss-1',
        workspaceId: 'ws-1',
        threadId: 'thread-other',
        question: 'test',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Thread not found');
  });
});

// ===========================================================================
// GET /api/fleetgraph/chat/thread
// ===========================================================================

describe('GET /api/fleetgraph/chat/thread', () => {
  const app = createTestApp();

  it('returns active thread with messages', async () => {
    mockGetActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValue([
      { role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app).get('/api/fleetgraph/chat/thread');

    expect(res.status).toBe(200);
    expect(res.body.thread).toBeTruthy();
    expect(res.body.thread.id).toBe('thread-1');
    expect(res.body.messages).toHaveLength(1);
  });

  it('returns null thread when none exists', async () => {
    mockGetActiveThread.mockResolvedValue(null);

    const res = await request(app).get('/api/fleetgraph/chat/thread');

    expect(res.status).toBe(200);
    expect(res.body.thread).toBeNull();
    expect(res.body.messages).toEqual([]);
  });
});

// ===========================================================================
// POST /api/fleetgraph/chat/thread
// ===========================================================================

describe('POST /api/fleetgraph/chat/thread', () => {
  const app = createTestApp();

  it('creates a new thread', async () => {
    mockCreateThread.mockResolvedValue(makeThread({ id: 'thread-new' }));

    const res = await request(app).post('/api/fleetgraph/chat/thread');

    expect(res.status).toBe(200);
    expect(res.body.thread.id).toBe('thread-new');
    expect(mockCreateThread).toHaveBeenCalledWith(expect.anything(), 'ws-1', 'user-1');
  });
});

// ===========================================================================
// GET /api/fleetgraph/alerts
// ===========================================================================

describe('GET /api/fleetgraph/alerts', () => {
  const app = createTestApp();

  it('returns alerts filtered by entity', async () => {
    mockGetAlertsByEntity.mockResolvedValue([
      makeAlert({ id: 'a1' }),
      makeAlert({ id: 'a2', workspaceId: 'ws-other' }),
    ]);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/fleetgraph/alerts')
      .query({ entityType: 'issue', entityId: 'iss-1' });

    expect(res.status).toBe(200);
    // ws-other should be filtered out by workspace scoping
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].id).toBe('a1');
    expect(res.body.total).toBe(1);
    expect(res.body.pendingApprovals).toEqual([]);
  });

  it('returns active alerts for workspace when no entity filter', async () => {
    mockGetActiveAlerts.mockResolvedValue([makeAlert(), makeAlert({ id: 'a2' })]);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app).get('/api/fleetgraph/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.pendingApprovals).toEqual([]);
  });

  it('applies optional status filter', async () => {
    mockGetActiveAlerts.mockResolvedValue([
      makeAlert({ status: 'active' }),
      makeAlert({ id: 'a2', status: 'dismissed' }),
    ]);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/fleetgraph/alerts')
      .query({ status: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].status).toBe('dismissed');
  });

  it('returns empty array when no alerts exist', async () => {
    mockGetActiveAlerts.mockResolvedValue([]);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app).get('/api/fleetgraph/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.pendingApprovals).toEqual([]);
  });
});

// ===========================================================================
// POST /api/fleetgraph/alerts/:id/resolve
// ===========================================================================

describe('POST /api/fleetgraph/alerts/:id/resolve', () => {
  const app = createTestApp();

  it('dismisses an alert', async () => {
    const dismissed = makeAlert({ status: 'dismissed' });
    mockResolveAlert.mockResolvedValue(dismissed);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'dismiss' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.alert.status).toBe('dismissed');
  });

  it('snoozes an alert with duration', async () => {
    const snoozed = makeAlert({ status: 'snoozed', snoozedUntil: '2025-01-02T00:00:00.000Z' });
    mockResolveAlert.mockResolvedValue(snoozed);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'snooze', snoozeDurationMinutes: 120 });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('snoozed');
    expect(mockResolveAlert).toHaveBeenCalledWith(
      expect.anything(), // pool
      'alert-1',
      'ws-1',    // workspaceId
      'snooze',
      undefined, // snoozedUntil ISO
      120,       // snoozeDurationMinutes
    );
  });

  it('approves an alert and resumes the graph to execute action', async () => {
    const resolved = makeAlert({ status: 'resolved' });
    mockResolveAlert.mockResolvedValue(resolved);

    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    mockUpdateApprovalStatus.mockResolvedValue(makeApproval({ status: 'approved' }));
    mockResumeGraph.mockResolvedValue({
      state: { error: null, branch: 'confirm_action' },
      interrupted: false,
      threadId: 'thread-1',
    });

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('resolved');

    // Should have: approved -> executed (via graph resume)
    expect(mockUpdateApprovalStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateApprovalStatus).toHaveBeenNthCalledWith(
      1, expect.anything(), 'appr-1', 'approved', 'user-1',
    );
    expect(mockUpdateApprovalStatus).toHaveBeenNthCalledWith(
      2, expect.anything(), 'appr-1', 'executed', 'user-1',
    );
    // Graph was resumed with 'approve' outcome
    expect(mockResumeGraph).toHaveBeenCalledWith('thread-1', 'approve');
  });

  it('rejects an alert, dismisses approval, and resumes graph with dismiss', async () => {
    const rejected = makeAlert({ status: 'rejected' });
    mockResolveAlert.mockResolvedValue(rejected);

    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    mockUpdateApprovalStatus.mockResolvedValue(makeApproval({ status: 'dismissed' }));
    mockResumeGraph.mockResolvedValue({
      state: { error: null, branch: 'inform_only' },
      interrupted: false,
      threadId: 'thread-1',
    });

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('rejected');
    expect(mockUpdateApprovalStatus).toHaveBeenCalledWith(
      expect.anything(), 'appr-1', 'dismissed', 'user-1',
    );
    // Graph resumed with 'dismiss' outcome for clean audit logging
    expect(mockResumeGraph).toHaveBeenCalledWith('thread-1', 'dismiss');
  });

  it('returns 400 when outcome is missing', async () => {
    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('outcome');
  });

  it('returns 400 for invalid outcome', async () => {
    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'explode' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('outcome must be one of');
  });

  it('returns 404 when alert does not exist', async () => {
    mockResolveAlert.mockResolvedValue(null);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/nonexistent/resolve')
      .send({ outcome: 'dismiss' });

    expect(res.status).toBe(404);
  });

  it('returns 502 when graph resume fails (action execution error)', async () => {
    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    mockUpdateApprovalStatus.mockResolvedValue(makeApproval({ status: 'approved' }));
    mockResumeGraph.mockRejectedValue(new Error('API down'));

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'approve' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.approvalStatus).toBe('execution_failed');
    expect(mockUpdateApprovalStatus).toHaveBeenCalledWith(
      expect.anything(), 'appr-1', 'execution_failed', 'user-1',
    );
    // Alert should NOT be resolved
    expect(mockResolveAlert).not.toHaveBeenCalled();
  });

  it('returns 502 when graph resume returns error state', async () => {
    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    mockUpdateApprovalStatus.mockResolvedValue(makeApproval({ status: 'approved' }));
    mockResumeGraph.mockResolvedValue({
      state: {
        error: {
          failedNode: 'execute_action',
          errorClass: 'action_execution_error',
        },
        branch: 'error',
      },
      interrupted: false,
      threadId: 'thread-1',
    });

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'approve' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.approvalStatus).toBe('execution_failed');
    expect(mockResolveAlert).not.toHaveBeenCalled();
  });

  it('returns 410 when approval has expired', async () => {
    const expiredApproval = makeApproval({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    mockGetPendingApprovals.mockResolvedValue([expiredApproval]);
    mockUpdateApprovalStatus.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'approve' });

    expect(res.status).toBe(410);
    expect(res.body.error).toContain('expired');
    expect(mockUpdateApprovalStatus).toHaveBeenCalledWith(
      expect.anything(), 'appr-1', 'expired', null,
    );
    expect(mockResumeGraph).not.toHaveBeenCalled();
    expect(mockResolveAlert).not.toHaveBeenCalled();
  });

  it('returns 409 when approval already processed (CAS guard)', async () => {
    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    // CAS returns null = already transitioned
    mockUpdateApprovalStatus.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'approve' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already processed');
    expect(mockResumeGraph).not.toHaveBeenCalled();
    expect(mockResolveAlert).not.toHaveBeenCalled();
  });

  it('still resolves alert when graph resume for dismiss fails', async () => {
    const rejected = makeAlert({ status: 'rejected' });
    mockResolveAlert.mockResolvedValue(rejected);

    const approval = makeApproval();
    mockGetPendingApprovals.mockResolvedValue([approval]);
    mockUpdateApprovalStatus.mockResolvedValue(makeApproval({ status: 'dismissed' }));
    // Graph resume throws but reject should still succeed
    mockResumeGraph.mockRejectedValue(new Error('graph stale'));

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'reject' });

    // The alert is still resolved despite the graph resume failure
    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('rejected');
    expect(mockResumeGraph).toHaveBeenCalledWith('thread-1', 'dismiss');
  });
});

// ===========================================================================
// GET /api/fleetgraph/status
// ===========================================================================

describe('GET /api/fleetgraph/status', () => {
  const app = createTestApp();

  it('returns running scheduler status', async () => {
    const sweepDate = new Date('2025-01-15T10:00:00Z');
    mockGetScheduler.mockReturnValue({
      running: true,
      lastSweepAt: sweepDate,
      nextSweepAt: new Date(sweepDate.getTime() + 240000),
      sweepIntervalMs: 240000,
    });
    mockGetActiveAlerts.mockResolvedValue([makeAlert()]);

    const res = await request(app).get('/api/fleetgraph/status');

    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.lastSweepAt).toBe(sweepDate.toISOString());
    expect(res.body.sweepIntervalMs).toBe(240000);
    expect(res.body.alertsActive).toBe(1);
  });

  it('returns stopped state when scheduler is null', async () => {
    mockGetScheduler.mockReturnValue(null);
    mockGetActiveAlerts.mockResolvedValue([]);

    const res = await request(app).get('/api/fleetgraph/status');

    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
    expect(res.body.lastSweepAt).toBeNull();
    expect(res.body.nextSweepAt).toBeNull();
    expect(res.body.alertsActive).toBe(0);
  });

  it('returns alertsActive 0 when alert query fails', async () => {
    mockGetScheduler.mockReturnValue(null);
    mockGetActiveAlerts.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/fleetgraph/status');

    expect(res.status).toBe(200);
    expect(res.body.alertsActive).toBe(0);
  });
});
