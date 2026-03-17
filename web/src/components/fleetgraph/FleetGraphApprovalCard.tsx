/**
 * FleetGraph approval card for confirm_action branch alerts.
 * Shows proposed action details with Approve, Reject, Dismiss, Snooze controls.
 * Includes expiry countdown when expiresAt is provided (Phase 2C).
 * Disables all buttons while an action is processing or after resolution.
 */
import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/date-utils';
import type { FleetGraphApprovalCardProps } from '@ship/shared';

const SNOOZE_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1 day', minutes: 1440 },
];

type ActionTaken = 'approve' | 'reject' | 'dismiss' | 'snooze';

function useCountdown(expiresAt: string | undefined): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!expiresAt) return;

    function update() {
      const diff = new Date(expiresAt!).getTime() - Date.now();
      // Treat sub-minute as expired to prevent "0m" actionable window
      if (diff < 60_000) {
        setRemaining('Expired');
        return;
      }
      const hours = Math.floor(diff / 3_600_000);
      const mins = Math.floor((diff % 3_600_000) / 60_000);
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setRemaining(`${days}d ${hours % 24}h`);
      } else if (hours > 0) {
        setRemaining(`${hours}h ${mins}m`);
      } else {
        setRemaining(`${mins}m`);
      }
    }

    update();
    // Use shorter interval when close to expiry for tighter enforcement
    const interval = setInterval(update, 15_000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

export function FleetGraphApprovalCard({
  alert,
  proposedAction,
  onApprove,
  onReject,
  onDismiss,
  onSnooze,
  isActioning,
  expiresAt,
}: FleetGraphApprovalCardProps) {
  const [acted, setActed] = useState<ActionTaken | null>(null);
  const countdown = useCountdown(expiresAt);
  const disabled = isActioning || acted !== null || countdown === 'Expired';

  const handle = (action: ActionTaken, fn: () => Promise<unknown>) => async () => {
    setActed(action);
    try {
      await fn();
    } catch {
      setActed(null); // rollback on failure
    }
  };

  const handleSnooze = async (minutes: number) => {
    setActed('snooze');
    try {
      await onSnooze(minutes);
    } catch {
      setActed(null);
    }
  };

  return (
    <div className="rounded-lg border-2 border-accent/40 bg-accent/5 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-semibold text-accent uppercase tracking-wider">
            Action Required
          </span>
        </div>
        {countdown && (
          <span className={cn(
            'text-[10px] font-medium px-1.5 py-0.5 rounded',
            countdown === 'Expired'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-yellow-500/10 text-yellow-400',
          )}>
            {countdown === 'Expired' ? 'Expired' : `Expires in ${countdown}`}
          </span>
        )}
      </div>

      {/* Alert summary */}
      <p className="text-xs text-foreground leading-relaxed">{alert.summary}</p>

      {/* Proposed action details */}
      <div className="rounded border border-border bg-background/50 p-2 space-y-1">
        <div className="text-[10px] font-medium text-muted uppercase tracking-wider">
          Recommended Action
        </div>
        <p className="text-xs text-foreground font-medium">{proposedAction.description}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <span>Type: {proposedAction.actionType}</span>
          <span>Target: {proposedAction.targetEntityType} {proposedAction.targetEntityId.slice(0, 8)}</span>
        </div>
      </div>

      {/* Recommendation (only if not the [ACTION] prefix, which is already in description) */}
      {alert.recommendation && !alert.recommendation.startsWith('[ACTION]') && (
        <p className="text-xs text-muted italic">{alert.recommendation}</p>
      )}

      {/* Timestamp */}
      <p className="text-[10px] text-muted/60">
        Detected {formatRelativeTime(alert.createdAt)}
      </p>

      {/* Post-action feedback */}
      {acted && (
        <div className={cn(
          'text-[11px] font-medium px-2 py-1 rounded text-center',
          acted === 'approve' && 'bg-green-500/10 text-green-400',
          acted === 'reject' && 'bg-red-500/10 text-red-400',
          acted === 'dismiss' && 'bg-border/40 text-muted',
          acted === 'snooze' && 'bg-yellow-500/10 text-yellow-400',
        )}>
          {acted === 'approve' && 'Approved'}
          {acted === 'reject' && 'Rejected'}
          {acted === 'dismiss' && 'Dismissed'}
          {acted === 'snooze' && 'Snoozed'}
        </div>
      )}

      {/* Action buttons (hidden after action taken) */}
      {!acted && countdown !== 'Expired' && (
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={handle('approve', onApprove)}
            disabled={disabled}
            className={cn(
              'text-[11px] px-3 py-1.5 rounded font-medium transition-colors',
              'bg-accent text-white hover:bg-accent/90',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Approve
          </button>
          <button
            onClick={handle('reject', onReject)}
            disabled={disabled}
            className={cn(
              'text-[11px] px-2 py-1.5 rounded font-medium transition-colors',
              'bg-red-500/10 text-red-400 hover:bg-red-500/20',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Reject
          </button>
          <button
            onClick={handle('dismiss', onDismiss)}
            disabled={disabled}
            className={cn(
              'text-[11px] px-2 py-1.5 rounded bg-border/40 text-muted transition-colors',
              'hover:text-foreground hover:bg-border/60',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Dismiss
          </button>
          <div className="flex items-center gap-0.5 ml-auto">
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.minutes}
                onClick={() => handleSnooze(opt.minutes)}
                disabled={disabled}
                className={cn(
                  'text-[10px] px-1.5 py-1 rounded text-muted transition-colors',
                  'hover:text-foreground hover:bg-border/40',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
