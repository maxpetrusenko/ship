import { describe, expect, it } from 'vitest';
import { buildDeterministicChatAssessment, heuristicFilter, REASONING_SYSTEM_PROMPT } from './nodes.js';
import type { FleetGraphRunState, FleetGraphCandidate } from '@ship/shared';

function makeState(overrides: Partial<FleetGraphRunState> = {}): FleetGraphRunState {
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    mode: 'on_demand',
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    entityType: 'issue',
    entityId: 'issue-1',
    pageContext: null,
    coreContext: {},
    parallelSignals: {},
    candidates: [],
    branch: 'clean',
    assessment: null,
    gateOutcome: null,
    snoozeUntil: null,
    error: null,
    runStartedAt: Date.now(),
    tokenUsage: null,
    chatQuestion: null,
    chatHistory: null,
    traceUrl: null,
    ...overrides,
  };
}

describe('heuristicFilter', () => {
  it('treats a recently updated issue as active even when history is stale', async () => {
    const updatedRecently = new Date(Date.now() - 12 * 60 * 60_000).toISOString();
    const result = await heuristicFilter(
      makeState({
        coreContext: {
          entity: {
            updated_at: updatedRecently,
            properties: {
              state: 'in_progress',
            },
          },
        },
        parallelSignals: {
          lastActivityDays: 7,
        },
      }),
    );

    expect(result.branch).toBe('clean');
    expect(result.candidates).toEqual([]);
  });

  it('creates a stale issue candidate for issue entities past the threshold', async () => {
    const updatedAt = new Date(Date.now() - 4 * 24 * 60 * 60_000).toISOString();
    const result = await heuristicFilter(
      makeState({
        entityType: 'issue',
        entityId: 'issue-stale',
        coreContext: {
          entity: {
            updated_at: updatedAt,
            properties: {
              state: 'in_progress',
            },
          },
        },
        parallelSignals: {
          missingStandup: false,
          pendingApprovalDays: 0,
          scopeDrift: false,
          managerActionItems: [],
        },
      }),
    );

    const staleCandidates = result.candidates!.filter(
      (c: FleetGraphCandidate) => c.signalType === 'stale_issue',
    );
    expect(staleCandidates).toHaveLength(1);
    expect(result.branch).toBe('inform_only');
    expect(staleCandidates[0]).toMatchObject({
      entityType: 'issue',
      entityId: 'issue-stale',
      severity: 'medium',
    });
  });

  it('does not create a stale issue candidate for done issues', async () => {
    const updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    const result = await heuristicFilter(
      makeState({
        entityType: 'issue',
        entityId: 'issue-done',
        coreContext: {
          entity: {
            updated_at: updatedAt,
            properties: {
              state: 'done',
            },
          },
        },
        parallelSignals: {
          lastActivityDays: 8,
          missingStandup: false,
          pendingApprovalDays: 0,
          scopeDrift: false,
          managerActionItems: [],
        },
      }),
    );

    const staleCandidates = result.candidates!.filter(
      (c: FleetGraphCandidate) => c.signalType === 'stale_issue',
    );
    expect(staleCandidates).toHaveLength(0);
  });

  it('creates a scope drift candidate for issue history regressions', async () => {
    const result = await heuristicFilter(
      makeState({
        entityType: 'issue',
        entityId: 'issue-drift',
        coreContext: {
          entity: {
            updated_at: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
            properties: {
              state: 'in_progress',
            },
          },
        },
        parallelSignals: {
          lastActivityDays: 1,
          missingStandup: false,
          pendingApprovalDays: 0,
          scopeDrift: true,
          managerActionItems: [],
        },
      }),
    );

    const driftCandidates = result.candidates!.filter(
      (c: FleetGraphCandidate) => c.signalType === 'scope_drift',
    );
    expect(driftCandidates).toHaveLength(1);
    expect(result.branch).toBe('inform_only');
    expect(driftCandidates[0]).toMatchObject({
      entityType: 'issue',
      entityId: 'issue-drift',
      severity: 'high',
    });
  });

  it('creates a scope drift candidate for project content that is off-topic', async () => {
    const result = await heuristicFilter(
      makeState({
        entityType: 'project',
        entityId: 'project-drift',
        coreContext: {
          entity: {
            title: 'Infrastructure Bug Fixes',
            document_type: 'project',
            properties: {
              plan: 'Stabilize auth pipeline and fix flaky deployment bugs',
            },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'lets build the plane and fly to the moon' },
                  ],
                },
              ],
            },
          },
          relatedEntities: [
            { title: 'Fix auth pipeline flakes' },
            { title: 'Repair deployment rollback bug' },
          ],
        },
        parallelSignals: {
          lastActivityDays: 0,
          missingStandup: false,
          pendingApprovalDays: 0,
          scopeDrift: false,
          managerActionItems: [],
        },
      }),
    );

    const driftCandidates = result.candidates!.filter(
      (c: FleetGraphCandidate) => c.signalType === 'scope_drift',
    );
    expect(driftCandidates).toHaveLength(1);
    expect(driftCandidates[0]).toMatchObject({
      entityType: 'project',
      entityId: 'project-drift',
      severity: 'high',
      evidence: expect.objectContaining({
        reason: 'project_content_topic_mismatch',
      }),
    });
  });

  it('keeps project content clean when it matches project topic', async () => {
    const result = await heuristicFilter(
      makeState({
        entityType: 'project',
        entityId: 'project-clean',
        coreContext: {
          entity: {
            title: 'Infrastructure Bug Fixes',
            document_type: 'project',
            properties: {
              plan: 'Stabilize auth pipeline and fix flaky deployment bugs',
            },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Fix auth pipeline bugs and deployment rollback handling this week.' },
                  ],
                },
              ],
            },
          },
          relatedEntities: [
            { title: 'Fix auth pipeline flakes' },
            { title: 'Repair deployment rollback bug' },
          ],
        },
        parallelSignals: {
          lastActivityDays: 0,
          missingStandup: false,
          pendingApprovalDays: 0,
          scopeDrift: false,
          managerActionItems: [],
        },
      }),
    );

    const driftCandidates = result.candidates!.filter(
      (c: FleetGraphCandidate) => c.signalType === 'scope_drift',
    );
    expect(driftCandidates).toHaveLength(0);
  });

  describe('manager_missing_standup signal', () => {
    it('no missed standups: clean branch', async () => {
      const result = await heuristicFilter(
        makeState({
          entityType: 'sprint',
          entityId: 'sprint-001',
          coreContext: { metadata: { ownerUserId: 'mgr-1' } },
          parallelSignals: {
            lastActivityDays: 0,
            missingStandup: false,
            pendingApprovalDays: 0,
            scopeDrift: false,
            managerActionItems: [],
          },
        }),
      );

      const mgrCandidates = result.candidates!.filter(
        (c: FleetGraphCandidate) => c.signalType === 'manager_missing_standup',
      );
      expect(mgrCandidates).toHaveLength(0);
      expect(result.branch).toBe('clean');
    });

    it('missed standup under 5 min: no alert', async () => {
      const result = await heuristicFilter(
        makeState({
          entityType: 'sprint',
          entityId: 'sprint-001',
          coreContext: { metadata: { ownerUserId: 'mgr-1' } },
          parallelSignals: {
            lastActivityDays: 0,
            missingStandup: false,
            pendingApprovalDays: 0,
            scopeDrift: false,
            managerActionItems: [
              {
                employeeName: 'Alice',
                employeeId: 'emp-alice',
                dueTime: '2026-03-17T09:00:00Z',
                overdueMinutes: 3,
                sprintId: 'sprint-001',
                sprintTitle: 'Week 1',
                projectId: null,
                projectTitle: null,
              },
            ],
          },
        }),
      );

      const mgrCandidates = result.candidates!.filter(
        (c: FleetGraphCandidate) => c.signalType === 'manager_missing_standup',
      );
      expect(mgrCandidates).toHaveLength(0);
    });

    it('missed standup at 5+ min: candidate created for manager', async () => {
      const result = await heuristicFilter(
        makeState({
          entityType: 'sprint',
          entityId: 'sprint-001',
          coreContext: { metadata: { ownerUserId: 'mgr-1' } },
          parallelSignals: {
            lastActivityDays: 0,
            missingStandup: false,
            pendingApprovalDays: 0,
            scopeDrift: false,
            managerActionItems: [
              {
                employeeName: 'Bob',
                employeeId: 'emp-bob',
                dueTime: '2026-03-17T09:00:00Z',
                overdueMinutes: 20,
                sprintId: 'sprint-001',
                sprintTitle: 'Week 1',
                projectId: 'proj-001',
                projectTitle: 'Project A',
              },
            ],
          },
        }),
      );

      const mgrCandidates = result.candidates!.filter(
        (c: FleetGraphCandidate) => c.signalType === 'manager_missing_standup',
      );
      expect(mgrCandidates).toHaveLength(1);
      expect(result.branch).toBe('inform_only');

      const candidate = mgrCandidates[0];
      expect(candidate.severity).toBe('medium');
      expect(candidate.entityType).toBe('sprint');
      expect(candidate.entityId).toBe('sprint-001');
      expect(candidate.ownerUserId).toBe('mgr-1');
      expect(candidate.evidence).toMatchObject({
        employeeName: 'Bob',
        employeeId: 'emp-bob',
        overdueMinutes: 20,
      });
      expect(candidate.fingerprint).toContain('manager_missing_standup');
      expect(candidate.fingerprint).toContain('emp-bob');
    });

    it('escalates to high severity at 60+ min overdue', async () => {
      const result = await heuristicFilter(
        makeState({
          entityType: 'sprint',
          entityId: 'sprint-002',
          coreContext: { metadata: { ownerUserId: 'mgr-1' } },
          parallelSignals: {
            lastActivityDays: 0,
            missingStandup: false,
            pendingApprovalDays: 0,
            scopeDrift: false,
            managerActionItems: [
              {
                employeeName: 'Charlie',
                employeeId: 'emp-charlie',
                dueTime: '2026-03-17T09:00:00Z',
                overdueMinutes: 90,
                sprintId: 'sprint-002',
                sprintTitle: 'Week 2',
                projectId: null,
                projectTitle: null,
              },
            ],
          },
        }),
      );

      const mgrCandidates = result.candidates!.filter(
        (c: FleetGraphCandidate) => c.signalType === 'manager_missing_standup',
      );
      expect(mgrCandidates).toHaveLength(1);
      expect(mgrCandidates[0].severity).toBe('high');
    });
  });
});

