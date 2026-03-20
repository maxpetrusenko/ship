import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ShipIssueSummary, ShipProject, ShipSprint } from '../data/types.js';
import { FleetGraphScheduler } from './scheduler.js';
import { computeFleetGraphEntityDigest } from './digest.js';
import type { FleetGraphQueue, FleetGraphQueueItem } from './queue.js';
import type {
  fetchActiveSprints,
  fetchDocumentAssociations,
  fetchIssues,
  fetchProject,
} from '../data/fetchers.js';
import type {
  cleanExpiredSnoozed,
  expirePendingApprovals,
  getEntityDigest,
  setEntityDigest,
} from './persistence.js';

const mockFetchActiveSprints = vi.fn();
const mockFetchDocumentAssociations = vi.fn();
const mockFetchIssues = vi.fn();
const mockFetchProject = vi.fn();
const mockCleanExpiredSnoozed = vi.fn();
const mockExpirePendingApprovals = vi.fn();
const mockGetEntityDigest = vi.fn();
const mockSetEntityDigest = vi.fn();

vi.mock('../data/fetchers.js', () => ({
  fetchActiveSprints: (...args: Parameters<typeof fetchActiveSprints>) =>
    mockFetchActiveSprints(...args),
  fetchDocumentAssociations: (...args: Parameters<typeof fetchDocumentAssociations>) =>
    mockFetchDocumentAssociations(...args),
  fetchIssues: (...args: Parameters<typeof fetchIssues>) => mockFetchIssues(...args),
  fetchProject: (...args: Parameters<typeof fetchProject>) => mockFetchProject(...args),
}));

vi.mock('./persistence.js', () => ({
  cleanExpiredSnoozed: (...args: Parameters<typeof cleanExpiredSnoozed>) =>
    mockCleanExpiredSnoozed(...args),
  expirePendingApprovals: (...args: Parameters<typeof expirePendingApprovals>) =>
    mockExpirePendingApprovals(...args),
  getEntityDigest: (...args: Parameters<typeof getEntityDigest>) =>
    mockGetEntityDigest(...args),
  setEntityDigest: (...args: Parameters<typeof setEntityDigest>) =>
    mockSetEntityDigest(...args),
}));

function makeSprint(overrides: Partial<ShipSprint> = {}): ShipSprint {
  return {
    id: 'sprint-1',
    title: 'Sprint 1',
    properties: {
      sprint_number: 1,
      status: 'active',
      owner_id: 'user-1',
    },
    created_at: '2026-03-17T00:00:00.000Z',
    updated_at: '2026-03-17T00:00:00.000Z',
    ...overrides,
  } as ShipSprint;
}

function makeIssue(overrides: Partial<ShipIssueSummary> = {}): ShipIssueSummary {
  return {
    id: 'issue-1',
    title: 'Issue 1',
    state: 'in_progress',
    priority: 'high',
    assignee_id: 'user-1',
    ticket_number: 1,
    display_id: 'SHIP-1',
    updated_at: '2026-03-17T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    belongs_to: [],
    ...overrides,
  };
}

function makeProjectBelongsTo(
  id: string,
  title: string,
): ShipIssueSummary['belongs_to'][number] {
  return {
    id,
    title,
    type: 'project',
  };
}

function makeProject(overrides: Partial<ShipProject> = {}): ShipProject {
  return {
    id: 'project-1',
    title: 'Project 1',
    document_type: 'project',
    properties: {
      owner_id: 'user-1',
    },
    content: {},
    created_at: '2026-03-17T00:00:00.000Z',
    updated_at: '2026-03-17T00:00:00.000Z',
    created_by: 'user-1',
    belongs_to: [],
    ...overrides,
  } as ShipProject;
}

interface SchedulerTestHarness {
  sweep(): Promise<void>;
  processQueue(): Promise<void>;
  queue: FleetGraphQueue;
}

interface QueueTestHarness {
  pending: Map<string, FleetGraphQueueItem>;
}

