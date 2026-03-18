/**
 * FleetGraph shared contracts.
 * All agents, routes, and UI components import from here.
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type FleetGraphMode = 'proactive' | 'on_demand';

export type FleetGraphTrigger = 'sweep' | 'on_demand' | 'page_view' | 'github_webhook';

export type FleetGraphEntityType = 'issue' | 'sprint' | 'project' | 'workspace';

export type FleetGraphBranch =
  | 'clean'
  | 'inform_only'
  | 'confirm_action'
  | 'error';

export type FleetGraphSignalType =
  | 'missing_standup'
  | 'manager_missing_standup'
  | 'stale_issue'
  | 'scope_drift'
  | 'approval_bottleneck'
  | 'ownership_gap'
  | 'multi_signal_cluster'
  | 'chat_suggestion';

export type HumanGateOutcome = 'approve' | 'reject' | 'dismiss' | 'snooze';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Action types (Phase 2A: real action dispatch)
// ---------------------------------------------------------------------------

export type FleetGraphActionType =
  | 'reassign_issue'
  | 'change_state'
  | 'escalate_priority'
  | 'flag_issue'
  | 'add_comment';

export interface ReassignIssuePayload {
  assignee_id: string;
}

export interface ChangeStatePayload {
  state: 'triage' | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
}

export interface EscalatePriorityPayload {
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
}

export interface FlagIssuePayload {
  priority: 'urgent';
  reason?: string;
}

export interface AddCommentPayload {
  content: string;
}

export type FleetGraphActionPayload =
  | ReassignIssuePayload
  | ChangeStatePayload
  | EscalatePriorityPayload
  | FlagIssuePayload
  | AddCommentPayload;

// ---------------------------------------------------------------------------
// Signal thresholds (conservative defaults from FLEETGRAPH.md)
// ---------------------------------------------------------------------------

export interface FleetGraphThresholds {
  missingStandupSameDay: boolean;         // same workday after expected window
  staleIssueDays: number;                 // default 3 business days
  approvalBottleneckDays: number;         // default 2 business days
  scopeDriftImmediate: boolean;           // immediate after plan snapshot
  carryoverSprintCount: number;           // 3+ consecutive sprints (stretch)
}

export const DEFAULT_THRESHOLDS: FleetGraphThresholds = {
  missingStandupSameDay: true,
  staleIssueDays: 3,
  approvalBottleneckDays: 2,
  scopeDriftImmediate: true,
  carryoverSprintCount: 3,
};

// ---------------------------------------------------------------------------
// Manager missed-standup evidence (for manager_missing_standup signal)
// ---------------------------------------------------------------------------

export interface ManagerMissingStandupEvidence {
  targetUserId: string;
  employeeName: string;
  employeeId: string;
  overdueMinutes: number;
  dueTime: string;
  sprintId: string;
  sprintTitle: string;
  projectId: string | null;
  projectTitle: string | null;
}

// ---------------------------------------------------------------------------
// Graph state (carried across nodes in a single run)
// ---------------------------------------------------------------------------

export interface FleetGraphCandidate {
  signalType: FleetGraphSignalType;
  entityType: FleetGraphEntityType;
  entityId: string;
  severity: AlertSeverity;
  evidence: Record<string, unknown>;
  ownerUserId: string | null;
  fingerprint: string;
}

export interface FleetGraphAssessment {
  summary: string;
  recommendation: string;
  branch: 'inform_only' | 'confirm_action';
  proposedAction?: FleetGraphProposedAction;
  citations: string[];
}

export interface FleetGraphProposedAction {
  actionType: string;
  targetEntityType: FleetGraphEntityType;
  targetEntityId: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface FleetGraphRunState {
  // Entry context
  runId: string;
  traceId: string;
  mode: FleetGraphMode;
  workspaceId: string;
  actorUserId: string | null;

  // Page context (on-demand only)
  entityType: FleetGraphEntityType | null;
  entityId: string | null;
  pageContext: FleetGraphPageContext | null;

  // Fetched data
  coreContext: Record<string, unknown>;
  parallelSignals: Record<string, unknown>;

  // After heuristic filter
  candidates: FleetGraphCandidate[];
  branch: FleetGraphBranch;

  // After reasoning
  assessment: FleetGraphAssessment | null;

  // After human gate
  gateOutcome: HumanGateOutcome | null;
  snoozeUntil: string | null;

  // Error state
  error: FleetGraphErrorLog | null;

  // Telemetry (Phase 2D)
  runStartedAt: number;
  tokenUsage: { input: number; output: number } | null;

  // Chat context (Phase 2B: threaded into LLM prompt)
  chatQuestion: string | null;
  chatHistory: FleetGraphChatMessage[] | null;

  // LangSmith trace URL (Phase 2D)
  traceUrl: string | null;

  // Trigger source (Phase 3: page-view + webhook)
  trigger?: FleetGraphTrigger;
}

// ---------------------------------------------------------------------------
// Persisted alert state (dedupe + snooze across runs)
// ---------------------------------------------------------------------------

export interface FleetGraphAlert {
  id: string;
  workspaceId: string;
  fingerprint: string;
  signalType: FleetGraphSignalType;
  entityType: FleetGraphEntityType;
  entityId: string;
  severity: AlertSeverity;
  summary: string;
  recommendation: string;
  citations: string[];
  ownerUserId: string | null;
  status: 'active' | 'dismissed' | 'snoozed' | 'resolved' | 'rejected';
  snoozedUntil: string | null;
  lastSurfacedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Per-recipient read timestamp (null = unread). Populated from recipient join. */
  readAt: string | null;
}

