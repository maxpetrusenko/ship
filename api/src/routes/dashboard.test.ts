import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { mockPoolQuery, mockLoadContentFromYjsState } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLoadContentFromYjsState: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

vi.mock('../middleware/visibility.js', () => ({
  getVisibilityContext: vi.fn().mockResolvedValue({ isAdmin: false }),
  VISIBILITY_FILTER_SQL: vi.fn().mockReturnValue('1=1'),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'user-123';
    req.workspaceId = 'ws-123';
    next();
  }),
}));

vi.mock('../utils/yjsConverter.js', () => ({
  loadContentFromYjsState: mockLoadContentFromYjsState,
}));

import express from 'express';
import request from 'supertest';
import dashboardRouter from './dashboard.js';

function mockRows<Row extends object>(rows: Row[], rowCount = rows.length) {
  return { rows, rowCount };
}

describe('Dashboard API', () => {
  let app: express.Express;

  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockLoadContentFromYjsState.mockReset();
    app = express();
    app.use(express.json());
    app.use('/api/dashboard', dashboardRouter);
  });

  it('computes project status with a shared CTE instead of a correlated subquery per project', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(mockRows([{ sprint_start_date: '2025-01-06' }]))
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]));

    const res = await request(app).get('/api/dashboard/my-work');

    expect(res.status).toBe(200);

    const projectQuery = mockPoolQuery.mock.calls[2]?.[0];
    expect(projectQuery).toContain('WITH project_status AS');
    expect(projectQuery).toContain('LEFT JOIN project_status');
    expect(projectQuery).toContain('ps.inferred_status');
  });

  it('prefers persisted yjs_state content for my-week plan items', async () => {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];

    mockLoadContentFromYjsState.mockReturnValue({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Loaded from Yjs state' }],
                },
              ],
            },
          ],
        },
      ],
    });

    mockPoolQuery
      .mockResolvedValueOnce(mockRows([{ id: 'person-1', title: 'Dev User' }]))
      .mockResolvedValueOnce(mockRows([{ sprint_start_date: todayString }]))
      .mockResolvedValueOnce(mockRows([{
        id: 'plan-1',
        title: 'Week 1 Plan',
        content: {
          type: 'doc',
          content: [
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Stale content column' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        yjs_state: Buffer.from([1, 2, 3]),
        properties: { submitted_at: null },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]))
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([]));

    const res = await request(app).get('/api/dashboard/my-week?week_number=1');

    expect(res.status).toBe(200);
    expect(mockLoadContentFromYjsState).toHaveBeenCalledTimes(1);
    expect(res.body.plan.items).toEqual([{ text: 'Loaded from Yjs state', checked: false }]);
  });
});
