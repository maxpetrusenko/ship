import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetGraphChat } from './FleetGraphChat';

const mockMutateAsync = vi.fn();
const mockCreateThreadMutateAsync = vi.fn();
const mockResolveMutateAsync = vi.fn();
let mockAlertsData: {
  alerts: Array<{
    id: string;
    summary: string;
    signalType: string;
    status: string;
  }>;
} = { alerts: [] };
let mockThreadData: {
  thread: {
    id: string;
    workspaceId: string;
    userId: string;
    status: 'active' | 'archived';
    lastPageRoute: string | null;
    lastPageSurface: string | null;
    lastPageDocumentId: string | null;
    lastPageTitle: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
} | null = null;

vi.mock('@/hooks/useFleetGraph', () => ({
  useFleetGraphChat: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useFleetGraphAlerts: () => ({
    data: mockAlertsData,
  }),
  useFleetGraphThread: () => ({
    data: mockThreadData,
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
    mockAlertsData = { alerts: [] };
    mockThreadData = null;
  });

  it('shows quick prompts before conversation starts', () => {
    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    expect(screen.getByRole('button', { name: 'Is this issue stale?' })).toBeInTheDocument();
  });

  it('supports workspace scope prompts without rendering scope chrome', () => {
    render(
      <FleetGraphChat
        entityType="workspace"
        entityId="ws-1"
        workspaceId="ws-1"
        scopeType="workspace"
      />,
    );

    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
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
          toolCalls: [
            {
              name: 'fetch_sprint_context',
              arguments: {
                sprintId: 'sprint-14',
                view: 'standup',
              },
            },
          ],
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

    expect(await screen.findByRole('link', { name: 'Trace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open trace/i })).toHaveAttribute(
      'href',
      'https://smith.langchain.com/runs/run-1',
    );
    expect(screen.getByText('sprint-14')).toBeInTheDocument();
    expect(screen.getByText('fetch_sprint_context')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(2);
  });

  it('renders inform-only replies as direct chat text instead of meta chrome', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      runId: 'run-1',
      branch: 'inform_only',
      assessment: {
        summary: 'There are no overdue items in this workspace.',
        recommendation: 'Keep monitoring upcoming work.',
        branch: 'inform_only',
        citations: [],
      },
      alerts: [],
      message: {
        role: 'assistant',
        content: 'There are no overdue items in this workspace.',
        assessment: {
          summary: 'There are no overdue items in this workspace.',
          recommendation: 'Keep monitoring upcoming work.',
          branch: 'inform_only',
          citations: [],
        },
        debug: {
          traceUrl: null,
          branch: 'inform_only',
          entityType: 'workspace',
          entityId: 'ws-1',
          candidateSignals: [],
          accountability: {
            total: 0,
            overdue: 0,
            dueToday: 0,
          },
          managerActionItems: 0,
        },
        timestamp: new Date().toISOString(),
      },
    });

    render(<FleetGraphChat entityType="workspace" entityId="ws-1" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'overall health?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(await screen.findByText('There are no overdue items in this workspace.')).toBeInTheDocument();
    expect(screen.queryByText('Informational')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommendation')).not.toBeInTheDocument();
  });

  it('shows compact approve and dismiss controls for suggested chat changes', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      threadId: 'thread-1',
      runId: 'run-1',
      branch: 'confirm_action',
      assessment: {
        summary: 'Post the standup for Week 14 to address the pending item.',
        recommendation: 'Get approval before posting.',
        branch: 'confirm_action',
        proposedAction: {
          actionType: 'add_comment',
          targetEntityType: 'sprint',
          targetEntityId: 'sprint-14',
          description: 'Post the standup for Week 14 to address the pending item.',
          payload: {
            content: 'Yesterday: ...',
          },
        },
        citations: ['accountability:pending_item'],
      },
      alerts: [
        {
          id: 'alert-standup-1',
          workspaceId: 'ws-1',
          fingerprint: 'fp-1',
          signalType: 'chat_suggestion',
          entityType: 'sprint',
          entityId: 'sprint-14',
          severity: 'medium',
          summary: 'Post the standup for Week 14 to address the pending item.',
          recommendation: 'Get approval before posting.',
          citations: [],
          ownerUserId: 'user-1',
          status: 'active',
          snoozedUntil: null,
          lastSurfacedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      message: {
        role: 'assistant',
        content: 'Post the standup for Week 14 to address the pending item.',
        alertId: 'alert-standup-1',
        assessment: {
          summary: 'Post the standup for Week 14 to address the pending item.',
          recommendation: 'Get approval before posting.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'add_comment',
            targetEntityType: 'sprint',
            targetEntityId: 'sprint-14',
            description: 'Post the standup for Week 14 to address the pending item.',
            payload: {
              content: 'Yesterday: ...',
            },
          },
          citations: ['accountability:pending_item'],
        },
        debug: {
          traceUrl: null,
          branch: 'confirm_action',
          entityType: 'sprint',
          entityId: 'sprint-14',
          candidateSignals: ['missing_standup'],
          accountability: {
            total: 1,
            overdue: 1,
            dueToday: 0,
          },
          managerActionItems: 0,
        },
        timestamp: new Date().toISOString(),
      },
    });

    render(<FleetGraphChat entityType="sprint" entityId="sprint-14" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What should I do?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(await screen.findByText('Suggested Change')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Dismiss')).not.toBeInTheDocument();
  });

  it('keeps hydrated thread messages when scope resolves after refresh', () => {
    const now = new Date().toISOString();
    mockThreadData = {
      thread: {
        id: 'thread-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        status: 'active',
        lastPageRoute: '/issues/issue-1',
        lastPageSurface: 'issue',
        lastPageDocumentId: 'issue-1',
        lastPageTitle: 'Issue 1',
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          role: 'assistant',
          content: 'Persisted thread survives refresh',
          timestamp: now,
        },
      ],
    };

    const { rerender } = render(
      <FleetGraphChat
        entityType="workspace"
        entityId="ws-1"
        workspaceId="ws-1"
        scopeType="workspace"
      />,
    );

    expect(screen.getByText('Persisted thread survives refresh')).toBeInTheDocument();

    rerender(
      <FleetGraphChat
        entityType="issue"
        entityId="issue-1"
        workspaceId="ws-1"
        scopeType="issue"
      />,
    );

    expect(screen.getByText('Persisted thread survives refresh')).toBeInTheDocument();
  });

  it('shows approve and dismiss controls for hydrated suggested messages with a persisted alert id', async () => {
    const now = new Date().toISOString();
    mockThreadData = {
      thread: {
        id: 'thread-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        status: 'active',
        lastPageRoute: '/sprints/sprint-14',
        lastPageSurface: 'sprint',
        lastPageDocumentId: 'sprint-14',
        lastPageTitle: 'Sprint 14',
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          role: 'assistant',
          content: 'Post the standup for Week 14 to address the pending item.',
          alertId: 'alert-standup-1',
          assessment: {
            summary: 'Post the standup for Week 14 to address the pending item.',
            recommendation: 'Get approval before posting.',
            branch: 'confirm_action',
            proposedAction: {
              actionType: 'add_comment',
              targetEntityType: 'sprint',
              targetEntityId: 'sprint-14',
              description: 'Post the standup for Week 14 to address the pending item.',
              payload: {
                content: 'Yesterday: ...',
              },
            },
            citations: ['accountability:pending_item'],
          },
          debug: {
            traceUrl: 'https://smith.langchain.com/public/chat-run-1/r',
            branch: 'confirm_action',
            entityType: 'sprint',
            entityId: 'sprint-14',
            candidateSignals: ['missing_standup'],
            accountability: {
              total: 1,
              overdue: 1,
              dueToday: 0,
            },
            managerActionItems: 0,
          },
          timestamp: now,
        },
      ],
    };

    render(<FleetGraphChat entityType="sprint" entityId="sprint-14" workspaceId="ws-1" />);

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('hides the conversation count row and reacts to header new-thread requests', async () => {
    const now = new Date().toISOString();
    mockThreadData = {
      thread: {
        id: 'thread-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        status: 'active',
        lastPageRoute: '/issues/issue-1',
        lastPageSurface: 'issue',
        lastPageDocumentId: 'issue-1',
        lastPageTitle: 'Issue 1',
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          role: 'assistant',
          content: 'Persisted thread survives refresh',
          timestamp: now,
        },
      ],
    };
    mockCreateThreadMutateAsync.mockResolvedValue({
      thread: {
        id: 'thread-2',
      },
    });

    const { rerender } = render(
      <FleetGraphChat
        entityType="issue"
        entityId="issue-1"
        workspaceId="ws-1"
        newThreadNonce={0}
      />,
    );

    expect(screen.queryByText(/conversation \(/i)).not.toBeInTheDocument();

    rerender(
      <FleetGraphChat
        entityType="issue"
        entityId="issue-1"
        workspaceId="ws-1"
        newThreadNonce={1}
      />,
    );

    await waitFor(() => {
      expect(mockCreateThreadMutateAsync).toHaveBeenCalledTimes(1);
    });
  });
});
