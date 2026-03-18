/**
 * FleetGraph notification center dropdown.
 * Shows a scrollable list of active alerts with severity indicators,
 * relative timestamps, entity context, and manager-focused CTAs.
 */
import { useState, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/date-utils';
import type {
  FleetGraphAlert,
  FleetGraphSignalType,
  AlertSeverity,
} from '@ship/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNAL_LABELS: Record<FleetGraphSignalType, string> = {
  missing_standup: 'Missing Standup',
  manager_missing_standup: 'Manager Missing Standup',
  stale_issue: 'Stale Issue',
  scope_drift: 'Scope Drift',
  approval_bottleneck: 'Approval Bottleneck',
  ownership_gap: 'Ownership Gap',
  multi_signal_cluster: 'Multiple Signals',
  chat_suggestion: 'Chat Suggestion',
};

const SEVERITY_CONFIG: Record<AlertSeverity, { dot: string; bg: string; text: string }> = {
  low: { dot: 'bg-blue-400', bg: 'bg-blue-500/5', text: 'text-blue-400' },
  medium: { dot: 'bg-yellow-400', bg: 'bg-yellow-500/5', text: 'text-yellow-400' },
  high: { dot: 'bg-orange-400', bg: 'bg-orange-500/5', text: 'text-orange-400' },
  critical: { dot: 'bg-red-400', bg: 'bg-red-500/5', text: 'text-red-400' },
};

const SNOOZE_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1 day', minutes: 1440 },
];

const ENTITY_CTA_LABELS: Record<string, string> = {
  issue: 'View Issue',
  sprint: 'View Sprint',
  project: 'View Project',
  workspace: 'View Workspace',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FleetGraphNotificationCenterProps {
  alerts: FleetGraphAlert[];
  onDismiss: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onMarkAllRead: () => void;
  onOpenContext: (alert: FleetGraphAlert) => void;
  isDismissing?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FleetGraphNotificationCenter({
  alerts,
  onDismiss,
  onSnooze,
  onMarkAllRead,
  onOpenContext,
  isDismissing,
}: FleetGraphNotificationCenterProps) {
  const activeAlerts = alerts.filter((a) => a.status === 'active');

  return (
    <div
      data-testid="fleetgraph-notification-center"
      className={cn(
        'absolute right-0 top-full mt-2 z-[9999]',
        'w-80 max-h-[420px] rounded-lg border border-border',
        'bg-background shadow-xl flex flex-col overflow-hidden',
      )}
      role="dialog"
      aria-label="FleetGraph notifications"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-border/10">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-xs font-medium text-foreground">Notifications</span>
          {activeAlerts.length > 0 && (
            <span className="text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
              {activeAlerts.length}
            </span>
          )}
        </div>
        {activeAlerts.length > 0 && (
          <button
            onClick={onMarkAllRead}
            disabled={isDismissing}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
              'text-muted hover:text-foreground hover:bg-border/40',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto">
        {activeAlerts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/40">
            {activeAlerts.map((alert) => (
              <NotificationRow
                key={alert.id}
                alert={alert}
                onDismiss={onDismiss}
                onSnooze={onSnooze}
                onOpenContext={onOpenContext}
                isDismissing={isDismissing}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

function NotificationRow({
  alert,
  onDismiss,
  onSnooze,
  onOpenContext,
  isDismissing,
}: {
  alert: FleetGraphAlert;
  onDismiss: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onOpenContext: (alert: FleetGraphAlert) => void;
  isDismissing?: boolean;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  const severity = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.medium;
  const signalLabel = SIGNAL_LABELS[alert.signalType] ?? alert.signalType;

  const handleDismiss = useCallback(() => {
    onDismiss(alert.id);
  }, [onDismiss, alert.id]);

  const handleSnooze = useCallback(
    (minutes: number) => {
      onSnooze(alert.id, minutes);
      setShowSnooze(false);
    },
    [onSnooze, alert.id],
  );

  return (
    <li
      data-testid="notification-row"
      className={cn('px-3 py-2.5 hover:bg-border/10 transition-colors', severity.bg)}
    >
      {/* Top: severity dot + signal label + timestamp */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', severity.dot)} />
          <span className={cn('text-[11px] font-medium', severity.text)}>{signalLabel}</span>
        </div>
        <span className="text-[10px] text-muted/60">{formatRelativeTime(alert.createdAt)}</span>
      </div>

      {/* Summary */}
      <p className="text-xs text-foreground leading-relaxed mb-1 line-clamp-2">
        {alert.summary}
      </p>

      {/* Entity context */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-muted bg-border/40 px-1.5 py-0.5 rounded capitalize">
          {alert.entityType}
        </span>
        {alert.ownerUserId && (
          <span className="text-[10px] text-muted/60">
            Owner: {alert.ownerUserId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* CTAs */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onOpenContext(alert)}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
            'bg-accent/10 text-accent hover:bg-accent/20',
          )}
        >
          {ENTITY_CTA_LABELS[alert.entityType] ?? 'View Details'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={isDismissing}
          className={cn(
            'text-[10px] px-2 py-0.5 rounded transition-colors',
            'bg-border/40 text-muted hover:text-foreground hover:bg-border/60',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          Dismiss
        </button>
        <div className="relative">
          <button
            onClick={() => setShowSnooze(!showSnooze)}
            disabled={isDismissing}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded transition-colors',
              'bg-border/40 text-muted hover:text-foreground hover:bg-border/60',
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
                    onClick={() => handleSnooze(opt.minutes)}
                    className="text-[10px] px-2 py-0.5 rounded text-muted hover:text-foreground hover:bg-border/40 whitespace-nowrap transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="py-8 text-center space-y-2">
      <svg className="w-8 h-8 mx-auto text-muted/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      <p className="text-xs text-muted">No new notifications</p>
      <p className="text-[10px] text-muted/60">
        FleetGraph will surface drift alerts here.
      </p>
    </div>
  );
}
