import { describe, expect, it, vi } from 'vitest';
import { getUnreadCount, getUserAlerts } from './persistence.js';

function makePool(rows: unknown[] = [{ cnt: '0' }]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

describe('FleetGraph persistence alert visibility', () => {
  it('getUserAlerts only returns active alerts', async () => {
    const pool = makePool([
      {
        id: 'alert-1',
        workspace_id: 'ws-1',
        fingerprint: 'fp-1',
        signal_type: 'chat_suggestion',
        entity_type: 'issue',
        entity_id: 'iss-1',
        severity: 'medium',
        summary: 'Escalate issue priority',
        recommendation: 'Move this to high priority.',
        citations: '[]',
        owner_user_id: null,
        status: 'active',
        snoozed_until: null,
        last_surfaced_at: new Date('2026-03-18T18:56:03.000Z'),
        created_at: new Date('2026-03-18T18:56:03.000Z'),
        updated_at: new Date('2026-03-18T18:56:03.000Z'),
        recipient_read_at: null,
      },
    ]);

    await getUserAlerts(pool as never, 'user-1', 'ws-1');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(`AND a.status = 'active'`),
      ['user-1', 'ws-1'],
    );
  });

  it('getUnreadCount ignores resolved alerts', async () => {
    const pool = makePool([{ cnt: '1' }]);

    const unreadCount = await getUnreadCount(pool as never, 'user-1', 'ws-1');

    expect(unreadCount).toBe(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(`AND a.status = 'active'`),
      ['user-1', 'ws-1'],
    );
  });
});
