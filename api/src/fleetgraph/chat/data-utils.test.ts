import { describe, expect, it } from 'vitest';
import { detectProjectDrift } from './data-utils.js';

describe('detectProjectDrift', () => {
  it('keeps bug-fix support work aligned when related issue titles match project topic', () => {
    const result = detectProjectDrift(
      {
        id: 'proj-1',
        title: 'Authentication - Bug Fixes',
        properties: {
          plan: 'Resolve auth defects to improve retention and reduce support costs.',
        },
        content: null,
      },
      [
        {
          id: 'iss-1',
          title: 'Add auth tests',
          state: 'todo',
          priority: 'medium',
          ticket_number: 7,
        },
      ],
    );

    expect(result.scopeDrift).toBe(false);
    expect(result.evidence.alignedIssueTitles).toEqual(['Add auth tests']);
    expect(result.evidence.offTopicIssueTitles).toEqual([]);
  });

  it('flags project drift when several related issue titles are off-topic', () => {
    const result = detectProjectDrift(
      {
        id: 'proj-1',
        title: 'Authentication - Bug Fixes',
        properties: {
          plan: 'Resolve auth defects to improve retention and reduce support costs.',
        },
        content: null,
      },
      [
        {
          id: 'iss-1',
          title: 'Launch summer campaign landing page',
          state: 'todo',
          priority: 'medium',
          ticket_number: 8,
        },
        {
          id: 'iss-2',
          title: 'Redesign pricing hero animation',
          state: 'todo',
          priority: 'low',
          ticket_number: 9,
        },
      ],
    );

    expect(result.scopeDrift).toBe(true);
    expect(result.reason).toBe('related_issue_topic_mismatch');
    expect(result.evidence.offTopicIssueTitles).toEqual([
      'Launch summer campaign landing page',
      'Redesign pricing hero animation',
    ]);
  });
});
