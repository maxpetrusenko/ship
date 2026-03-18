import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {
  verifyGitHubSignature,
  extractIssueRefs,
} from '../routes/github-webhook.js';

// -------------------------------------------------------------------------
// verifyGitHubSignature
// -------------------------------------------------------------------------

describe('verifyGitHubSignature', () => {
  const secret = 'test-secret-key';
  const body = JSON.stringify({ action: 'push' });

  function sign(payload: string, key: string): string {
    return 'sha256=' + crypto.createHmac('sha256', key).update(payload).digest('hex');
  }

  it('accepts a valid signature', () => {
    const sig = sign(body, secret);
    expect(verifyGitHubSignature(body, sig, secret)).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifyGitHubSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects an invalid signature', () => {
    expect(verifyGitHubSignature(body, 'sha256=invalid', secret)).toBe(false);
  });

  it('rejects a signature with wrong secret', () => {
    const sig = sign(body, 'wrong-secret');
    expect(verifyGitHubSignature(body, sig, secret)).toBe(false);
  });

  it('accepts Buffer input', () => {
    const buf = Buffer.from(body);
    const sig = sign(body, secret);
    expect(verifyGitHubSignature(buf, sig, secret)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// extractIssueRefs
// -------------------------------------------------------------------------

describe('extractIssueRefs', () => {
  it('extracts #123 ticket numbers', () => {
    const refs = extractIssueRefs('fix #42 and close #99');
    expect(refs.ticketNumbers).toContain(42);
    expect(refs.ticketNumbers).toContain(99);
    expect(refs.uuids).toHaveLength(0);
  });

  it('extracts SHP-456 prefixed refs', () => {
    const refs = extractIssueRefs('relates to SHP-456 and shp-789');
    expect(refs.ticketNumbers).toContain(456);
    expect(refs.ticketNumbers).toContain(789);
  });

  it('extracts UUIDs', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const refs = extractIssueRefs(`updating issue ${uuid}`);
    expect(refs.uuids).toContain(uuid);
    expect(refs.ticketNumbers).toHaveLength(0);
  });

  it('deduplicates references', () => {
    const refs = extractIssueRefs('fix #42, also #42, SHP-42');
    expect(refs.ticketNumbers).toEqual([42]);
  });

  it('handles empty text', () => {
    const refs = extractIssueRefs('');
    expect(refs.ticketNumbers).toHaveLength(0);
    expect(refs.uuids).toHaveLength(0);
  });

  it('handles text with no refs', () => {
    const refs = extractIssueRefs('just a regular commit message');
    expect(refs.ticketNumbers).toHaveLength(0);
    expect(refs.uuids).toHaveLength(0);
  });

  it('extracts mixed refs', () => {
    const uuid = 'deadbeef-1234-5678-9abc-def012345678';
    const refs = extractIssueRefs(`fix #10, SHP-20, and ${uuid}`);
    expect(refs.ticketNumbers).toContain(10);
    expect(refs.ticketNumbers).toContain(20);
    expect(refs.uuids).toContain(uuid);
  });
});

// -------------------------------------------------------------------------
// githubWebhookRoutes
// -------------------------------------------------------------------------

describe('githubWebhookRoutes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_WEBHOOK_SECRET: 'test-secret-key',
      FLEETGRAPH_WORKSPACE_ID: 'ws-1',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.doUnmock('../db/client.js');
    vi.doUnmock('../fleetgraph/runtime/index.js');
  });

  function sign(payload: string): string {
    return 'sha256=' + crypto
      .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET!)
      .update(payload)
      .digest('hex');
  }

  async function createWebhookApp(options: {
    queryRows?: Array<Record<string, unknown>>;
    enqueueReturn?: boolean;
  } = {}) {
    const queue = {
      enqueue: vi.fn().mockReturnValue(options.enqueueReturn ?? true),
    };
    const scheduler = {
      getQueue: () => queue,
      processQueueImmediate: vi.fn().mockResolvedValue(undefined),
    };
    const query = vi.fn().mockResolvedValue({ rows: options.queryRows ?? [] });

    vi.doMock('../db/client.js', () => ({
      pool: { query },
    }));
    vi.doMock('../fleetgraph/runtime/index.js', () => ({
      getScheduler: () => scheduler,
    }));

    const { githubWebhookRoutes } = await import('../routes/github-webhook.js');

    const app = express();
    app.use(express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }));
    app.use('/api/webhooks/github', githubWebhookRoutes);

    return { app, queue, scheduler, query };
  }

  it('resolves ticket refs inside the configured workspace only', async () => {
    const { app, queue, query } = await createWebhookApp({
      queryRows: [{ id: 'issue-uuid-42' }],
    });
    const payload = JSON.stringify({
      pull_request: {
        title: 'Fix SHP-42',
        body: 'Refs #42',
      },
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-Hub-Signature-256', sign(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: true, enqueued: 1 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('workspace_id = $1'),
      ['ws-1', [42], []],
    );
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      entityType: 'issue',
      entityId: 'issue-uuid-42',
      trigger: 'github_webhook',
    }));
  });

  it('ignores UUID refs that do not resolve to workspace issues', async () => {
    const { app, queue, query } = await createWebhookApp({
      queryRows: [],
    });
    const uuid = 'deadbeef-1234-5678-9abc-def012345678';
    const payload = JSON.stringify({
      commits: [{ message: `relates to ${uuid}` }],
    });

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'push')
      .set('X-Hub-Signature-256', sign(payload))
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: false, reason: 'no issue refs found' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('document_type = \'issue\''),
      ['ws-1', [], [uuid]],
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