describe('FleetGraphScheduler Phase 3A', () => {
  const pool = { query: vi.fn() } as Partial<pg.Pool> as pg.Pool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCleanExpiredSnoozed.mockResolvedValue(0);
    mockExpirePendingApprovals.mockResolvedValue(0);
    mockFetchActiveSprints.mockResolvedValue([]);
    mockFetchDocumentAssociations.mockResolvedValue([]);
    mockFetchIssues.mockResolvedValue([]);
    mockFetchProject.mockResolvedValue(null);
    mockGetEntityDigest.mockResolvedValue(null);
    mockSetEntityDigest.mockResolvedValue(undefined);
    process.env.FLEETGRAPH_WORKSPACE_ID = 'ws-1';
  });

  it('skips proactive runs for unchanged sprint digests', async () => {
    const sprint = makeSprint();
    mockFetchActiveSprints.mockResolvedValue([sprint]);

    const scheduler = new FleetGraphScheduler(
      pool,
      { invoke: vi.fn().mockResolvedValue({}) as never },
      vi.fn(),
    );
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    const digest = computeFleetGraphEntityDigest('sprint', sprint);
    mockGetEntityDigest.mockResolvedValue(digest);

    await internals.sweep();

    expect(mockGetEntityDigest).toHaveBeenCalledWith(pool, 'ws-1', 'sprint', 'sprint-1');
    expect(internals.queue.size).toBe(0);
  });

  it('persists digest after a successful proactive run', async () => {
    const sprint = makeSprint();
    const issue = makeIssue({
      belongs_to: [{ id: 'project-1', type: 'project', title: 'Project 1' }],
    });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issue]);
    mockFetchProject.mockResolvedValue(
      makeProject({ id: 'project-1', title: 'Project 1' }),
    );
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'sprint',
      'sprint-1',
      computeFleetGraphEntityDigest('sprint', {
        sprint,
        issues: [issue],
        projectIds: ['project-1'],
      }),
    );
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'issue',
      'issue-1',
      computeFleetGraphEntityDigest('issue', issue),
    );
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'project',
      'project-1',
      computeFleetGraphEntityDigest('project', {
        projectId: 'project-1',
        issues: [issue],
        sprintIds: ['sprint-1'],
      }),
    );
  });

  it('enqueues and processes proactive issue runs alongside sprint runs', async () => {
    const sprint = makeSprint({ id: 'sprint-2', title: 'Sprint 2' });
    const issueOne = makeIssue({ id: 'issue-2', title: 'Issue 2' });
    const issueTwo = makeIssue({ id: 'issue-3', title: 'Issue 3' });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issueOne, issueTwo]);
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(mockFetchIssues).toHaveBeenCalledWith(expect.anything(), { sprint_id: 'sprint-2' });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entityType: 'sprint', entityId: 'sprint-2' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-2' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-3' }),
    );
  });

  it('skips done issues during proactive issue fanout', async () => {
    const sprint = makeSprint({ id: 'sprint-3', title: 'Sprint 3' });
    const doneIssue = makeIssue({ id: 'issue-done', state: 'done' });
    const activeIssue = makeIssue({ id: 'issue-active', state: 'in_progress' });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([doneIssue, activeIssue]);
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entityType: 'sprint', entityId: 'sprint-3' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-active' }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-done' }),
    );
  });

  it('enqueues a linked project once after rolling up sprint issues', async () => {
    const sprint = makeSprint({ id: 'sprint-4', title: 'Sprint 4' });
    const issueOne = makeIssue({
      id: 'issue-4',
      belongs_to: [{ id: 'project-9', type: 'project', title: 'Project 9' }],
    });
    const issueTwo = makeIssue({
      id: 'issue-5',
      belongs_to: [{ id: 'project-9', type: 'project', title: 'Project 9' }],
    });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issueOne, issueTwo]);
    mockFetchProject.mockResolvedValue(
      makeProject({ id: 'project-9', title: 'Project 9' }),
    );
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entityType: 'sprint', entityId: 'sprint-4' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-4' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ entityType: 'issue', entityId: 'issue-5' }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ entityType: 'project', entityId: 'project-9' }),
    );
  });

  it('rolls active sprint sweep up to linked projects once per project', async () => {
    const sprint = makeSprint({ id: 'sprint-4', title: 'Sprint 4' });
    const projectBelongsTo = makeProjectBelongsTo('project-1', 'Auth Bug Fixes');
    const issueOne = makeIssue({
      id: 'issue-4',
      title: 'Fix login retry',
      belongs_to: [projectBelongsTo],
    });
    const issueTwo = makeIssue({
      id: 'issue-5',
      title: 'Fix session refresh',
      belongs_to: [projectBelongsTo],
    });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issueOne, issueTwo]);
    mockFetchProject.mockResolvedValue(
      makeProject({ id: 'project-1', title: 'Auth Bug Fixes' }),
    );
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'project', entityId: 'project-1' }),
    );
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'project',
      'project-1',
      expect.any(String),
    );
  });

  it('skips proactive project runs for unchanged linked project digests', async () => {
    const sprint = makeSprint({ id: 'sprint-5', title: 'Sprint 5' });
    const projectBelongsTo = makeProjectBelongsTo('project-2', 'Payments Stabilization');
    const issue = makeIssue({
      id: 'issue-6',
      title: 'Fix refund retries',
      belongs_to: [projectBelongsTo],
    });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issue]);
    mockFetchProject.mockResolvedValue(
      makeProject({ id: 'project-2', title: 'Payments Stabilization' }),
    );
    mockGetEntityDigest.mockImplementation(
      async (_poolArg, _workspaceId, entityType, entityId) => {
        if (entityType === 'project' && entityId === 'project-2') {
          return computeFleetGraphEntityDigest('project', {
            projectId: 'project-2',
            issues: [issue],
            sprintIds: ['sprint-5'],
          });
        }
        return null;
      },
    );
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'project', entityId: 'project-2' }),
    );
  });

  it('re-enqueues sprint sweep when issue membership changes even if sprint row is unchanged', async () => {
    const sprint = makeSprint({ id: 'sprint-membership', title: 'Sprint Membership' });
    const issue = makeIssue({
      id: 'issue-membership',
      title: 'Unexpected infra work',
      belongs_to: [makeProjectBelongsTo('project-membership', 'Bug Fixes')],
    });
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issue]);
    mockGetEntityDigest.mockImplementation(
      async (_poolArg, _workspaceId, entityType, entityId) => {
        if (entityType === 'sprint' && entityId === 'sprint-membership') {
          return computeFleetGraphEntityDigest('sprint', sprint);
        }
        return null;
      },
    );

    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'sprint', entityId: 'sprint-membership' }),
    );
  });

  it('rolls shared project scope up once across multiple active sprints', async () => {
    const sprintOne = makeSprint({ id: 'sprint-10', title: 'Sprint 10' });
    const sprintTwo = makeSprint({ id: 'sprint-11', title: 'Sprint 11' });
    const sharedProject = makeProjectBelongsTo('project-shared', 'Auth Hardening');
    const issueOne = makeIssue({ id: 'issue-10', title: 'Login bug', belongs_to: [sharedProject] });
    const issueTwo = makeIssue({ id: 'issue-11', title: 'Session bug', belongs_to: [sharedProject] });

    mockFetchActiveSprints.mockResolvedValue([sprintOne, sprintTwo]);
    mockFetchIssues
      .mockResolvedValueOnce([issueOne])
      .mockResolvedValueOnce([issueTwo]);
    mockFetchProject.mockResolvedValue(
      makeProject({ id: 'project-shared', title: 'Auth Hardening' }),
    );

    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(5);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'project', entityId: 'project-shared' }),
    );
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'project',
      'project-shared',
      computeFleetGraphEntityDigest('project', {
        projectId: 'project-shared',
        issues: [issueOne, issueTwo],
        sprintIds: ['sprint-10', 'sprint-11'],
      }),
    );
  });

  it('requeues failed proactive runs with bounded backoff', async () => {
    const sprint = makeSprint();
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream 429'))
      .mockResolvedValueOnce({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());
    const internals = scheduler as FleetGraphScheduler & SchedulerTestHarness;
    const queueInternals = internals.queue as FleetGraphQueue & QueueTestHarness;

    await internals.sweep();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(internals.queue.size).toBe(1);

    const queued = Array.from(queueInternals.pending.values())[0];
    expect(queued?.attempt).toBe(1);
    expect(queued?.availableAt).toBeGreaterThan(Date.now());

    internals.queue.clear();
    internals.queue.enqueue({
      workspaceId: queued!.workspaceId,
      mode: queued!.mode,
      entityType: queued!.entityType,
      entityId: queued!.entityId,
      attempt: queued!.attempt,
      availableAt: Date.now() - 1,
      digest: queued!.digest,
    });

    await internals.processQueue();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(mockSetEntityDigest).toHaveBeenCalledTimes(1);
  });
});
