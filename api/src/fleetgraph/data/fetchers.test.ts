import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureFleetGraphData,
  executeShipAction,
  fetchActiveSprints,
  fetchCoreContext,
  fetchParallelSignals,
} from './fetchers.js';

const mockClientGet = vi.fn();
const mockClientPatch = vi.fn();
const mockPoolQuery = vi.fn();

describe('FleetGraph fetchers', () => {

  beforeEach(() => {
    mockClientGet.mockReset();
    mockClientPatch.mockReset();
    mockPoolQuery.mockReset();
    configureFleetGraphData(
      { query: mockPoolQuery } as never,
      {
        get: mockClientGet,
        patch: mockClientPatch,
        post: vi.fn(),
      } as never,
    );
    mockClientGet.mockResolvedValue([]);
  });

  it('builds workspace summary context for explicit workspace scope', async () => {
    mockClientGet.mockImplementation(async (path: string) => {
      if (path === '/api/weeks?status=active') {
        return [
          {
            id: 'sprint-1',
            title: 'Week 1',
            properties: {
              sprint_number: 1,
              status: 'active',
              owner_id: 'user-1',
            },
            created_at: '2026-03-17T00:00:00.000Z',
            updated_at: '2026-03-17T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const result = await fetchCoreContext('ws-1', 'workspace', 'ws-1');

    expect(result.entity).toMatchObject({
      id: 'ws-1',
      title: 'Workspace Summary',
      document_type: 'workspace',
    });
    expect(result.relatedEntities).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      workspaceId: 'ws-1',
      isWorkspaceSummary: true,
    });
  });

  it('normalizes wrapped weeks responses for active sprints', async () => {
    mockClientGet.mockResolvedValue({
      weeks: [
        {
          id: 'sprint-1',
          title: 'Week 1',
          properties: {
            sprint_number: 1,
            status: 'active',
            owner_id: 'user-1',
          },
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
        },
      ],
    });

    const result = await fetchActiveSprints({ get: mockClientGet } as never);

    expect(mockClientGet).toHaveBeenCalledWith('/api/weeks?status=active');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'sprint-1', title: 'Week 1' });
  });

  it('uses REST with forUserId for workspace-scoped accountability signals', async () => {
    mockClientGet.mockImplementation(async (path: string) => {
      if (path.includes('/api/accountability/action-items')) {
        return { items: [{ type: 'weekly_plan', targetId: 'project-1' }] };
      }
      if (path.includes('/api/accountability/manager-action-items')) {
        return { items: [{ employeeId: 'user-alice', overdueMinutes: 45 }] };
      }
      return [];
    });

    const result = await fetchParallelSignals(
      'ws-1',
      'project',
      'ws-1',
      'user-admin',
      null,
    );

    // Verify REST calls with forUserId param (not direct service imports)
    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/action-items?forUserId=user-admin',
    );
    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/manager-action-items?forUserId=user-admin',
    );
    expect(result.accountability).toBeTruthy();
    expect(result.managerActionItems).toEqual([
      expect.objectContaining({
        employeeId: 'user-alice',
        overdueMinutes: 45,
      }),
    ]);
  });

  it('falls back to the entity owner when proactive runs have no actor user', async () => {
    mockClientGet.mockResolvedValue({ items: [] });

    await fetchParallelSignals(
      'ws-1',
      'sprint',
      'sprint-1',
      null,
      'user-manager',
    );

    // Should use ownerUserId when actorUserId is null
    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/action-items?forUserId=user-manager',
    );
    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/manager-action-items?forUserId=user-manager',
    );
  });

  it('treats explicit workspace scope as workspace summary', async () => {
    mockClientGet.mockResolvedValue({ items: [] });

    await fetchParallelSignals(
      'ws-1',
      'workspace',
      'ws-1',
      'user-admin',
      null,
    );

    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/action-items?forUserId=user-admin',
    );
    expect(mockClientGet).toHaveBeenCalledWith(
      '/api/accountability/manager-action-items?forUserId=user-admin',
    );
    // Should not fetch issue history for workspace scope
    expect(mockClientGet).not.toHaveBeenCalledWith('/api/issues/ws-1/history');
  });

  describe('executeShipAction', () => {
    it('throws when client.patch returns null for reassign_issue', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // member exists
      mockClientPatch.mockResolvedValueOnce(null); // 404

      await expect(
        executeShipAction('ws-1', 'reassign_issue', 'issue', 'iss-missing', {
          assignee_id: 'user-2',
        }),
      ).rejects.toThrow('not found (404)');
    });

    it('throws when assignee is not a member of the workspace', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // no member

      await expect(
        executeShipAction('ws-1', 'reassign_issue', 'issue', 'iss-1', {
          assignee_id: 'user-nonexistent',
        }),
      ).rejects.toThrow('is not a member of workspace');
    });

    it('succeeds with valid user and non-null patch result', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // member exists
      mockClientPatch.mockResolvedValueOnce({ id: 'iss-1', assignee_id: 'user-2' });

      const result = await executeShipAction('ws-1', 'reassign_issue', 'issue', 'iss-1', {
        assignee_id: 'user-2',
      });

      expect(result).toEqual({
        success: true,
        message: 'Issue reassigned to user-2',
        payload: { assignee_id: 'user-2' },
      });
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('workspace_memberships'),
        ['ws-1', 'user-2'],
      );
      expect(mockClientPatch).toHaveBeenCalledWith(
        '/api/issues/iss-1',
        { assignee_id: 'user-2' },
      );
    });
  });
});
