import { Client } from 'langsmith';

export type LangSmithEnv = Record<string, string | undefined>;

export function getLangSmithApiKey(env: LangSmithEnv = process.env): string | null {
  return env.LANGSMITH_API_KEY ?? env.LANGCHAIN_API_KEY ?? null;
}

export function isLangSmithTracingRequested(env: LangSmithEnv = process.env): boolean {
  return env.LANGSMITH_TRACING === 'true' || env.LANGCHAIN_TRACING_V2 === 'true';
}

export function canUseLangSmithTracing(env: LangSmithEnv = process.env): boolean {
  return isLangSmithTracingRequested(env) && typeof getLangSmithApiKey(env) === 'string';
}

export function getLangSmithProjectName(env: LangSmithEnv = process.env): string | null {
  return env.LANGSMITH_PROJECT ?? env.LANGCHAIN_PROJECT ?? null;
}

interface LangSmithRunUrlClient {
  readRunSharedLink: (runId: string) => Promise<string | undefined>;
  shareRun: (runId: string) => Promise<string>;
}

interface ResolveLangSmithRunUrlOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

function getErrorStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveLangSmithRunUrl(
  runId: string,
  client?: LangSmithRunUrlClient,
  env: LangSmithEnv = process.env,
  options: ResolveLangSmithRunUrlOptions = {},
): Promise<string | null> {
  if (!runId || !canUseLangSmithTracing(env)) {
    return null;
  }

  const langSmithClient = client ?? new Client({
    apiKey: getLangSmithApiKey(env) ?? undefined,
  });
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const existingSharedUrl = await langSmithClient.readRunSharedLink(runId);
      if (existingSharedUrl) {
        return existingSharedUrl;
      }

      return await langSmithClient.shareRun(runId);
    } catch (err) {
      const status = getErrorStatus(err);
      const shouldRetry = status === 404 && attempt < maxAttempts;
      if (shouldRetry) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      console.warn('[FleetGraph] Failed to resolve LangSmith run URL:', err);
      return null;
    }
  }

  return null;
}
