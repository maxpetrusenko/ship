import { describe, expect, it } from 'vitest';
import {
  canUseLangSmithTracing,
  getLangSmithApiKey,
  getLangSmithProjectName,
  isLangSmithTracingRequested,
  resolveLangSmithRunUrl,
} from './langsmith.js';

describe('fleetgraph LangSmith env helpers', () => {
  it('accepts current LangSmith env names', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'lsv2-key',
    };

    expect(getLangSmithApiKey(env)).toBe('lsv2-key');
    expect(isLangSmithTracingRequested(env)).toBe(true);
    expect(canUseLangSmithTracing(env)).toBe(true);
  });

  it('falls back to legacy LangChain env names', () => {
    const env = {
      LANGCHAIN_TRACING_V2: 'true',
      LANGCHAIN_API_KEY: 'legacy-key',
    };

    expect(getLangSmithApiKey(env)).toBe('legacy-key');
    expect(isLangSmithTracingRequested(env)).toBe(true);
    expect(canUseLangSmithTracing(env)).toBe(true);
  });

  it('ignores an empty modern LangSmith key and falls back to the legacy key', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: '',
      LANGCHAIN_API_KEY: 'legacy-key',
    };

    expect(getLangSmithApiKey(env)).toBe('legacy-key');
    expect(canUseLangSmithTracing(env)).toBe(true);
  });

  it('keeps tracing disabled when all LangSmith key env vars are empty', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: '',
      LANGCHAIN_API_KEY: '',
    };

    expect(getLangSmithApiKey(env)).toBeNull();
    expect(canUseLangSmithTracing(env)).toBe(false);
  });

  it('prefers modern project env name with legacy fallback', () => {
    expect(getLangSmithProjectName({
      LANGSMITH_PROJECT: 'fleetgraph',
      LANGCHAIN_PROJECT: 'legacy-project',
    })).toBe('fleetgraph');
    expect(getLangSmithProjectName({
      LANGCHAIN_PROJECT: 'legacy-project',
    })).toBe('legacy-project');
  });

  it('resolves existing public run URLs through the LangSmith client', async () => {
    const url = await resolveLangSmithRunUrl(
      'run-123',
      {
        readRunSharedLink: async (runId: string) => `https://smith.langchain.com/public/${runId}/r`,
        shareRun: async (runId: string) => `https://smith.langchain.com/public/${runId}/r`,
      },
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'lsv2-key' },
    );

    expect(url).toBe('https://smith.langchain.com/public/run-123/r');
  });

  it('creates a public run URL when no shared link exists yet', async () => {
    const url = await resolveLangSmithRunUrl(
      'run-123',
      {
        readRunSharedLink: async () => undefined,
        shareRun: async (runId: string) => `https://smith.langchain.com/public/${runId}/r`,
      },
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'lsv2-key' },
    );

    expect(url).toBe('https://smith.langchain.com/public/run-123/r');
  });

  it('shares the run when LangSmith returns 404 while reading the shared link', async () => {
    const url = await resolveLangSmithRunUrl(
      'run-123',
      {
        readRunSharedLink: async () => {
          const err = new Error('Run not found') as Error & { status?: number };
          err.status = 404;
          throw err;
        },
        shareRun: async (runId: string) => `https://smith.langchain.com/public/${runId}/r`,
      },
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'lsv2-key' },
      { maxAttempts: 1, retryDelayMs: 0 },
    );

    expect(url).toBe('https://smith.langchain.com/public/run-123/r');
  });

  it('retries transient run-not-found errors before sharing the run', async () => {
    let attempts = 0;

    const url = await resolveLangSmithRunUrl(
      'run-123',
      {
        readRunSharedLink: async () => undefined,
        shareRun: async (runId: string) => {
          attempts += 1;
          if (attempts < 3) {
            const err = new Error('Run not found') as Error & { status?: number };
            err.status = 404;
            throw err;
          }
          return `https://smith.langchain.com/public/${runId}/r`;
        },
      },
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'lsv2-key' },
      { maxAttempts: 3, retryDelayMs: 0 },
    );

    expect(url).toBe('https://smith.langchain.com/public/run-123/r');
    expect(attempts).toBe(3);
  });
});
