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

describe('createFleetGraphChatDataAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
