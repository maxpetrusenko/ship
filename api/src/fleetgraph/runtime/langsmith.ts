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
  getRunUrl: (args: { runId: string }) => Promise<string>;
}

export async function resolveLangSmithRunUrl(
  runId: string,
  client?: LangSmithRunUrlClient,
  env: LangSmithEnv = process.env,
): Promise<string | null> {
  if (!runId || !canUseLangSmithTracing(env)) {
    return null;
  }

  const langSmithClient = client ?? new Client({
    apiKey: getLangSmithApiKey(env) ?? undefined,
  });

  try {
    return await langSmithClient.getRunUrl({ runId });
  } catch (err) {
    console.warn('[FleetGraph] Failed to resolve LangSmith run URL:', err);
    return null;
  }
}
