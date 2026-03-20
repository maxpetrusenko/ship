/**
 * FleetGraph data fetchers.
 *
 * Typed functions that call Ship REST API endpoints via the internal HTTP client.
 * Each fetcher returns a strongly-typed response (or null for 404).
 *
 * Also preserves the stub graph-node interfaces (CoreContextResult, etc.)
 * until the graph nodes are fully migrated to use the typed fetchers.
 */

import type pg from 'pg';
import type {
  FleetGraphEntityType,
  FleetGraphActionType,
  FleetGraphAlert,
  FleetGraphAuditEntry,
} from '@ship/shared';
import { ShipApiClient } from './client.js';
import type {
  ShipIssue,
  ShipIssueSummary,
  ShipIssueHistory,
  ShipSprint,
  ShipWorkspaceMember,
  ShipWorkspaceMembersResponse,
  ShipActivityDay,
  ShipAccountabilityItem,
  ShipAccountabilityResponse,
  ShipSprintContext,
  ShipDocumentAssociation,
  ShipProject,
  ShipIssueFilters,
  ManagerActionItem,
  ManagerActionItemsResponse,
} from './types.js';
import { upsertAlert, logAuditEntry } from '../runtime/persistence.js';

// ---------------------------------------------------------------------------
// Module-level singletons (set once at startup via configureFleetGraphData)
// ---------------------------------------------------------------------------

let _pool: pg.Pool | null = null;
let _client: ShipApiClient | null = null;

type ShipWeeksResponse = {
  weeks?: ShipSprint[];
};

/** Call once at server startup to inject dependencies. */
export function configureFleetGraphData(pool: pg.Pool, client?: ShipApiClient): void {
  _pool = pool;
  _client = client ?? new ShipApiClient();
}

function getPool(): pg.Pool {
  if (!_pool) throw new Error('[FleetGraph] Data layer not configured; call configureFleetGraphData first');
  return _pool;
}

function getClient(): ShipApiClient {
  if (!_client) throw new Error('[FleetGraph] Data layer not configured; call configureFleetGraphData first');
  return _client;
}

function extractWeeks(result: ShipSprint[] | ShipWeeksResponse | null): ShipSprint[] {
  if (Array.isArray(result)) return result;
  return result?.weeks ?? [];
}

// ---------------------------------------------------------------------------
// 1. fetchIssue - GET /api/issues/:id
// ---------------------------------------------------------------------------

/** Fetch a single issue by ID. Returns null if not found. */
export async function fetchIssue(
  client: ShipApiClient,
  issueId: string,
): Promise<ShipIssue | null> {
  return client.get<ShipIssue>(`/api/issues/${encodeURIComponent(issueId)}`);
}

// ---------------------------------------------------------------------------
// 2. fetchIssues - GET /api/issues?...
// ---------------------------------------------------------------------------

/** Fetch issues list with optional filters. */
export async function fetchIssues(
  client: ShipApiClient,
  filters?: ShipIssueFilters,
): Promise<ShipIssueSummary[]> {
  const params = new URLSearchParams();

  if (filters?.state) params.set('state', filters.state);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.assignee_id) params.set('assignee_id', filters.assignee_id);
  if (filters?.program_id) params.set('program_id', filters.program_id);
  if (filters?.sprint_id) params.set('sprint_id', filters.sprint_id);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.parent_filter) params.set('parent_filter', filters.parent_filter);

  const qs = params.toString();
  const path = qs ? `/api/issues?${qs}` : '/api/issues';

  const result = await client.get<ShipIssueSummary[]>(path);
  return result ?? [];
}

// ---------------------------------------------------------------------------
// 3. fetchIssueHistory - GET /api/issues/:id/history
// ---------------------------------------------------------------------------

/** Fetch change history for an issue. Returns empty array if issue not found. */
export async function fetchIssueHistory(
  client: ShipApiClient,
  issueId: string,
): Promise<ShipIssueHistory[]> {
  const result = await client.get<ShipIssueHistory[]>(
    `/api/issues/${encodeURIComponent(issueId)}/history`,
  );
  return result ?? [];
}

// ---------------------------------------------------------------------------
// 4. fetchIssueChildren - GET /api/issues/:id/children
// ---------------------------------------------------------------------------

/** Fetch sub-issues (children) of a parent issue. */
export async function fetchIssueChildren(
  client: ShipApiClient,
  issueId: string,
): Promise<ShipIssueSummary[]> {
  const result = await client.get<ShipIssueSummary[]>(
    `/api/issues/${encodeURIComponent(issueId)}/children`,
  );
  return result ?? [];
}

