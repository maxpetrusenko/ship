/**
 * Single FleetGraph alert card for inform_only branch.
 * Shows signal type, severity, summary, recommendation, citations, and timestamps.
 * Dismiss and snooze controls with loading feedback.
 */
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/date-utils';
import type { FleetGraphAlertCardProps, FleetGraphSignalType, AlertSeverity } from '@ship/shared';

const SIGNAL_LABELS: Record<FleetGraphSignalType, string> = {
  missing_standup: 'Missing Standup',
  manager_missing_standup: 'Team Member Missing Standup',
  stale_issue: 'Stale Issue',
  scope_drift: 'Scope Drift',
  approval_bottleneck: 'Approval Bottleneck',
  ownership_gap: 'Ownership Gap',
  multi_signal_cluster: 'Multiple Signals',
};

const SEVERITY_STYLES: Record<AlertSeverity, { bg: string; text: string; border: string; icon: string }> = {
  low: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  medium: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/20',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  },
  high: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  },
  critical: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

const SNOOZE_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1 day', minutes: 1440 },
];

function SignalIcon({ signalType }: { signalType: FleetGraphSignalType }) {
  const iconClass = 'w-3.5 h-3.5';
  switch (signalType) {
    case 'missing_standup':
    case 'manager_missing_standup':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'stale_issue':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      );
    case 'scope_drift':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
        </svg>
      );
    case 'approval_bottleneck':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      );
    case 'ownership_gap':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
  }
}

// Severity icon (distinct from signal icon, shows risk level)
function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium;
  return (
    <svg className={cn('w-3 h-3', style.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.icon} />
    </svg>
  );
}

export function FleetGraphAlertCard({ alert, onResolve, isResolving }: FleetGraphAlertCardProps) {
  const [showSnooze, setShowSnooze] = useState(false);
  const severity = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.medium;
  const signalLabel = SIGNAL_LABELS[alert.signalType] ?? alert.signalType;

  return (
    <div className={cn('rounded-lg border p-3 space-y-2', severity.border, severity.bg)}>
      {/* Header: signal type + severity badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={severity.text}>
            <SignalIcon signalType={alert.signalType} />
          </span>
          <span className="text-xs font-medium text-foreground">{signalLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SeverityIcon severity={alert.severity} />
          <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', severity.bg, severity.text)}>
            {alert.severity}
          </span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-foreground leading-relaxed">{alert.summary}</p>

      {/* Recommendation */}
      {alert.recommendation && (
        <p className="text-xs text-muted italic">{alert.recommendation}</p>
      )}

      {/* Citations as links */}
      {alert.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {alert.citations.map((cite, i) => {
            const isUrl = cite.startsWith('http://') || cite.startsWith('https://');
            if (isUrl) {
              return (
                <a
                  key={i}
                  href={cite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded hover:bg-accent/20 transition-colors"
                >
                  Source {i + 1}
                </a>
              );
            }
            return (
              <span key={i} className="text-[10px] text-muted bg-border/30 px-1.5 py-0.5 rounded">
                {cite}
              </span>
            );
          })}
        </div>
      )}

      {/* Timestamp */}
      <p className="text-[10px] text-muted/60">
        Detected {formatRelativeTime(alert.createdAt)}
        {alert.lastSurfacedAt !== alert.createdAt && (
          <> &middot; Last seen {formatRelativeTime(alert.lastSurfacedAt)}</>
        )}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1">
        <button
          onClick={() => onResolve('dismiss')}
          disabled={isResolving}
          className={cn(
            'text-[11px] px-2 py-1 rounded bg-border/40 text-muted transition-colors',
            'hover:text-foreground hover:bg-border/60',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          Dismiss
        </button>
        <div className="relative">
          <button
            onClick={() => setShowSnooze(!showSnooze)}
            disabled={isResolving}
            className={cn(
              'text-[11px] px-2 py-1 rounded bg-border/40 text-muted transition-colors',
              'hover:text-foreground hover:bg-border/60',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Snooze
          </button>
          {showSnooze && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSnooze(false)} />
              <div className="absolute bottom-full left-0 mb-1 z-50 flex gap-1 bg-background border border-border rounded-md shadow-lg p-1">
                {SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.minutes}
                    onClick={() => {
                      onResolve('snooze', opt.minutes);
                      setShowSnooze(false);
                    }}
                    className="text-[10px] px-2 py-1 rounded text-muted hover:text-foreground hover:bg-border/40 whitespace-nowrap transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
