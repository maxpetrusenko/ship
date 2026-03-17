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

  it('prefers modern project env name with legacy fallback', () => {
    expect(getLangSmithProjectName({
      LANGSMITH_PROJECT: 'fleetgraph',
      LANGCHAIN_PROJECT: 'legacy-project',
    })).toBe('fleetgraph');
    expect(getLangSmithProjectName({
      LANGCHAIN_PROJECT: 'legacy-project',
    })).toBe('legacy-project');
  });

  it('resolves canonical run URLs through the LangSmith client', async () => {
    const url = await resolveLangSmithRunUrl(
      'run-123',
      {
        getRunUrl: async ({ runId }: { runId: string }) => `https://smith.langchain.com/o/org/projects/p/proj/r/${runId}?poll=true`,
      },
      { LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: 'lsv2-key' },
    );

    expect(url).toBe('https://smith.langchain.com/o/org/projects/p/proj/r/run-123?poll=true');
  });
});
