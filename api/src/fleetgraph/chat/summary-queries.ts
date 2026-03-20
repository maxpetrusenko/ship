import { pool } from '../../db/client.js';
import { VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import type { FleetGraphChatToolContext } from './types.js';
import type { VisibilityContext } from './data-queries.js';
import type { RollupIssueRow, RollupSprintRow } from './rollups.js';

export async function loadProjectIssuesForSummary(
  context: FleetGraphChatToolContext,
  projectId: string,
  visibility: VisibilityContext,
): Promise<RollupIssueRow[]> {
  const result = await pool.query(
    `SELECT d.id,
            d.title,
            d.ticket_number,
            d.properties->>'state' as state,
            d.properties->>'priority' as priority,
            d.properties->>'assignee_id' as assignee_id,
            u.name as assignee_name
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'project'
     LEFT JOIN users u
       ON (d.properties->>'assignee_id')::uuid = u.id
     WHERE d.workspace_id = $2
       AND d.document_type = 'issue'
       AND d.deleted_at IS NULL
       AND d.archived_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY d.updated_at DESC`,
    [projectId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows;
}

export async function loadProjectSprintsForSummary(
  context: FleetGraphChatToolContext,
  projectId: string,
  visibility: VisibilityContext,
): Promise<RollupSprintRow[]> {
  const result = await pool.query(
    `SELECT d.id,
            d.title,
            d.properties->>'status' as status,
            d.properties->>'sprint_number' as sprint_number
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'project'
     WHERE d.workspace_id = $2
       AND d.document_type = 'sprint'
       AND d.deleted_at IS NULL
       AND d.archived_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY (d.properties->>'sprint_number')::int NULLS LAST, d.created_at`,
    [projectId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows;
}
