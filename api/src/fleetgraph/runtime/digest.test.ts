import { describe, expect, it } from 'vitest';
import type { ShipIssueSummary, ShipProject, ShipSprint } from '../data/types.js';
import { computeFleetGraphEntityDigest } from './digest.js';

function makeSprint(overrides: Partial<ShipSprint> = {}): ShipSprint {
  return {
    id: 'sprint-1',
    title: 'Sprint 1',
    properties: {
      sprint_number: 1,
      status: 'active',
      owner_id: 'user-1',
    },
    created_at: '2026-03-17T00:00:00.000Z',
    updated_at: '2026-03-17T00:00:00.000Z',
    ...overrides,
  } as ShipSprint;
}

function makeIssue(overrides: Partial<ShipIssueSummary> = {}): ShipIssueSummary {
  return {
    id: 'issue-1',
    title: 'Issue 1',
    state: 'in_progress',
    priority: 'high',
    assignee_id: 'user-1',
    ticket_number: 1,
    display_id: 'SHIP-1',
    updated_at: '2026-03-17T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    belongs_to: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<ShipProject> = {}): ShipProject {
  return {
    id: 'project-1',
    title: 'Project 1',
    document_type: 'project',
    properties: {
      owner_id: 'user-1',
      status: 'active',
      plan: 'Stabilize auth bugs.',
    },
    content: {},
    created_at: '2026-03-17T00:00:00.000Z',
    updated_at: '2026-03-17T00:00:00.000Z',
    created_by: 'user-1',
    belongs_to: [],
    ...overrides,
  } as ShipProject;
}

describe('computeFleetGraphEntityDigest', () => {
  it('changes sprint digest when issue membership changes', () => {
    const sprint = makeSprint();
    const baseline = computeFleetGraphEntityDigest('sprint', { sprint, issues: [] });
    const withIssue = computeFleetGraphEntityDigest('sprint', {
      sprint,
      issues: [makeIssue({ id: 'issue-added', title: 'New issue' })],
      projectIds: ['project-1'],
    });

    expect(withIssue).not.toBe(baseline);
  });

  it('changes project digest when contributing sprint set changes', () => {
    const project = makeProject();
    const issue = makeIssue({
      id: 'issue-project',
      belongs_to: [{ id: 'project-1', type: 'project', title: 'Project 1' }],
    });
    const digestOneSprint = computeFleetGraphEntityDigest('project', {
      project,
      issues: [issue],
      sprintIds: ['sprint-1'],
    });
    const digestTwoSprints = computeFleetGraphEntityDigest('project', {
      project,
      issues: [issue],
      sprintIds: ['sprint-1', 'sprint-2'],
    });

    expect(digestTwoSprints).not.toBe(digestOneSprint);
  });
});
