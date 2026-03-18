/**
 * FleetGraph notification bell with unread badge.
 * Sits in the app shell header area. Clicking toggles a dropdown
 * notification center showing active FleetGraph alerts.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  useFleetGraphNotifications,
  useFleetGraphDismissAlert,
  useFleetGraphSnoozeAlert,
  useFleetGraphMarkAllRead,
  fleetgraphKeys,
} from '@/hooks/useFleetGraph';
import { useRealtimeEvent } from '@/hooks/useRealtimeEvents';
import { FleetGraphNotificationCenter } from './FleetGraphNotificationCenter';
import type { FleetGraphAlert } from '@ship/shared';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FleetGraphNotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { alerts, unreadCount } = useFleetGraphNotifications();
  const dismissAlert = useFleetGraphDismissAlert();
  const snoozeAlert = useFleetGraphSnoozeAlert();
  const markAllRead = useFleetGraphMarkAllRead();

  // Realtime: refetch all alerts when server pushes a new fleetgraph:alert
  const handleAlertEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: fleetgraphKeys.allAlerts() });
  }, [queryClient]);

  useRealtimeEvent('fleetgraph:alert', handleAlertEvent);

  const toggle = useCallback(() => {
    setIsOpen((v) => !v);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    // Delay to avoid catching the toggle click itself
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Handlers
  const handleDismiss = useCallback(
    (alertId: string) => {
      dismissAlert.mutate(alertId);
    },
    [dismissAlert],
  );

  const handleSnooze = useCallback(
    (alertId: string, minutes: number) => {
      snoozeAlert.mutate({ alertId, minutes });
    },
    [snoozeAlert],
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  const handleOpenContext = useCallback(
    (alert: FleetGraphAlert) => {
      setIsOpen(false);
      // Navigate to the entity page based on type
      switch (alert.entityType) {
        case 'issue':
          navigate(`/documents/${alert.entityId}`);
          break;
        case 'project':
          navigate(`/documents/${alert.entityId}`);
          break;
        case 'sprint':
          navigate(`/documents/${alert.entityId}`);
          break;
        default:
          navigate(`/documents/${alert.entityId}`);
      }
    },
    [navigate],
  );

  return (
    <div ref={containerRef} className="relative" data-testid="fleetgraph-notification-bell">
      {/* Bell button */}
      <button
        onClick={toggle}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          isOpen
            ? 'bg-border text-foreground'
            : 'text-muted hover:bg-border/50 hover:text-foreground',
        )}
        aria-label={
          unreadCount > 0
            ? `FleetGraph notifications, ${unreadCount} unread`
            : 'FleetGraph notifications'
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {/* Bell icon */}
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className={cn(
              'absolute -top-0.5 -right-0.5 flex items-center justify-center',
              'min-w-[16px] h-4 px-1 rounded-full',
              'bg-red-500 text-white text-[10px] font-semibold leading-none',
              'border-2 border-background',
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification center dropdown */}
      {isOpen && (
        <FleetGraphNotificationCenter
          alerts={alerts}
          onDismiss={handleDismiss}
          onSnooze={handleSnooze}
          onMarkAllRead={handleMarkAllRead}
          onOpenContext={handleOpenContext}
          isDismissing={dismissAlert.isPending || markAllRead.isPending}
        />
      )}
    </div>
  );
}
