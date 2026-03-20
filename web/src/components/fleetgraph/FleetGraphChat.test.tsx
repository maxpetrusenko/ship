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
    alertId?: string;
    assessment?: {
      summary: string;
      recommendation: string;
      branch: 'inform_only' | 'confirm_action';
      proposedAction?: {
        actionType: string;
        targetEntityType: 'issue' | 'project' | 'sprint' | 'workspace';
        targetEntityId: string;
        description: string;
        payload: Record<string, unknown>;
      };
      citations: string[];
    };
    timestamp: string;
  }>;
} | null = null;
const mockUseDocumentContextQuery = vi.fn();

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

vi.mock('@/hooks/useDocumentContextQuery', () => ({
  useDocumentContextQuery: (id: string | undefined) => mockUseDocumentContextQuery(id),
}));

describe('FleetGraphChat', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockCreateThreadMutateAsync.mockReset();
    mockResolveMutateAsync.mockReset();
    mockAlertsData = { alerts: [] };
    mockThreadData = null;
    mockUseDocumentContextQuery.mockImplementation((id: string | undefined) => ({
      data: id ? {
        current: {
          id,
          title: 'Set up project structure',
          document_type: 'issue',
          ticket_number: 1,
        },
      } : undefined,
    }));
  });

  it('shows quick prompts before conversation starts', () => {
    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    expect(screen.getByRole('button', { name: 'Is this issue stale?' })).toBeInTheDocument();
  });

  it('hydrates newly persisted actionable thread messages into the open chat', async () => {
    const { rerender } = render(
      <FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />,
    );

    expect(screen.queryByText(/Approve escalate priority/i)).not.toBeInTheDocument();

    mockAlertsData = {
      alerts: [
        {
          id: 'alert-demo-1',
          summary: 'Demo: Issue One should be escalated before it slips further.',
          signalType: 'chat_suggestion',
          status: 'active',
        },
      ],
    };
    mockThreadData = {
      thread: {
        id: 'thread-demo',
        workspaceId: 'ws-1',
        userId: 'user-1',
        status: 'active',
        lastPageRoute: null,
        lastPageSurface: null,
        lastPageDocumentId: null,
        lastPageTitle: null,
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
      },
      messages: [
        {
          role: 'assistant',
          content: 'Demo: Issue One should be escalated before it slips further.',
          alertId: 'alert-demo-1',
          assessment: {
            summary: 'Demo: Issue One should be escalated before it slips further.',
            recommendation: 'Approve to raise priority and surface it in the queue.',
            branch: 'confirm_action',
            proposedAction: {
              actionType: 'escalate_priority',
              targetEntityType: 'issue',
              targetEntityId: 'issue-1',
              description: 'Raise issue priority to high for the demo flow.',
              payload: { priority: 'high' },
            },
            citations: ['demo:seed-flow'],
          },
          timestamp: '2026-03-19T00:00:01.000Z',
        },
      ],
    };

    rerender(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByText(/Raise issue priority to high for the demo flow/i)).toBeInTheDocument();
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

  it('shows the exact target ticket link for suggested issue changes', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      threadId: 'thread-1',
      runId: 'run-1',
      branch: 'confirm_action',
      assessment: {
        summary: 'Add setup details to the issue description.',
        recommendation: 'Apply the change to the issue body.',
        branch: 'confirm_action',
        proposedAction: {
          actionType: 'change_state',
          targetEntityType: 'issue',
          targetEntityId: 'issue-1',
          description: 'Move the issue into review after adding the setup details.',
          payload: {
            state: 'in_review',
          },
        },
        citations: ['issue-context'],
      },
      alerts: [
        {
          id: 'alert-1',
          workspaceId: 'ws-1',
          fingerprint: 'fp-1',
          signalType: 'chat_suggestion',
          entityType: 'issue',
          entityId: 'issue-1',
          severity: 'medium',
          summary: 'Add setup details to the issue description.',
          recommendation: 'Apply the change to the issue body.',
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
        content: 'Add setup details to the issue description.',
        alertId: 'alert-1',
        assessment: {
          summary: 'Add setup details to the issue description.',
          recommendation: 'Apply the change to the issue body.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'change_state',
            targetEntityType: 'issue',
            targetEntityId: 'issue-1',
            description: 'Move the issue into review after adding the setup details.',
            payload: {
              state: 'in_review',
            },
          },
          citations: ['issue-context'],
        },
        debug: {
          traceUrl: null,
          branch: 'confirm_action',
          entityType: 'issue',
          entityId: 'issue-1',
          candidateSignals: ['chat_suggestion'],
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

    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fix it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    const targetLink = await screen.findByRole('link', { name: '#1 Set up project structure' });
    expect(targetLink).toHaveAttribute('href', '/documents/issue-1');
  });

  it('uses only the active document editor text for page context', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      threadId: 'thread-1',
      runId: 'run-1',
      branch: 'inform_only',
      assessment: {
        summary: 'Read the active issue content.',
        recommendation: 'Continue.',
        branch: 'inform_only',
        proposedAction: null,
        citations: [],
      },
      alerts: [],
      message: {
        role: 'assistant',
        content: 'Read the active issue content.',
        assessment: {
          summary: 'Read the active issue content.',
          recommendation: 'Continue.',
          branch: 'inform_only',
          citations: [],
        },
        debug: {
          traceUrl: null,
          branch: 'inform_only',
          entityType: 'issue',
          entityId: 'issue-1',
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

    const activeEditor = document.createElement('div');
    activeEditor.innerHTML = '<div data-fleetgraph-editor="document" data-document-id="issue-1"><div class="ProseMirror">Active issue body</div></div>';
    const unrelatedEditor = document.createElement('div');
    unrelatedEditor.innerHTML = '<div data-fleetgraph-editor="document" data-document-id="other-doc"><div class="ProseMirror">Wrong unrelated editor body that should not be read</div></div>';
    document.body.append(activeEditor, unrelatedEditor);

    render(
      <FleetGraphChat
        entityType="issue"
        entityId="issue-1"
        workspaceId="ws-1"
        pageContext={{
          route: '/documents/issue-1',
          surface: 'issue',
          documentId: 'issue-1',
          title: 'Issue: Set up project structure',
        }}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'what is on this page?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });
    expect(mockMutateAsync.mock.calls[0]?.[0]?.pageContext?.visibleContentText).toBe('Active issue body');

    activeEditor.remove();
    unrelatedEditor.remove();
  });

  it('shows the completed target ticket after approval succeeds', async () => {
    mockResolveMutateAsync.mockResolvedValue({ success: true });
    mockThreadData = {
      thread: {
        id: 'thread-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        status: 'active',
        lastPageRoute: '/documents/issue-1',
        lastPageSurface: 'issue',
        lastPageDocumentId: 'issue-1',
        lastPageTitle: 'Set up project structure',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      messages: [
        {
          role: 'assistant',
          content: 'Move the issue into review after adding the setup details.',
          alertId: 'alert-1',
          assessment: {
            summary: 'Move the issue into review after adding the setup details.',
            recommendation: 'Approve the action.',
            branch: 'confirm_action',
            proposedAction: {
              actionType: 'change_state',
              targetEntityType: 'issue',
              targetEntityId: 'issue-1',
              description: 'Move the issue into review after adding the setup details.',
              payload: {
                state: 'in_review',
              },
            },
            citations: ['issue-context'],
          },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText('State updated')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: '#1 Set up project structure' })).toSatisfy((links) =>
      links.every((link) => link.getAttribute('href') === '/documents/issue-1'));
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

  it('falls back to the chat response trace URL when the assistant debug payload misses it', async () => {
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      runId: 'run-1',
      branch: 'inform_only',
      traceUrl: 'https://smith.langchain.com/public/chat-run-1/r',
      assessment: {
        summary: 'The issue is blocked on API latency.',
        recommendation: 'Inspect the latest save failures.',
        branch: 'inform_only',
        citations: ['issue-context'],
      },
      alerts: [],
      message: {
        role: 'assistant',
        content: 'The issue is blocked on API latency.',
        assessment: {
          summary: 'The issue is blocked on API latency.',
          recommendation: 'Inspect the latest save failures.',
          branch: 'inform_only',
          citations: ['issue-context'],
        },
        debug: {
          traceUrl: null,
          branch: 'inform_only',
          entityType: 'issue',
          entityId: 'issue-1',
          candidateSignals: ['stale_issue'],
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

    render(<FleetGraphChat entityType="issue" entityId="issue-1" workspaceId="ws-1" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What is blocked?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    await screen.findByText('The issue is blocked on API latency.');
    expect(await screen.findByRole('link', { name: 'Trace' })).toHaveAttribute(
      'href',
      'https://smith.langchain.com/public/chat-run-1/r',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }));

    expect(screen.getByRole('link', { name: /open trace/i })).toHaveAttribute(
      'href',
      'https://smith.langchain.com/public/chat-run-1/r',
    );
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
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

  it('keeps hydrated workspace thread messages across route and scope changes when persistAcrossScopes is enabled', () => {
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
        persistAcrossScopes
      />,
    );

    expect(screen.getByText('Persisted thread survives refresh')).toBeInTheDocument();

    rerender(
      <FleetGraphChat
        entityType="issue"
        entityId="issue-1"
        workspaceId="ws-1"
        scopeType="issue"
        persistAcrossScopes
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

  it('hides the conversation count row and resets a hydrated workspace thread when the header requests a new thread', async () => {
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
        entityType="workspace"
        entityId="ws-1"
        workspaceId="ws-1"
        scopeType="workspace"
        persistAcrossScopes
        newThreadNonce={0}
      />,
    );

    expect(screen.queryByText(/conversation \(/i)).not.toBeInTheDocument();
    expect(screen.getByText('Persisted thread survives refresh')).toBeInTheDocument();

    rerender(
      <FleetGraphChat
        entityType="workspace"
        entityId="ws-1"
        workspaceId="ws-1"
        scopeType="workspace"
        persistAcrossScopes
        newThreadNonce={1}
      />,
    );

    await waitFor(() => {
      expect(mockCreateThreadMutateAsync).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Persisted thread survives refresh')).not.toBeInTheDocument();
    });
  });
});
