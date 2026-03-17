/**
 * React Query hooks for FleetGraph API.
 * Uses quietGet/quietPost pattern for background requests.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  FleetGraphEntityType,
  FleetGraphAlertsResponse,
  FleetGraphAlertResolveRequest,
  FleetGraphOnDemandResponse,
  FleetGraphChatResponse,
  FleetGraphChatThreadResponse,
  FleetGraphCreateChatThreadResponse,
  FleetGraphStatusResponse,
  FleetGraphPageContext,
} from '@ship/shared';

const API_URL = import.meta.env.VITE_API_URL ?? '';

let quietCsrfToken: string | null = null;

function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false;
}

export function clearQuietCsrfToken(): void {
  quietCsrfToken = null;
}

async function getQuietCsrfToken(): Promise<string | null> {
  if (quietCsrfToken) return quietCsrfToken;
  try {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    quietCsrfToken = data.token;
    return quietCsrfToken;
  } catch {
    return null;
  }
}

async function quietGet(endpoint: string): Promise<Response> {
  return fetch(`${API_URL}${endpoint}`, { credentials: 'include' });
}

async function quietPost(endpoint: string, body: object): Promise<Response> {
  const token = await getQuietCsrfToken();
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (response.status === 403 && isJsonResponse(response)) {
    clearQuietCsrfToken();
    const refreshedToken = await getQuietCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(refreshedToken ? { 'X-CSRF-Token': refreshedToken } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }

  return response;
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
  thread: () => [...fleetgraphKeys.all, 'thread'] as const,
};

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
      const res = await quietGet(url);
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
      const res = await quietGet('/api/fleetgraph/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    staleTime: 60_000,
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
      const res = await quietPost('/api/fleetgraph/on-demand', params);
      if (!res.ok) throw new Error('Failed to run on-demand analysis');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: fleetgraphKeys.alerts(variables.entityType, variables.entityId),
      });
    },
  });
}

export function useFleetGraphChat() {
  const queryClient = useQueryClient();

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
      const res = await quietPost('/api/fleetgraph/chat', params);
      if (!res.ok) throw new Error('Failed to send chat message');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: fleetgraphKeys.alerts(variables.entityType, variables.entityId),
      });
    },
  });
}

// -------------------------------------------------------------------------
// Thread persistence
// -------------------------------------------------------------------------

/** Load the active chat thread + its messages. */
export function useFleetGraphThread() {
  return useQuery<FleetGraphChatThreadResponse>({
    queryKey: fleetgraphKeys.thread(),
    queryFn: async () => {
      const res = await quietGet('/api/fleetgraph/chat/thread');
      if (!res.ok) throw new Error('Failed to load thread');
      return res.json();
    },
    staleTime: 30_000,
  });
}

/** Create a new chat thread (archives previous active). */
export function useFleetGraphCreateThread() {
  const queryClient = useQueryClient();

  return useMutation<FleetGraphCreateChatThreadResponse, Error, void>({
    mutationFn: async () => {
      const res = await quietPost('/api/fleetgraph/chat/thread', {});
      if (!res.ok) throw new Error('Failed to create thread');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.thread() });
    },
  });
}

export function useFleetGraphResolve() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean },
    Error,
    { alertId: string; outcome: FleetGraphAlertResolveRequest['outcome']; snoozeDurationMinutes?: number; reason?: string }
  >({
    mutationFn: async ({ alertId, outcome, snoozeDurationMinutes, reason }) => {
      const res = await quietPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
        outcome,
        snoozeDurationMinutes,
        reason,
      });
      if (!res.ok) throw new Error('Failed to resolve alert');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
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
      const res = await quietGet('/api/fleetgraph/alerts');
      if (!res.ok) throw new Error('Failed to fetch all alerts');
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Composite hook for the notification bell.
 * Returns the alerts list and derived unread count.
 */
export function useFleetGraphNotifications() {
  const { data, isLoading, isError } = useFleetGraphAllAlerts();
  const alerts = data?.alerts ?? [];
  const activeAlerts = alerts.filter((a) => a.status === 'active');

  return {
    alerts,
    activeAlerts,
    unreadCount: activeAlerts.length,
    isLoading,
    isError,
  };
}

/** Dismiss a single alert (marks it as dismissed via resolve endpoint). */
export function useFleetGraphDismissAlert() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (alertId) => {
      const res = await quietPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
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
      const res = await quietPost(`/api/fleetgraph/alerts/${alertId}/resolve`, {
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
      quietPost('/api/fleetgraph/page-view', { entityType, entityId }).catch(() => {
        // fire-and-forget: swallow errors
      });
    }, PAGE_VIEW_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [entityType, entityId]);
}

/** Dismiss all active alerts at once. */
export function useFleetGraphDismissAll() {
  const queryClient = useQueryClient();
  const { activeAlerts } = useFleetGraphNotifications();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      // Dismiss each active alert in parallel
      const results = await Promise.allSettled(
        activeAlerts.map((alert) =>
          quietPost(`/api/fleetgraph/alerts/${alert.id}/resolve`, {
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
