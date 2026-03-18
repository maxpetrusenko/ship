import { pool } from '../../db/client.js';
import { VISIBILITY_FILTER_SQL } from '../../middleware/visibility.js';
import {
  checkMissingAccountability,
  getManagerActionItems,
} from '../../services/accountability.js';
import type {
  FleetGraphChatDataAccess,
  FleetGraphChatToolContext,
} from './types.js';
import {
  loadCurrentSprintNumber,
  loadVisibleDocumentContent,
  loadExistingSprintReview,
  loadIssueChildren,
  loadIssueHistory,
  loadProjectRetroContext,
  loadSprintBase,
  loadSprintIssues,
  loadSprintStandups,
  loadVisibility,
  loadVisibleAssociations,
  loadVisibleIssue,
  loadVisibleProject,
} from './data-queries.js';
import {
  asRecord,
  detectIssueDrift,
  detectProjectDrift,
  summarizeAccountability,
  summarizeAssociations,
  summarizeDocumentContent,
  summarizeIssueChildren,
  summarizeIssueHistory,
  summarizeManagerItems,
  summarizeSprintContext,
} from './data-utils.js';

export { normalizeChatPageContext } from './data-utils.js';

export function createFleetGraphChatDataAccess(): FleetGraphChatDataAccess {
  return {
    async fetchIssueContext(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const issueId = typeof args.issueId === 'string' && args.issueId.trim() ? args.issueId : context.entityId;
      const visibility = await loadVisibility(context);
      const issue = await loadVisibleIssue(context, issueId, visibility);
      if (!issue) {
        return { found: false, entityType: 'issue', issueId };
      }

      const [history, children, associations] = await Promise.all([
        loadIssueHistory(issueId).catch(() => []),
        loadIssueChildren(context, issueId, visibility).catch(() => []),
        loadVisibleAssociations(context, issueId, undefined, visibility).catch(() => []),
      ]);

      const properties = asRecord(issue.properties);

      return {
        found: true,
        entityType: 'issue',
        issue: {
          id: issue.id,
          title: issue.title,
          state: properties.state ?? null,
          priority: properties.priority ?? null,
          assigneeId: properties.assignee_id ?? null,
          ticketNumber: issue.ticket_number,
          displayId: issue.ticket_number ? `#${issue.ticket_number}` : null,
          updatedAt: issue.updated_at,
        },
        history: summarizeIssueHistory(history),
        children: summarizeIssueChildren(children),
        relatedDocuments: summarizeAssociations(Array.isArray(associations) ? associations : []),
        drift: detectIssueDrift(issue, history),
      };
    },

    async fetchSprintContext(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const sprintId = typeof args.sprintId === 'string' && args.sprintId.trim() ? args.sprintId : context.entityId;
      const view = args.view === 'review' || args.view === 'retro' ? args.view : 'standup';
      const visibility = await loadVisibility(context);
      const sprint = await loadSprintBase(context, sprintId, visibility);
      if (!sprint) {
        return { found: false, entityType: 'sprint', sprintId, view };
      }

      if (view === 'retro' && sprint.project_id) {
        const retroContext = await loadProjectRetroContext(context, sprint.project_id, visibility);
        return {
          found: true,
          entityType: 'sprint',
          sprintId,
          view,
          context: summarizeSprintContext({
            sprint: {
              id: sprint.sprint_id,
              title: sprint.sprint_title,
              sprint_number: sprint.sprint_number,
              status: sprint.sprint_status,
              plan: sprint.sprint_plan,
            },
            ...(retroContext ?? {}),
          }),
        };
      }

      const [issues, standups, existingReview] = await Promise.all([
        loadSprintIssues(context, sprintId, visibility).catch(() => []),
        loadSprintStandups(context, sprintId, visibility).catch(() => []),
        view === 'review'
          ? loadExistingSprintReview(context, sprintId, visibility).catch(() => null)
          : Promise.resolve(null),
      ]);

      const issueStats = {
        total: issues.length,
        completed: issues.filter((row) => row.state === 'done').length,
        in_progress: issues.filter((row) => row.state === 'in_progress').length,
        todo: issues.filter((row) => row.state === 'todo' || row.state === 'backlog').length,
      };

      return {
        found: true,
        entityType: 'sprint',
        sprintId,
        view,
        context: summarizeSprintContext({
          sprint: {
            id: sprint.sprint_id,
            title: sprint.sprint_title,
            sprint_number: sprint.sprint_number,
            status: sprint.sprint_status,
            plan: sprint.sprint_plan,
          },
          project: sprint.project_id
            ? {
                id: sprint.project_id,
                name: sprint.project_name,
                plan: sprint.project_plan,
              }
            : null,
          program: sprint.program_id
            ? {
                id: sprint.program_id,
                name: sprint.program_name,
              }
            : null,
          issueStats,
          issues,
          standups,
          existing_review: existingReview,
          clarifying_questions_context: [],
        }),
      };
    },

    async fetchProjectContext(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const projectId = typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId : context.entityId;
      const visibility = await loadVisibility(context);
      const [project, retroContext] = await Promise.all([
        loadVisibleProject(context, projectId, visibility),
        loadProjectRetroContext(context, projectId, visibility).catch(() => null),
      ]);

      if (!project) {
        return { found: false, entityType: 'project', projectId };
      }

      const properties = asRecord(project.properties);

      return {
        found: true,
        entityType: 'project',
        project: {
          id: project.id,
          title: project.title,
          plan: properties.plan ?? null,
          ownerId: properties.owner_id ?? null,
          accountableId: properties.accountable_id ?? null,
          status: properties.status ?? null,
        },
        retroContext: retroContext ? summarizeSprintContext(retroContext) : null,
        drift: detectProjectDrift(project),
      };
    },

    async fetchWorkspaceSignals(context: FleetGraphChatToolContext, _args: Record<string, unknown>) {
      const visibility = await loadVisibility(context);
      const currentSprintNumber = await loadCurrentSprintNumber(context.workspaceId);
      const today = new Date().toISOString().split('T')[0] ?? null;

      const sprintParams: Array<string | boolean> = [
        context.workspaceId,
        context.userId,
        visibility.isAdmin,
      ];
      let activeSprintFilter = '';
      if (typeof currentSprintNumber === 'number') {
        sprintParams.push(String(currentSprintNumber));
        activeSprintFilter = ` AND (d.properties->>'sprint_number') = $4`;
      }

      const [accountability, managerActionItems, activeSprintsResult, allSprintsResult] = await Promise.all([
        checkMissingAccountability(context.userId, context.workspaceId).catch(() => []),
        getManagerActionItems(context.userId, context.workspaceId).catch(() => []),
        pool.query(
          `SELECT d.id, d.title, d.properties
           FROM documents d
           WHERE d.workspace_id = $1
             AND d.document_type = 'sprint'
             AND d.deleted_at IS NULL
             AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}${activeSprintFilter}
           ORDER BY (d.properties->>'sprint_number')::int NULLS LAST, d.created_at`,
          sprintParams,
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT d.id, d.title, d.properties
           FROM documents d
           WHERE d.workspace_id = $1
             AND d.document_type = 'sprint'
             AND d.deleted_at IS NULL
             AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
           ORDER BY (d.properties->>'sprint_number')::int NULLS LAST, d.created_at`,
          [context.workspaceId, context.userId, visibility.isAdmin],
        ).catch(() => ({ rows: [] })),
      ]);

      const overdueCount = accountability.filter((item) => item.dueDate && today && item.dueDate < today).length;
      const dueTodayCount = accountability.filter((item) => item.dueDate && today && item.dueDate === today).length;

      return {
        found: true,
        workspaceId: context.workspaceId,
        accountability: {
          total: accountability.length,
          overdue: overdueCount,
          dueToday: dueTodayCount,
          items: summarizeAccountability(accountability),
        },
        managerActionItems: summarizeManagerItems(managerActionItems.slice(0, 8)),
        activeSprints: activeSprintsResult.rows.slice(0, 8).map((sprint) => ({
          id: sprint.id,
          title: sprint.title,
          status: asRecord(sprint.properties).status ?? null,
        })),
        sprintCount: allSprintsResult.rows.length,
      };
    },

    async fetchEntityDrift(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const entityType = typeof args.entityType === 'string' ? args.entityType : context.entityType;
      const entityId = typeof args.entityId === 'string' && args.entityId.trim() ? args.entityId : context.entityId;
      const visibility = await loadVisibility(context);

      if (entityType === 'issue') {
        const issue = await loadVisibleIssue(context, entityId, visibility);
        if (!issue) {
          return { found: false, entityType, entityId };
        }
        const history = await loadIssueHistory(entityId).catch(() => []);
        return {
          found: true,
          entityType,
          entityId,
          ...detectIssueDrift(issue, history),
        };
      }

      if (entityType === 'project') {
        const project = await loadVisibleProject(context, entityId, visibility);
        if (!project) {
          return { found: false, entityType, entityId };
        }
        return {
          found: true,
          entityType,
          entityId,
          ...detectProjectDrift(project),
        };
      }

      return {
        found: false,
        entityType,
        entityId,
        reason: 'drift_detection_only_supported_for_issue_and_project',
      };
    },

    async fetchRelatedDocuments(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const documentId = typeof args.documentId === 'string' && args.documentId.trim()
        ? args.documentId
        : context.entityId;
      const relationshipType = typeof args.relationshipType === 'string' && args.relationshipType.trim()
        ? args.relationshipType
        : undefined;
      const visibility = await loadVisibility(context);

      const associations = await loadVisibleAssociations(context, documentId, relationshipType, visibility).catch(() => null);
      if (!associations) {
        return {
          found: false,
          documentId,
          relationshipType: relationshipType ?? null,
          relatedDocuments: [],
        };
      }

      return {
        found: true,
        documentId,
        relationshipType: relationshipType ?? null,
        relatedDocuments: summarizeAssociations(associations),
      };
    },

    async fetchDocumentContent(context: FleetGraphChatToolContext, args: Record<string, unknown>) {
      const documentId = typeof args.documentId === 'string' && args.documentId.trim()
        ? args.documentId
        : context.pageContext?.documentId ?? context.entityId;
      const visibility = await loadVisibility(context);
      const document = await loadVisibleDocumentContent(context, documentId, visibility);

      if (!document) {
        return {
          found: false,
          documentId,
        };
      }

      return {
        found: true,
        documentId: document.id,
        documentType: document.document_type,
        title: document.title,
        contentText: summarizeDocumentContent(document.content, 1200),
      };
    },
  };
}
