import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { clearCsrfToken } from '@/lib/api';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { clearQuietCsrfToken, useFleetGraphChat, useFleetGraphResolve } from './useFleetGraph';

const realFetch = globalThis.fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const wrapper = function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  return { queryClient, wrapper };
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
    clearCsrfToken();
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

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFleetGraphChat(), {
      wrapper,
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

  it('preserves HTTP status and server error detail when chat POST fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await jsonResponse({ token: 'csrf-1' }))
      .mockResolvedValueOnce(await jsonResponse({ error: 'FleetGraph chat runtime failed' }, 502));

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useFleetGraphChat(), {
      wrapper,
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          entityType: 'issue',
          entityId: 'iss-1',
          workspaceId: 'ws-1',
          question: 'What changed?',
        });
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'FleetGraph chat request failed (502): FleetGraph chat runtime failed',
    );
  });
});

describe('useFleetGraphResolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCsrfToken();
    clearQuietCsrfToken();
    globalThis.fetch = realFetch;
  });

  it('invalidates modal and issue/document queries after approve succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(await jsonResponse({ token: 'csrf-1' }))
      .mockResolvedValueOnce(await jsonResponse({ success: true }));

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useFleetGraphResolve(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        alertId: 'alert-1',
        outcome: 'approve',
        targetEntityType: 'issue',
        targetEntityId: 'iss-1',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fleetgraph'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fleetgraph', 'alerts-all'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fleetgraph', 'modal-feed'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document', 'iss-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: issueKeys.detail('iss-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: issueKeys.lists() });
  });
});
