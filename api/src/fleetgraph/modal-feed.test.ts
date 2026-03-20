import { describe, it, expect } from 'vitest';
import { buildModalFeed } from './modal-feed.js';
import type { FleetGraphAlert, FleetGraphApproval } from '@ship/shared';
import type { ModalFeedContext } from './modal-feed.js';

function makeAlert(overrides: Partial<FleetGraphAlert> = {}): FleetGraphAlert {
  return {
    id: 'alert-1',
    workspaceId: 'ws-1',
    fingerprint: 'fp-1',
    signalType: 'stale_issue',
    entityType: 'issue',
    entityId: 'iss-1',
    severity: 'medium',
    summary: 'Issue has not been updated in 5 days',
    recommendation: 'Follow up with the assignee',
    citations: [],
    ownerUserId: null,
    status: 'active',
    snoozedUntil: null,
    lastSurfacedAt: '2026-03-18T10:00:00Z',
    createdAt: '2026-03-17T10:00:00Z',
    updatedAt: '2026-03-18T10:00:00Z',
    readAt: null,
    ...overrides,
  };
}

function makeApproval(overrides: Partial<FleetGraphApproval> = {}): FleetGraphApproval {
  return {
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
    ...overrides,
  };
}

const emptyContext: ModalFeedContext = {
  entityTitles: new Map(),
  parentEntityMap: new Map(),
};

