import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { clearQuietCsrfToken, useFleetGraphChat } from './useFleetGraph';

const realFetch = globalThis.fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('useFleetGraphChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQuietCsrfToken();
    globalThis.fetch = realFetch;
  });

  it('refreshes the CSRF token and retries once when chat POST returns JSON 403', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await jsonResponse({ token: 'csrf-1' }))
      .mockResolvedValueOnce(await jsonResponse({ error: 'invalid csrf' }, 403))
      .mockResolvedValueOnce(await jsonResponse({ token: 'csrf-2' }))
      .mockResolvedValueOnce(await jsonResponse({
        conversationId: 'thread-1',
        threadId: 'thread-1',
        runId: 'run-1',
        branch: 'inform_only',
        assessment: null,
        alerts: [],
        message: {
          role: 'assistant',
          content: 'Recovered after retry',
          timestamp: '2026-03-17T00:00:00.000Z',
        },
      }));

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { result } = renderHook(() => useFleetGraphChat(), {
      wrapper: createWrapper(),
    });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync({
        entityType: 'issue',
        entityId: 'iss-1',
        workspaceId: 'ws-1',
        question: 'What changed?',
      });
    });

    expect(response?.message.content).toBe('Recovered after retry');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstPost = fetchMock.mock.calls[1];
    const secondPost = fetchMock.mock.calls[3];

    expect((firstPost?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-1',
    });
    expect((secondPost?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-2',
    });
  });
});
