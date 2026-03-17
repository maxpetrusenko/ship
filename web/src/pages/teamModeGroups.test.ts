import { describe, expect, it } from 'vitest';
import { buildProgramGroups } from './teamModeGroups.ts';

describe('buildProgramGroups', () => {
  it('moves assigned people without a program out of Unassigned', () => {
    const groups = buildProgramGroups({
      users: [
        { personId: 'person-1', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
      ],
      assignments: {
        'person-1': {
          4: {
            projectId: 'project-1',
            projectName: 'Ad hoc work',
            projectColor: '#999999',
            programId: null,
            programName: null,
            emoji: null,
            color: null,
          },
        },
      },
      groupingSprintNumber: 4,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.programId).toBe('__no_program__');
    expect(groups[0]?.programName).toBe('No Program');
    expect(groups[0]?.users.map((user) => user.personId)).toEqual(['person-1']);
  });
});
