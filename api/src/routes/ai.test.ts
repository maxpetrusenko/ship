import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockIsAiAvailable,
  mockAnalyzePlan,
  mockAnalyzeRetro,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockIsAiAvailable: vi.fn(),
  mockAnalyzePlan: vi.fn(),
  mockAnalyzeRetro: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = 'user-1';
    req.workspaceId = 'ws-1';
    next();
  },
}));

vi.mock('../services/ai-analysis.js', () => ({
  isAiAvailable: mockIsAiAvailable,
  analyzePlan: mockAnalyzePlan,
  analyzeRetro: mockAnalyzeRetro,
  checkRateLimit: mockCheckRateLimit,
}));

import aiRoutes from './ai.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);
  return app;
}

describe('AI routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
  });

  it('returns unavailable when OpenAI is not configured', async () => {
    mockIsAiAvailable.mockResolvedValue(false);

    const res = await request(app).get('/api/ai/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('returns available when OpenAI is configured', async () => {
    mockIsAiAvailable.mockResolvedValue(true);

    const res = await request(app).get('/api/ai/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });
});
