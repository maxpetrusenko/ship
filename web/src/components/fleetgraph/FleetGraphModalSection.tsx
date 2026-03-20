/**
 * FleetGraph section rendered inside ActionItemsModal.
 * Shows server-prioritized findings below accountability items.
 * Rows collapse/expand in place; actions use existing resolve endpoint.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useFleetGraphModalFeed, useFleetGraphResolve } from '@/hooks/useFleetGraph';
import type {
  FleetGraphModalFeedItem,
  AlertSeverity,
  FleetGraphSignalType,
} from '@ship/shared';

// -------------------------------------------------------------------------
// Severity styles (same palette as AlertCard)
// -------------------------------------------------------------------------

const SEVERITY_STYLES: Record<AlertSeverity, { bg: string; text: string; dot: string }> = {
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
};

const SNOOZE_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1 day', minutes: 1440 },
];

const SIGNAL_ICONS: Record<FleetGraphSignalType, string> = {
  missing_standup: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  manager_missing_standup: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  stale_issue: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  scope_drift: 'M13 17h8m0 0V9m0 8l-8-8-4 4-6-6',
  approval_bottleneck: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  ownership_gap: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  multi_signal_cluster: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  chat_suggestion: 'M13 10V3L4 14h7v7l9-11h-7z',
};

// -------------------------------------------------------------------------
// Single row
// -------------------------------------------------------------------------

function FleetGraphModalRow({
  item,
  onClose,
}: {
  item: FleetGraphModalFeedItem;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const navigate = useNavigate();
  const resolve = useFleetGraphResolve();
  const severity = SEVERITY_STYLES[item.severity];
  const iconPath = SIGNAL_ICONS[item.signalType] ?? SIGNAL_ICONS.chat_suggestion;

  const handleSkip = () => {
    resolve.mutate({
      alertId: item.alertId,
      outcome: 'dismiss',
      targetEntityType: item.entityType,
      targetEntityId: item.entityId,
    });
  };

  const handleSnooze = (minutes: number) => {
    resolve.mutate({
      alertId: item.alertId,
      outcome: 'snooze',
      snoozeDurationMinutes: minutes,
      targetEntityType: item.entityType,
      targetEntityId: item.entityId,
    });
    setSnoozeOpen(false);
  };

  const handleApprove = () => {
    resolve.mutate({
      alertId: item.alertId,
      outcome: 'approve',
      targetEntityType: item.entityType,
      targetEntityId: item.entityId,
    });
  };

  const handleDeny = () => {
    resolve.mutate({
      alertId: item.alertId,
      outcome: 'reject',
      targetEntityType: item.entityType,
      targetEntityId: item.entityId,
    });
  };

  const handleOpenIssue = () => {
    onClose();
    navigate(`/documents/${item.entityId}`);
  };

  const approvalLabel = item.approval
    ? `Approve ${item.approval.actionType.replace(/_/g, ' ')}`
    : 'Approve';

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-border/30 transition-colors text-left"
      >
        {/* Signal icon */}
        <span className={cn('flex items-center justify-center h-8 w-8 rounded-full flex-shrink-0', severity.bg)}>
          <svg className={cn('w-4 h-4', severity.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
          </svg>
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
            <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', severity.dot)} />
            <span className="text-xs text-muted capitalize">{item.severity}</span>
          </div>
          <p className="text-xs text-muted truncate mt-0.5">{item.whatChanged}</p>
        </div>

        {/* Actionable badge */}
        {item.isActionable && (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-accent/10 text-accent flex-shrink-0">
            Action
          </span>
        )}

        {/* Chevron */}
        <svg
          className={cn('w-4 h-4 text-muted flex-shrink-0 transition-transform', expanded && 'rotate-90')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Diagnosis fields */}
          <div className="ml-11 space-y-2 text-sm">
            <div>
              <span className="font-medium text-foreground">What changed</span>
              <p className="text-muted mt-0.5">{item.whatChanged}</p>
            </div>
            <div>
              <span className="font-medium text-foreground">Why this matters</span>
              <p className="text-muted mt-0.5">{item.whyThisMatters}</p>
            </div>
            {item.ownerLabel && (
              <div>
                <span className="font-medium text-foreground">Owner</span>
                <p className="text-muted mt-0.5">{item.ownerLabel}</p>
              </div>
            )}
            {item.nextDecision && (
              <div>
                <span className="font-medium text-foreground">Next decision</span>
                <p className="text-muted mt-0.5">{item.nextDecision}</p>
              </div>
            )}
            <div>
              <span className="font-medium text-foreground">Explain</span>
              {item.explanation ? (
                <p className="text-muted mt-0.5">{item.explanation}</p>
              ) : (
                <p className="text-muted/60 mt-0.5 text-xs italic">
                  Open {item.entityType} for detailed FleetGraph analysis
                </p>
              )}
            </div>
            <div>
              <span className="font-medium text-foreground">Show reasoning</span>
              {item.reasoning ? (
                <p className="text-muted mt-0.5">{item.reasoning}</p>
              ) : (
                <p className="text-muted/60 mt-0.5 text-xs italic">
                  Reasoning available via FleetGraph chat
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="ml-11 flex flex-wrap items-center gap-2">
            <button
              onClick={handleOpenIssue}
              className="px-2.5 py-1 text-xs font-medium rounded border border-border text-foreground hover:bg-border/50 transition-colors"
            >
              Open {item.entityType}
            </button>

            {item.isActionable && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={resolve.isPending}
                  className="px-2.5 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {approvalLabel}
                </button>
                <button
                  onClick={handleDeny}
                  disabled={resolve.isPending}
                  className="px-2.5 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  Deny
                </button>
              </>
            )}

            {/* Snooze */}
            <div className="relative">
              <button
                onClick={() => setSnoozeOpen(!snoozeOpen)}
                disabled={resolve.isPending}
                className="px-2.5 py-1 text-xs font-medium rounded border border-border text-muted hover:bg-border/50 transition-colors disabled:opacity-50"
              >
                Snooze
              </button>
              {snoozeOpen && (
                <div className="absolute left-0 top-full mt-1 z-10 bg-background border border-border rounded shadow-lg">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.minutes}
                      onClick={() => handleSnooze(opt.minutes)}
                      className="block w-full px-3 py-1.5 text-xs text-left text-foreground hover:bg-border/50"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Skip (maps to dismiss) */}
            {!item.isActionable && (
              <button
                onClick={handleSkip}
                disabled={resolve.isPending}
                className="px-2.5 py-1 text-xs font-medium rounded border border-border text-muted hover:bg-border/50 transition-colors disabled:opacity-50"
              >
                Skip
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Section
// -------------------------------------------------------------------------

export interface FleetGraphModalSectionProps {
  onClose: () => void;
}

export function FleetGraphModalSection({ onClose }: FleetGraphModalSectionProps) {
  const { data, isLoading } = useFleetGraphModalFeed();
  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-xs">Loading FleetGraph findings...</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-border/20">
        <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          FleetGraph
        </span>
        <span className="text-xs text-muted">
          {items.length} finding{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Items */}
      {items.map((item) => (
        <FleetGraphModalRow key={item.alertId} item={item} onClose={onClose} />
      ))}
    </div>
  );
}
