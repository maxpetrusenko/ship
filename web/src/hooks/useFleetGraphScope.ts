/**
 * Resolves the current FleetGraph scope from document context, route, or workspace fallback.
 *
 * Priority:
 *   1. CurrentDocumentContext (issue/project/sprint with title lookup)
 *   2. Route pathname parsing (/documents/:id, /issues/:id, /projects/:id, /sprints/:id)
 *   3. Workspace fallback (always available)
 */
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useIssues } from '@/contexts/IssuesContext';
import { useProjects } from '@/contexts/ProjectsContext';
import type { FleetGraphEntityType } from '@ship/shared';

export type FleetGraphScopeType = FleetGraphEntityType | 'workspace';

export interface FleetGraphScope {
  scopeType: FleetGraphScopeType;
  scopeId: string;
  scopeLabel: string;
}

/** Maps CurrentDocumentContext document types to FleetGraph entity types. */
const DOC_TYPE_TO_ENTITY: Record<string, FleetGraphEntityType> = {
  issue: 'issue',
  project: 'project',
  sprint: 'sprint',
};

/**
 * Extract entity scope from a route pathname.
 * Returns null if the route doesn't match a known entity pattern.
 */
export function parseScopeFromPath(pathname: string): { entityType: FleetGraphEntityType; entityId: string } | null {
  // /documents/:id (unified route; type resolved from context, not route)
  const docMatch = pathname.match(/^\/documents\/([^/]+)/);
  if (docMatch) {
    // We can't determine entity type from the unified route alone.
    // Return null so the caller falls through to workspace.
    return null;
  }

  // Legacy routes: /issues/:id, /projects/:id, /sprints/:id
  const legacyMatch = pathname.match(/^\/(issues|projects|sprints)\/([^/]+)/);
  if (legacyMatch) {
    const [, segment, id] = legacyMatch;
    const type = segment === 'issues' ? 'issue' : segment === 'projects' ? 'project' : 'sprint';
    return { entityType: type as FleetGraphEntityType, entityId: id };
  }

  // /programs/:id/sprints/:sprintId
  const programSprintMatch = pathname.match(/^\/programs\/[^/]+\/sprints\/([^/]+)/);
  if (programSprintMatch) {
    return { entityType: 'sprint', entityId: programSprintMatch[1] };
  }

  return null;
}

/**
 * Hook that returns the current FleetGraph scope.
 * Usable anywhere in the app; always returns a valid scope.
 */
export function useFleetGraphScope(): FleetGraphScope {
  const { currentDocumentType, currentDocumentId } = useCurrentDocument();
  const { currentWorkspace } = useWorkspace();
  const location = useLocation();

  // Look up entity title from loaded context lists
  const { issues } = useIssues();
  const { projects } = useProjects();

  return useMemo(() => {
    // 1. Document context (highest priority)
    if (currentDocumentType && currentDocumentId) {
      const entityType = DOC_TYPE_TO_ENTITY[currentDocumentType];
      if (entityType) {
        let title: string | undefined;
        if (entityType === 'issue') {
          title = issues.find((i) => i.id === currentDocumentId)?.title || undefined;
        } else if (entityType === 'project') {
          title = projects.find((p) => p.id === currentDocumentId)?.title || undefined;
        }
        const label = title || `${entityType} ${currentDocumentId.slice(0, 8)}`;
        return {
          scopeType: entityType,
          scopeId: currentDocumentId,
          scopeLabel: label,
        };
      }
    }

    // 2. Route parsing (legacy routes only; unified /documents/:id is handled above)
    const routeScope = parseScopeFromPath(location.pathname);
    if (routeScope) {
      let title: string | undefined;
      if (routeScope.entityType === 'issue') {
        title = issues.find((i) => i.id === routeScope.entityId)?.title || undefined;
      } else if (routeScope.entityType === 'project') {
        title = projects.find((p) => p.id === routeScope.entityId)?.title || undefined;
      }
      const label = title || `${routeScope.entityType} ${routeScope.entityId.slice(0, 8)}`;
      return {
        scopeType: routeScope.entityType,
        scopeId: routeScope.entityId,
        scopeLabel: label,
      };
    }

    // 3. Workspace fallback (always available)
    return {
      scopeType: 'workspace' as FleetGraphScopeType,
      scopeId: currentWorkspace?.id ?? 'default',
      scopeLabel: currentWorkspace?.name ?? 'Workspace',
    };
  }, [currentDocumentType, currentDocumentId, location.pathname, currentWorkspace, issues, projects]);
}
