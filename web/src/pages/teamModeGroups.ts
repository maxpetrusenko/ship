interface UserLike {
  personId: string;
  name: string;
}

interface AssignmentLike {
  projectId: string | null;
  programId: string | null;
  programName: string | null;
  emoji?: string | null;
  color: string | null;
}

interface ProgramGroup<TUser extends UserLike> {
  programId: string | null;
  programName: string;
  emoji: string | null;
  color: string | null;
  users: TUser[];
}

interface BuildProgramGroupsArgs<TUser extends UserLike> {
  users: TUser[];
  assignments: Record<string, Record<number, AssignmentLike>>;
  groupingSprintNumber: number | null;
}

const UNASSIGNED_KEY = '__unassigned__';
const NO_PROGRAM_KEY = '__no_program__';

export function buildProgramGroups<TUser extends UserLike>({
  users,
  assignments,
  groupingSprintNumber,
}: BuildProgramGroupsArgs<TUser>): ProgramGroup<TUser>[] {
  const groups = new Map<string, ProgramGroup<TUser>>();

  for (const user of users) {
    const currentAssignment = groupingSprintNumber
      ? assignments[user.personId]?.[groupingSprintNumber]
      : null;

    const hasAssignedProject = Boolean(currentAssignment?.projectId);
    const groupKey = hasAssignedProject
      ? currentAssignment?.programId || NO_PROGRAM_KEY
      : UNASSIGNED_KEY;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        programId: groupKey === NO_PROGRAM_KEY ? NO_PROGRAM_KEY : currentAssignment?.programId || null,
        programName: hasAssignedProject
          ? currentAssignment?.programName || 'No Program'
          : 'Unassigned',
        emoji: hasAssignedProject ? currentAssignment?.emoji || null : null,
        color: hasAssignedProject ? currentAssignment?.color || null : null,
        users: [],
      });
    }

    groups.get(groupKey)!.users.push(user);
  }

  const sortedGroups = Array.from(groups.values()).sort((left, right) => {
    const leftUnassigned = left.programId === null;
    const rightUnassigned = right.programId === null;

    if (leftUnassigned) return 1;
    if (rightUnassigned) return -1;

    if (left.programId === NO_PROGRAM_KEY && right.programId !== NO_PROGRAM_KEY) return 1;
    if (right.programId === NO_PROGRAM_KEY && left.programId !== NO_PROGRAM_KEY) return -1;

    return left.programName.localeCompare(right.programName);
  });

  for (const group of sortedGroups) {
    group.users.sort((left, right) => left.name.localeCompare(right.name));
  }

  return sortedGroups;
}
