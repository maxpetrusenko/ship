/**
 * FleetGraph modal feed: transforms raw alerts + approvals into
 * display-ready, server-prioritized items for the ActionItemsModal.
 *
 * All sorting/suppression logic lives here so the frontend renders
 * a flat, pre-ordered list.
 */
import type pg from 'pg';
import type {
  FleetGraphAlert,
  FleetGraphApproval,
  FleetGraphModalFeedItem,
  FleetGraphModalFeedResponse,
  AlertSeverity,
  FleetGraphSignalType,
} from '@ship/shared';

// -------------------------------------------------------------------------
// Signal type → human-readable label (used as prefix, not full title)
// -------------------------------------------------------------------------

const SIGNAL_LABELS: Record<FleetGraphSignalType, string> = {
  missing_standup: 'Missing standup',
  manager_missing_standup: 'Team member missed standup',
  stale_issue: 'Stale issue',
  scope_drift: 'Scope drift',
  approval_bottleneck: 'Approval bottleneck',
  ownership_gap: 'Ownership gap',
  multi_signal_cluster: 'Multiple signals',
  chat_suggestion: 'Suggested action',
};

// -------------------------------------------------------------------------
// Severity → numeric weight for sorting
// -------------------------------------------------------------------------

export const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Bonus added to displayPriority when the item has a pending approval. */
const ACTIONABLE_BONUS = 10;

// -------------------------------------------------------------------------
// Context passed from the route handler (DB lookups happen there)
// -------------------------------------------------------------------------

export interface ModalFeedContext {
  /** Map from entityId → document title. */
  entityTitles: Map<string, string>;
  /** Map from issue entityId → parent entity IDs (sprint/project). */
  parentEntityMap: Map<string, string[]>;
}

// -------------------------------------------------------------------------
// DB lookup helpers (called by route handler, not by buildModalFeed)
// -------------------------------------------------------------------------

/**
 * Batch-lookup document titles for a set of entity IDs.
 * Returns a Map<entityId, title>.
 */
export async function lookupEntityTitles(
  pool: pg.Pool,
  entityIds: string[],
  workspaceId: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(entityIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const result = await pool.query(
    `SELECT id, title FROM documents
     WHERE id = ANY($1) AND workspace_id = $2 AND deleted_at IS NULL`,
    [unique, workspaceId],
  );
  return new Map(result.rows.map((r) => [r.id as string, r.title as string]));
}

/**
 * Batch-lookup parent entity IDs (sprint, project) for a set of issue IDs.
 * Returns a Map<issueEntityId, parentEntityId[]>.
 */
export async function lookupIssueParents(
  pool: pg.Pool,
  issueIds: string[],
  workspaceId: string,
): Promise<Map<string, string[]>> {
  const unique = [...new Set(issueIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const result = await pool.query(
    `SELECT da.document_id AS issue_id, da.related_id AS parent_id
     FROM document_associations da
     JOIN documents d ON d.id = da.related_id AND d.deleted_at IS NULL
     WHERE da.document_id = ANY($1)
       AND da.relationship_type IN ('sprint', 'project')
       AND d.workspace_id = $2`,
    [unique, workspaceId],
  );

  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const issueId = row.issue_id as string;
    const parentId = row.parent_id as string;
    const existing = map.get(issueId) ?? [];
    existing.push(parentId);
    map.set(issueId, existing);
  }
  return map;
}

// -------------------------------------------------------------------------
// Pure feed builder
// -------------------------------------------------------------------------

/**
 * Build a display-ready, server-prioritized modal feed from raw alerts
 * and pending approvals.
 *
 * Pure function — no DB access. Caller fetches alerts, approvals, and
 * context (titles + parent map) and passes them in.
 *
 * Product rules:
 * 1. Approvals scoped to user's alert IDs only (no workspace-wide leak)
 * 2. Parent-over-child suppression: sprint/project signal beats child issue
 * 3. Actionable (pending approval) sorts above inform-only
 * 4. Higher severity sorts above lower within same tier
 * 5. Newer lastSurfacedAt breaks ties
 */
export function buildModalFeed(
  alerts: FleetGraphAlert[],
  approvals: FleetGraphApproval[],
  context: ModalFeedContext = { entityTitles: new Map(), parentEntityMap: new Map() },
): FleetGraphModalFeedResponse {
  // 1. Scope approvals: only link pending approvals matching user's alerts
  const userAlertIds = new Set(alerts.map((a) => a.id));
  const approvalByAlertId = new Map<string, FleetGraphApproval>();
  for (const a of approvals) {
    if (a.status === 'pending' && userAlertIds.has(a.alertId)) {
      approvalByAlertId.set(a.alertId, a);
    }
  }

  // 2. Build parent suppression index: which parent entity IDs have alerts?
  const parentAlertIndex = new Map<string, FleetGraphAlert>();
  for (const alert of alerts) {
    if (alert.entityType === 'sprint' || alert.entityType === 'project' || alert.entityType === 'workspace') {
      parentAlertIndex.set(alert.entityId, alert);
    }
  }

  // 3. Map alerts to feed items, suppressing child signals when parent is stronger
  const items: FleetGraphModalFeedItem[] = [];

  for (const alert of alerts) {
    const approval = approvalByAlertId.get(alert.id) ?? null;
    const isActionable = approval !== null;
    const severityWeight = SEVERITY_WEIGHT[alert.severity] ?? 1;

    // Parent-over-child suppression (skip if actionable — approvals always show)
    if (alert.entityType === 'issue' && !isActionable) {
      const parentIds = context.parentEntityMap.get(alert.entityId) ?? [];
      let superseded = false;
      for (const parentId of parentIds) {
        const parentAlert = parentAlertIndex.get(parentId);
        if (parentAlert && (SEVERITY_WEIGHT[parentAlert.severity] ?? 0) >= severityWeight) {
          superseded = true;
          break;
        }
      }
      if (superseded) continue;
    }

    // Build title: "Signal label: Entity name" when title available
    const entityTitle = context.entityTitles.get(alert.entityId);
    const signalLabel = SIGNAL_LABELS[alert.signalType] ?? alert.signalType;
    const title = entityTitle ? `${signalLabel}: ${entityTitle}` : signalLabel;

    const displayPriority = severityWeight + (isActionable ? ACTIONABLE_BONUS : 0);

    items.push({
      alertId: alert.id,
      entityType: alert.entityType,
      entityId: alert.entityId,
      title,
      signalType: alert.signalType,
      severity: alert.severity,
      whatChanged: alert.summary,
      whyThisMatters: alert.recommendation,
      ownerLabel: null,
      nextDecision: approval?.description ?? null,
      explanation: null,
      reasoning: null,
      displayPriority,
      isActionable,
      approval,
      createdAt: alert.createdAt,
      lastSurfacedAt: alert.lastSurfacedAt,
    });
  }

  // Sort: highest displayPriority first, then newest lastSurfacedAt
  items.sort((a, b) => {
    if (b.displayPriority !== a.displayPriority) {
      return b.displayPriority - a.displayPriority;
    }
    return new Date(b.lastSurfacedAt).getTime() - new Date(a.lastSurfacedAt).getTime();
  });

  return { items, total: items.length };
}
