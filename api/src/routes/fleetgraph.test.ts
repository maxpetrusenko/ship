/**
 * FleetGraph route tests.
 *
 * Mocks the fleetgraph runtime module so tests run without a live
 * database, LangGraph, or OpenAI keys. Chat uses the dedicated
 * runFleetGraphChat() runtime while the other routes still use invokeGraph()
 * and resumeGraph() from the runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { FleetGraphAlert, FleetGraphApproval, FleetGraphRunState } from '@ship/shared';
import type { FleetGraphChatRuntimeResult } from '../fleetgraph/chat/types.js';

// ---------------------------------------------------------------------------
// Module mocks (must be declared before the module under test is imported)
// ---------------------------------------------------------------------------

const {
  mockResolveAlert,
  mockGetAlertsByEntity,
  mockGetActiveAlerts,
  mockGetScheduler,
  mockUpdateApprovalStatus,
  mockGetPendingApprovals,
  mockUpsertAlert,
  mockInvokeGraph,
  mockResumeGraph,
  mockIsEntityAnalysisStale,
  mockGetActiveThread,
  mockGetThreadById,
  mockCreateThread,
  mockGetOrCreateActiveThread,
  mockAppendChatMessage,
  mockLoadRecentMessages,
  mockUpdateThreadPageContext,
  mockGetUserAlerts,
  mockGetUnreadCount,
  mockMarkRecipientsRead,
  mockDismissRecipient,
  mockSnoozeRecipient,
  mockRunFleetGraphChat,
  mockIsFleetGraphReady,
} = vi.hoisted(() => ({
  mockResolveAlert: vi.fn(),
  mockGetAlertsByEntity: vi.fn(),
  mockGetActiveAlerts: vi.fn(),
  mockGetScheduler: vi.fn(),
  mockUpdateApprovalStatus: vi.fn(),
  mockGetPendingApprovals: vi.fn(),
  mockUpsertAlert: vi.fn(),
  mockInvokeGraph: vi.fn(),
  mockResumeGraph: vi.fn(),
  mockIsEntityAnalysisStale: vi.fn(),
  mockGetActiveThread: vi.fn(),
  mockGetThreadById: vi.fn(),
  mockCreateThread: vi.fn(),
  mockGetOrCreateActiveThread: vi.fn(),
  mockAppendChatMessage: vi.fn(),
  mockLoadRecentMessages: vi.fn(),
  mockUpdateThreadPageContext: vi.fn(),
  mockGetUserAlerts: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockMarkRecipientsRead: vi.fn(),
  mockDismissRecipient: vi.fn(),
  mockSnoozeRecipient: vi.fn(),
  mockRunFleetGraphChat: vi.fn(),
  mockIsFleetGraphReady: vi.fn(),
}));

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

vi.mock('../fleetgraph/runtime/index.js', () => ({
  resolveAlert: mockResolveAlert,
  getAlertsByEntity: mockGetAlertsByEntity,
  getActiveAlerts: mockGetActiveAlerts,
  getScheduler: () => mockGetScheduler(),
  updateApprovalStatus: mockUpdateApprovalStatus,
  getPendingApprovals: mockGetPendingApprovals,
  upsertAlert: mockUpsertAlert,
  invokeGraph: mockInvokeGraph,
  resumeGraph: mockResumeGraph,
  isEntityAnalysisStale: mockIsEntityAnalysisStale,
  buildQueueFingerprint: (workspaceId: string, entityType: string, entityId: string) =>
    `${workspaceId}:${entityType}:${entityId}`,
  getActiveThread: mockGetActiveThread,
  getThreadById: mockGetThreadById,
  createThread: mockCreateThread,
  getOrCreateActiveThread: mockGetOrCreateActiveThread,
  appendChatMessage: mockAppendChatMessage,
  loadRecentMessages: mockLoadRecentMessages,
  updateThreadPageContext: mockUpdateThreadPageContext,
  getUserAlerts: mockGetUserAlerts,
  getUnreadCount: mockGetUnreadCount,
  markRecipientsRead: mockMarkRecipientsRead,
  dismissRecipient: mockDismissRecipient,
  snoozeRecipient: mockSnoozeRecipient,
}));

vi.mock('../fleetgraph/bootstrap.js', () => ({
  isFleetGraphReady: () => mockIsFleetGraphReady(),
}));

vi.mock('../fleetgraph/chat/runtime.js', () => ({
  runFleetGraphChat: mockRunFleetGraphChat,
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
    readAt: null,
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

function makeChatGraphState(overrides: Partial<FleetGraphRunState> = {}): FleetGraphRunState {
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    mode: 'on_demand',
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    entityType: 'issue',
    entityId: 'iss-1',
    pageContext: null,
    coreContext: {},
    parallelSignals: {},
    candidates: [],
    branch: 'inform_only',
    assessment: {
      summary: 'Issue needs a quick follow-up',
      recommendation: 'Ping the assignee today',
      branch: 'inform_only',
      citations: ['history'],
    },
    gateOutcome: null,
    snoozeUntil: null,
    error: null,
    runStartedAt: Date.now(),
    tokenUsage: null,
    chatQuestion: null,
    chatHistory: null,
    traceUrl: null,
    trigger: 'on_demand',
    ...overrides,
  };
}

function makeChatRuntimeResult(
  overrides: Partial<FleetGraphChatRuntimeResult> = {},
): FleetGraphChatRuntimeResult {
  return {
    responseId: 'resp-1',
    traceUrl: null,
    steps: 1,
    assessment: {
      summary: 'Issue needs a quick follow-up',
      recommendation: 'Ping the assignee today',
      branch: 'inform_only',
      proposedAction: null,
      citations: ['history'],
    },
    message: {
      role: 'assistant',
      content: 'Issue needs a quick follow-up',
      assessment: {
        summary: 'Issue needs a quick follow-up',
        recommendation: 'Ping the assignee today',
        branch: 'inform_only',
        citations: ['history'],
      },
      timestamp: '2025-01-01T00:00:01.000Z',
    },
    toolCalls: [],
    rawOutputText: '',
    usage: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFleetGraphReady.mockReturnValue(true);
  mockIsEntityAnalysisStale.mockResolvedValue(true);
  mockGetUserAlerts.mockResolvedValue([]);
  mockGetUnreadCount.mockResolvedValue(0);
  mockDismissRecipient.mockResolvedValue(true);
  mockSnoozeRecipient.mockResolvedValue(true);
  mockMarkRecipientsRead.mockResolvedValue(0);
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
// POST /api/fleetgraph/page-view
// ===========================================================================

describe('POST /api/fleetgraph/page-view', () => {
  const app = createTestApp();

  it('returns triggered false when the entity is already queued', async () => {
    const enqueue = vi.fn().mockReturnValue(false);
    const hasPending = vi.fn().mockReturnValue(true);
    const processQueueImmediate = vi.fn().mockResolvedValue(undefined);

    mockGetScheduler.mockReturnValue({
      getQueue: () => ({ enqueue, hasPending }),
      processQueueImmediate,
    });

    const res = await request(app)
      .post('/api/fleetgraph/page-view')
      .send({ entityType: 'issue', entityId: 'iss-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      triggered: false,
      reason: 'analysis already queued',
    });
    expect(processQueueImmediate).not.toHaveBeenCalled();
  });

  it('returns triggered true and processes immediately when enqueue succeeds', async () => {
    const enqueue = vi.fn().mockReturnValue(true);
    const hasPending = vi.fn().mockReturnValue(false);
    const processQueueImmediate = vi.fn().mockResolvedValue(undefined);

    mockGetScheduler.mockReturnValue({
      getQueue: () => ({ enqueue, hasPending }),
      processQueueImmediate,
    });

    const res = await request(app)
      .post('/api/fleetgraph/page-view')
      .send({ entityType: 'issue', entityId: 'iss-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      triggered: true,
      reason: 'analysis enqueued',
    });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      mode: 'on_demand',
      entityType: 'issue',
      entityId: 'iss-1',
      trigger: 'page_view',
    }));
  });
});

// ===========================================================================
// POST /api/fleetgraph/chat
// ===========================================================================

interface FleetGraphThreadFixture {
  id: string;
  workspaceId: string;
  userId: string;
  status: string;
  lastPageRoute: string | null;
  lastPageSurface: string | null;
  lastPageDocumentId: string | null;
  lastPageTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

const makeThread = (overrides: Partial<FleetGraphThreadFixture> = {}): FleetGraphThreadFixture => ({
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
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValueOnce([]);
    mockAppendChatMessage.mockResolvedValue(undefined);
    mockRunFleetGraphChat.mockResolvedValueOnce(makeChatRuntimeResult({
      toolCalls: [
        {
          name: 'fetch_issue_context',
          callId: 'call-1',
          arguments: { issueId: 'iss-1' },
          result: {
            found: true,
            issue: {
              id: 'iss-1',
              title: 'Issue title',
            },
          },
        },
        {
          name: 'fetch_workspace_signals',
          callId: 'call-2',
          arguments: {},
          result: {
            found: true,
            accountability: { total: 2, overdue: 1, dueToday: 1 },
            managerActionItems: [{ employeeId: 'emp-1' }],
          },
        },
      ],
    }));
    mockGetAlertsByEntity.mockResolvedValue([]);

    const first = await request(app)
      .post('/api/fleetgraph/chat')
      .send({ entityType: 'issue', entityId: 'iss-1', workspaceId: 'ws-1', question: 'What changed?' });

    expect(first.status).toBe(200);
    expect(first.body.threadId).toBe('thread-1');
    expect(mockRunFleetGraphChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'issue',
        entityId: 'iss-1',
        question: 'What changed?',
        history: [],
      }),
    );

    mockGetThreadById.mockResolvedValueOnce(makeThread());
    mockLoadRecentMessages.mockResolvedValueOnce([
      { role: 'user', content: 'What changed?', timestamp: '2025-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Issue needs a quick follow-up', timestamp: '2025-01-01T00:00:01.000Z' },
    ]);
    mockRunFleetGraphChat.mockResolvedValueOnce(makeChatRuntimeResult({
      toolCalls: [
        {
          name: 'fetch_issue_context',
          callId: 'call-3',
          arguments: { issueId: 'iss-1' },
          result: {
            found: true,
            issue: {
              id: 'iss-1',
              title: 'Issue title',
            },
          },
        },
        {
          name: 'fetch_workspace_signals',
          callId: 'call-4',
          arguments: {},
          result: {
            found: true,
            accountability: { total: 2, overdue: 1, dueToday: 1 },
            managerActionItems: [{ employeeId: 'emp-1' }],
          },
        },
      ],
    }));

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
    expect(mockRunFleetGraphChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        question: 'Is it stale?',
        history: [
          expect.objectContaining({ role: 'user', content: 'What changed?' }),
          expect.objectContaining({ role: 'assistant', content: 'Issue needs a quick follow-up' }),
        ],
      }),
    );

    const secondCallRequest = mockRunFleetGraphChat.mock.calls[1]?.[0];
    expect(secondCallRequest.history.filter((msg: { content: string }) => msg.content === 'Is it stale?')).toHaveLength(0);
    expect(second.body.message.debug).toMatchObject({
      traceUrl: null,
      branch: 'inform_only',
      candidateSignals: [],
      accountability: {
        total: 2,
        overdue: 1,
        dueToday: 1,
      },
      managerActionItems: 1,
    });
    expect(second.body.message.debug.toolCalls).toEqual(expect.arrayContaining([
      {
        name: 'fetch_issue_context',
        arguments: { issueId: 'iss-1' },
      },
    ]));
  });

  it('accepts workspace chat scope and preserves the workspace entity type', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread({ id: 'thread-ws' }));
    mockLoadRecentMessages.mockResolvedValue([]);
    mockAppendChatMessage.mockResolvedValue(undefined);
    mockRunFleetGraphChat.mockResolvedValue(makeChatRuntimeResult({
      assessment: {
        summary: 'Workspace summary',
        recommendation: 'Monitor workspace',
        branch: 'inform_only',
        proposedAction: null,
        citations: ['workspace-signal'],
      },
      message: {
        role: 'assistant',
        content: 'Workspace summary',
        assessment: {
          summary: 'Workspace summary',
          recommendation: 'Monitor workspace',
          branch: 'inform_only',
          citations: ['workspace-signal'],
        },
        timestamp: '2025-01-01T00:00:01.000Z',
      },
    }));
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
    expect(mockRunFleetGraphChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityType: 'workspace',
        entityId: 'ws-1',
        question: 'What needs attention?',
      }),
    );
    expect(res.body.message.content).toBe('Workspace summary');
  });

  it('threads page context into graph invocation for chat turns', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValue([]);
    mockAppendChatMessage.mockResolvedValue(undefined);
    mockRunFleetGraphChat.mockResolvedValue(makeChatRuntimeResult({
      assessment: {
        summary: 'You are on the details page.',
        recommendation: 'Keep editing.',
        branch: 'inform_only',
        proposedAction: null,
        citations: ['page-context'],
      },
      message: {
        role: 'assistant',
        content: 'You are on the details page.',
        assessment: {
          summary: 'You are on the details page.',
          recommendation: 'Keep editing.',
          branch: 'inform_only',
          citations: ['page-context'],
        },
        timestamp: '2025-01-01T00:00:01.000Z',
      },
    }));
    mockGetAlertsByEntity.mockResolvedValue([]);

    const pageContext = {
      route: '/documents/proj-1/details',
      surface: 'project',
      title: 'Infrastructure - Bug Fixes',
      tab: 'details',
      tabLabel: 'Details',
    } as const;

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'project',
        entityId: 'proj-1',
        workspaceId: 'ws-1',
        question: 'what page im on',
        pageContext,
      });

    expect(res.status).toBe(200);
    expect(mockRunFleetGraphChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageContext,
      }),
    );
    expect(mockUpdateThreadPageContext).toHaveBeenCalledWith(
      expect.anything(),
      'thread-1',
      pageContext,
    );
  });

  it('returns confirm_action branch from graph assessment', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValue([]);
    mockAppendChatMessage.mockResolvedValue(undefined);
    mockRunFleetGraphChat.mockResolvedValue(makeChatRuntimeResult({
      assessment: {
        summary: 'This issue should be reassigned.',
        recommendation: 'Ask for approval to reassign.',
        branch: 'confirm_action',
        proposedAction: {
          actionType: 'reassign_issue',
          targetEntityType: 'issue',
          targetEntityId: 'iss-1',
          description: 'Reassign to a different owner.',
          payload: { assignee_id: 'user-2' },
        },
        citations: ['issue-context'],
      },
      message: {
        role: 'assistant',
        content: 'This issue should be reassigned.',
        assessment: {
          summary: 'This issue should be reassigned.',
          recommendation: 'Ask for approval to reassign.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'reassign_issue',
            targetEntityType: 'issue',
            targetEntityId: 'iss-1',
            description: 'Reassign to a different owner.',
            payload: { assignee_id: 'user-2' },
          },
          citations: ['issue-context'],
        },
        timestamp: '2025-01-01T00:00:01.000Z',
      },
    }));
    mockGetAlertsByEntity.mockResolvedValue([
      makeAlert({
        id: 'chat-alert-1',
        signalType: 'chat_suggestion',
        summary: 'This issue should be reassigned.',
        recommendation: 'Ask for approval to reassign.',
      }),
    ]);

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'issue',
        entityId: 'iss-1',
        workspaceId: 'ws-1',
        question: 'who should own this?',
      });

    expect(res.status).toBe(200);
    expect(res.body.branch).toBe('confirm_action');
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.message.alertId).toBe('chat-alert-1');
  });

  it('returns a trace URL on each chat call and persists it with the assistant message', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValue([]);
    mockAppendChatMessage.mockResolvedValue(undefined);
    mockRunFleetGraphChat.mockResolvedValue(makeChatRuntimeResult({
      traceUrl: 'https://smith.langchain.com/public/chat-run-1/r',
      assessment: {
        summary: 'Ticket says the API is timing out on save.',
        recommendation: 'Check the latest failing saves.',
        branch: 'inform_only',
        proposedAction: null,
        citations: ['issue-context'],
      },
      message: {
        role: 'assistant',
        content: 'Ticket says the API is timing out on save.',
        assessment: {
          summary: 'Ticket says the API is timing out on save.',
          recommendation: 'Check the latest failing saves.',
          branch: 'inform_only',
          citations: ['issue-context'],
        },
        timestamp: '2025-01-01T00:00:01.000Z',
      },
      toolCalls: [
        {
          name: 'fetch_issue_context',
          callId: 'call-1',
          arguments: { issueId: 'iss-1' },
          result: { found: true },
        },
      ],
    }));
    mockGetAlertsByEntity.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'issue',
        entityId: 'iss-1',
        workspaceId: 'ws-1',
        question: 'what he says in the ticket?',
      });

    expect(res.status).toBe(200);
    expect(res.body.traceUrl).toBe('https://smith.langchain.com/public/chat-run-1/r');
    expect(res.body.message.debug.traceUrl).toBe('https://smith.langchain.com/public/chat-run-1/r');
    expect(mockAppendChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'thread-1',
      'assistant',
      'Ticket says the API is timing out on save.',
      expect.anything(),
      expect.objectContaining({
        traceUrl: 'https://smith.langchain.com/public/chat-run-1/r',
      }),
      undefined,
      'https://smith.langchain.com/public/chat-run-1/r',
    );
  });

  it('returns 502 when the chat runtime fails instead of fabricating a healthy reply', async () => {
    mockGetOrCreateActiveThread.mockResolvedValue(makeThread());
    mockLoadRecentMessages.mockResolvedValue([]);
    mockRunFleetGraphChat.mockRejectedValue(new Error('invalid_function_parameters'));

    const res = await request(app)
      .post('/api/fleetgraph/chat')
      .send({
        entityType: 'workspace',
        entityId: 'ws-1',
        workspaceId: 'ws-1',
        question: 'give me one risk',
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('FleetGraph chat runtime failed');
    expect(mockAppendChatMessage).not.toHaveBeenCalled();
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
    expect(mockCreateThread).toHaveBeenCalledWith(expect.anything(), 'ws-1', 'user-1', undefined, undefined);
  });
});

// ===========================================================================
// GET /api/fleetgraph/alerts
// ===========================================================================

describe('GET /api/fleetgraph/alerts', () => {
  const app = createTestApp();

  it('returns alerts filtered by entity', async () => {
    mockGetUserAlerts.mockResolvedValue([
      makeAlert({ id: 'a1' }),
      makeAlert({ id: 'a2', workspaceId: 'ws-other' }),
    ]);
    mockGetUnreadCount.mockResolvedValue(1);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/fleetgraph/alerts')
      .query({ entityType: 'issue', entityId: 'iss-1' });

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.pendingApprovals).toEqual([]);
  });

  it('returns active alerts for workspace when no entity filter', async () => {
    mockGetUserAlerts.mockResolvedValue([makeAlert(), makeAlert({ id: 'a2' })]);
    mockGetUnreadCount.mockResolvedValue(2);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app).get('/api/fleetgraph/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.pendingApprovals).toEqual([]);
  });

  it('applies optional status filter', async () => {
    mockGetUserAlerts.mockResolvedValue([
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
    mockGetUserAlerts.mockResolvedValue([]);
    mockGetUnreadCount.mockResolvedValue(0);
    mockGetPendingApprovals.mockResolvedValue([]);

    const res = await request(app).get('/api/fleetgraph/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.pendingApprovals).toEqual([]);
  });
});

// ===========================================================================
// POST /api/fleetgraph/alerts/:id/resolve
// ===========================================================================

describe('POST /api/fleetgraph/alerts/:id/resolve', () => {
  const app = createTestApp();

  it('dismisses an alert (recipient-level)', async () => {
    mockDismissRecipient.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'dismiss' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDismissRecipient).toHaveBeenCalledWith(
      expect.anything(), 'alert-1', 'user-1',
    );
    // Dismiss is recipient-level; global resolveAlert should NOT be called
    expect(mockResolveAlert).not.toHaveBeenCalled();
  });

  it('snoozes an alert with duration (recipient-level)', async () => {
    mockSnoozeRecipient.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/alert-1/resolve')
      .send({ outcome: 'snooze', snoozeDurationMinutes: 120 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSnoozeRecipient).toHaveBeenCalledWith(
      expect.anything(), 'alert-1', 'user-1', expect.any(Date),
    );
    // Snooze is recipient-level; global resolveAlert should NOT be called
    expect(mockResolveAlert).not.toHaveBeenCalled();
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

  it('returns 404 when recipient not found for dismiss', async () => {
    mockDismissRecipient.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/fleetgraph/alerts/nonexistent/resolve')
      .send({ outcome: 'dismiss' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
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
