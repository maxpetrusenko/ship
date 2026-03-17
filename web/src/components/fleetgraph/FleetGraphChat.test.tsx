import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphChat } from './FleetGraphChat';

const mockMutateAsync = vi.fn();
const mockCreateThreadMutateAsync = vi.fn();
const mockResolveMutateAsync = vi.fn();

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphChat: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useFleetGraphThread: () => ({
    data: null,
    isLoading: false,
  }),
  useFleetGraphCreateThread: () => ({
    mutateAsync: mockCreateThreadMutateAsync,
    isPending: false,
  }),
  useFleetGraphResolve: () => ({
    mutateAsync: mockResolveMutateAsync,
    isPending: false,
  }),
}));

describe('FleetGraphChat', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockCreateThreadMutateAsync.mockReset();
    mockResolveMutateAsync.mockReset();
  });

  it('shows quick prompts before conversation starts', () => {
    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    expect(screen.getByRole('button', { name: 'Is this issue stale?' })).toBeInTheDocument();
  });

  it('supports workspace scope prompts and labels', () => {
    render(
      <FleetGraphChat
        entityType="workspace"
        entityId="ws-1"
        workspaceId="ws-1"
        scopeLabel="Workspace"
        scopeType="workspace"
      />,
    );

    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overall execution health' })).toBeInTheDocument();
  });

  it('renders the assistant summary once when message content already matches assessment summary', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      runId: 'run-1',
      branch: 'inform_only',
      assessment: {
        summary: 'Issue needs a quick follow-up',
        recommendation: 'Ping the assignee today',
        branch: 'inform_only',
        citations: [],
      },
      alerts: [],
      message: {
        role: 'assistant',
        content: 'Issue needs a quick follow-up',
        assessment: {
          summary: 'Issue needs a quick follow-up',
          recommendation: 'Ping the assignee today',
          branch: 'inform_only',
          citations: [],
        },
        debug: {
          traceUrl: 'https://smith.langchain.com/runs/run-1',
          branch: 'inform_only',
          entityType: 'issue',
          entityId: 'issue-1',
          candidateSignals: ['missing_standup'],
          accountability: {
            total: 2,
            overdue: 1,
            dueToday: 1,
          },
          managerActionItems: 1,
        },
        timestamp: new Date().toISOString(),
      },
    });

    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is it stale?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    await waitFor(() => {
      expect(screen.getAllByText('Issue needs a quick follow-up')).toHaveLength(1);
    });
  });

  it('shows debug popover for assistant replies with trace metadata', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      runId: 'run-1',
      branch: 'inform_only',
      assessment: {
        summary: 'You have 5 overdue accountability items overall. 2 are tied to this sprint.',
        recommendation: 'Start with the 2 sprint-linked items.',
        branch: 'inform_only',
        citations: ['accountability:overall_overdue=5'],
      },
      alerts: [],
      message: {
        role: 'assistant',
        content: 'You have 5 overdue accountability items overall. 2 are tied to this sprint.',
        assessment: {
          summary: 'You have 5 overdue accountability items overall. 2 are tied to this sprint.',
          recommendation: 'Start with the 2 sprint-linked items.',
          branch: 'inform_only',
          citations: ['accountability:overall_overdue=5'],
        },
        debug: {
          traceUrl: 'https://smith.langchain.com/runs/run-1',
          branch: 'inform_only',
          entityType: 'sprint',
          entityId: 'sprint-14',
          candidateSignals: ['missing_standup'],
          accountability: {
            total: 5,
            overdue: 5,
            dueToday: 0,
          },
          managerActionItems: 0,
        },
        timestamp: new Date().toISOString(),
      },
    });

    render(<FleetGraphChat entityType="sprint" entityId="sprint-14" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'overdue items?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    const debugButton = await screen.findByRole('button', { name: 'Debug' });
    fireEvent.click(debugButton);

    expect(await screen.findByText('Trace')).toBeInTheDocument();
    expect(screen.getByText('https://smith.langchain.com/runs/run-1')).toBeInTheDocument();
    expect(screen.getByText('sprint-14')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(2);
  });
});
