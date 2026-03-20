import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphModalSection } from './FleetGraphModalSection';
import type { FleetGraphModalFeedItem } from '@ship/shared';

const mockResolveMutate = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeItem(overrides: Partial<FleetGraphModalFeedItem> = {}): FleetGraphModalFeedItem {
  return {
    alertId: 'alert-1',
    entityType: 'issue',
    entityId: 'iss-1',
    title: 'Stale issue detected',
    signalType: 'stale_issue',
    severity: 'medium',
    whatChanged: 'Issue has not been updated in 5 days',
    whyThisMatters: 'Follow up with the assignee',
    ownerLabel: null,
    nextDecision: null,
    explanation: null,
    reasoning: null,
    displayPriority: 2,
    isActionable: false,
    approval: null,
    createdAt: '2026-03-17T10:00:00Z',
    lastSurfacedAt: '2026-03-18T10:00:00Z',
    ...overrides,
  };
}

let mockFeedData: { items: FleetGraphModalFeedItem[]; total: number } | undefined;
let mockFeedLoading = false;

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphModalFeed: () => ({
    data: mockFeedData,
    isLoading: mockFeedLoading,
  }),
  useFleetGraphResolve: () => ({
    mutate: mockResolveMutate,
    isPending: false,
  }),
  fleetgraphKeys: {
    all: ['fleetgraph'],
    modalFeed: () => ['fleetgraph', 'modal-feed'],
  },
}));

function renderSection(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FleetGraphModalSection onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FleetGraphModalSection', () => {
  beforeEach(() => {
    mockFeedData = undefined;
    mockFeedLoading = false;
    mockResolveMutate.mockReset();
    mockNavigate.mockReset();
  });

  it('shows loading state', () => {
    mockFeedLoading = true;
    renderSection();
    expect(screen.getByText(/loading fleetgraph findings/i)).toBeInTheDocument();
  });

  it('renders nothing when no items', () => {
    mockFeedData = { items: [], total: 0 };
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();
  });

  it('renders section header with count', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    expect(screen.getByText('FleetGraph')).toBeInTheDocument();
    expect(screen.getByText('1 finding')).toBeInTheDocument();
  });

  it('pluralizes finding count', () => {
    mockFeedData = { items: [makeItem(), makeItem({ alertId: 'alert-2' })], total: 2 };
    renderSection();
    expect(screen.getByText('2 findings')).toBeInTheDocument();
  });

  it('shows collapsed row with title and severity', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    expect(screen.getByText('Stale issue detected')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('expands row to show diagnosis fields', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();

    // Click to expand
    fireEvent.click(screen.getByText('Stale issue detected'));

    expect(screen.getByText('What changed')).toBeInTheDocument();
    expect(screen.getByText('Why this matters')).toBeInTheDocument();
    // whatChanged text appears in collapsed row + expanded detail = 2 occurrences
    const summaryMatches = screen.getAllByText('Issue has not been updated in 5 days');
    expect(summaryMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Follow up with the assignee')).toBeInTheDocument();
  });

  it('shows Skip button for inform-only items', () => {
    mockFeedData = { items: [makeItem({ isActionable: false })], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('Skip calls resolve with dismiss outcome', () => {
    mockFeedData = { items: [makeItem({ isActionable: false })], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    fireEvent.click(screen.getByText('Skip'));
    expect(mockResolveMutate).toHaveBeenCalledWith({
      alertId: 'alert-1',
      outcome: 'dismiss',
      targetEntityType: 'issue',
      targetEntityId: 'iss-1',
    });
  });

  it('shows Approve/Deny for actionable items', () => {
    mockFeedData = {
      items: [makeItem({
        isActionable: true,
        approval: {
          id: 'appr-1',
          workspaceId: 'ws-1',
          alertId: 'alert-1',
          runId: 'run-1',
          threadId: 'thread-1',
          checkpointId: null,
          actionType: 'reassign_issue',
          targetEntityType: 'issue',
          targetEntityId: 'iss-1',
          description: 'Reassign to @alice',
          payload: { assignee_id: 'user-alice' },
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          expiresAt: '2026-03-21T10:00:00Z',
          createdAt: '2026-03-18T10:00:00Z',
          updatedAt: '2026-03-18T10:00:00Z',
        },
      })],
      total: 1,
    };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    expect(screen.getByText('Approve reassign issue')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('does not show Skip for actionable items', () => {
    mockFeedData = {
      items: [makeItem({
        isActionable: true,
        approval: {
          id: 'appr-1',
          workspaceId: 'ws-1',
          alertId: 'alert-1',
          runId: 'run-1',
          threadId: 'thread-1',
          checkpointId: null,
          actionType: 'reassign_issue',
          targetEntityType: 'issue',
          targetEntityId: 'iss-1',
          description: 'Reassign to @alice',
          payload: { assignee_id: 'user-alice' },
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          expiresAt: '2026-03-21T10:00:00Z',
          createdAt: '2026-03-18T10:00:00Z',
          updatedAt: '2026-03-18T10:00:00Z',
        },
      })],
      total: 1,
    };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();
  });

  it('Approve calls resolve with target entity context', () => {
    mockFeedData = {
      items: [makeItem({
        isActionable: true,
        approval: {
          id: 'appr-1',
          workspaceId: 'ws-1',
          alertId: 'alert-1',
          runId: 'run-1',
          threadId: 'thread-1',
          checkpointId: null,
          actionType: 'escalate_priority',
          targetEntityType: 'issue',
          targetEntityId: 'iss-1',
          description: 'Escalate priority to high',
          payload: { priority: 'high' },
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          expiresAt: '2026-03-21T10:00:00Z',
          createdAt: '2026-03-18T10:00:00Z',
          updatedAt: '2026-03-18T10:00:00Z',
        },
      })],
      total: 1,
    };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    fireEvent.click(screen.getByText('Approve escalate priority'));
    expect(mockResolveMutate).toHaveBeenCalledWith({
      alertId: 'alert-1',
      outcome: 'approve',
      targetEntityType: 'issue',
      targetEntityId: 'iss-1',
    });
  });

  it('shows Open issue button', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    expect(screen.getByText('Open issue')).toBeInTheDocument();
  });

  it('opens the full document route for issue items', () => {
    const onClose = vi.fn();
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection(onClose);
    fireEvent.click(screen.getByText('Stale issue detected'));
    fireEvent.click(screen.getByText('Open issue'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/documents/iss-1');
  });

  it('shows Action badge on actionable items', () => {
    mockFeedData = { items: [makeItem({ isActionable: true })], total: 1 };
    renderSection();
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('shows Explain and Show reasoning sections when expanded', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    expect(screen.getByText('Explain')).toBeInTheDocument();
    expect(screen.getByText('Show reasoning')).toBeInTheDocument();
    // V1 placeholder text
    expect(screen.getByText(/detailed FleetGraph analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/Reasoning available via FleetGraph chat/i)).toBeInTheDocument();
  });

  it('shows Snooze dropdown options', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    fireEvent.click(screen.getByText('Snooze'));
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('1 hr')).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });

  it('Snooze calls resolve with snooze outcome', () => {
    mockFeedData = { items: [makeItem()], total: 1 };
    renderSection();
    fireEvent.click(screen.getByText('Stale issue detected'));
    fireEvent.click(screen.getByText('Snooze'));
    fireEvent.click(screen.getByText('1 hr'));
    expect(mockResolveMutate).toHaveBeenCalledWith({
      alertId: 'alert-1',
      outcome: 'snooze',
      snoozeDurationMinutes: 60,
      targetEntityType: 'issue',
      targetEntityId: 'iss-1',
    });
  });
});
