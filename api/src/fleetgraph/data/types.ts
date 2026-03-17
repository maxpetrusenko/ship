/**
 * FleetGraph data adapter response types.
 *
 * Mirrors Ship API response shapes with stricter typing for graph node consumption.
 * Uses shared types from @ship/shared where applicable.
 */

import type {
  IssueProperties,
  WeekProperties,
  ProjectProperties,
  BelongsTo,
} from '@ship/shared';

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

/** Full issue document returned by GET /api/issues/:id */
export interface ShipIssue {
  id: string;
  title: string;
  document_type: 'issue';
  properties: IssueProperties;
  ticket_number: number;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  converted_from_id: string | null;
  display_id: string;
  assignee_name: string | null;
  assignee_archived: boolean;
  created_by_name: string | null;
  belongs_to: BelongsTo[];
}

/** Summary issue returned by GET /api/issues (list) */
export interface ShipIssueSummary {
  id: string;
  title: string;
  state: string;
  priority: string;
  assignee_id: string | null;
  ticket_number: number;
  display_id: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  belongs_to: BelongsTo[];
}

/** History entry returned by GET /api/issues/:id/history */
export interface ShipIssueHistory {
  id: number;
  field: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: { id: string; name: string } | null;
  automated_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Sprint types
// ---------------------------------------------------------------------------

/** Sprint document returned by GET /api/weeks */
export interface ShipSprint {
  id: string;
  title: string;
  properties: WeekProperties;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Workspace member types
// ---------------------------------------------------------------------------

/** Member entry returned by GET /api/workspaces/:id/members */
export interface ShipWorkspaceMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  personDocumentId: string | null;
  joinedAt: string;
  isArchived: boolean;
}

/** Wrapper for members response */
export interface ShipWorkspaceMembersResponse {
  success: boolean;
  data: {
    members: ShipWorkspaceMember[];
  };
}

// ---------------------------------------------------------------------------
// Activity types
// ---------------------------------------------------------------------------

/** Activity day entry returned by GET /api/activity/:entityType/:entityId */
export interface ShipActivityDay {
  date: string;
  count: number;
}

/** Full activity response */
export interface ShipActivityResponse {
  days: ShipActivityDay[];
}

// ---------------------------------------------------------------------------
// Accountability types
// ---------------------------------------------------------------------------

/** Action item returned by GET /api/accountability/action-items */
export interface ShipAccountabilityItem {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  is_system_generated: boolean;
  accountability_type: string;
  accountability_target_id: string;
  target_title: string;
  due_date: string | null;
  days_overdue: number;
  person_id: string | null;
  project_id: string | null;
  week_number: number | null;
}

/** Accountability items response wrapper */
export interface ShipAccountabilityResponse {
  items: ShipAccountabilityItem[];
  total: number;
  has_overdue: boolean;
  has_due_today: boolean;
}

// ---------------------------------------------------------------------------
// Manager action items (missed standup by direct reports)
// ---------------------------------------------------------------------------

/** Action item for a manager when a direct report misses their standup */
export interface ManagerActionItem {
  employeeName: string;
  employeeId: string;
  dueTime: string;
  overdueMinutes: number;
  sprintId: string;
  sprintTitle: string;
  projectId: string | null;
  projectTitle: string | null;
}

/** Response wrapper for GET /api/accountability/manager-action-items */
export interface ManagerActionItemsResponse {
  items: ManagerActionItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Sprint context (Claude context API)
// ---------------------------------------------------------------------------

/** Sprint context returned by GET /api/claude/context?context_type=standup */
export interface ShipSprintContext {
  sprint: {
    id: string;
    title: string;
    sprint_number: string;
    status: string;
    plan: string | null;
  };
  program: {
    id: string | null;
    name: string | null;
    description: string | null;
    goals: string | null;
  };
  project: {
    id: string | null;
    name: string | null;
    plan: string | null;
  };
  issues: Array<{
    id: string;
    title: string;
    state: string;
    priority: string;
    assignee_id: string | null;
    ticket_number: number;
  }>;
  standups: Array<{
    id: string;
    author_id: string;
    date: string;
    content: Record<string, unknown>;
    created_at: string;
  }>;
  issueStats: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Document association types
// ---------------------------------------------------------------------------

/** Association entry returned by GET /api/documents/:id/associations */
export interface ShipDocumentAssociation {
  id: string;
  document_id: string;
  related_id: string;
  relationship_type: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  related_title: string;
  related_document_type: string;
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

/** Project document returned by GET /api/documents/:id */
export interface ShipProject {
  id: string;
  title: string;
  document_type: 'project';
  properties: ProjectProperties;
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  belongs_to: BelongsTo[];
}

// ---------------------------------------------------------------------------
// Fetcher filter params
// ---------------------------------------------------------------------------

/** Optional filters for issue list queries */
export interface ShipIssueFilters {
  state?: string;
  priority?: string;
  assignee_id?: string;
  program_id?: string;
  sprint_id?: string;
  source?: string;
  parent_filter?: 'top_level' | 'has_children' | 'is_sub_issue';
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Typed error for Ship API failures */
export class ShipApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'ShipApiError';
  }
}