describe('buildModalFeed', () => {
  it('returns empty list for no alerts', () => {
    const result = buildModalFeed([], []);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('maps alert fields to modal feed item', () => {
    const alert = makeAlert();
    const result = buildModalFeed([alert], [], emptyContext);
    expect(result.total).toBe(1);

    const item = result.items[0];
    expect(item.alertId).toBe('alert-1');
    expect(item.entityType).toBe('issue');
    expect(item.signalType).toBe('stale_issue');
    expect(item.severity).toBe('medium');
    expect(item.whatChanged).toBe('Issue has not been updated in 5 days');
    expect(item.whyThisMatters).toBe('Follow up with the assignee');
    expect(item.isActionable).toBe(false);
    expect(item.approval).toBeNull();
  });

  it('marks item actionable when pending approval exists', () => {
    const alert = makeAlert({ id: 'alert-1' });
    const approval = makeApproval({ alertId: 'alert-1', status: 'pending' });

    const result = buildModalFeed([alert], [approval], emptyContext);
    expect(result.items[0].isActionable).toBe(true);
    expect(result.items[0].approval).toEqual(approval);
    expect(result.items[0].nextDecision).toBe('Reassign to @alice');
  });

  it('does not link non-pending approvals', () => {
    const alert = makeAlert({ id: 'alert-1' });
    const approval = makeApproval({ alertId: 'alert-1', status: 'approved' });

    const result = buildModalFeed([alert], [approval], emptyContext);
    expect(result.items[0].isActionable).toBe(false);
    expect(result.items[0].approval).toBeNull();
  });

  it('sorts actionable items above inform-only', () => {
    const informAlert = makeAlert({
      id: 'alert-inform',
      severity: 'critical',
      lastSurfacedAt: '2026-03-18T12:00:00Z',
    });
    const actionAlert = makeAlert({
      id: 'alert-action',
      severity: 'low',
      lastSurfacedAt: '2026-03-18T08:00:00Z',
    });
    const approval = makeApproval({ alertId: 'alert-action', status: 'pending' });

    const result = buildModalFeed([informAlert, actionAlert], [approval], emptyContext);

    // Actionable (low + bonus 10 = 11) > inform-only (critical = 4)
    expect(result.items[0].alertId).toBe('alert-action');
    expect(result.items[1].alertId).toBe('alert-inform');
  });

  it('sorts by severity within same actionability tier', () => {
    const lowAlert = makeAlert({
      id: 'alert-low',
      severity: 'low',
      lastSurfacedAt: '2026-03-18T12:00:00Z',
    });
    const highAlert = makeAlert({
      id: 'alert-high',
      severity: 'high',
      lastSurfacedAt: '2026-03-18T08:00:00Z',
    });

    const result = buildModalFeed([lowAlert, highAlert], [], emptyContext);
    expect(result.items[0].alertId).toBe('alert-high');
    expect(result.items[1].alertId).toBe('alert-low');
  });

  it('sorts by recency within same severity', () => {
    const older = makeAlert({
      id: 'alert-older',
      severity: 'medium',
      lastSurfacedAt: '2026-03-17T10:00:00Z',
    });
    const newer = makeAlert({
      id: 'alert-newer',
      severity: 'medium',
      lastSurfacedAt: '2026-03-18T10:00:00Z',
    });

    const result = buildModalFeed([older, newer], [], emptyContext);
    expect(result.items[0].alertId).toBe('alert-newer');
    expect(result.items[1].alertId).toBe('alert-older');
  });

  it('uses signal label as title without entity title', () => {
    const alert = makeAlert({ signalType: 'scope_drift' });
    const result = buildModalFeed([alert], [], emptyContext);
    expect(result.items[0].title).toBe('Scope drift');
  });

  // -- Finding 1: Approval scope --

  it('does not link approvals for alerts the user does not have', () => {
    const alert = makeAlert({ id: 'alert-user' });
    // This approval is for a different alert the user doesn't have
    const orphanApproval = makeApproval({ alertId: 'alert-other-user', status: 'pending' });

    const result = buildModalFeed([alert], [orphanApproval], emptyContext);
    expect(result.items[0].isActionable).toBe(false);
    expect(result.items[0].approval).toBeNull();
  });

  // -- Finding 2: Parent-over-child suppression --

  it('suppresses issue alert when parent sprint has alert of equal or higher severity', () => {
    const sprintAlert = makeAlert({
      id: 'alert-sprint',
      entityType: 'sprint',
      entityId: 'sprint-1',
      signalType: 'scope_drift',
      severity: 'high',
    });
    const issueAlert = makeAlert({
      id: 'alert-issue',
      entityType: 'issue',
      entityId: 'iss-1',
      signalType: 'stale_issue',
      severity: 'medium',
    });

    const ctx: ModalFeedContext = {
      entityTitles: new Map(),
      parentEntityMap: new Map([['iss-1', ['sprint-1']]]),
    };

    const result = buildModalFeed([sprintAlert, issueAlert], [], ctx);
    expect(result.total).toBe(1);
    expect(result.items[0].alertId).toBe('alert-sprint');
  });

  it('does not suppress issue alert when parent severity is lower', () => {
    const sprintAlert = makeAlert({
      id: 'alert-sprint',
      entityType: 'sprint',
      entityId: 'sprint-1',
      severity: 'low',
    });
    const issueAlert = makeAlert({
      id: 'alert-issue',
      entityType: 'issue',
      entityId: 'iss-1',
      severity: 'high',
    });

    const ctx: ModalFeedContext = {
      entityTitles: new Map(),
      parentEntityMap: new Map([['iss-1', ['sprint-1']]]),
    };

    const result = buildModalFeed([sprintAlert, issueAlert], [], ctx);
    expect(result.total).toBe(2);
  });

  it('keeps actionable issue even when parent has higher severity alert', () => {
    const sprintAlert = makeAlert({
      id: 'alert-sprint',
      entityType: 'sprint',
      entityId: 'sprint-1',
      severity: 'critical',
    });
    const issueAlert = makeAlert({
      id: 'alert-issue',
      entityType: 'issue',
      entityId: 'iss-1',
      severity: 'low',
    });
    const approval = makeApproval({ alertId: 'alert-issue', status: 'pending' });

    const ctx: ModalFeedContext = {
      entityTitles: new Map(),
      parentEntityMap: new Map([['iss-1', ['sprint-1']]]),
    };

    const result = buildModalFeed([sprintAlert, issueAlert], [approval], ctx);
    expect(result.total).toBe(2);
    // Actionable issue should still appear
    expect(result.items.find((i) => i.alertId === 'alert-issue')).toBeDefined();
  });

  it('does not suppress when parent entity has no alert', () => {
    const issueAlert = makeAlert({
      id: 'alert-issue',
      entityType: 'issue',
      entityId: 'iss-1',
      severity: 'medium',
    });

    const ctx: ModalFeedContext = {
      entityTitles: new Map(),
      parentEntityMap: new Map([['iss-1', ['sprint-no-alert']]]),
    };

    const result = buildModalFeed([issueAlert], [], ctx);
    expect(result.total).toBe(1);
  });

  // -- Finding 4: Entity title in title --

  it('includes entity title in title when available', () => {
    const alert = makeAlert({ signalType: 'stale_issue', entityId: 'iss-1' });
    const ctx: ModalFeedContext = {
      entityTitles: new Map([['iss-1', 'Fix login bug']]),
      parentEntityMap: new Map(),
    };

    const result = buildModalFeed([alert], [], ctx);
    expect(result.items[0].title).toBe('Stale issue: Fix login bug');
  });

  it('falls back to signal label when entity title not found', () => {
    const alert = makeAlert({ signalType: 'ownership_gap', entityId: 'iss-missing' });
    const ctx: ModalFeedContext = {
      entityTitles: new Map(),
      parentEntityMap: new Map(),
    };

    const result = buildModalFeed([alert], [], ctx);
    expect(result.items[0].title).toBe('Ownership gap');
  });
});
