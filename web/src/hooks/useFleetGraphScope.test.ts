import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseLocation = vi.fn();
const mockUseCurrentDocument = vi.fn();
const mockUseWorkspace = vi.fn();
const mockUseIssues = vi.fn();
const mockUseProjects = vi.fn();
const mockUseActiveWeeksQuery = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useLocation: () => mockUseLocation(),
  };
});

vi.mock('@/contexts/CurrentDocumentContext', () => ({
  useCurrentDocument: () => mockUseCurrentDocument(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

vi.mock('@/contexts/IssuesContext', () => ({
  useIssues: () => mockUseIssues(),
}));

vi.mock('@/contexts/ProjectsContext', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@/hooks/useWeeksQuery', () => ({
  useActiveWeeksQuery: () => mockUseActiveWeeksQuery(),
}));

import { parseScopeFromPath, useFleetGraphScope } from './useFleetGraphScope';

beforeEach(() => {
  mockUseLocation.mockReturnValue({ pathname: '/dashboard' });
  mockUseCurrentDocument.mockReturnValue({
    currentDocumentType: null,
    currentDocumentId: null,
  });
  mockUseWorkspace.mockReturnValue({
    currentWorkspace: {
      id: 'ws-1',
      name: 'Acme Workspace',
    },
  });
  mockUseIssues.mockReturnValue({ issues: [] });
  mockUseProjects.mockReturnValue({ projects: [] });
  mockUseActiveWeeksQuery.mockReturnValue({ data: null });
});

describe('parseScopeFromPath', () => {
  it('returns null for unified /documents/:id route (type comes from context)', () => {
    expect(parseScopeFromPath('/documents/abc-123')).toBeNull();
  });

  it('returns null for /documents/:id/tab routes', () => {
    expect(parseScopeFromPath('/documents/abc-123/weeks')).toBeNull();
  });

  it('parses legacy /issues/:id route', () => {
    const result = parseScopeFromPath('/issues/issue-42');
    expect(result).toEqual({ entityType: 'issue', entityId: 'issue-42' });
  });

  it('parses legacy /projects/:id route', () => {
    const result = parseScopeFromPath('/projects/proj-7');
    expect(result).toEqual({ entityType: 'project', entityId: 'proj-7' });
  });

  it('parses legacy /sprints/:id route', () => {
    const result = parseScopeFromPath('/sprints/sprint-99');
    expect(result).toEqual({ entityType: 'sprint', entityId: 'sprint-99' });
  });

  it('parses /programs/:pid/sprints/:sid route', () => {
    const result = parseScopeFromPath('/programs/prog-1/sprints/sprint-5');
    expect(result).toEqual({ entityType: 'sprint', entityId: 'sprint-5' });
  });

  it('returns null for dashboard route', () => {
    expect(parseScopeFromPath('/dashboard')).toBeNull();
  });

  it('returns null for /docs route', () => {
    expect(parseScopeFromPath('/docs')).toBeNull();
  });

  it('returns null for /team route', () => {
    expect(parseScopeFromPath('/team')).toBeNull();
  });

  it('returns null for /settings route', () => {
    expect(parseScopeFromPath('/settings')).toBeNull();
  });

  it('returns null for root path', () => {
    expect(parseScopeFromPath('/')).toBeNull();
  });

  it('returns null for /programs/:id without sprint segment', () => {
    expect(parseScopeFromPath('/programs/prog-1')).toBeNull();
  });
});

describe('useFleetGraphScope', () => {
  it('falls back to workspace scope on non-entity screens', () => {
    const { result } = renderHook(() => useFleetGraphScope());

    expect(result.current).toEqual({
      scopeType: 'workspace',
      scopeId: 'ws-1',
      scopeLabel: 'Acme Workspace',
    });
  });

  it('infers issue scope from a unified document route when issue data is already loaded', () => {
    mockUseLocation.mockReturnValue({ pathname: '/documents/issue-42/details' });
    mockUseIssues.mockReturnValue({
      issues: [{ id: 'issue-42', title: 'Fix trace propagation' }],
    });

    const { result } = renderHook(() => useFleetGraphScope());

    expect(result.current).toEqual({
      scopeType: 'issue',
      scopeId: 'issue-42',
      scopeLabel: 'Fix trace propagation',
    });
  });
});
