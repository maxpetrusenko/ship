import { describe, expect, it } from 'vitest';
import type { FleetGraphCandidate } from '@ship/shared';
import { REASONING_SYSTEM_PROMPT } from './nodes.js';
import { sortCandidatesByPriority } from './candidate-priority.js';

function makeCandidate(
  signalType: FleetGraphCandidate['signalType'],
): FleetGraphCandidate {
  return {
    signalType,
    entityType: 'issue',
    entityId: `issue-${signalType}`,
    severity: 'medium',
    evidence: {},
    ownerUserId: 'user-1',
    fingerprint: `fp-${signalType}`,
  };
}

describe('FleetGraph candidate priority', () => {
  it('sorts stale issues ahead of approval bottlenecks', () => {
    const sorted = sortCandidatesByPriority([
      makeCandidate('approval_bottleneck'),
      makeCandidate('stale_issue'),
    ]);

    expect(sorted.map((candidate) => candidate.signalType)).toEqual([
      'stale_issue',
      'approval_bottleneck',
    ]);
  });

  it('tells reasoning to lead with staleness before approval delay', () => {
    expect(REASONING_SYSTEM_PROMPT).toContain('lead with the stale_issue signal first');
    expect(REASONING_SYSTEM_PROMPT).toContain('pending approval as secondary context');
  });
});
