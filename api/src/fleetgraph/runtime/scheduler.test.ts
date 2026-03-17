import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ShipIssueSummary, ShipSprint } from '../data/types.js';
import { FleetGraphScheduler } from './scheduler.js';
import { computeFleetGraphEntityDigest } from './digest.js';

const mockFetchActiveSprints = vi.fn();
const mockFetchIssues = vi.fn();
const mockCleanExpiredSnoozed = vi.fn();
const mockExpirePendingApprovals = vi.fn();
const mockGetEntityDigest = vi.fn();
const mockSetEntityDigest = vi.fn();

vi.mock('../data/fetchers.js', () => ({
  fetchActiveSprints: (...args: unknown[]) => mockFetchActiveSprints(...args),
  fetchIssues: (...args: unknown[]) => mockFetchIssues(...args),
}));

vi.mock('./persistence.js', () => ({
  cleanExpiredSnoozed: (...args: unknown[]) => mockCleanExpiredSnoozed(...args),
  expirePendingApprovals: (...args: unknown[]) => mockExpirePendingApprovals(...args),
  getEntityDigest: (...args: unknown[]) => mockGetEntityDigest(...args),
  setEntityDigest: (...args: unknown[]) => mockSetEntityDigest(...args),
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

describe('FleetGraphScheduler Phase 3A', () => {
  const pool = { query: vi.fn() } as unknown as pg.Pool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCleanExpiredSnoozed.mockResolvedValue(0);
    mockExpirePendingApprovals.mockResolvedValue(0);
    mockFetchActiveSprints.mockResolvedValue([]);
    mockFetchIssues.mockResolvedValue([]);
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

    const digest = computeFleetGraphEntityDigest('sprint', sprint);
    mockGetEntityDigest.mockResolvedValue(digest);

    await (scheduler as any).sweep();

    expect(mockGetEntityDigest).toHaveBeenCalledWith(pool, 'ws-1', 'sprint', 'sprint-1');
    expect((scheduler as any).queue.size).toBe(0);
  });

  it('persists digest after a successful proactive run', async () => {
    const sprint = makeSprint();
    const issue = makeIssue();
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    mockFetchIssues.mockResolvedValue([issue]);
    const invoke = vi.fn().mockResolvedValue({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());

    await (scheduler as any).sweep();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'sprint',
      'sprint-1',
      computeFleetGraphEntityDigest('sprint', sprint),
    );
    expect(mockSetEntityDigest).toHaveBeenCalledWith(
      pool,
      'ws-1',
      'issue',
      'issue-1',
      computeFleetGraphEntityDigest('issue', issue),
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

    await (scheduler as any).sweep();

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

    await (scheduler as any).sweep();

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

  it('requeues failed proactive runs with bounded backoff', async () => {
    const sprint = makeSprint();
    mockFetchActiveSprints.mockResolvedValue([sprint]);
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream 429'))
      .mockResolvedValueOnce({});
    const scheduler = new FleetGraphScheduler(pool, { invoke }, vi.fn());

    await (scheduler as any).sweep();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect((scheduler as any).queue.size).toBe(1);

    const queued = Array.from((scheduler as any).queue.pending.values())[0];
    expect(queued?.attempt).toBe(1);
    expect(queued?.availableAt).toBeGreaterThan(Date.now());

    (scheduler as any).queue.clear();
    (scheduler as any).queue.enqueue({
      workspaceId: queued!.workspaceId,
      mode: queued!.mode,
      entityType: queued!.entityType,
      entityId: queued!.entityId,
      attempt: queued!.attempt,
      availableAt: Date.now() - 1,
      digest: queued!.digest,
    });

    await (scheduler as any).processQueue();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(mockSetEntityDigest).toHaveBeenCalledTimes(1);
  });
});
