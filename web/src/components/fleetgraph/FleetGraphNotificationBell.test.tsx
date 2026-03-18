/**
 * Tests for FleetGraphNotificationBell + FleetGraphNotificationCenter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import FleetGraphNotificationBell from './FleetGraphNotificationBell';
import type { FleetGraphAlert, FleetGraphAlertsResponse } from '@ship/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock useRealtimeEvents to avoid needing the provider
vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvent: vi.fn(),
  useRealtimeEvents: () => ({ isConnected: true, subscribe: vi.fn(() => vi.fn()) }),
}));

// Mock useAuth (needed by RealtimeEventsProvider if ever resolved)
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Test' } }),
}));

const realFetch = globalThis.fetch;

function makeAlert(overrides: Partial<FleetGraphAlert> = {}): FleetGraphAlert {
  return {
    id: overrides.id ?? 'alert-1',
    workspaceId: 'ws-1',
    fingerprint: 'fp-1',
    signalType: 'stale_issue',
    entityType: 'issue',
    entityId: 'issue-1',
    severity: 'medium',
    summary: 'Issue has been idle for 5 business days.',
    recommendation: 'Follow up with assignee.',
    citations: [],
    ownerUserId: 'user-1',
    readAt: null,
    status: 'active',
    snoozedUntil: null,
    lastSurfacedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function setupFetch(alerts: FleetGraphAlert[]) {
  const activeAlerts = alerts.filter((a) => a.status === 'active');
  const response: FleetGraphAlertsResponse = {
    alerts,
    pendingApprovals: [],
    total: alerts.length,
    unreadCount: activeAlerts.length,
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    // CSRF token
    if (url.endsWith('/api/csrf-token')) {
      return jsonResponse({ token: 'test-csrf' });
    }

    // All alerts (notification bell query)
    if (method === 'GET' && url.includes('/api/fleetgraph/alerts')) {
      return jsonResponse(response);
    }

    // Resolve (dismiss/snooze)
    if (method === 'POST' && url.includes('/resolve')) {
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }) as typeof globalThis.fetch;
}

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FleetGraphNotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FleetGraphNotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('renders bell without badge when there are 0 unread alerts', async () => {
    setupFetch([]);
    renderBell();

    // Bell button should exist
    const bell = screen.getByTestId('fleetgraph-notification-bell');
    expect(bell).toBeInTheDocument();

    // Wait for query to settle, then verify no badge
    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    });
  });

  it('renders badge with count when there are unread alerts', async () => {
    const alerts = [
      makeAlert({ id: 'a-1' }),
      makeAlert({ id: 'a-2', severity: 'high' }),
      makeAlert({ id: 'a-3', severity: 'critical' }),
    ];
    setupFetch(alerts);
    renderBell();

    await waitFor(() => {
      const badge = screen.getByTestId('notification-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe('3');
    });
  });

  it('opens and closes notification center on click', async () => {
    setupFetch([makeAlert()]);
    renderBell();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
    });

    // Initially closed
    expect(screen.queryByTestId('fleetgraph-notification-center')).not.toBeInTheDocument();

    // Open
    const bellButton = screen.getByRole('button', { name: /FleetGraph notifications/i });
    fireEvent.click(bellButton);

    expect(screen.getByTestId('fleetgraph-notification-center')).toBeInTheDocument();

    // Close
    fireEvent.click(bellButton);
    expect(screen.queryByTestId('fleetgraph-notification-center')).not.toBeInTheDocument();
  });

  it('shows notification rows in the center', async () => {
    const alerts = [
      makeAlert({ id: 'a-1', summary: 'First alert' }),
      makeAlert({ id: 'a-2', summary: 'Second alert', severity: 'critical' }),
    ];
    setupFetch(alerts);
    renderBell();

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
    });

    // Open the center
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph notifications/i }));

    const center = screen.getByTestId('fleetgraph-notification-center');
    expect(center).toBeInTheDocument();

    const rows = within(center).getAllByTestId('notification-row');
    expect(rows).toHaveLength(2);
  });

  it('dismisses an alert via the Dismiss button', async () => {
    setupFetch([makeAlert({ id: 'alert-dismiss-1', summary: 'Dismiss me' })]);
    renderBell();

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
    });

    // Open center
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph notifications/i }));

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    // Verify the resolve endpoint was called
    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const resolveCall = calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/resolve') &&
          (c[1] as RequestInit)?.method === 'POST',
      );
      expect(resolveCall).toBeDefined();
    });
  });

  it('shows empty state when all alerts are dismissed', async () => {
    // All alerts are dismissed (not active)
    setupFetch([makeAlert({ id: 'a-1', status: 'dismissed' })]);
    renderBell();

    // Wait for query, no badge should appear
    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    });

    // Open center to see empty state
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph notifications/i }));

    expect(screen.getByText('No new notifications')).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    setupFetch([makeAlert()]);
    renderBell();

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toBeInTheDocument();
    });

    // Open
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph notifications/i }));
    expect(screen.getByTestId('fleetgraph-notification-center')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('fleetgraph-notification-center')).not.toBeInTheDocument();
  });
});
