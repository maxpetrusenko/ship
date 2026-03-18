import { extractText } from '../../utils/document-content.js';
import type { MissingAccountabilityItem } from '../../services/accountability.js';
import type { ManagerActionItem } from '../data/types.js';
import type { FleetGraphChatHintContext } from './types.js';

const DEFAULT_TRUNCATION = 240;

export type JsonRecord = Record<string, unknown>;

export interface IssueRow {
  id: string;
  title: string;
  properties: JsonRecord | null;
  ticket_number: number | null;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  title: string;
  properties: JsonRecord | null;
  content: unknown;
}

export interface IssueHistoryRow {
  field: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  automated_by: string | null;
}

export interface IssueChildRow {
  id: string;
  title: string;
  state: string | null;
  priority: string | null;
  ticket_number: number | null;
}

export interface RelatedDocumentRow {
  related_id: string;
  related_title: string | null;
  related_document_type: string | null;
  relationship_type: string;
}

export function compactText(value: string | null | undefined | unknown, max = DEFAULT_TRUNCATION): string | null {
  if (!value) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function readContextValue(
  context: Record<string, unknown>,
  key: string,
): unknown {
  return context[key];
}

export function summarizeIssueHistory(history: IssueHistoryRow[], limit = 5) {
  return history.slice(0, limit).map((entry) => ({
    field: entry.field,
    oldValue: entry.old_value,
    newValue: entry.new_value,
    createdAt: entry.created_at,
    automatedBy: entry.automated_by,
  }));
}

export function summarizeIssueChildren(children: IssueChildRow[], limit = 5) {
  return children.slice(0, limit).map((item) => ({
    id: item.id,
    title: item.title,
    state: item.state,
    priority: item.priority,
    displayId: item.ticket_number ? `#${item.ticket_number}` : null,
  }));
}

export function summarizeAssociations(associations: RelatedDocumentRow[], limit = 5) {
  return associations.slice(0, limit).map((assoc) => ({
    id: assoc.related_id,
    title: assoc.related_title,
    type: assoc.related_document_type,
    relationshipType: assoc.relationship_type,
  }));
}

export function summarizeAccountability(items: MissingAccountabilityItem[], limit = 5) {
  return items.slice(0, limit).map((item) => ({
    id: `${item.type}:${item.targetId}`,
    title: item.targetTitle,
    type: item.type,
    targetId: item.targetId,
    targetTitle: item.targetTitle,
    dueDate: item.dueDate,
    message: compactText(item.message, 160),
  }));
}

export function summarizeManagerItems(items: ManagerActionItem[], limit = 5) {
  return items.slice(0, limit).map((item) => ({
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    overdueMinutes: item.overdueMinutes,
    sprintId: item.sprintId,
    sprintTitle: item.sprintTitle,
    projectId: item.projectId,
    projectTitle: item.projectTitle,
  }));
}

export function summarizeDocumentContent(content: unknown, max = 600) {
  return compactText(extractText(content) as string | null | undefined, max);
}

export function summarizeSprintContext(context: Record<string, unknown>) {
  const sprint = context.sprint as Record<string, unknown> | undefined;
  const project = context.project as Record<string, unknown> | undefined;
  const program = context.program as Record<string, unknown> | undefined;
  const issues = Array.isArray(context.issues) ? context.issues as Array<Record<string, unknown>> : [];
  const standups = Array.isArray(context.standups) ? context.standups as Array<Record<string, unknown>> : [];
  const weeks = Array.isArray(readContextValue(context, 'weeks'))
    ? readContextValue(context, 'weeks') as Array<Record<string, unknown>>
    : [];

  return {
    sprint: sprint
      ? {
          id: sprint.id,
          title: sprint.title,
          sprintNumber: sprint.sprint_number,
          status: sprint.status,
          plan: sprint.plan,
        }
      : null,
    project: project
      ? {
          id: project.id,
          name: project.name,
          plan: project.plan,
        }
      : null,
    program: program
      ? {
          id: program.id,
          name: program.name,
        }
      : null,
    issueStats: context.issueStats ?? null,
    issues: issues.slice(0, 8).map((issue) => ({
      id: issue.id,
      title: issue.title,
      state: issue.state,
      priority: issue.priority,
      assigneeId: issue.assignee_id ?? null,
    })),
    standups: standups.slice(0, 3).map((standup) => ({
      id: standup.id,
      authorId: standup.author_id ?? null,
      createdAt: standup.created_at,
      content: compactText(extractText(standup.content) as string | null | undefined),
    })),
    weeks: weeks.slice(0, 8).map((week) => ({
      id: week.id,
      title: week.title,
      status: week.status,
      sprintNumber: week.sprint_number,
      hasReview: week.has_review ?? null,
      planValidated: week.plan_validated ?? null,
    })),
    existingReview: readContextValue(context, 'existing_review') ?? null,
    existingRetro: readContextValue(context, 'existing_retro') ?? null,
    clarifyingQuestions: Array.isArray(readContextValue(context, 'clarifying_questions_context'))
      ? readContextValue(context, 'clarifying_questions_context')
      : [],
  };
}

export function detectIssueDrift(issue: IssueRow, history: IssueHistoryRow[]) {
  const regression = history.find(
    (entry) => entry.field === 'state' && entry.old_value === 'done' && entry.new_value !== 'done',
  );

  return {
    scopeDrift: !!regression,
    reason: regression ? 'issue_state_regression' : null,
    evidence: regression
      ? {
          field: regression.field,
          oldValue: regression.old_value,
          newValue: regression.new_value,
          createdAt: regression.created_at,
        }
      : null,
    updatedAt: issue.updated_at,
  };
}

export function detectProjectDrift(project: ProjectRow) {
  const properties = asRecord(project.properties);
  const title = compactText(project.title, 120);
  const contentText = summarizeDocumentContent(project.content, 300);
  const plan = compactText(properties.plan, 300);

  return {
    scopeDrift: false,
    reason: null,
    evidence: {
      title,
      content: contentText,
      plan,
    },
  };
}

export function normalizeChatPageContext(pageContext: FleetGraphChatHintContext | null | undefined): FleetGraphChatHintContext | null {
  if (!pageContext) return null;

  return {
    route: pageContext.route,
    surface: pageContext.surface,
    documentId: pageContext.documentId,
    title: compactText(pageContext.title, 120) ?? undefined,
    visibleContentText: compactText(pageContext.visibleContentText, 2000) ?? undefined,
    tab: pageContext.tab,
    tabLabel: compactText(pageContext.tabLabel, 80) ?? undefined,
  };
}
