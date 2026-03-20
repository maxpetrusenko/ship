import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphFloatingChat } from './FleetGraphFloatingChat';

const mockOnDemandMutate = vi.fn();
const mockSeedDemoMutate = vi.fn();
let latestTraceUrl: string | undefined;

let mockScope = {
  scopeType: 'issue' as const,
  scopeId: 'issue-1',
  scopeLabel: 'Issue: Issue 1',
};

let mockWorkspace = {
  currentWorkspace: {
    id: 'ws-1',
    name: 'Acme Corp',
  },
};

vi.mock('@/hooks/useFleetGraphScope', () => ({
  useFleetGraphScope: () => mockScope,
}));

vi.mock('@/hooks/useFleetGraphPageContext', () => ({
  useFleetGraphPageContext: () => undefined,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace,
}));

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphOnDemand: () => ({
    mutate: mockOnDemandMutate,
    isPending: false,
    isError: false,
  }),
  useFleetGraphSeedDemoFlow: () => ({
    mutate: mockSeedDemoMutate,
    isPending: false,
  }),
}));

vi.mock('./FleetGraphChat', () => ({
  FleetGraphChat: ({
    entityType,
    entityId,
    scopeType,
    newThreadNonce,
    persistAcrossScopes,
  }: {
    entityType: string;
    entityId: string;
    scopeType?: string;
    newThreadNonce?: number;
    persistAcrossScopes?: boolean;
  }) => (
    <div
      data-testid="fleetgraph-chat"
      data-entity-type={entityType}
      data-entity-id={entityId}
      data-scope-type={scopeType ?? entityType}
      data-new-thread-nonce={String(newThreadNonce ?? 0)}
      data-persist-across-scopes={String(!!persistAcrossScopes)}
    >
      chat
    </div>
  ),
}));

describe('FleetGraphFloatingChat', () => {
  beforeEach(() => {
    mockScope = {
      scopeType: 'issue',
      scopeId: 'issue-1',
      scopeLabel: 'Issue: Issue 1',
    };
    mockWorkspace = {
      currentWorkspace: {
        id: 'ws-1',
        name: 'Acme Corp',
      },
    };
    mockOnDemandMutate.mockReset();
    mockSeedDemoMutate.mockReset();
    mockOnDemandMutate.mockImplementation((_variables, options) => {
      options?.onSuccess?.({
        runId: 'run-1',
        branch: 'inform_only',
        assessment: null,
        alerts: [],
        traceUrl: latestTraceUrl,
      }, _variables, undefined);
    });
    latestTraceUrl = undefined;
  });

  it('runs analysis from the floating header bolt and shows the returned trace link', async () => {
    latestTraceUrl = 'https://smith.langchain.com/runs/run-floating';
    render(<FleetGraphFloatingChat />);

    expect(screen.getByTestId('fleetgraph-floating-btn')).toHaveTextContent('North Star');
    expect(screen.getByTestId('fleetgraph-floating-btn')).not.toHaveTextContent('Issue: Issue 1');

    fireEvent.click(screen.getByRole('button', { name: /open north star/i }));
    const panel = await screen.findByTestId('fleetgraph-floating-panel');
    expect(within(panel).getByText('North Star')).toBeInTheDocument();
    expect(within(panel).getByText('Issue: Issue 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /run fleetgraph analysis from header/i }));

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

  it('runs the demo seed flow from the break button in the header controls', async () => {
    render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open north star/i }));

    await screen.findByTestId('fleetgraph-floating-panel');
    fireEvent.click(screen.getByRole('button', { name: /seed fleetgraph demo flow/i }));

    expect(mockSeedDemoMutate).toHaveBeenCalledWith({
      entityType: 'issue',
      entityId: 'issue-1',
    });
  });

  it('shows a typed scope chip in the floating header when opened', async () => {
    render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open north star/i }));

    const panel = await screen.findByTestId('fleetgraph-floating-panel');
    expect(within(panel).getByText('North Star')).toBeInTheDocument();
    expect(within(panel).getByText('Issue: Issue 1')).toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
  });

  it('keeps the scope label out of the collapsed launcher for workspace scope too', () => {
    mockScope = {
      scopeType: 'workspace',
      scopeId: 'ws-1',
      scopeLabel: 'Workspace: Acme Corp',
    };

    render(<FleetGraphFloatingChat />);

    expect(screen.getByTestId('fleetgraph-floating-btn')).toHaveTextContent('North Star');
    expect(screen.getByTestId('fleetgraph-floating-btn')).not.toHaveTextContent('Workspace: Acme Corp');
  });

  it('keeps persistAcrossScopes wired through scope changes', async () => {
    const { rerender } = render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open north star/i }));

    const chat = await screen.findByTestId('fleetgraph-chat');
    expect(chat).toHaveAttribute('data-persist-across-scopes', 'true');
    expect(chat).toHaveAttribute('data-entity-type', 'issue');
    expect(chat).toHaveAttribute('data-scope-type', 'issue');

    mockScope = {
      scopeType: 'workspace',
      scopeId: 'ws-1',
      scopeLabel: 'Workspace: Acme Corp',
    };

    rerender(<FleetGraphFloatingChat />);

    expect(await screen.findByTestId('fleetgraph-chat')).toHaveAttribute('data-persist-across-scopes', 'true');
    expect(screen.getByTestId('fleetgraph-chat')).toHaveAttribute('data-entity-type', 'workspace');
    expect(screen.getByTestId('fleetgraph-chat')).toHaveAttribute('data-scope-type', 'workspace');
  });

  it('moves new thread into the header as a plus action', async () => {
    render(<FleetGraphFloatingChat />);

    fireEvent.click(screen.getByRole('button', { name: /open north star/i }));

    const chat = await screen.findByTestId('fleetgraph-chat');
    expect(chat).toHaveAttribute('data-new-thread-nonce', '0');
    expect(chat).toHaveAttribute('data-persist-across-scopes', 'true');
    expect(screen.getByRole('button', { name: /new thread/i })).toHaveAttribute('title', 'New thread');

    fireEvent.click(screen.getByRole('button', { name: /new thread/i }));

    await waitFor(() => {
      expect(chat).toHaveAttribute('data-new-thread-nonce', '1');
    });
  });
});
