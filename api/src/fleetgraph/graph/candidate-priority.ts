import type { FleetGraphCandidate, FleetGraphSignalType } from '@ship/shared';

const SIGNAL_PRIORITY: Record<FleetGraphSignalType, number> = {
  stale_issue: 10,
  missing_standup: 20,
  approval_bottleneck: 30,
  scope_drift: 40,
  manager_missing_standup: 50,
  ownership_gap: 60,
  multi_signal_cluster: 70,
  chat_suggestion: 80,
};

export function sortCandidatesByPriority(
  candidates: FleetGraphCandidate[],
): FleetGraphCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftPriority = SIGNAL_PRIORITY[left.signalType] ?? 999;
    const rightPriority = SIGNAL_PRIORITY[right.signalType] ?? 999;
    return leftPriority - rightPriority;
  });
}
