/**
 * GitHub webhook route for FleetGraph.
 * Receives push and pull_request events, extracts issue references,
 * resolves them to Ship document UUIDs, and enqueues FleetGraph analysis runs.
 *
 * Security: HMAC-SHA256 signature verification via GITHUB_WEBHOOK_SECRET.
 * No session auth or CSRF (webhook uses its own signature verification).
 */
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { getScheduler } from '../fleetgraph/runtime/index.js';

const router = Router();

// -------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// -------------------------------------------------------------------------

/**
 * Verify the GitHub webhook HMAC-SHA256 signature.
 * Returns true if the signature is valid.
 */
export function verifyGitHubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------
// Issue reference extraction
// -------------------------------------------------------------------------

/** Regex patterns for issue references in commit messages and PR bodies. */
const TICKET_NUMBER_RE = /#(\d+)/g;
const SHP_PREFIX_RE = /SHP-(\d+)/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Extract issue references from text.
 * Returns { ticketNumbers, uuids } with deduplication.
 */
export function extractIssueRefs(text: string): { ticketNumbers: number[]; uuids: string[] } {
  const ticketNumbers = new Set<number>();
  const uuids = new Set<string>();

  // #123 pattern
  for (const match of text.matchAll(TICKET_NUMBER_RE)) {
    const ticketNumber = match[1];
    if (ticketNumber) {
      ticketNumbers.add(parseInt(ticketNumber, 10));
    }
  }

  // SHP-123 pattern
  for (const match of text.matchAll(SHP_PREFIX_RE)) {
    const ticketNumber = match[1];
    if (ticketNumber) {
      ticketNumbers.add(parseInt(ticketNumber, 10));
    }
  }

  // UUID pattern
  for (const match of text.matchAll(UUID_RE)) {
    uuids.add(match[0].toLowerCase());
  }

  return {
    ticketNumbers: [...ticketNumbers],
    uuids: [...uuids],
  };
}

// -------------------------------------------------------------------------
// Resolve ticket numbers to document UUIDs
// -------------------------------------------------------------------------

async function resolveTicketNumbers(ticketNumbers: number[]): Promise<string[]> {
  if (ticketNumbers.length === 0) return [];

  const result = await pool.query(
    `SELECT id FROM documents WHERE ticket_number = ANY($1)`,
    [ticketNumbers],
  );
  return result.rows.map((row) => row.id as string);
}

// -------------------------------------------------------------------------
// Extract text from GitHub event payloads
// -------------------------------------------------------------------------

function extractTextFromPush(payload: Record<string, unknown>): string {
  const commits = payload.commits as Array<{ message?: string }> | undefined;
  if (!Array.isArray(commits)) return '';
  return commits.map((c) => c.message ?? '').join('\n');
}

function extractTextFromPullRequest(payload: Record<string, unknown>): string {
  const pr = payload.pull_request as { title?: string; body?: string } | undefined;
  if (!pr) return '';
  return [pr.title ?? '', pr.body ?? ''].join('\n');
}

// -------------------------------------------------------------------------
// POST /api/webhooks/github
// -------------------------------------------------------------------------

router.post('/', async (req: Request, res: Response) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[FleetGraph:Webhook] GITHUB_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify HMAC signature
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    return res.status(400).json({ error: 'Missing raw body' });
  }

  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    console.warn('[FleetGraph:Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'] as string | undefined;
  const payload = req.body as Record<string, unknown>;

  // Extract text based on event type
  let text = '';
  if (event === 'push') {
    text = extractTextFromPush(payload);
  } else if (event === 'pull_request') {
    text = extractTextFromPullRequest(payload);
  } else {
    // Acknowledge but ignore unsupported events
    return res.json({ ok: true, processed: false, reason: `unsupported event: ${event}` });
  }

  if (!text.trim()) {
    return res.json({ ok: true, processed: false, reason: 'no text to parse' });
  }

  // Extract issue references
  const refs = extractIssueRefs(text);
  const resolvedIds = await resolveTicketNumbers(refs.ticketNumbers);
  const allIds = [...new Set([...resolvedIds, ...refs.uuids])];

  if (allIds.length === 0) {
    return res.json({ ok: true, processed: false, reason: 'no issue refs found' });
  }

  // Enqueue graph runs
  const scheduler = getScheduler();
  if (!scheduler) {
    return res.json({ ok: true, processed: false, reason: 'scheduler not running' });
  }

  const workspaceId = process.env.FLEETGRAPH_WORKSPACE_ID ?? '';
  if (!workspaceId) {
    return res.json({ ok: true, processed: false, reason: 'FLEETGRAPH_WORKSPACE_ID not set' });
  }

  const queue = scheduler.getQueue();
  let enqueued = 0;
  for (const entityId of allIds) {
    const added = queue.enqueue({
      workspaceId,
      mode: 'on_demand',
      entityType: 'issue',
      entityId,
      trigger: 'github_webhook',
    });
    if (added) enqueued++;
  }

  console.log(`[FleetGraph:Webhook] event=${event} refs=${allIds.length} enqueued=${enqueued}`);

  // Fire-and-forget queue processing
  if (enqueued > 0) {
    setImmediate(() => {
      scheduler.processQueueImmediate().catch((err) =>
        console.error('[FleetGraph:Webhook] processQueue error:', err),
      );
    });
  }

  return res.json({ ok: true, processed: true, enqueued });
});

export const githubWebhookRoutes = router;
