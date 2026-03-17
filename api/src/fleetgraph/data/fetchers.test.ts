import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissingAccountabilityItem } from '../../services/accountability.js';
import type { ManagerActionItem } from './types.js';

const mockCheckMissingAccountability = vi.fn<(userId: string, workspaceId: string) => Promise<MissingAccountabilityItem[]>>();
const mockGetManagerActionItems = vi.fn<(userId: string, workspaceId: string) => Promise<ManagerActionItem[]>>();

vi.mock('../../services/accountability.js', () => ({
  checkMissingAccountability: (...args: [string, string]) => mockCheckMissingAccountability(...args),
  getManagerActionItems: (...args: [string, string]) => mockGetManagerActionItems(...args),
}));

import { configureFleetGraphData, fetchCoreContext, fetchParallelSignals } from './fetchers.js';

const mockClientGet = vi.fn();

describe('FleetGraph fetchers', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    configureFleetGraphData(
      {} as never,
      {
        get: mockClientGet,
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

  it('uses the current actor for workspace-scoped accountability signals', async () => {
    mockCheckMissingAccountability.mockResolvedValue([
      {
        type: 'weekly_plan',
        targetId: 'project-1',
        targetTitle: 'Week 12 Plan - Core Project',
        targetType: 'project',
        dueDate: '2026-03-17',
        message: 'Write week 12 plan for Core Project',
        personId: 'person-1',
        projectId: 'project-1',
        weekNumber: 12,
      },
    ]);
    mockGetManagerActionItems.mockResolvedValue([
      {
        employeeName: 'Alice',
        employeeId: 'user-alice',
        dueTime: '2026-03-17T09:00:00Z',
        overdueMinutes: 45,
        sprintId: 'sprint-1',
        sprintTitle: 'Week 12',
        projectId: 'project-1',
        projectTitle: 'Core Project',
      },
    ]);

    const result = await fetchParallelSignals(
      'ws-1',
      'project',
      'ws-1',
      'user-admin',
      null,
    );

    expect(mockCheckMissingAccountability).toHaveBeenCalledWith('user-admin', 'ws-1');
    expect(mockGetManagerActionItems).toHaveBeenCalledWith('user-admin', 'ws-1');
    expect(result.accountability).toMatchObject({
      items: [
        expect.objectContaining({
          accountability_type: 'weekly_plan',
          days_overdue: 0,
        }),
      ],
    });
    expect(result.managerActionItems).toEqual([
      expect.objectContaining({
        employeeId: 'user-alice',
        overdueMinutes: 45,
      }),
    ]);
  });

  it('falls back to the entity owner when proactive runs have no actor user', async () => {
    mockCheckMissingAccountability.mockResolvedValue([]);
    mockGetManagerActionItems.mockResolvedValue([]);

    await fetchParallelSignals(
      'ws-1',
      'sprint',
      'sprint-1',
      null,
      'user-manager',
    );

    expect(mockCheckMissingAccountability).toHaveBeenCalledWith('user-manager', 'ws-1');
    expect(mockGetManagerActionItems).toHaveBeenCalledWith('user-manager', 'ws-1');
  });

  it('treats explicit workspace scope as workspace summary', async () => {
    mockCheckMissingAccountability.mockResolvedValue([]);
    mockGetManagerActionItems.mockResolvedValue([]);

    await fetchParallelSignals(
      'ws-1',
      'workspace',
      'ws-1',
      'user-admin',
      null,
    );

    expect(mockCheckMissingAccountability).toHaveBeenCalledWith('user-admin', 'ws-1');
    expect(mockGetManagerActionItems).toHaveBeenCalledWith('user-admin', 'ws-1');
    expect(mockClientGet).not.toHaveBeenCalledWith('/api/issues/ws-1/history');
  });
});
