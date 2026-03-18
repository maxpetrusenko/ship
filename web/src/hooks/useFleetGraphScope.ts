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
import { useActiveWeeksQuery } from '@/hooks/useWeeksQuery';
import type { FleetGraphEntityType } from '@ship/shared';

export type FleetGraphScopeType = FleetGraphEntityType | 'workspace';

export interface FleetGraphScope {
  scopeType: FleetGraphScopeType;
  scopeId: string;
  scopeLabel: string;
}

function extractUnifiedDocumentId(pathname: string): string | null {
  const match = pathname.match(/^\/documents\/([^/]+)/);
  return match?.[1] ?? null;
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
  const { data: weeks } = useActiveWeeksQuery();

  /** Resolve title for any entity type. */
  function lookupTitle(entityType: FleetGraphEntityType, entityId: string): string | undefined {
    if (entityType === 'issue') {
      return issues.find((i) => i.id === entityId)?.title || undefined;
    }
    if (entityType === 'project') {
      return projects.find((p) => p.id === entityId)?.title || undefined;
    }
    if (entityType === 'sprint') {
      return weeks?.weeks?.find((w: { id: string; name: string }) => w.id === entityId)?.name || undefined;
    }
    return undefined;
  }

  function inferEntityTypeFromDocumentId(documentId: string): FleetGraphEntityType | null {
    if (issues.some((issue) => issue.id === documentId)) {
      return 'issue';
    }
    if (projects.some((project) => project.id === documentId)) {
      return 'project';
    }
    if (weeks?.weeks?.some((week: { id: string }) => week.id === documentId)) {
      return 'sprint';
    }
    return null;
  }

  return useMemo(() => {
    console.log('[FleetGraph:Scope] resolving', { currentDocumentType, currentDocumentId, pathname: location.pathname });
    // 1. Document context (highest priority)
    if (currentDocumentType && currentDocumentId) {
      const entityType = DOC_TYPE_TO_ENTITY[currentDocumentType];
      console.log('[FleetGraph:Scope] docContext hit', { currentDocumentType, entityType: entityType ?? 'UNMAPPED' });
      if (entityType) {
        const title = lookupTitle(entityType, currentDocumentId);
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
      const title = lookupTitle(routeScope.entityType, routeScope.entityId);
      const label = title || `${routeScope.entityType} ${routeScope.entityId.slice(0, 8)}`;
      return {
        scopeType: routeScope.entityType,
        scopeId: routeScope.entityId,
        scopeLabel: label,
      };
    }

    const unifiedDocumentId = extractUnifiedDocumentId(location.pathname);
    if (unifiedDocumentId) {
      const inferredEntityType = inferEntityTypeFromDocumentId(unifiedDocumentId);
      if (inferredEntityType) {
        const title = lookupTitle(inferredEntityType, unifiedDocumentId);
        const label = title || `${inferredEntityType} ${unifiedDocumentId.slice(0, 8)}`;
        return {
          scopeType: inferredEntityType,
          scopeId: unifiedDocumentId,
          scopeLabel: label,
        };
      }
    }

    // 3. Workspace fallback (always available)
    console.log('[FleetGraph:Scope] falling back to workspace');
    return {
      scopeType: 'workspace' as FleetGraphScopeType,
      scopeId: currentWorkspace?.id ?? 'default',
      scopeLabel: currentWorkspace?.name ?? 'Workspace',
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocumentType, currentDocumentId, location.pathname, currentWorkspace, issues, projects, weeks]);
}
