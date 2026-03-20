/**
 * React Query hooks for FleetGraph API.
 * Delegates CSRF + auth to the shared api.ts helpers.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { issueKeys } from '@/hooks/useIssuesQuery';
import type {
  FleetGraphEntityType,
  FleetGraphAlertsResponse,
  FleetGraphAlertResolveRequest,
  FleetGraphOnDemandResponse,
  FleetGraphDemoSeedResponse,
  FleetGraphChatResponse,
  FleetGraphChatThreadResponse,
  FleetGraphCreateChatThreadResponse,
  FleetGraphStatusResponse,
  FleetGraphModalFeedResponse,
  FleetGraphPageContext,
} from '@ship/shared';

/** @deprecated kept for test compat; CSRF now managed by api.ts */
export function clearQuietCsrfToken(): void {
  // no-op: CSRF token lifecycle managed by @/lib/api
}

// -------------------------------------------------------------------------
// Query keys
// -------------------------------------------------------------------------

export const fleetgraphKeys = {
  all: ['fleetgraph'] as const,
  alerts: (entityType?: string, entityId?: string) =>
    [...fleetgraphKeys.all, 'alerts', entityType, entityId] as const,
  allAlerts: () => [...fleetgraphKeys.all, 'alerts-all'] as const,
  status: () => [...fleetgraphKeys.all, 'status'] as const,
  thread: (entityType?: string, entityId?: string) =>
    [...fleetgraphKeys.all, 'thread', entityType, entityId] as const,
  modalFeed: () => [...fleetgraphKeys.all, 'modal-feed'] as const,
};

async function buildResponseError(response: Response, fallback: string): Promise<Error> {
  let detail = '';

  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const payload = await response.clone().json() as {
        error?: string | { message?: string };
      };
      if (typeof payload.error === 'string') {
        detail = payload.error;
      } else if (typeof payload.error?.message === 'string') {
        detail = payload.error.message;
      }
    } catch {
      // Ignore JSON parse failures and fall back to text below.
    }
  }

  if (!detail) {
    try {
      detail = (await response.clone().text()).trim();
    } catch {
      detail = '';
    }
  }

  const statusLabel = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  return new Error(
    detail
      ? `${fallback} (${statusLabel}): ${detail}`
      : `${fallback} (${statusLabel})`,
  );
}

// -------------------------------------------------------------------------
// Queries
// -------------------------------------------------------------------------