// ---------------------------------------------------------------------------
// 5. fetchDocumentAssociations - GET /api/documents/:id/associations
// ---------------------------------------------------------------------------

/** Fetch all associations for a document. */
export async function fetchDocumentAssociations(
  client: ShipApiClient,
  documentId: string,
  relationshipType?: string,
): Promise<ShipDocumentAssociation[]> {
  const params = new URLSearchParams();
  if (relationshipType) params.set('type', relationshipType);

  const qs = params.toString();
  const path = `/api/documents/${encodeURIComponent(documentId)}/associations${qs ? `?${qs}` : ''}`;

  const result = await client.get<ShipDocumentAssociation[]>(path);
  return result ?? [];
}

// ---------------------------------------------------------------------------
// 6. fetchWorkspaceMembers - GET /api/workspaces/:id/members
// ---------------------------------------------------------------------------

/** Fetch workspace members. Requires admin-level API token. */
export async function fetchWorkspaceMembers(
  client: ShipApiClient,
  workspaceId: string,
): Promise<ShipWorkspaceMember[]> {
  const result = await client.get<ShipWorkspaceMembersResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );
  return result?.data?.members ?? [];
}

// ---------------------------------------------------------------------------
// 7. fetchActiveSprints - GET /api/weeks (filtered to active)
// ---------------------------------------------------------------------------

/** Fetch active sprints for the workspace. */
export async function fetchActiveSprints(
  client: ShipApiClient,
): Promise<ShipSprint[]> {
  const result = await client.get<ShipSprint[] | ShipWeeksResponse>('/api/weeks?status=active');
  return extractWeeks(result);
}

// ---------------------------------------------------------------------------
// 8. fetchAllSprints - GET /api/weeks
// ---------------------------------------------------------------------------

/** Fetch all sprints for the workspace. */
export async function fetchAllSprints(
  client: ShipApiClient,
): Promise<ShipSprint[]> {
  const result = await client.get<ShipSprint[] | ShipWeeksResponse>('/api/weeks');
  return extractWeeks(result);
}

// ---------------------------------------------------------------------------
// 9. fetchActivity - GET /api/activity/:entityType/:entityId
// ---------------------------------------------------------------------------

