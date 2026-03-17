/**
 * FleetGraph main panel component.
 * Embedded in property sidebars to surface drift alerts, approval gates, and
 * on-demand analysis scoped to the current entity (issue/sprint/project).
 */
import { useCallback } from 'react';
import { cn } from '@/lib/cn';
import {
  useFleetGraphAlerts,
  useFleetGraphOnDemand,
  useFleetGraphResolve,
  useFleetGraphPageView,
  fleetgraphKeys,
} from '@/hooks/useFleetGraph';
import { useRealtimeEvent } from '@/hooks/useRealtimeEvents';
import { useQueryClient } from '@tanstack/react-query';
import { FleetGraphAlertCard } from './FleetGraphAlertCard';
import { FleetGraphApprovalCard } from './FleetGraphApprovalCard';
import { FleetGraphChat } from './FleetGraphChat';
import type {
  FleetGraphPanelProps,
  FleetGraphAlert,
  FleetGraphAlertResolveRequest,
  FleetGraphApproval,
} from '@ship/shared';

// ---------------------------------------------------------------------------
// Skeleton placeholder while alerts load
// ---------------------------------------------------------------------------
function AlertSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="rounded-lg border border-border/40 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded bg-border/50" />
          <div className="h-3 w-24 rounded bg-border/50" />
        </div>
        <div className="h-3 w-full rounded bg-border/40" />
        <div className="h-3 w-2/3 rounded bg-border/40" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function FleetGraphPanel({ entityType, entityId, workspaceId }: FleetGraphPanelProps) {
  const queryClient = useQueryClient();
  useFleetGraphPageView(entityType, entityId);
  const { data, isLoading, isError, refetch } = useFleetGraphAlerts(entityType, entityId);
  const onDemand = useFleetGraphOnDemand();
  const resolve = useFleetGraphResolve();

  // Realtime: invalidate scoped query when server pushes a new alert
  const handleAlertEvent = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: fleetgraphKeys.alerts(entityType, entityId),
    });
  }, [queryClient, entityType, entityId]);

  useRealtimeEvent('fleetgraph:alert', handleAlertEvent);

  // Handlers
  const handleResolve = useCallback(
    (alertId: string) => (outcome: FleetGraphAlertResolveRequest['outcome'], snoozeDurationMinutes?: number) => {
      resolve.mutate({ alertId, outcome, snoozeDurationMinutes });
    },
    [resolve],
  );

  const handleAnalyze = useCallback(() => {
    onDemand.mutate({ entityType, entityId, workspaceId });
  }, [onDemand, entityType, entityId, workspaceId]);

  // Partition active alerts into approval vs informational using real approval data
  const alerts = data?.alerts ?? [];
  const pendingApprovals: FleetGraphApproval[] = data?.pendingApprovals ?? [];
  const activeAlerts = alerts.filter((a) => a.status === 'active');

  // Build a map of alertId -> approval for quick lookup
  const approvalByAlertId = new Map<string, FleetGraphApproval>();
  for (const approval of pendingApprovals) {
    approvalByAlertId.set(approval.alertId, approval);
  }

  const approvalAlerts: Array<{ alert: FleetGraphAlert; approval: FleetGraphApproval }> = [];
  const informAlerts: FleetGraphAlert[] = [];

  for (const alert of activeAlerts) {
    const approval = approvalByAlertId.get(alert.id);
    if (approval) {
      approvalAlerts.push({ alert, approval });
    } else {
      informAlerts.push(alert);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-xs font-medium text-foreground">FleetGraph</span>
          {activeAlerts.length > 0 && (
            <span className="text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
              {activeAlerts.length}
            </span>
          )}
          {approvalAlerts.length > 0 && (
            <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">
              {approvalAlerts.length} pending
            </span>
          )}
        </div>
        <button
          onClick={handleAnalyze}
          disabled={onDemand.isPending}
          className={cn(
            'text-[11px] px-2 py-1 rounded font-medium transition-colors',
            'bg-accent/10 text-accent hover:bg-accent/20',
            'disabled:opacity-40',
          )}
        >
          {onDemand.isPending ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {/* Loading skeleton */}
      {isLoading && <AlertSkeleton />}

      {/* Error state with retry */}
      {isError && !isLoading && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center space-y-2">
          <p className="text-xs text-red-400">
            Could not load drift alerts.
          </p>
          <button
            onClick={() => refetch()}
            className="text-[11px] px-2.5 py-1 rounded font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* On-demand error (analysis failed) */}
      {onDemand.isError && (
        <p className="text-xs text-red-400 px-1">
          Analysis failed. Try again.
        </p>
      )}

      {/* Approval cards (action required, highlighted) */}
      {approvalAlerts.length > 0 && (
        <div className="space-y-2">
          {approvalAlerts.map(({ alert, approval }) => (
            <FleetGraphApprovalCard
              key={alert.id}
              alert={alert}
              proposedAction={{
                actionType: approval.actionType,
                targetEntityType: approval.targetEntityType,
                targetEntityId: approval.targetEntityId,
                description: approval.description,
                payload: approval.payload,
              }}
              onApprove={() => resolve.mutateAsync({ alertId: alert.id, outcome: 'approve' })}
              onReject={() => resolve.mutateAsync({ alertId: alert.id, outcome: 'reject' })}
              onDismiss={() => resolve.mutateAsync({ alertId: alert.id, outcome: 'dismiss' })}
              onSnooze={(minutes) => resolve.mutateAsync({ alertId: alert.id, outcome: 'snooze', snoozeDurationMinutes: minutes })}
              isActioning={resolve.isPending}
              expiresAt={approval.expiresAt}
            />
          ))}
        </div>
      )}

      {/* Informational alerts */}
      {informAlerts.length > 0 && (
        <div className="space-y-2">
          {informAlerts.map((alert) => (
            <FleetGraphAlertCard
              key={alert.id}
              alert={alert}
              onResolve={handleResolve(alert.id)}
              isResolving={resolve.isPending}
            />
          ))}
        </div>
      )}

      {/* Empty state: no drift detected */}
      {!isLoading && !isError && activeAlerts.length === 0 && (
        <div className="py-3 text-center space-y-1">
          <p className="text-xs text-muted">
            No execution drift detected for this {entityType}.
          </p>
          <p className="text-[10px] text-muted/60">
            Run Analyze to check for stale issues, scope creep, or missing standups.
          </p>
        </div>
      )}

      {/* On-demand analysis input */}
      <div className="border-t border-border pt-3">
        <FleetGraphChat
          entityType={entityType}
          entityId={entityId}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}
