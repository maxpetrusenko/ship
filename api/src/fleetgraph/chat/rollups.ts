export interface RollupIssueRow {
  id: string;
  title: string;
  ticket_number: number | null;
  state: string | null;
  priority: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

export interface RollupSprintRow {
  id: string;
  title: string;
  status: string | null;
  sprint_number: string | null;
}

const ACTIVE_STATES = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'triage']);
const DEFAULT_OVERLOAD_THRESHOLD = 5;

export function buildIssueStateCounts(issues: RollupIssueRow[]) {
  const counts = {
    total: issues.length,
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    cancelled: 0,
    other: 0,
    active: 0,
  };

  for (const issue of issues) {
    const state = issue.state ?? 'backlog';
    switch (state) {
      case 'backlog':
        counts.backlog += 1;
        break;
      case 'todo':
        counts.todo += 1;
        break;
      case 'in_progress':
        counts.in_progress += 1;
        break;
      case 'in_review':
        counts.in_review += 1;
        break;
      case 'done':
        counts.done += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      default:
        counts.other += 1;
        break;
    }

    if (ACTIVE_STATES.has(state)) {
      counts.active += 1;
    }
  }

  return counts;
}

export function buildAssigneeLoadSummary(
  issues: RollupIssueRow[],
  overloadThreshold = DEFAULT_OVERLOAD_THRESHOLD,
) {
  const byAssignee = new Map<string, {
    assigneeId: string;
    assigneeName: string | null;
    totalCount: number;
    activeCount: number;
    inProgressCount: number;
    doneCount: number;
  }>();

  for (const issue of issues) {
    if (!issue.assignee_id) {
      continue;
    }

    const state = issue.state ?? 'backlog';
    const current = byAssignee.get(issue.assignee_id) ?? {
      assigneeId: issue.assignee_id,
      assigneeName: issue.assignee_name,
      totalCount: 0,
      activeCount: 0,
      inProgressCount: 0,
      doneCount: 0,
    };

    current.totalCount += 1;
    if (ACTIVE_STATES.has(state)) {
      current.activeCount += 1;
    }
    if (state === 'in_progress') {
      current.inProgressCount += 1;
    }
    if (state === 'done') {
      current.doneCount += 1;
    }

    byAssignee.set(issue.assignee_id, current);
  }

  const assigneeLoads = Array.from(byAssignee.values())
    .sort((left, right) => (
      right.activeCount - left.activeCount
      || right.totalCount - left.totalCount
      || (left.assigneeName ?? left.assigneeId).localeCompare(right.assigneeName ?? right.assigneeId)
    ));

  return {
    overloadThreshold,
    assigneeLoads,
    overloadedAssignees: assigneeLoads.filter((entry) => entry.activeCount >= overloadThreshold),
  };
}

export function summarizeSprintRows(sprints: RollupSprintRow[]) {
  return sprints.map((sprint) => ({
    id: sprint.id,
    title: sprint.title,
    status: sprint.status,
    sprintNumber: sprint.sprint_number,
  }));
}