/** Fetch 30-day activity heatmap for a program, project, or sprint. */
export async function fetchActivity(
  client: ShipApiClient,
  entityType: 'program' | 'project' | 'sprint',
  entityId: string,
): Promise<ShipActivityDay[]> {
  const result = await client.get<{ days: ShipActivityDay[] }>(
    `/api/activity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
  );
  return result?.days ?? [];
}

// ---------------------------------------------------------------------------
// 10. fetchAccountabilityItems - GET /api/accountability/action-items
// ---------------------------------------------------------------------------

/** Fetch inferred accountability action items for the authenticated user. */
export async function fetchAccountabilityItems(
  client: ShipApiClient,
): Promise<ShipAccountabilityItem[]> {
  const result = await client.get<ShipAccountabilityResponse>(
    '/api/accountability/action-items',
  );
  return result?.items ?? [];
}

// ---------------------------------------------------------------------------
// 11. fetchManagerActionItems - GET /api/accountability/manager-action-items
// ---------------------------------------------------------------------------

/** Fetch missed-standup action items for a manager's direct reports. */
export async function fetchManagerActionItems(
  client: ShipApiClient,
  _managerId: string,
): Promise<ManagerActionItem[]> {
  // The endpoint uses auth to identify the manager; managerId kept for caller clarity
  const result = await client.get<ManagerActionItemsResponse>(
    '/api/accountability/manager-action-items',
  );
  return result?.items ?? [];
}

// ---------------------------------------------------------------------------
// 12. fetchSprintContext - GET /api/claude/context?context_type=...&sprint_id=...
// ---------------------------------------------------------------------------

/** Fetch comprehensive sprint context for a given context type. */
export async function fetchSprintContext(
  client: ShipApiClient,
  contextType: 'standup' | 'review' | 'retro',
  targetId: string,
): Promise<ShipSprintContext | null> {
  const params = new URLSearchParams();
  params.set('context_type', contextType);

  // standup/review use sprint_id; retro uses project_id
  if (contextType === 'retro') {
    params.set('project_id', targetId);
  } else {
    params.set('sprint_id', targetId);
  }

  return client.get<ShipSprintContext>(`/api/claude/context?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// 12. fetchProject - GET /api/documents/:id
// ---------------------------------------------------------------------------

/** Fetch a project document by ID. Returns null if not found. */
export async function fetchProject(
  client: ShipApiClient,
  projectId: string,
): Promise<ShipProject | null> {
  return client.get<ShipProject>(
    `/api/documents/${encodeURIComponent(projectId)}`,
  );
}


// ===========================================================================
// Legacy stub interfaces (preserved for graph node backward compatibility)
// ===========================================================================

// ---------------------------------------------------------------------------
// Core entity context
// ---------------------------------------------------------------------------

export interface CoreContextResult {
  entity: Record<string, unknown>;
  relatedEntities: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}

/** Fetch the primary entity and its immediate relations. */
export async function fetchCoreContext(
  workspaceId: string,
  entityType: FleetGraphEntityType | null,
  entityId: string | null,
): Promise<CoreContextResult> {
  const client = getClient();
  if (!entityType || !entityId) {
    return { entity: {}, relatedEntities: [], metadata: { workspaceId } };
  }

  try {
    let entity: Record<string, unknown> = {};
    let relatedEntities: Record<string, unknown>[] = [];
    const isWorkspaceSummary = entityType === 'workspace' && entityId === workspaceId;

    if (isWorkspaceSummary) {
      const activeSprints = await fetchActiveSprints(client);
      entity = {
        id: workspaceId,
        title: 'Workspace Summary',
        document_type: 'workspace',
      };
      relatedEntities = activeSprints as unknown as Record<string, unknown>[];
    } else if (entityType === 'issue') {
      const issue = await fetchIssue(client, entityId);
      if (issue) {
        entity = issue as unknown as Record<string, unknown>;
        const children = await fetchIssueChildren(client, entityId);
        relatedEntities = (children ?? []) as unknown as Record<string, unknown>[];
      }
    } else if (entityType === 'sprint') {
      const ctx = await fetchSprintContext(client, 'standup', entityId);
      if (ctx) {
        entity = ctx.sprint as unknown as Record<string, unknown>;
        relatedEntities = (ctx.issues ?? []) as unknown as Record<string, unknown>[];
      }
    } else if (entityType === 'project') {
      const proj = await fetchProject(client, entityId);
      if (proj) {
        entity = proj as unknown as Record<string, unknown>;
        const assocs = await fetchDocumentAssociations(client, entityId);
        relatedEntities = (assocs ?? []) as unknown as Record<string, unknown>[];
      }
    }

    // Extract owner: issues use assignee_id, sprints/projects use owner_id
    let ownerUserId: string | null = null;
    const props = (entity as Record<string, Record<string, unknown>>).properties;
    if (props) {
      if (entityType === 'issue') {
        ownerUserId = (props.assignee_id as string) ?? null;
      } else {
        ownerUserId = (props.owner_id as string) ?? null;
      }
    }

    return {
      entity,
      relatedEntities,
      metadata: {
        workspaceId,
        ownerUserId,
        isWorkspaceSummary,
      },
    };
  } catch (err) {
    console.error('[FleetGraph] fetchCoreContext error:', err);
    return { entity: {}, relatedEntities: [], metadata: { workspaceId } };
  }
}

// ---------------------------------------------------------------------------
// Parallel signal fetchers
// ---------------------------------------------------------------------------

export interface ParallelSignalsResult {
  activity: Record<string, unknown>;
  accountability: Record<string, unknown>;
  history: Record<string, unknown>;
  /** Flattened heuristic signal values consumed by heuristicFilter */
  lastActivityDays: number;
  missingStandup: boolean;
  pendingApprovalDays: number;
  scopeDrift: boolean;
  /** Full issue history entries for content scope drift analysis */
  issueHistory: Array<{ field: string; old_value: unknown; new_value: unknown }>;
  /** Manager-scoped: direct reports with missed standups */
  managerActionItems: ManagerActionItem[];
}

/** Fan-out: activity feed, accountability (standups/reviews), history. */
export async function fetchParallelSignals(
  workspaceId: string,
  entityType: FleetGraphEntityType | null,
  entityId: string | null,
  actorUserId: string | null = null,
  ownerUserId: string | null = null,
): Promise<ParallelSignalsResult> {
  const client = getClient();
  const isWorkspaceSummary = entityType === 'workspace' && entityId === workspaceId;
  const signalUserId = actorUserId ?? ownerUserId ?? null;

  try {
    // Always use REST endpoints (respects API boundary; forUserId for actor-scoped queries)
    const accountabilityPromise = signalUserId
      ? client.get<ShipAccountabilityResponse>(
          `/api/accountability/action-items?forUserId=${encodeURIComponent(signalUserId)}`,
        ).then((r) => r?.items ?? []).catch(() => [])
      : fetchAccountabilityItems(client).catch(() => []);
    const managerItemsPromise = signalUserId
      ? client.get<ManagerActionItemsResponse>(
          `/api/accountability/manager-action-items?forUserId=${encodeURIComponent(signalUserId)}`,
        ).then((r) => r?.items ?? []).catch(() => [])
      : fetchManagerActionItems(client, '').catch(() => []);

    // Fan-out: run fetches in parallel
    const [activityDays, accountability, history, managerItems] = await Promise.all([
      entityType && entityId && !isWorkspaceSummary && (entityType === 'project' || entityType === 'sprint')
        ? fetchActivity(client, entityType as 'project' | 'sprint', entityId)
        : Promise.resolve([]),
      accountabilityPromise,
      entityType === 'issue' && entityId
        ? fetchIssueHistory(client, entityId).catch(() => [])
        : Promise.resolve([]),
      managerItemsPromise,
    ]);

    // Compute heuristic signals from raw data
    const now = Date.now();
    const DAY_MS = 86_400_000;

    // lastActivityDays: days since most recent activity
    let lastActivityDays = 0;
    if (entityType === 'issue' && entityId && history.length > 0) {
      const first = history[0];
      if (first) {
        const latestChange = new Date(first.created_at).getTime();
        lastActivityDays = Math.floor((now - latestChange) / DAY_MS);
      }
    } else if (activityDays.length > 0) {
      const sorted = [...activityDays].sort((a, b) => b.date.localeCompare(a.date));
      const first = sorted[0];
      if (first) {
        const latest = new Date(first.date).getTime();
        lastActivityDays = Math.floor((now - latest) / DAY_MS);
      }
    }

    // missingStandup: check if there are overdue accountability items
    const missingStandup = accountability.some(
      (item) => item.accountability_type === 'standup' && item.days_overdue > 0,
    );

    // pendingApprovalDays: check for review-type accountability items that are overdue
    const reviewItems = accountability.filter(
      (item) => item.accountability_type === 'review' && item.days_overdue > 0,
    );
    const pendingApprovalDays = reviewItems.length > 0
      ? Math.max(...reviewItems.map((i) => i.days_overdue))
      : 0;

    // scopeDrift: detected via issue history (state changes from done back to in_progress)
    const scopeDrift = history.some(
      (h) => h.field === 'state' && h.old_value === 'done' && h.new_value !== 'done',
    );

    return {
      activity: { days: activityDays, lastActivityDays },
      accountability: { items: accountability, missingStandup, pendingApprovalDays },
      history: { entries: history, scopeDrift },
      lastActivityDays,
      missingStandup,
      pendingApprovalDays,
      scopeDrift,
      issueHistory: history.map((h) => ({ field: h.field, old_value: h.old_value, new_value: h.new_value })),
      managerActionItems: managerItems,
    };
  } catch (err) {
    console.error('[FleetGraph] fetchParallelSignals error:', err);
    return {
      activity: {},
      accountability: {},
      history: {},
      lastActivityDays: 0,
      missingStandup: false,
      pendingApprovalDays: 0,
      scopeDrift: false,
      issueHistory: [],
      managerActionItems: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Action executors (Phase 2A: real Ship API dispatch)
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  message: string;
  payload: Record<string, unknown>;
}

/** Validate action payload before dispatch. */
function validateActionPayload(
  actionType: FleetGraphActionType,
  payload: Record<string, unknown>,
): string | null {
  switch (actionType) {
    case 'reassign_issue':
      if (!payload.assignee_id || typeof payload.assignee_id !== 'string') {
        return 'reassign_issue requires assignee_id (uuid string)';
      }
      break;
    case 'change_state':
      if (!payload.state || typeof payload.state !== 'string') {
        return 'change_state requires state field';
      }
      break;
    case 'escalate_priority':
      if (!payload.priority || typeof payload.priority !== 'string') {
        return 'escalate_priority requires priority field';
      }
      break;
    case 'flag_issue':
      // flag_issue always sets priority to urgent
      break;
    case 'add_comment':
      if (!payload.content || typeof payload.content !== 'string') {
        return 'add_comment requires content string';
      }
      break;
    default:
      return `Unknown action type: ${actionType}`;
  }
  return null;
}

/** Execute an approved action against the Ship API. */
export async function executeShipAction(
  workspaceId: string,
  actionType: string,
  targetEntityType: FleetGraphEntityType,
  targetEntityId: string,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const client = getClient();
  const typedAction = actionType as FleetGraphActionType;

  // Validate payload — throw so callers (resolve route) catch and fail closed
  const validationError = validateActionPayload(typedAction, payload);
  if (validationError) {
    throw new Error(`Action validation failed: ${validationError}`);
  }

  console.log(
    `[FleetGraph] Executing action: ${actionType} on ${targetEntityType}:${targetEntityId}`,
    { workspaceId, payload },
  );

  try {
    switch (typedAction) {
      case 'reassign_issue': {
        // Validate assignee exists in workspace before PATCH
        const pool = getPool();
        const memberCheck = await pool.query(
          'SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
          [workspaceId, payload.assignee_id],
        );
        if (memberCheck.rows.length === 0) {
          throw new Error(`User ${payload.assignee_id} is not a member of workspace ${workspaceId}`);
        }

        const reassignResult = await client.patch(`/api/issues/${encodeURIComponent(targetEntityId)}`, {
          assignee_id: payload.assignee_id,
        });
        if (reassignResult === null) {
          throw new Error(`Target issue ${targetEntityId} not found (404)`);
        }
        return { success: true, message: `Issue reassigned to ${payload.assignee_id}`, payload };
      }

      case 'change_state': {
        const stateResult = await client.patch(`/api/issues/${encodeURIComponent(targetEntityId)}`, {
          state: payload.state,
        });
        if (stateResult === null) {
          throw new Error(`Target issue ${targetEntityId} not found (404)`);
        }
        return { success: true, message: `Issue state changed to ${payload.state}`, payload };
      }

      case 'escalate_priority': {
        const priorityResult = await client.patch(`/api/issues/${encodeURIComponent(targetEntityId)}`, {
          priority: payload.priority,
        });
        if (priorityResult === null) {
          throw new Error(`Target issue ${targetEntityId} not found (404)`);
        }
        return { success: true, message: `Issue priority set to ${payload.priority}`, payload };
      }

      case 'flag_issue': {
        const flagResult = await client.patch(`/api/issues/${encodeURIComponent(targetEntityId)}`, {
          priority: 'urgent',
        });
        if (flagResult === null) {
          throw new Error(`Target issue ${targetEntityId} not found (404)`);
        }
        return { success: true, message: 'Issue flagged as urgent', payload };
      }

      case 'add_comment': {
        const commentResult = await client.post(`/api/comments`, {
          document_id: targetEntityId,
          content: payload.content,
        });
        if (commentResult === null) {
          throw new Error(`Target document ${targetEntityId} not found (404)`);
        }
        return { success: true, message: 'Comment added', payload };
      }

      default: {
        // Fallback: log unknown action types (forward compat)
        console.warn(`[FleetGraph] Unhandled action type: ${actionType}, logging only`);
        return { success: true, message: `${actionType} logged (unhandled type)`, payload };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FleetGraph] Action execution failed: ${message}`);
    throw new Error(`Action ${actionType} failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Audit / alert persistence
// ---------------------------------------------------------------------------

export async function persistAlert(
  alert: Record<string, unknown>,
): Promise<string> {
  const pool = getPool();
  const saved = await upsertAlert(pool, {
    workspaceId: alert.workspaceId as string,
    fingerprint: alert.fingerprint as string,
    signalType: alert.signalType as FleetGraphAlert['signalType'],
    entityType: alert.entityType as FleetGraphAlert['entityType'],
    entityId: alert.entityId as string,
    severity: alert.severity as FleetGraphAlert['severity'],
    summary: alert.summary as string,
    recommendation: (alert.recommendation as string) ?? '',
    citations: (alert.citations as string[]) ?? [],
    ownerUserId: (alert.ownerUserId as string) ?? null,
    status: (alert.status as FleetGraphAlert['status']) ?? 'active',
    snoozedUntil: (alert.snoozedUntil as string) ?? null,
  });
  return saved.id;
}

export async function persistAuditEntry(
  entry: Record<string, unknown>,
): Promise<void> {
  const pool = getPool();
  await logAuditEntry(pool, {
    id: '',
    workspaceId: entry.workspaceId as string,
    runId: entry.runId as string,
    mode: entry.mode as FleetGraphAuditEntry['mode'],
    entityType: (entry.entityType as FleetGraphAuditEntry['entityType']) ?? null,
    entityId: (entry.entityId as string) ?? null,
    branch: entry.branch as FleetGraphAuditEntry['branch'],
    candidateCount: (entry.candidateCount as number) ?? 0,
    durationMs: (entry.durationMs as number) ?? 0,
    tokenUsage: (entry.tokenUsage as FleetGraphAuditEntry['tokenUsage']) ?? null,
    traceUrl: (entry.traceUrl as string) ?? null,
    createdAt: (entry.createdAt as string) ?? new Date().toISOString(),
  });
}
