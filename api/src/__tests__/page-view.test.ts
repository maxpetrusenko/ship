import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isEntityAnalysisStale } from '../fleetgraph/runtime/persistence.js';

// Mock pg.Pool
function createMockPool(rows: Array<Record<string, unknown>> = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as import('pg').Pool;
}

describe('isEntityAnalysisStale', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when no audit log entries exist', async () => {
    const pool = createMockPool([]);
    const result = await isEntityAnalysisStale(pool, 'ws-1', 'issue', 'issue-1');
    expect(result).toBe(true);
  });

  it('returns true when last run is older than 15 minutes', async () => {
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const pool = createMockPool([{ created_at: twentyMinAgo }]);
    const result = await isEntityAnalysisStale(pool, 'ws-1', 'issue', 'issue-1');
    expect(result).toBe(true);
  });

  it('returns false when last run is within 15 minutes', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const pool = createMockPool([{ created_at: fiveMinAgo }]);
    const result = await isEntityAnalysisStale(pool, 'ws-1', 'issue', 'issue-1');
    expect(result).toBe(false);
  });

  it('respects custom threshold', async () => {
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const pool = createMockPool([{ created_at: threeMinAgo }]);

    // 2 minute threshold: 3 min ago should be stale
    const stale = await isEntityAnalysisStale(pool, 'ws-1', 'issue', 'issue-1', 2 * 60 * 1000);
    expect(stale).toBe(true);

    // 5 minute threshold: 3 min ago should be fresh
    const fresh = await isEntityAnalysisStale(pool, 'ws-1', 'issue', 'issue-1', 5 * 60 * 1000);
    expect(fresh).toBe(false);
  });

  it('queries the correct table and parameters', async () => {
    const pool = createMockPool([]);
    await isEntityAnalysisStale(pool, 'ws-1', 'sprint', 'sprint-42');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('fleetgraph_audit_log'),
      ['ws-1', 'sprint', 'sprint-42'],
    );
  });
});
