import type { IssueProperties, ProjectProperties, StandupProperties, WeekProperties } from './document.js';
import type { TipTapDoc } from './tiptap.js';

export type InferredProjectStatus = 'active' | 'planned' | 'completed' | 'backlog' | 'archived';

export interface DocumentRow<TProperties extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string | null;
  properties: TProperties | null;
  archived_at?: Date | string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export type ProjectRow = DocumentRow<ProjectProperties> & {
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  program_id?: string | null;
  sprint_count?: string | number | null;
  issue_count?: string | number | null;
  inferred_status?: InferredProjectStatus | null;
  converted_from_id?: string | null;
};

export type ProjectSprintRow = DocumentRow<WeekProperties> & {
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  program_id?: string | null;
  program_name?: string | null;
  program_prefix?: string | null;
  workspace_sprint_start_date?: string | null;
  issue_count?: string | number | null;
  completed_count?: string | number | null;
  started_count?: string | number | null;
};

export type FeedbackRow = DocumentRow<IssueProperties> & {
  ticket_number?: number | null;
  program_id?: string | null;
  content?: TipTapDoc | null;
  created_by?: string | null;
  program_name?: string | null;
  program_prefix?: string | null;
  program_color?: string | null;
  created_by_name?: string | null;
};

export type StandupRow = DocumentRow<StandupProperties> & {
  parent_id: string;
  content?: TipTapDoc | null;
  author_id: string;
  author_name?: string | null;
  author_email?: string | null;
};

export type DashboardIssueRow = DocumentRow<IssueProperties> & {
  ticket_number?: number | null;
  sprint_id?: string | null;
  sprint_name?: string | null;
  sprint_number?: number | null;
  program_name?: string | null;
};

export type DashboardProjectRow = DocumentRow<ProjectProperties> & {
  program_name?: string | null;
  inferred_status?: InferredProjectStatus | null;
};

export type DashboardSprintRow = DocumentRow<WeekProperties> & {
  program_name?: string | null;
  sprint_number?: number | null;
};

export interface TeamGridIssueRow {
  id: string;
  title: string;
  assignee_id: string | null;
  state: string | null;
  ticket_number: number | null;
  sprint_number: number | null;
  program_id: string | null;
  program_name: string | null;
  program_emoji?: string | null;
  program_color?: string | null;
}