describe('REASONING_SYSTEM_PROMPT', () => {
  it('keeps FleetGraph chat Ship-only, short, and scope-bound', () => {
    expect(REASONING_SYSTEM_PROMPT).toContain('If userQuestion is unrelated to Ship');
    expect(REASONING_SYSTEM_PROMPT).toContain('Keep chat answers short');
    expect(REASONING_SYSTEM_PROMPT).toContain('Stay inside the provided Ship scope');
    expect(REASONING_SYSTEM_PROMPT).not.toContain('answer it briefly and naturally');
  });
});

describe('buildDeterministicChatAssessment', () => {
  it('answers overdue-item questions with exact overall and scoped counts', () => {
    const assessment = buildDeterministicChatAssessment(
      makeState({
        entityType: 'sprint',
        entityId: 'sprint-14',
        chatQuestion: 'overdue items?',
        coreContext: {
          entity: {
            id: 'sprint-14',
            title: 'Week 14',
            sprint_number: 14,
          },
        },
        parallelSignals: {
          accountability: {
            items: [
              {
                id: 'week-issues-sprint-11',
                title: 'Add issues to Week 11',
                accountability_type: 'week_issues',
                accountability_target_id: 'sprint-11',
                target_title: 'Week 11',
                due_date: '2026-02-25',
                days_overdue: 21,
                person_id: null,
                project_id: null,
                week_number: 11,
              },
              {
                id: 'weekly-plan-project-1-14',
                title: 'Write week 14 plan for Ship Core - Core Features',
                accountability_type: 'weekly_plan',
                accountability_target_id: 'project-1',
                target_title: 'Week 14 Plan - Ship Core - Core Features',
                due_date: '2026-03-15',
                days_overdue: 2,
                person_id: 'person-1',
                project_id: 'project-1',
                week_number: 14,
              },
              {
                id: 'weekly-retro-project-1-14',
                title: 'Write week 14 retro for Ship Core - Bug Fixes',
                accountability_type: 'weekly_retro',
                accountability_target_id: 'project-2',
                target_title: 'Week 14 Retro - Ship Core - Bug Fixes',
                due_date: '2026-03-15',
                days_overdue: 2,
                person_id: 'person-1',
                project_id: 'project-2',
                week_number: 14,
              },
            ],
          },
          managerActionItems: [],
        },
      }),
    );

    expect(assessment).toBeTruthy();
    expect(assessment?.summary).toContain('3 overdue accountability items overall');
    expect(assessment?.summary).toContain('2 tied to this sprint');
    expect(assessment?.recommendation).toContain('Write week 14 plan');
    expect(assessment?.citations).toContain('accountability:overall_overdue=3');
    expect(assessment?.citations).toContain('accountability:scope_overdue=2');
  });
});