// ---------------------------------------------------------------------------
// Alert recipient (per-user notification state)
// ---------------------------------------------------------------------------

export interface FleetGraphAlertRecipient {
  id: string;
  alertId: string;
  userId: string;
  readAt: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Approval state (HITL gate persistence)
// ---------------------------------------------------------------------------

export type FleetGraphApprovalStatus =
  | 'pending'
  | 'approved'
  | 'dismissed'
  | 'snoozed'
  | 'executed'
  | 'execution_failed'
  | 'expired';

export interface FleetGraphApproval {
  id: string;
  workspaceId: string;
  alertId: string;
  runId: string;
  threadId: string;
  checkpointId: string | null;
  actionType: string;
  targetEntityType: FleetGraphEntityType;
  targetEntityId: string;
  description: string;
  payload: Record<string, unknown>;
  status: FleetGraphApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface FleetGraphAuditEntry {
  id: string;
  workspaceId: string;
  runId: string;
  mode: FleetGraphMode;
  entityType: FleetGraphEntityType | null;
  entityId: string | null;
  branch: FleetGraphBranch;
  candidateCount: number;
  durationMs: number;
  tokenUsage: { input: number; output: number } | null;
  traceUrl: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Error fallback logging (from FLEETGRAPH.md:390)
// ---------------------------------------------------------------------------

export interface FleetGraphErrorLog {
  runId: string;
  traceId: string;
  mode: FleetGraphMode;
  entityType: FleetGraphEntityType | null;
  entityId: string | null;
  workspaceId: string;
  failedNode: string;
  failedRoute: string | null;
  errorClass: string;
  retryable: boolean;
  inputFingerprint: string | null;
  partialAnswerReturned: boolean;
  followUpAction: 'retry' | 'ignore' | 'tune_heuristic' | 'inspect_schema';
}

// ---------------------------------------------------------------------------
// API request/response contracts
// ---------------------------------------------------------------------------

/** POST /api/fleetgraph/on-demand */
export interface FleetGraphOnDemandRequest {
  entityType: FleetGraphEntityType;
  entityId: string;
  workspaceId: string;
  question?: string;
}

export interface FleetGraphOnDemandResponse {
  runId: string;
  branch: FleetGraphBranch;
  assessment: FleetGraphAssessment | null;
  alerts: FleetGraphAlert[];
  traceUrl?: string;
}

/** POST /api/fleetgraph/page-view */
export interface FleetGraphPageViewResponse {
  triggered: boolean;
  reason: string;
}

/** GET /api/fleetgraph/alerts?entityType=...&entityId=... */
export interface FleetGraphAlertsResponse {
  alerts: FleetGraphAlert[];
  pendingApprovals: FleetGraphApproval[];
  total: number;
  /** Count of unread alerts for the requesting user. */
  unreadCount: number;
}

/** POST /api/fleetgraph/alerts/:id/resolve */
export interface FleetGraphAlertResolveRequest {
  outcome: 'dismiss' | 'snooze' | 'approve' | 'reject';
  /** ISO timestamp; required when outcome is 'snooze'. Preferred over snoozeDurationMinutes. */
  snoozedUntil?: string;
  /** Convenience alternative: minutes from now. Used when snoozedUntil is absent. */
  snoozeDurationMinutes?: number;
  /** Optional user-provided reason for the decision. */
  reason?: string;
}

/** GET /api/fleetgraph/status */
export interface FleetGraphStatusResponse {
  running: boolean;
  lastSweepAt: string | null;
  nextSweepAt: string | null;
  sweepIntervalMs: number;
  alertsActive: number;
}

// ---------------------------------------------------------------------------
// Realtime event payloads (via broadcastToUser)
// ---------------------------------------------------------------------------

export interface FleetGraphAlertEvent {
  alertId: string;
  signalType: FleetGraphSignalType;
  entityType: FleetGraphEntityType;
  entityId: string;
  severity: AlertSeverity;
  summary: string;
  ownerUserId: string | null;
}

// Realtime event type string
export const FLEETGRAPH_ALERT_EVENT = 'fleetgraph:alert' as const;

// ---------------------------------------------------------------------------
// Page context (injected every chat turn from the web app)
// ---------------------------------------------------------------------------

export interface FleetGraphPageContext {
  route: string;
  surface: 'docs' | 'issue' | 'project' | 'sprint' | 'workspace';
  documentId?: string;
  title?: string;
  tab?: string;
  tabLabel?: string;
  documentType?: string;
  isEmpty?: boolean;
  breadcrumbs?: Array<{ id: string; title: string; type: string }>;
  belongsTo?: Array<{ id: string; title: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Chat threads (persistent, restart-safe)
// ---------------------------------------------------------------------------

export interface FleetGraphChatThread {
  id: string;
  workspaceId: string;
  userId: string;
  status: 'active' | 'archived';
  lastPageRoute: string | null;
  lastPageSurface: string | null;
  lastPageDocumentId: string | null;
  lastPageTitle: string | null;
  /** Entity scope: threads can be scoped to a specific entity. */
  entityType: FleetGraphEntityType | null;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FleetGraphChatThreadResponse {
  thread: FleetGraphChatThread | null;
  messages: FleetGraphChatMessage[];
}

export interface FleetGraphCreateChatThreadResponse {
  thread: FleetGraphChatThread;
}

// ---------------------------------------------------------------------------
// Multi-turn chat (Phase 2B)
// ---------------------------------------------------------------------------

export interface FleetGraphChatMessage {
  role: 'user' | 'assistant';
  content: string;
  alertId?: string;
  assessment?: FleetGraphAssessment;
  debug?: FleetGraphChatDebugInfo;
  timestamp: string;
}

export interface FleetGraphChatDebugInfo {
  traceUrl: string | null;
  branch: FleetGraphBranch;
  entityType: FleetGraphEntityType | null;
  entityId: string | null;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  candidateSignals: FleetGraphSignalType[];
  accountability: {
    total: number;
    overdue: number;
    dueToday: number;
  };
  managerActionItems: number;
}

export interface FleetGraphChatRequest {
  entityType: FleetGraphEntityType;
  entityId: string;
  workspaceId: string;
  question: string;
  conversationId?: string;
  threadId?: string;
  pageContext?: FleetGraphPageContext;
  history?: FleetGraphChatMessage[];
}

export interface FleetGraphChatResponse {
  conversationId: string;
  threadId?: string;
  runId: string;
  branch: FleetGraphBranch;
  assessment: FleetGraphAssessment | null;
  alerts: FleetGraphAlert[];
  message: FleetGraphChatMessage;
  traceUrl?: string;
}

// ---------------------------------------------------------------------------
// UI component props
// ---------------------------------------------------------------------------

export interface FleetGraphPanelProps {
  entityType: FleetGraphEntityType;
  entityId: string;
  workspaceId: string;
}

export interface FleetGraphAlertCardProps {
  alert: FleetGraphAlert;
  onResolve: (outcome: FleetGraphAlertResolveRequest['outcome'], snoozeDurationMinutes?: number) => void;
  isResolving?: boolean;
}

export interface FleetGraphApprovalCardProps {
  alert: FleetGraphAlert;
  proposedAction: FleetGraphProposedAction;
  onApprove: () => Promise<unknown>;
  onReject: () => Promise<unknown>;
  onDismiss: () => Promise<unknown>;
  onSnooze: (minutes: number) => Promise<unknown>;
  isActioning?: boolean;
  expiresAt?: string;
}
