import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphPanel } from './FleetGraphPanel';

const mockOnDemandMutate = vi.fn();
const mockResolveMutate = vi.fn();
const mockResolveMutateAsync = vi.fn();
const mockRefetch = vi.fn();

let latestTraceUrl: string | undefined;

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphAlerts: () => ({
    data: {
      alerts: [],
      pendingApprovals: [],
      total: 0,
    },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useFleetGraphOnDemand: () => ({
    mutate: mockOnDemandMutate,
    isPending: false,
    isError: false,
  }),
  useFleetGraphResolve: () => ({
    mutate: mockResolveMutate,
    mutateAsync: mockResolveMutateAsync,
    isPending: false,
  }),
  useFleetGraphPageView: vi.fn(),
  fleetgraphKeys: {
    alerts: (entityType?: string, entityId?: string) => ['fleetgraph', 'alerts', entityType, entityId],
  },
}));

vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvent: vi.fn(),
}));

vi.mock('./FleetGraphChat', () => ({
  FleetGraphChat: () => <div data-testid="fleetgraph-chat">chat</div>,
}));

function renderPanel(onSubmit = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <FleetGraphPanel entityType="issue" entityId="issue-1" workspaceId="ws-1" />
      </form>
    </QueryClientProvider>,
  );
}

describe('FleetGraphPanel', () => {
  beforeEach(() => {
    latestTraceUrl = undefined;
    mockRefetch.mockReset();
    mockResolveMutate.mockReset();
    mockResolveMutateAsync.mockReset();
    mockOnDemandMutate.mockReset();
    mockOnDemandMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.({
        runId: 'run-1',
        branch: 'inform_only',
        assessment: null,
        alerts: [],
        traceUrl: latestTraceUrl,
      }, _variables, undefined);
    });
  });

  it('fires on-demand analysis from the header bolt without submitting parent forms', async () => {
    const submitSpy = vi.fn();
    renderPanel(submitSpy);

    fireEvent.click(screen.getByRole('button', { name: /run fleetgraph analysis/i }));

    expect(mockOnDemandMutate).toHaveBeenCalledWith(
      {
        entityType: 'issue',
        entityId: 'issue-1',
        workspaceId: 'ws-1',
      },
      expect.any(Object),
    );
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('shows the latest on-demand trace link after a successful run', async () => {
    latestTraceUrl = 'https://smith.langchain.com/runs/run-1';
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /run fleetgraph analysis/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /latest trace/i })).toHaveAttribute(
        'href',
        'https://smith.langchain.com/runs/run-1',
      );
    });
  });

  it('keeps the properties panel focused on alerts only without embedded chat', () => {
    renderPanel();

    expect(screen.queryByTestId('fleetgraph-chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /fleetgraph analysis question/i })).not.toBeInTheDocument();
  });
});
