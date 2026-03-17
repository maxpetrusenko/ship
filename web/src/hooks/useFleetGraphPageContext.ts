/**
 * Builds FleetGraphPageContext from the current scope + route.
 * Injected into every chat turn so the LLM knows where the user is.
 */
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { FleetGraphPageContext } from '@ship/shared';
import type { FleetGraphScope } from './useFleetGraphScope';

const SURFACE_MAP: Record<string, FleetGraphPageContext['surface']> = {
  issue: 'issue',
  project: 'project',
  sprint: 'sprint',
  workspace: 'workspace',
};

export function useFleetGraphPageContext(scope: FleetGraphScope): FleetGraphPageContext {
  const location = useLocation();

  return useMemo(() => {
    const surface = SURFACE_MAP[scope.scopeType] ?? 'workspace';

    return {
      route: location.pathname,
      surface,
      documentId: scope.scopeType !== 'workspace' ? scope.scopeId : undefined,
      title: scope.scopeLabel,
    };
  }, [location.pathname, scope.scopeType, scope.scopeId, scope.scopeLabel]);
}
