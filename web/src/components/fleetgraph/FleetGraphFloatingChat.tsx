/**
 * Floating FleetGraph chat widget.
 * Fixed-position button in bottom-right that expands into a chat panel.
 * Always visible; scope-aware via useFleetGraphScope hook.
 */
import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import { cn } from '@/lib/cn';
import { useFleetGraphScope } from '@/hooks/useFleetGraphScope';
import { useFleetGraphPageContext } from '@/hooks/useFleetGraphPageContext';
import { useFleetGraphOnDemand, useFleetGraphSeedDemoFlow } from '@/hooks/useFleetGraph';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const FleetGraphChat = lazy(() =>
  import('./FleetGraphChat').then((m) => ({ default: m.FleetGraphChat }))
);

const LOG_PREFIX = '[FleetGraph:FloatingChat]';

export function FleetGraphFloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [latestTraceUrl, setLatestTraceUrl] = useState<string | null>(null);
  const [newThreadNonce, setNewThreadNonce] = useState(0);
  const scope = useFleetGraphScope();
  const pageContext = useFleetGraphPageContext(scope);
  const { currentWorkspace } = useWorkspace();

  const workspaceId = currentWorkspace?.id ?? null;
  const onDemand = useFleetGraphOnDemand();
  const seedDemo = useFleetGraphSeedDemoFlow();

  const handleTriggerAnalysis = useCallback(() => {
    console.log(`${LOG_PREFIX} trigger clicked`, { scopeType: scope.scopeType, scopeId: scope.scopeId, workspaceId, pathname: window.location.pathname });
    if (!workspaceId) return;
    setLatestTraceUrl(null);
    onDemand.mutate(
      {
        entityType: scope.scopeType === 'workspace' ? 'workspace' : scope.scopeType,
        entityId: scope.scopeId,
        workspaceId,
      },
      {
        onSuccess: (result) => {
          setLatestTraceUrl(result.traceUrl ?? null);
        },
      },
    );
  }, [onDemand, scope.scopeType, scope.scopeId, workspaceId]);

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      const next = !v;
      console.log(`${LOG_PREFIX} ${next ? 'opened' : 'closed'}`);
      return next;
    });
  }, []);

  const handleNewThread = useCallback(() => {
    if (!workspaceId) return;
    setNewThreadNonce((current) => current + 1);
  }, [workspaceId]);

  const handleSeedDemo = useCallback(() => {
    if (!workspaceId) return;
    seedDemo.mutate({
      entityType: scope.scopeType === 'workspace' ? 'workspace' : scope.scopeType,
      entityId: scope.scopeId,
    });
  }, [scope.scopeId, scope.scopeType, seedDemo, workspaceId]);

  // Log context changes
  useEffect(() => {
    console.log(`${LOG_PREFIX} scope: type=${scope.scopeType} id=${scope.scopeId} label=${scope.scopeLabel}`);
  }, [scope.scopeType, scope.scopeId, scope.scopeLabel]);

  useEffect(() => {
    setLatestTraceUrl(null);
  }, [scope.scopeType, scope.scopeId, workspaceId]);

  // Log mount
  useEffect(() => {
    console.log(`${LOG_PREFIX} mounted`);
    return () => console.log(`${LOG_PREFIX} unmounted`);
  }, []);

  return (
    <>
      {/* Expanded chat panel */}
      {isOpen && (
        <div
          data-testid="fleetgraph-floating-panel"
          className={cn(
            'fixed bottom-[136px] right-4 z-[9999]',
            'w-80 max-h-[480px] rounded-lg border border-border',
            'bg-background shadow-xl flex flex-col overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-border/10">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={handleTriggerAnalysis}
                disabled={onDemand.isPending || !workspaceId}
                title="Run FleetGraph analysis from header"
                aria-label="Run FleetGraph analysis from header"
                className={cn(
                  'flex-shrink-0 rounded p-0.5 transition-colors',
                  'text-accent hover:bg-accent/10',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  onDemand.isPending && 'animate-pulse',
                )}
              >
                <svg
                  className={cn(
                    'w-3.5 h-3.5 transition-transform',
                    onDemand.isPending && 'animate-spin',
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
              <span className="text-xs font-medium text-foreground flex-shrink-0">North Star</span>
              <ScopeChip label={scope.scopeLabel} variant="header" />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleSeedDemo}
                disabled={seedDemo.isPending || !workspaceId}
                title="Seed FleetGraph demo flow"
                aria-label="Seed FleetGraph demo flow"
                className={cn(
                  'p-0.5 rounded transition-colors',
                  'text-muted hover:text-red-400 hover:bg-red-500/10',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  seedDemo.isPending && 'animate-pulse',
                )}
              >
                <svg
                  className={cn(
                    'w-3.5 h-3.5 transition-transform',
                    seedDemo.isPending && 'animate-spin text-red-400',
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.75 3.75v2.5m4.5-2.5v2.5M8 8.5h8M7.5 20.25h9a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 6 11.75v7a1.5 1.5 0 0 0 1.5 1.5Zm1.25-6 1.5 1.5 3-3m-5.25 3.25 1.5 1.5m0-1.5-1.5 1.5m6-1.5 1.5 1.5m0-1.5-1.5 1.5"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleNewThread}
                disabled={!workspaceId}
                title="New thread"
                className={cn(
                  'p-0.5 rounded transition-colors',
                  'text-muted hover:text-foreground hover:bg-border/30',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
                aria-label="New thread"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggle}
                className="text-muted hover:text-foreground transition-colors p-0.5 rounded hover:bg-border/30"
                aria-label="Close North Star"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-3">
            {latestTraceUrl && (
              <div className="mb-3 flex items-center justify-between rounded border border-accent/20 bg-accent/5 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                  <TraceArrowsIcon className="w-3 h-3" />
                  <span>Trace</span>
                </div>
                <a
                  href={latestTraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Latest trace"
                  className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                >
                  <TraceArrowsIcon className="w-3 h-3" />
                  <span>Open</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
              </div>
            )}
            {workspaceId ? (
              <Suspense fallback={<ChatSkeleton />}>
                <FleetGraphChat
                  entityType={scope.scopeType}
                  entityId={scope.scopeId}
                  workspaceId={workspaceId}
                  newThreadNonce={newThreadNonce}
                  scopeType={scope.scopeType}
                  pageContext={pageContext}
                  persistAcrossScopes
                />
              </Suspense>
            ) : (
              <div className="py-6 text-center space-y-2">
                <svg className="w-8 h-8 mx-auto text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="text-xs text-muted">
                  No workspace selected.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating action button */}
      <button
        type="button"
        onClick={toggle}
        data-testid="fleetgraph-floating-btn"
        className={cn(
          'fixed bottom-20 right-6 z-[9999]',
          'flex items-center gap-2 rounded-full',
          'shadow-lg shadow-accent/25 transition-all',
          isOpen
            ? 'bg-accent text-white scale-90 h-12 w-12 justify-center'
            : 'bg-accent text-white hover:bg-accent/90 hover:scale-105 hover:shadow-xl hover:shadow-accent/30 h-12 px-4',
        )}
        aria-label={isOpen ? 'Close North Star' : 'Open North Star'}
        title="North Star"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {!isOpen && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-medium flex-shrink-0">North Star</span>
          </span>
        )}
      </button>
    </>
  );
}

function ScopeChip({ label, variant }: { label: string; variant: 'header' }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none',
        'max-w-[150px] overflow-hidden whitespace-nowrap text-ellipsis',
        'border border-border/60 bg-border/40 text-muted',
      )}
      title={label}
    >
      {label}
    </span>
  );
}

function TraceArrowsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
    </svg>
  );
}

function ChatSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="flex gap-1">
        <div className="h-6 w-20 rounded bg-border/40" />
        <div className="h-6 w-16 rounded bg-border/40" />
      </div>
      <div className="h-8 w-full rounded bg-border/30" />
    </div>
  );
}
