import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesPanel } from './PropertiesPanel';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    isWorkspaceAdmin: false,
    currentWorkspace: { id: 'ws-1', name: 'Workspace' },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/components/sidebars/WikiSidebar', () => ({
  WikiSidebar: () => <div>Wiki Sidebar</div>,
}));

vi.mock('@/components/sidebars/IssueSidebar', () => ({
  IssueSidebar: () => <div>Issue Sidebar</div>,
}));

vi.mock('@/components/sidebars/ProjectSidebar', () => ({
  ProjectSidebar: () => <div>Project Sidebar</div>,
}));

vi.mock('@/components/sidebars/WeekSidebar', () => ({
  WeekSidebar: () => <div>Sprint Sidebar</div>,
}));

vi.mock('@/components/sidebars/ProgramSidebar', () => ({
  ProgramSidebar: () => <div>Program Sidebar</div>,
}));

vi.mock('@/components/ContentHistoryPanel', () => ({
  ContentHistoryPanel: () => <div>History Panel</div>,
}));

vi.mock('@/components/sidebars/QualityAssistant', () => ({
  PlanQualityAssistant: () => <div>Plan Quality Assistant</div>,
  RetroQualityAssistant: () => <div>Retro Quality Assistant</div>,
}));

const onUpdate = vi.fn(async () => {});

describe('PropertiesPanel', () => {
  it.each([
    {
      name: 'issue',
      document: {
        id: 'issue-1',
        title: 'Issue 1',
        document_type: 'issue',
        state: 'todo',
        priority: 'medium',
        estimate: null,
        assignee_id: null,
        program_id: null,
        sprint_id: null,
      },
      panelProps: {
        teamMembers: [],
        programs: [],
        projects: [],
      },
      expectedSidebar: 'Issue Sidebar',
    },
    {
      name: 'project',
      document: {
        id: 'project-1',
        title: 'Project 1',
        document_type: 'project',
        impact: null,
        confidence: null,
        ease: null,
        color: '#000000',
        emoji: null,
        program_id: null,
      },
      panelProps: {
        programs: [],
        people: [],
      },
      expectedSidebar: 'Project Sidebar',
    },
    {
      name: 'sprint',
      document: {
        id: 'sprint-1',
        title: 'Sprint 1',
        document_type: 'sprint',
        status: 'active',
        program_id: null,
      },
      panelProps: {
        people: [],
        existingSprints: [],
      },
      expectedSidebar: 'Sprint Sidebar',
    },
  ])('does not render FleetGraph in details for $name documents', ({ document, panelProps, expectedSidebar }) => {
    render(
      <PropertiesPanel
        document={document as never}
        panelProps={panelProps as never}
        onUpdate={onUpdate as never}
      />,
    );

    expect(screen.getByText(expectedSidebar)).toBeInTheDocument();
    expect(screen.queryByText('FleetGraph')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run fleetgraph analysis/i })).not.toBeInTheDocument();
  });
});
