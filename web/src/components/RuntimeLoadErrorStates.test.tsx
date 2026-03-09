import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeekReview } from './WeekReview';
import { ProjectRetro } from './ProjectRetro';
import { StandupFeed } from './StandupFeed';

const showToast = vi.fn();
const apiGetMock = vi.fn();
const invalidateStandupStatus = vi.fn();
const mockEditor = {
  commands: {
    setContent: vi.fn(),
    clearContent: vi.fn(),
  },
  getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
  isEmpty: false,
};

vi.mock('@tiptap/react', () => ({
  useEditor: () => mockEditor,
  EditorContent: () => <div data-testid="editor-content" />,
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: {},
}));

vi.mock('@tiptap/extension-placeholder', () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock('@tiptap/extension-link', () => ({
  default: {
    configure: () => ({}),
  },
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/hooks/useStandupStatusQuery', () => ({
  useInvalidateStandupStatus: () => invalidateStandupStatus,
}));

vi.mock('@/lib/api', () => ({
  apiGet: (...args: Parameters<typeof apiGetMock>) => apiGetMock(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runtime load error states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps WeekReview in a blocking retry state after an initial load failure', async () => {
    // Risk mitigated: a failed review fetch should not drop the user into an empty editor that looks safe to overwrite.
    apiGetMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({
        is_draft: true,
        content: { type: 'doc', content: [] },
        plan_validated: null,
      }));

    render(<WeekReview sprintId="week-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/weekly review/i);
    expect(screen.queryByTestId('editor-content')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save review/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save review/i })).toBeInTheDocument();
    });
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it('keeps ProjectRetro in a blocking retry state after an initial load failure', async () => {
    // Risk mitigated: a failed retro fetch should not render a misleading blank retrospective editor.
    apiGetMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({
        is_draft: true,
        plan_validated: null,
        monetary_impact_actual: null,
        success_criteria: [],
        next_steps: null,
        content: { type: 'doc', content: [] },
        weeks: [],
        issues_summary: { total: 0, completed: 0, cancelled: 0, active: 0 },
      }));

    render(<ProjectRetro projectId="project-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/project retrospective/i);
    expect(screen.queryByTestId('editor-content')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save retrospective/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save retrospective/i })).toBeInTheDocument();
    });
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });

  it('keeps StandupFeed out of the empty-feed state after an initial load failure', async () => {
    // Risk mitigated: a failed standup fetch should not masquerade as "No standup updates yet".
    apiGetMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse([]));

    render(<StandupFeed sprintId="week-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/standups/i);
    expect(screen.queryByText(/no standup updates yet/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText(/no standup updates yet/i)).toBeInTheDocument();
    });
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });
});
