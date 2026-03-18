import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphFloatingChat } from './FleetGraphFloatingChat';

const mockOnDemandMutate = vi.fn();

let latestTraceUrl: string | undefined;

vi.mock('@/hooks/useFleetGraphScope', () => ({
  useFleetGraphScope: () => ({
    scopeType: 'issue',
    scopeId: 'issue-1',
    scopeLabel: 'Issue 1',
  }),
}));

vi.mock('@/hooks/useFleetGraphPageContext', () => ({
  useFleetGraphPageContext: () => undefined,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Workspace' },
  }),
}));

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphOnDemand: () => ({
    mutate: mockOnDemandMutate,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('./FleetGraphChat', () => ({
  FleetGraphChat: ({
    newThreadNonce,
    persistAcrossScopes,
  }: {
    newThreadNonce?: number;
    persistAcrossScopes?: boolean;
  }) => (
    <div
      data-testid="fleetgraph-chat"
      data-new-thread-nonce={String(newThreadNonce ?? 0)}
      data-persist-across-scopes={String(!!persistAcrossScopes)}
    >
      chat
    </div>
  ),
}));

describe('FleetGraphFloatingChat', () => {
  beforeEach(() => {
    latestTraceUrl = undefined;
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

  it('runs analysis from the floating header bolt and shows the returned trace link', async () => {
    latestTraceUrl = 'https://smith.langchain.com/runs/run-floating';
    render(<FleetGraphFloatingChat />);

    expect(screen.getByText('Issue 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open ship chat/i }));
    fireEvent.click(screen.getByRole('button', { name: /run fleetgraph analysis/i }));

    expect(mockOnDemandMutate).toHaveBeenCalledWith(
      {
        entityType: 'issue',
        entityId: 'issue-1',
        workspaceId: 'ws-1',
      },
      expect.any(Object),
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /latest trace/i })).toHaveAttribute(
        'href',
        'https://smith.langchain.com/runs/run-floating',
      );
    });
  });

  it('shows scope chip in the floating header when entity-scoped', () => {
    render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open ship chat/i }));

    // Scope chip visible in the header
    expect(screen.getByText('Issue 1')).toBeInTheDocument();
    expect(screen.getAllByText('Ship Chat').length).toBeGreaterThan(0);
    // But no verbose scope chrome
    expect(screen.queryByText('issue')).not.toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
  });

  it('moves new thread into the header as a plus action', async () => {
    render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open ship chat/i }));

    expect(screen.getByRole('button', { name: /new thread/i })).toHaveAttribute('title', 'New thread');
    expect(screen.queryByText(/new thread/i)).not.toBeInTheDocument();

    const chat = await screen.findByTestId('fleetgraph-chat');
    expect(chat).toHaveAttribute('data-new-thread-nonce', '0');
    expect(chat).toHaveAttribute('data-persist-across-scopes', 'true');

    fireEvent.click(screen.getByRole('button', { name: /new thread/i }));

    expect(chat).toHaveAttribute('data-new-thread-nonce', '1');
  });
});
