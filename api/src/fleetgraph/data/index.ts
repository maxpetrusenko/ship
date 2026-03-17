/**
 * FleetGraph data layer public API.
 *
 * Re-exports client, types, and fetcher functions for graph node consumption.
 */

export { ShipApiClient } from './client.js';

export type {
  ShipIssue,
  ShipIssueSummary,
  ShipIssueHistory,
  ShipSprint,
  ShipWorkspaceMember,
  ShipWorkspaceMembersResponse,
  ShipActivityDay,
  ShipActivityResponse,
  ShipAccountabilityItem,
  ShipAccountabilityResponse,
  ShipSprintContext,
  ShipDocumentAssociation,
  ShipProject,
  ShipIssueFilters,
} from './types.js';

export { ShipApiError } from './types.js';

export {
  fetchIssue,
  fetchIssues,
  fetchIssueHistory,
  fetchIssueChildren,
  fetchDocumentAssociations,
  fetchWorkspaceMembers,
  fetchActiveSprints,
  fetchAllSprints,
  fetchActivity,
  fetchAccountabilityItems,
  fetchSprintContext,
  fetchProject,
} from './fetchers.js';

// Re-export stub graph-node interfaces (kept for backward compat during migration)
export type {
  CoreContextResult,
  ParallelSignalsResult,
  ActionResult,
} from './fetchers.js';

export {
  configureFleetGraphData,
  fetchCoreContext,
  fetchParallelSignals,
  executeShipAction,
  persistAlert,
  persistAuditEntry,
} from './fetchers.js';
