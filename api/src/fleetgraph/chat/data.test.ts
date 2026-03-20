import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolQuery = vi.fn();
const mockGetVisibilityContext = vi.fn();
const mockCheckMissingAccountability = vi.fn();
const mockGetManagerActionItems = vi.fn();
const mockLegacyFetchIssue = vi.fn();
const mockLegacyFetchIssueChildren = vi.fn();
const mockLegacyFetchIssueHistory = vi.fn();
const mockLegacyFetchDocumentAssociations = vi.fn();
const mockLegacyFetchProject = vi.fn();
const mockLegacyFetchSprintContext = vi.fn();
const mockLegacyFetchActiveSprints = vi.fn();
const mockLegacyFetchAllSprints = vi.fn();
const mockLegacyFetchAccountabilityItems = vi.fn();

vi.mock('../../db/client.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

vi.mock('../../middleware/visibility.js', () => ({
  getVisibilityContext: (...args: unknown[]) => mockGetVisibilityContext(...args),
  VISIBILITY_FILTER_SQL: () => 'TRUE',
}));

vi.mock('../../services/accountability.js', () => ({
  checkMissingAccountability: (...args: unknown[]) => mockCheckMissingAccountability(...args),
  getManagerActionItems: (...args: unknown[]) => mockGetManagerActionItems(...args),
}));

vi.mock('../data/index.js', () => ({
  fetchIssue: (...args: unknown[]) => mockLegacyFetchIssue(...args),
  fetchIssueChildren: (...args: unknown[]) => mockLegacyFetchIssueChildren(...args),
  fetchIssueHistory: (...args: unknown[]) => mockLegacyFetchIssueHistory(...args),
  fetchDocumentAssociations: (...args: unknown[]) => mockLegacyFetchDocumentAssociations(...args),
  fetchProject: (...args: unknown[]) => mockLegacyFetchProject(...args),
  fetchSprintContext: (...args: unknown[]) => mockLegacyFetchSprintContext(...args),
  fetchActiveSprints: (...args: unknown[]) => mockLegacyFetchActiveSprints(...args),
  fetchAllSprints: (...args: unknown[]) => mockLegacyFetchAllSprints(...args),
  fetchAccountabilityItems: (...args: unknown[]) => mockLegacyFetchAccountabilityItems(...args),
}));

import { createFleetGraphChatDataAccess } from './data.js';
import { callShipApiAsUser } from './user-api.js';

describe('createFleetGraphChatDataAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mockGetVisibilityContext.mockResolvedValue({ isAdmin: false });
    mockLegacyFetchIssue.mockRejectedValue(new Error('legacy fetchIssue path should not run'));
    mockLegacyFetchIssueChildren.mockRejectedValue(new Error('legacy fetchIssueChildren path should not run'));
    mockLegacyFetchIssueHistory.mockRejectedValue(new Error('legacy fetchIssueHistory path should not run'));
    mockLegacyFetchDocumentAssociations.mockRejectedValue(new Error('legacy fetchDocumentAssociations path should not run'));
    mockLegacyFetchProject.mockRejectedValue(new Error('legacy fetchProject path should not run'));
    mockLegacyFetchSprintContext.mockRejectedValue(new Error('legacy fetchSprintContext path should not run'));
    mockLegacyFetchActiveSprints.mockRejectedValue(new Error('legacy fetchActiveSprints path should not run'));
    mockLegacyFetchAllSprints.mockRejectedValue(new Error('legacy fetchAllSprints path should not run'));
    mockLegacyFetchAccountabilityItems.mockRejectedValue(new Error('legacy fetchAccountabilityItems path should not run'));
  });

  it('returns not found for an issue outside the caller visibility scope', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const data = createFleetGraphChatDataAccess();
    const result = await data.fetchIssueContext(
      {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'issue',
        entityId: 'iss-private',
        pageContext: null,
      },
      { issueId: 'iss-private' },
    );

    expect(result).toEqual({
      found: false,
      entityType: 'issue',
      issueId: 'iss-private',
    });
    expect(mockGetVisibilityContext).toHaveBeenCalledWith('user-1', 'ws-1');
    expect(mockPoolQuery).toHaveBeenCalled();
    expect(mockLegacyFetchIssue).not.toHaveBeenCalled();
  });

  it('derives workspace signals from per-user accountability helpers', async () => {
    mockCheckMissingAccountability.mockResolvedValue([
      {
        type: 'standup',
        targetId: 'sprint-1',
        targetTitle: 'Week 1',
        targetType: 'sprint',
        dueDate: '2026-03-17',
        message: 'Post standup',
      },
    ]);
    mockGetManagerActionItems.mockResolvedValue([
      {
        employeeId: 'user-2',
        employeeName: 'Teammate',
        dueTime: '2026-03-17T09:00:00.000Z',
        overdueMinutes: 120,
        sprintId: 'sprint-1',
        sprintTitle: 'Week 1',
        projectId: 'proj-1',
        projectTitle: 'Infra',
      },
    ]);
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          { sprint_start_date: '2026-03-10' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'sprint-1', title: 'Week 1', properties: { status: 'active' } },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'sprint-1', title: 'Week 1', properties: { status: 'active' } },
          { id: 'sprint-2', title: 'Week 2', properties: { status: 'planned' } },
        ],
      });

    const data = createFleetGraphChatDataAccess();
    const result = await data.fetchWorkspaceSignals(
      {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'workspace',
        entityId: 'ws-1',
        pageContext: null,
      },
      {},
    );

    expect(result).toMatchObject({
      found: true,
      workspaceId: 'ws-1',
      accountability: {
        total: 1,
      },
      sprintCount: 2,
    });
    expect(mockCheckMissingAccountability).toHaveBeenCalledWith('user-1', 'ws-1');
    expect(mockGetManagerActionItems).toHaveBeenCalledWith('user-1', 'ws-1');
    expect(mockLegacyFetchAccountabilityItems).not.toHaveBeenCalled();
    expect(mockLegacyFetchActiveSprints).not.toHaveBeenCalled();
    expect(mockLegacyFetchAllSprints).not.toHaveBeenCalled();
  });

  it('loads current document body text from the active page document', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'iss-1',
        title: 'Create admin dashboard',
        document_type: 'issue',
        content: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'code is 123' }],
          }],
        },
        yjs_state: null,
      }],
    });

    const data = createFleetGraphChatDataAccess();
    const result = await data.fetchDocumentContent(
      {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'issue',
        entityId: 'iss-1',
        pageContext: {
          route: '/documents/iss-1',
          surface: 'issue',
          documentId: 'iss-1',
          title: 'Create admin dashboard',
        },
      },
      {},
    );

    expect(result).toEqual({
      found: true,
      documentId: 'iss-1',
      documentType: 'issue',
      title: 'Create admin dashboard',
      contentText: 'code is 123',
    });
  });

  it('returns project rollups with in-progress counts and overloaded assignees', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          title: 'North Star',
          properties: { plan: 'Tighten onboarding' },
          content: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'iss-1',
            title: 'Issue 1',
            ticket_number: 11,
            state: 'in_progress',
            priority: 'high',
            assignee_id: 'user-2',
            assignee_name: 'Taylor',
          },
          {
            id: 'iss-2',
            title: 'Issue 2',
            ticket_number: 12,
            state: 'in_progress',
            priority: 'medium',
            assignee_id: 'user-2',
            assignee_name: 'Taylor',
          },
          {
            id: 'iss-3',
            title: 'Issue 3',
            ticket_number: 13,
            state: 'in_progress',
            priority: 'medium',
            assignee_id: 'user-2',
            assignee_name: 'Taylor',
          },
          {
            id: 'iss-4',
            title: 'Issue 4',
            ticket_number: 14,
            state: 'in_progress',
            priority: 'low',
            assignee_id: 'user-2',
            assignee_name: 'Taylor',
          },
          {
            id: 'iss-5',
            title: 'Issue 5',
            ticket_number: 15,
            state: 'in_progress',
            priority: 'low',
            assignee_id: 'user-2',
            assignee_name: 'Taylor',
          },
          {
            id: 'iss-6',
            title: 'Issue 6',
            ticket_number: 16,
            state: 'done',
            priority: 'low',
            assignee_id: 'user-3',
            assignee_name: 'Jordan',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'sprint-1', title: 'Week 1', status: 'active', sprint_number: '1' },
          { id: 'sprint-2', title: 'Week 2', status: 'planned', sprint_number: '2' },
        ],
      });

    const data = createFleetGraphChatDataAccess();
    const result = await data.fetchProjectSummary(
      {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'project',
        entityId: 'proj-1',
        pageContext: null,
      },
      { projectId: 'proj-1' },
    );

    expect(result).toMatchObject({
      found: true,
      project: {
        id: 'proj-1',
        title: 'North Star',
      },
      counts: {
        total: 6,
        done: 1,
        in_progress: 5,
      },
      sprintCount: 2,
      overloadedAssignees: [
        {
          assigneeId: 'user-2',
          assigneeName: 'Taylor',
          activeCount: 5,
        },
      ],
    });
    expect(result.assigneeLoads?.[0]).toMatchObject({
      assigneeId: 'user-2',
      activeCount: 5,
    });
  });

  it('calls Ship API with a user-scoped bearer token', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [1] }), { status: 200 }));

    const result = await callShipApiAsUser({
      context: {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'project',
        entityId: 'proj-1',
        pageContext: null,
      },
      method: 'GET',
      path: '/api/documents',
      bodyJson: null,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      method: 'GET',
      path: '/api/documents',
      data: { items: [1] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('http://localhost:3000/api/documents');
    expect((call?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Bearer ship_/),
    });
  });

  it('grounds project context drift in related issue titles before claiming no drift', async () => {
    const projectRow = {
      id: 'proj-1',
      title: 'Authentication - Bug Fixes',
      properties: { plan: 'Resolve auth defects to improve retention and reduce support costs.' },
      content: null,
    };
    mockPoolQuery
      // 1: loadVisibleProject (top-level)
      .mockResolvedValueOnce({ rows: [projectRow] })
      // 2: loadProjectRetroContext → loadVisibleProject (internal)
      .mockResolvedValueOnce({ rows: [projectRow] })
      // 3: loadProjectIssues (top-level) — issue titles for drift detection
      .mockResolvedValueOnce({
        rows: [
          { id: 'iss-1', title: 'Add auth tests', state: 'todo', ticket_number: 7 },
        ],
      })
      // 4-7: loadProjectRetroContext inner Promise.all (program, sprints, issues, retro)
      .mockResolvedValueOnce({ rows: [] })  // program
      .mockResolvedValueOnce({ rows: [] })  // sprints
      .mockResolvedValueOnce({ rows: [] })  // issues (retro)
      .mockResolvedValueOnce({ rows: [] }); // retro doc

    const data = createFleetGraphChatDataAccess();
    const result = await data.fetchProjectContext(
      {
        workspaceId: 'ws-1',
        userId: 'user-1',
        threadId: 'thread-1',
        entityType: 'project',
        entityId: 'proj-1',
        pageContext: null,
      },
      { projectId: 'proj-1' },
    );

    expect(result).toMatchObject({
      found: true,
      project: {
        id: 'proj-1',
        title: 'Authentication - Bug Fixes',
      },
      drift: {
        scopeDrift: false,
        evidence: {
          title: 'Authentication - Bug Fixes',
          plan: 'Resolve auth defects to improve retention and reduce support costs.',
        },
      },
    });
  });
});
