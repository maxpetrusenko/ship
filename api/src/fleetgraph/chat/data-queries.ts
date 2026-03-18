import { pool } from '../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import type { FleetGraphChatToolContext } from './types.js';
import { asRecord, type IssueChildRow, type IssueHistoryRow, type IssueRow, type ProjectRow, type RelatedDocumentRow } from './data-utils.js';

export interface VisibilityContext {
  isAdmin: boolean;
}

export interface SprintBaseRow {
  sprint_id: string;
  sprint_title: string;
  sprint_number: string | null;
  sprint_status: string | null;
  sprint_plan: string | null;
  project_id: string | null;
  project_name: string | null;
  project_plan: string | null;
  program_id: string | null;
  program_name: string | null;
}

export async function loadVisibility(context: FleetGraphChatToolContext): Promise<VisibilityContext> {
  return getVisibilityContext(context.userId, context.workspaceId);
}

export async function loadVisibleIssue(
  context: FleetGraphChatToolContext,
  issueId: string,
  visibility: VisibilityContext,
): Promise<IssueRow | null> {
  const result = await pool.query(
    `SELECT d.id, d.title, d.properties, d.ticket_number, d.updated_at
     FROM documents d
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.document_type = 'issue'
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [issueId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows[0] ?? null;
}

export async function loadIssueHistory(issueId: string): Promise<IssueHistoryRow[]> {
  const result = await pool.query(
    `SELECT field, old_value, new_value, created_at, automated_by
     FROM document_history
     WHERE document_id = $1
     ORDER BY created_at DESC`,
    [issueId],
  );

  return result.rows;
}

export async function loadIssueChildren(
  context: FleetGraphChatToolContext,
  issueId: string,
  visibility: VisibilityContext,
): Promise<IssueChildRow[]> {
  const result = await pool.query(
    `SELECT d.id,
            d.title,
            d.properties->>'state' as state,
            d.properties->>'priority' as priority,
            d.ticket_number
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'parent'
     WHERE d.workspace_id = $2
       AND d.document_type = 'issue'
       AND d.deleted_at IS NULL
       AND d.archived_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY d.updated_at DESC`,
    [issueId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows;
}

export async function loadVisibleProject(
  context: FleetGraphChatToolContext,
  projectId: string,
  visibility: VisibilityContext,
): Promise<ProjectRow | null> {
  const result = await pool.query(
    `SELECT d.id, d.title, d.properties, d.content
     FROM documents d
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.document_type = 'project'
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [projectId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows[0] ?? null;
}

export async function loadVisibleAssociations(
  context: FleetGraphChatToolContext,
  documentId: string,
  relationshipType: string | undefined,
  visibility: VisibilityContext,
): Promise<RelatedDocumentRow[] | null> {
  const baseResult = await pool.query(
    `SELECT id
     FROM documents d
     WHERE d.id = $1
       AND d.workspace_id = $2
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [documentId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  if (baseResult.rows.length === 0) {
    return null;
  }

  const params: Array<string | boolean> = [
    documentId,
    context.workspaceId,
    context.userId,
    visibility.isAdmin,
  ];
  let relationshipFilter = '';
  if (relationshipType) {
    params.push(relationshipType);
    relationshipFilter = ` AND da.relationship_type = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT da.related_id,
            related.title as related_title,
            related.document_type as related_document_type,
            da.relationship_type
     FROM document_associations da
     JOIN documents related
       ON related.id = da.related_id
      AND related.workspace_id = $2
      AND related.deleted_at IS NULL
      AND ${VISIBILITY_FILTER_SQL('related', '$3', '$4')}
     WHERE da.document_id = $1${relationshipFilter}
     ORDER BY da.created_at DESC`,
    params,
  );

  return result.rows;
}

export async function loadSprintBase(
  context: FleetGraphChatToolContext,
  sprintId: string,
  visibility: VisibilityContext,
): Promise<SprintBaseRow | null> {
  const result = await pool.query(
    `SELECT s.id as sprint_id,
            s.title as sprint_title,
            s.properties->>'sprint_number' as sprint_number,
            s.properties->>'status' as sprint_status,
            s.properties->>'plan' as sprint_plan,
            proj.id as project_id,
            proj.title as project_name,
            proj.properties->>'plan' as project_plan,
            prog.id as program_id,
            prog.title as program_name
     FROM documents s
     LEFT JOIN document_associations da_proj
       ON da_proj.document_id = s.id
      AND da_proj.relationship_type = 'project'
     LEFT JOIN documents proj
       ON proj.id = da_proj.related_id
      AND proj.document_type = 'project'
      AND proj.workspace_id = $2
      AND proj.deleted_at IS NULL
      AND ${VISIBILITY_FILTER_SQL('proj', '$3', '$4')}
     LEFT JOIN document_associations da_prog
       ON da_prog.document_id = proj.id
      AND da_prog.relationship_type = 'program'
     LEFT JOIN documents prog
       ON prog.id = da_prog.related_id
      AND prog.document_type = 'program'
      AND prog.workspace_id = $2
      AND prog.deleted_at IS NULL
      AND ${VISIBILITY_FILTER_SQL('prog', '$3', '$4')}
     WHERE s.id = $1
       AND s.workspace_id = $2
       AND s.document_type = 'sprint'
       AND s.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('s', '$3', '$4')}`,
    [sprintId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows[0] ?? null;
}

export async function loadSprintIssues(
  context: FleetGraphChatToolContext,
  sprintId: string,
  visibility: VisibilityContext,
) {
  const result = await pool.query(
    `SELECT d.id,
            d.title,
            d.properties->>'state' as state,
            d.properties->>'priority' as priority,
            d.properties->>'assignee_id' as assignee_id
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'sprint'
     WHERE d.workspace_id = $2
       AND d.document_type = 'issue'
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY d.updated_at DESC`,
    [sprintId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows;
}

export async function loadSprintStandups(
  context: FleetGraphChatToolContext,
  sprintId: string,
  visibility: VisibilityContext,
) {
  const result = await pool.query(
    `SELECT d.id,
            d.properties->>'author_id' as author_id,
            d.content,
            d.created_at
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'sprint'
     WHERE d.workspace_id = $2
       AND d.document_type = 'standup'
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY d.created_at DESC
     LIMIT 5`,
    [sprintId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows;
}

export async function loadExistingSprintReview(
  context: FleetGraphChatToolContext,
  sprintId: string,
  visibility: VisibilityContext,
) {
  const result = await pool.query(
    `SELECT d.id,
            d.content,
            d.properties->>'plan_validated' as plan_validated
     FROM documents d
     JOIN document_associations da
       ON da.document_id = d.id
      AND da.related_id = $1
      AND da.relationship_type = 'sprint'
     WHERE d.workspace_id = $2
       AND d.document_type = 'weekly_review'
       AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     LIMIT 1`,
    [sprintId, context.workspaceId, context.userId, visibility.isAdmin],
  );

  return result.rows[0] ?? null;
}

export async function loadProjectRetroContext(
  context: FleetGraphChatToolContext,
  projectId: string,
  visibility: VisibilityContext,
) {
  const project = await loadVisibleProject(context, projectId, visibility);
  if (!project) {
    return null;
  }

  const projectProps = asRecord(project.properties);

  const [programResult, sprintsResult, issuesResult, retroResult] = await Promise.all([
    pool.query(
      `SELECT prog.id, prog.title
       FROM document_associations da
       JOIN documents prog
         ON prog.id = da.related_id
        AND prog.document_type = 'program'
        AND prog.workspace_id = $2
        AND prog.deleted_at IS NULL
        AND ${VISIBILITY_FILTER_SQL('prog', '$3', '$4')}
       WHERE da.document_id = $1
         AND da.relationship_type = 'program'
       LIMIT 1`,
      [projectId, context.workspaceId, context.userId, visibility.isAdmin],
    ),
    pool.query(
      `SELECT s.id,
              s.title,
              s.properties->>'status' as status,
              s.properties->>'sprint_number' as sprint_number
       FROM documents s
       JOIN document_associations da
         ON da.document_id = s.id
        AND da.related_id = $1
        AND da.relationship_type = 'project'
       WHERE s.workspace_id = $2
         AND s.document_type = 'sprint'
         AND s.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('s', '$3', '$4')}
       ORDER BY (s.properties->>'sprint_number')::int NULLS LAST, s.created_at`,
      [projectId, context.workspaceId, context.userId, visibility.isAdmin],
    ),
    pool.query(
      `SELECT d.id,
              d.title,
              d.properties->>'state' as state
       FROM documents d
       JOIN document_associations da
         ON da.document_id = d.id
        AND da.related_id = $1
        AND da.relationship_type = 'project'
       WHERE d.workspace_id = $2
         AND d.document_type = 'issue'
         AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [projectId, context.workspaceId, context.userId, visibility.isAdmin],
    ),
    pool.query(
      `SELECT d.id,
              d.content,
              d.properties->>'plan_validated' as plan_validated,
              d.properties->>'monetary_impact_actual' as monetary_impact_actual
       FROM documents d
       JOIN document_associations da
         ON da.document_id = d.id
        AND da.related_id = $1
        AND da.relationship_type = 'project'
       WHERE d.workspace_id = $2
         AND d.document_type = 'project_retro'
         AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       LIMIT 1`,
      [projectId, context.workspaceId, context.userId, visibility.isAdmin],
    ),
  ]);

  const sprintIds = sprintsResult.rows.map((row) => row.id as string);
  const [reviewsResult, standupsResult] = sprintIds.length > 0
    ? await Promise.all([
        pool.query(
          `SELECT da.related_id as sprint_id,
                  d.properties->>'plan_validated' as plan_validated
           FROM documents d
           JOIN document_associations da
             ON da.document_id = d.id
            AND da.relationship_type = 'sprint'
           WHERE da.related_id = ANY($1)
             AND d.workspace_id = $2
             AND d.document_type = 'weekly_review'
             AND d.deleted_at IS NULL
             AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
          [sprintIds, context.workspaceId, context.userId, visibility.isAdmin],
        ),
        pool.query(
          `SELECT da.related_id as sprint_id,
                  d.id,
                  d.properties->>'author_id' as author_id,
                  d.content,
                  d.created_at
           FROM documents d
           JOIN document_associations da
             ON da.document_id = d.id
            AND da.relationship_type = 'sprint'
           WHERE da.related_id = ANY($1)
             AND d.workspace_id = $2
             AND d.document_type = 'standup'
             AND d.deleted_at IS NULL
             AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
           ORDER BY d.created_at DESC
           LIMIT 20`,
          [sprintIds, context.workspaceId, context.userId, visibility.isAdmin],
        ),
      ])
    : [{ rows: [] }, { rows: [] }];

  const reviewBySprintId = new Map<string, { plan_validated: string | null }>();
  for (const row of reviewsResult.rows) {
    reviewBySprintId.set(row.sprint_id as string, {
      plan_validated: row.plan_validated as string | null,
    });
  }

  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter((row) => row.state === 'done').length,
    active: issuesResult.rows.filter((row) => ['in_progress', 'todo', 'in_review'].includes(String(row.state ?? ''))).length,
    cancelled: issuesResult.rows.filter((row) => row.state === 'cancelled').length,
  };

  return {
    project: {
      id: project.id,
      name: project.title,
      plan: projectProps.plan ?? null,
    },
    program: programResult.rows[0]
      ? {
          id: programResult.rows[0].id,
          name: programResult.rows[0].title,
        }
      : null,
    issueStats,
    standups: standupsResult.rows,
    weeks: sprintsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      sprint_number: row.sprint_number,
      has_review: reviewBySprintId.has(row.id),
      plan_validated: reviewBySprintId.get(row.id)?.plan_validated ?? null,
    })),
    existing_retro: retroResult.rows[0] ?? null,
    clarifying_questions_context: [],
  };
}

export async function loadCurrentSprintNumber(workspaceId: string): Promise<number | null> {
  const workspaceResult = await pool.query(
    `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
    [workspaceId],
  );

  if (workspaceResult.rows.length === 0) {
    return null;
  }

  const rawStartDate = workspaceResult.rows[0].sprint_start_date;
  const sprintDuration = 7;

  let workspaceStartDate: Date;
  if (rawStartDate instanceof Date) {
    workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
  } else if (typeof rawStartDate === 'string') {
    workspaceStartDate = new Date(`${rawStartDate}T00:00:00Z`);
  } else {
    workspaceStartDate = new Date();
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(daysSinceStart / sprintDuration) + 1;
}
