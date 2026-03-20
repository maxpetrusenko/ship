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

const TAB_LABELS: Record<string, string> = {
  details: 'Details',
  issues: 'Issues',
  weeks: 'Weeks',
  retro: 'Retro',
  overview: 'Overview',
  plan: 'Plan',
  review: 'Review',
  standups: 'Standups',
};

function resolvePageTab(pathname: string, scopeType: FleetGraphScope['scopeType']) {
  const match = pathname.match(/^\/documents\/[^/]+(?:\/([^/]+))?/);
  const explicitTab = match?.[1];

  if (scopeType === 'project') {
    const tab = explicitTab ?? 'details';
    return { tab, tabLabel: TAB_LABELS[tab] ?? tab };
  }

  if (scopeType === 'sprint') {
    const tab = explicitTab ?? 'overview';
    return { tab, tabLabel: TAB_LABELS[tab] ?? tab };
  }

  return {};
}

export function useFleetGraphPageContext(scope: FleetGraphScope): FleetGraphPageContext {
  const location = useLocation();

  return useMemo(() => {
    const surface = SURFACE_MAP[scope.scopeType] ?? 'workspace';
    const tabContext = resolvePageTab(location.pathname, scope.scopeType);

    return {
      route: location.pathname,
      surface,
      documentId: scope.scopeType !== 'workspace' ? scope.scopeId : undefined,
      title: scope.scopeLabel,
      documentType: scope.scopeType !== 'workspace' ? scope.scopeType : undefined,
      ...tabContext,
    };
  }, [location.pathname, scope.scopeType, scope.scopeId, scope.scopeLabel]);
}
