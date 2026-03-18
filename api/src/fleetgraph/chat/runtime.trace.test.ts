import { afterEach, describe, expect, it, vi } from 'vitest';

const traceableMock = vi.hoisted(() =>
  vi.fn((wrappedFunc: (...args: unknown[]) => Promise<unknown> | unknown, config?: {
    on_start?: (runTree: {
      id: string;
      client: {
        readRunSharedLink: (runId: string) => Promise<string | undefined>;
        shareRun: (runId: string) => Promise<string>;
      };
    }) => void;
  }) => async (...args: unknown[]) => {
    config?.on_start?.({
      id: 'chat-run-123',
      client: {
        readRunSharedLink: async () => undefined,
        shareRun: async (runId: string) => `https://smith.langchain.com/public/${runId}/r`,
      },
    });
    return await wrappedFunc(...args);
  }),
);

vi.mock('langsmith/traceable', () => ({
  traceable: traceableMock,
}));

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  traceableMock.mockClear();
  vi.resetModules();
});

describe('runFleetGraphChat tracing', () => {
  it('creates a trace URL for each chat call when LangSmith tracing is enabled', async () => {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2-key';

    const { runFleetGraphChat } = await import('./runtime.js');

    const client = {
      responses: {
        create: vi.fn(async () => ({
          id: 'resp-1',
          output: [],
          output_text: JSON.stringify({
            summary: 'Ticket says the API is timing out on save.',
            recommendation: 'Check the latest failing saves.',
            branch: 'inform_only',
            proposedAction: null,
            citations: ['issue-context'],
          }),
          usage: { input_tokens: 8, output_tokens: 6 },
        })),
      },
    };

    const result = await runFleetGraphChat({
      workspaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      entityType: 'issue',
      entityId: 'iss-1',
      question: 'what he says in the ticket?',
      history: [],
      pageContext: {
        route: '/documents/iss-1/details',
        surface: 'issue',
        documentId: 'iss-1',
        title: 'Issue title',
      },
    }, {
      client,
      maxSteps: 1,
    });

    expect(traceableMock).toHaveBeenCalledTimes(1);
    expect(result.traceUrl).toBe('https://smith.langchain.com/public/chat-run-123/r');
  });
});