export function useFleetGraphAlerts(
  entityType?: FleetGraphEntityType,
  entityId?: string,
) {
  return useQuery<FleetGraphAlertsResponse>({
    queryKey: fleetgraphKeys.alerts(entityType, entityId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (entityId) params.set('entityId', entityId);
      const qs = params.toString();
      const url = `/api/fleetgraph/alerts${qs ? `?${qs}` : ''}`;
      const res = await apiGet(url);
      if (!res.ok) throw new Error('Failed to fetch alerts');
      return res.json();
    },
    enabled: !!entityType && !!entityId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useFleetGraphStatus() {
  return useQuery<FleetGraphStatusResponse>({
    queryKey: fleetgraphKeys.status(),
    queryFn: async () => {
      const res = await apiGet('/api/fleetgraph/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    staleTime: 60_000,
  });
}

/**
 * Server-prioritized FleetGraph items for the ActionItemsModal.
 * Invalidated on fleetgraph:alert events and resolve actions.
 */
export function useFleetGraphModalFeed() {
  return useQuery<FleetGraphModalFeedResponse>({
    queryKey: fleetgraphKeys.modalFeed(),
    queryFn: async () => {
      const res = await apiGet('/api/fleetgraph/modal-feed');
      if (!res.ok) throw new Error('Failed to fetch modal feed');
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// -------------------------------------------------------------------------
// Mutations
// -------------------------------------------------------------------------

export function useFleetGraphOnDemand() {
  const queryClient = useQueryClient();

  return useMutation<
    FleetGraphOnDemandResponse,
    Error,
    { entityType: FleetGraphEntityType; entityId: string; workspaceId: string; question?: string }
  >({
    mutationFn: async (params) => {
      console.log('[FleetGraph] mutationFn firing, POST /api/fleetgraph/on-demand', params);
      const res = await apiPost('/api/fleetgraph/on-demand', params);
      console.log('[FleetGraph] on-demand response:', res.status, res.statusText);
      if (!res.ok) throw new Error(`on-demand analysis failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (data, variables) => {
      console.log('[FleetGraph] on-demand result:', {
        runId: data.runId,
        branch: data.branch,
        alertCount: data.alerts?.length ?? 0,
        hasAssessment: !!data.assessment,
        assessment: data.assessment,
        traceUrl: data.traceUrl,
      });
      queryClient.invalidateQueries({
        queryKey: fleetgraphKeys.alerts(variables.entityType, variables.entityId),
      });
    },
  });
}

export function useFleetGraphSeedDemoFlow() {
  const queryClient = useQueryClient();

  return useMutation<
    FleetGraphDemoSeedResponse,
    Error,
    { entityType: FleetGraphEntityType; entityId: string }
  >({
    mutationFn: async (params) => {
      const res = await apiPost('/api/fleetgraph/demo/seed-flow', params);
      if (!res.ok) {
        throw await buildResponseError(res, 'FleetGraph demo seed failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.allAlerts() });
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.modalFeed() });
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.status() });
      queryClient.invalidateQueries({ queryKey: [...fleetgraphKeys.all, 'thread'] });
      queryClient.refetchQueries({ queryKey: [...fleetgraphKeys.all, 'thread'], type: 'active' });
    },
  });
}

export function useFleetGraphChat() {
  return useMutation<
    FleetGraphChatResponse,
    Error,
    {
      entityType: FleetGraphEntityType;
      entityId: string;
      workspaceId: string;
      question: string;
      threadId?: string;
      pageContext?: FleetGraphPageContext;
    }
  >({
    mutationFn: async (params) => {
      const res = await apiPost('/api/fleetgraph/chat', params);
      if (!res.ok) {
        throw await buildResponseError(res, 'FleetGraph chat request failed');
      }
      return res.json();
    },
  });
}

// -------------------------------------------------------------------------
// Thread persistence
// -------------------------------------------------------------------------

/** Load the active chat thread + its messages. */
export function useFleetGraphThread(
  entityType?: FleetGraphEntityType,
  entityId?: string,
) {
  return useQuery<FleetGraphChatThreadResponse>({
    queryKey: fleetgraphKeys.thread(entityType, entityId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (entityId) params.set('entityId', entityId);
      const qs = params.toString();
      const res = await apiGet(`/api/fleetgraph/chat/thread${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error('Failed to load thread');
      return res.json();
    },
    staleTime: 30_000,
  });
}

/** Create a new chat thread (archives previous active). */
export function useFleetGraphCreateThread(
  entityType?: FleetGraphEntityType,
  entityId?: string,
) {
  const queryClient = useQueryClient();

  return useMutation<FleetGraphCreateChatThreadResponse, Error, void>({
    mutationFn: async () => {
      const res = await apiPost('/api/fleetgraph/chat/thread', {
        entityType,
        entityId,
      });
      if (!res.ok) throw new Error('Failed to create thread');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.thread(entityType, entityId) });
    },
  });
}

export function useFleetGraphResolve() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean },
    Error,
    {
      alertId: string;
      outcome: FleetGraphAlertResolveRequest['outcome'];
      snoozeDurationMinutes?: number;
      reason?: string;
      targetEntityType?: FleetGraphEntityType;
      targetEntityId?: string;
    }
  >({
    mutationFn: async ({ alertId, outcome, snoozeDurationMinutes, reason }) => {
      const res = await apiPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
        outcome,
        snoozeDurationMinutes,
        reason,
      });
      if (!res.ok) throw new Error('Failed to resolve alert');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.allAlerts() });
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.modalFeed() });

      if (variables.targetEntityId) {
        queryClient.invalidateQueries({ queryKey: ['document', variables.targetEntityId] });
      }

      if (variables.targetEntityType === 'issue' && variables.targetEntityId) {
        queryClient.invalidateQueries({ queryKey: issueKeys.detail(variables.targetEntityId) });
        queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
      }
    },
  });
}

// -------------------------------------------------------------------------
// Notification bell hooks (global alerts, not scoped to a single entity)
// -------------------------------------------------------------------------

/**
 * Fetches all active alerts for the current user (no entity filter).
 * Used by FleetGraphNotificationBell to show unread count + dropdown list.
 */
export function useFleetGraphAllAlerts() {
  return useQuery<FleetGraphAlertsResponse>({
    queryKey: fleetgraphKeys.allAlerts(),
    queryFn: async () => {
      const res = await apiGet('/api/fleetgraph/alerts');
      if (!res.ok) throw new Error('Failed to fetch all alerts');
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Composite hook for the notification bell.
 * Returns the alerts list and unread count from recipient table.
 */
export function useFleetGraphNotifications() {
  const { data, isLoading, isError } = useFleetGraphAllAlerts();
  const alerts = data?.alerts ?? [];

  return {
    alerts,
    activeAlerts: alerts,
    unreadCount: data?.unreadCount ?? 0,
    isLoading,
    isError,
  };
}

/** Dismiss a single alert (marks it as dismissed via resolve endpoint). */
export function useFleetGraphDismissAlert() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (alertId) => {
      const res = await apiPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
        outcome: 'dismiss',
      });
      if (!res.ok) throw new Error('Failed to dismiss alert');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}

/** Snooze a single alert for a given number of minutes. */
export function useFleetGraphSnoozeAlert() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, { alertId: string; minutes: number }>({
    mutationFn: async ({ alertId, minutes }) => {
      const res = await apiPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
        outcome: 'snooze',
        snoozeDurationMinutes: minutes,
      });
      if (!res.ok) throw new Error('Failed to snooze alert');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}

// -------------------------------------------------------------------------
// Page-view trigger (fire-and-forget analysis on entity navigation)
// -------------------------------------------------------------------------

const PAGE_VIEW_DEBOUNCE_MS = 2000;

/**
 * Triggers a background FleetGraph analysis when the user navigates to an entity.
 * Debounced by 2s. Fire-and-forget: errors are silently ignored.
 */
export function useFleetGraphPageView(
  entityType?: FleetGraphEntityType,
  entityId?: string,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!entityType || !entityId) return;

    // Clear previous debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      apiPost('/api/fleetgraph/page-view', { entityType, entityId }).catch(() => {
        // fire-and-forget: swallow errors
      });
    }, PAGE_VIEW_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [entityType, entityId]);
}

/** Mark all alerts as read (recipient-level, alerts stay active). */
export function useFleetGraphMarkAllRead() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; markedCount: number }, Error, void>({
    mutationFn: async () => {
      const res = await apiPost('/api/fleetgraph/alerts/mark-read', {});
      if (!res.ok) throw new Error('Failed to mark alerts as read');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}

/** Dismiss all active alerts at once. */
export function useFleetGraphDismissAll() {
  const queryClient = useQueryClient();
  const { activeAlerts } = useFleetGraphNotifications();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        activeAlerts.map((alert) =>
          apiPost(`/api/fleetgraph/alerts/${alert.id}/resolve`, {
            outcome: 'dismiss',
          }),
        ),
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Failed to dismiss ${failures.length} alert(s)`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}
