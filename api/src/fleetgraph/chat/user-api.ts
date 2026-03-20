import crypto from 'node:crypto';
import { pool } from '../../db/client.js';
import type { FleetGraphChatToolContext } from './types.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_METHODS = new Set(['GET']);

interface CachedChatToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedChatToken>();

function getBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return (process.env.SHIP_API_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
}

function cacheKey(context: FleetGraphChatToolContext): string {
  return `${context.workspaceId}:${context.userId}`;
}

function createTokenSecret(): string {
  return `ship_${crypto.randomBytes(32).toString('hex')}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseBody(bodyJson: string | null): unknown {
  if (bodyJson === null) {
    return undefined;
  }

  const trimmed = bodyJson.trim();
  if (!trimmed || trimmed === 'null') {
    return undefined;
  }

  return JSON.parse(trimmed);
}

function validatePath(path: string): void {
  if (!path.startsWith('/api/') && path !== '/health') {
    throw new Error(`Unsupported Ship API path: ${path}`);
  }
}

async function ensureToken(context: FleetGraphChatToolContext): Promise<string> {
  const key = cacheKey(context);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const token = createTokenSecret();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const name = `fleetgraph-chat:${context.workspaceId}:${context.userId}:${Date.now()}`;

  await pool.query(
    `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      context.userId,
      context.workspaceId,
      name,
      hashToken(token),
      token.slice(0, 12),
      expiresAt,
    ],
  );

  tokenCache.set(key, { token, expiresAt: expiresAt.getTime() });
  return token;
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function callShipApiAsUser(args: {
  context: FleetGraphChatToolContext;
  method: string;
  path: string;
  bodyJson: string | null;
}): Promise<Record<string, unknown>> {
  const method = args.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Unsupported Ship API method: ${args.method}`);
  }

  validatePath(args.path);

  const token = await ensureToken(args.context);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const init: RequestInit = {
    method,
    headers,
  };

  const body = parseBody(args.bodyJson);
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${getBaseUrl()}${args.path}`, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Ship API ${method} ${args.path} failed with ${response.status}: ${text.trim() || 'empty response'}`);
  }

  return {
    ok: true,
    status: response.status,
    method,
    path: args.path,
    data: parseResponseBody(text),
  };
}
