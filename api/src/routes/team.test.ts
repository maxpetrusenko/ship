import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
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

import express from 'express';
import request from 'supertest';
import teamRouter from './team.js';

function mockRows<Row extends object>(rows: Row[], rowCount = rows.length) {
  return { rows, rowCount };
}

describe('Team API', () => {
  let app: express.Express;

  beforeEach(() => {
    mockPoolQuery.mockReset();
    app = express();
    app.use(express.json());
    app.use('/api/team', teamRouter);
  });

  it('bounds the team grid issue query by sprint_number range', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(mockRows([]))
      .mockResolvedValueOnce(mockRows([{ sprint_start_date: '2025-01-06' }]))
      .mockResolvedValueOnce(mockRows([]));

    const res = await request(app).get('/api/team/grid?fromSprint=3&toSprint=5');

    expect(res.status).toBe(200);

    const issueQueryCall = mockPoolQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM documents i'),
    );

    expect(issueQueryCall?.[0]).toContain("(s.properties->>'sprint_number')::int BETWEEN $4 AND $5");
    expect(issueQueryCall?.[1]).toEqual(['ws-123', 'user-123', false, 3, 5]);
  });
});
