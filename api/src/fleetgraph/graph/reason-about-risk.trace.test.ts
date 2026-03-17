import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FleetGraphRunState } from '@ship/shared';

const traceableMock = vi.hoisted(() =>
  vi.fn((wrappedFunc: (...args: unknown[]) => Promise<unknown> | unknown, config?: {
    on_start?: (runTree: { id: string; client: { getHostUrl: () => string; getRunUrl: ({ runId }: { runId: string }) => Promise<string> } }) => void;
  }) => async (...args: unknown[]) => {
    config?.on_start?.({
      id: 'deterministic-run-123',
      client: {
        getHostUrl: () => 'https://smith.langchain.com',
        getRunUrl: async ({ runId }: { runId: string }) => `https://smith.langchain.com/o/org/projects/p/proj/r/${runId}?poll=true`,
      },
    });
    return await wrappedFunc(...args);
  }),
);

vi.mock('langsmith/traceable', () => ({
  traceable: traceableMock,
}));

function makeState(overrides: Partial<FleetGraphRunState> = {}): FleetGraphRunState {
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    mode: 'on_demand',
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    entityType: 'sprint',
    entityId: 'sprint-14',
    coreContext: {},
    parallelSignals: {},
    candidates: [],
    branch: 'clean',
    assessment: null,
    gateOutcome: null,
    snoozeUntil: null,
    error: null,
    runStartedAt: Date.now(),
    tokenUsage: null,
    chatQuestion: null,
    chatHistory: null,
    traceUrl: null,
    ...overrides,
  };
}

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  traceableMock.mockClear();
  vi.resetModules();
});

describe('reasonAboutRisk tracing', () => {
  it('creates a trace URL for deterministic accountability chat when LangSmith tracing is enabled', async () => {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2-key';

    const { reasonAboutRisk } = await import('./nodes.js');

    const result = await reasonAboutRisk(
      makeState({
        chatQuestion: 'What overdue action items do I have?',
        parallelSignals: {
          accountability: {
            items: [
              { title: 'Follow up', days_overdue: 3, accountability_target_id: 'sprint-14' },
            ],
          },
        },
      }),
    );

    expect(traceableMock).toHaveBeenCalledTimes(1);
    expect(result.traceUrl).toBe('https://smith.langchain.com/o/org/projects/p/proj/r/deterministic-run-123?poll=true');
    expect(result.assessment?.summary).toContain('1 overdue accountability items overall');
  });
});
