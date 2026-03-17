/**
 * Floating FleetGraph chat widget.
 * Fixed-position button in bottom-right that expands into a chat panel.
 * Always visible; scope-aware via useFleetGraphScope hook.
 */
import { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import { cn } from '@/lib/cn';
import { useFleetGraphScope } from '@/hooks/useFleetGraphScope';
import { useFleetGraphPageContext } from '@/hooks/useFleetGraphPageContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const FleetGraphChat = lazy(() =>
  import('./FleetGraphChat').then((m) => ({ default: m.FleetGraphChat }))
);

const LOG_PREFIX = '[FleetGraph:FloatingChat]';

export function FleetGraphFloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const scope = useFleetGraphScope();
  const pageContext = useFleetGraphPageContext(scope);
  const { currentWorkspace } = useWorkspace();

  const workspaceId = currentWorkspace?.id ?? null;

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      const next = !v;
      console.log(`${LOG_PREFIX} ${next ? 'opened' : 'closed'}`);
      return next;
    });
  }, []);

  const isEntityScoped = scope.scopeType !== 'workspace';

  // Log context changes
  useEffect(() => {
    console.log(`${LOG_PREFIX} scope: type=${scope.scopeType} id=${scope.scopeId} label=${scope.scopeLabel}`);
  }, [scope.scopeType, scope.scopeId, scope.scopeLabel]);

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
              <svg className="w-3.5 h-3.5 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-xs font-medium text-foreground flex-shrink-0">FleetGraph</span>
              <span className="text-[10px] text-muted bg-border/40 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                {scope.scopeType === 'workspace' ? 'Workspace' : scope.scopeType}
              </span>
            </div>
            <button
              onClick={toggle}
              className="text-muted hover:text-foreground transition-colors p-0.5 rounded hover:bg-border/30 flex-shrink-0"
              aria-label="Close FleetGraph chat"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-3">
            {workspaceId ? (
              <Suspense fallback={<ChatSkeleton />}>
                <FleetGraphChat
                  entityType={scope.scopeType}
                  entityId={scope.scopeId}
                  workspaceId={workspaceId}
                  scopeLabel={scope.scopeLabel}
                  scopeType={scope.scopeType}
                  pageContext={pageContext}
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
        aria-label={isOpen ? 'Close FleetGraph' : `Open FleetGraph: ${scope.scopeLabel}`}
        title={`FleetGraph: ${scope.scopeLabel}`}
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {/* Scope chip on button (collapsed state only) */}
        {!isOpen && (
          <span className="text-xs font-medium truncate max-w-[140px]">
            {isEntityScoped ? scope.scopeLabel : 'Workspace'}
          </span>
        )}
        {/* Green dot for entity-scoped context */}
        {isEntityScoped && !isOpen && (
          <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
        )}
      </button>
    </>
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
