import type {
  FleetGraphAssessment,
  FleetGraphChatMessage,
  FleetGraphEntityType,
  FleetGraphPageContext,
} from '@ship/shared';

export type FleetGraphChatToolName =
  | 'fetch_issue_context'
  | 'fetch_sprint_context'
  | 'fetch_project_context'
  | 'fetch_project_summary'
  | 'fetch_sprint_summary'
  | 'fetch_workspace_signals'
  | 'fetch_entity_drift'
  | 'fetch_related_documents'
  | 'fetch_document_content'
  | 'call_ship_api'
  | 'fetch_workspace_members';

export interface FleetGraphChatHintContext {
  route: string;
  surface: FleetGraphPageContext['surface'];
  documentId?: string;
  title?: string;
  documentType?: string;
  visibleContentText?: string;
  tab?: string;
  tabLabel?: string;
}

export interface FleetGraphChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface FleetGraphChatRequest {
  workspaceId: string;
  userId: string;
  threadId: string;
  entityType: FleetGraphEntityType;
  entityId: string;
  question: string;
  history?: FleetGraphChatTurn[];
  pageContext?: FleetGraphChatHintContext | FleetGraphPageContext | null;
}

export interface FleetGraphChatToolContext {
  workspaceId: string;
  userId: string;
  threadId: string;
  entityType: FleetGraphEntityType;
  entityId: string;
  pageContext: FleetGraphChatHintContext | null;
}

export interface FleetGraphChatToolCallRecord {
  name: FleetGraphChatToolName;
  callId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface FleetGraphChatRuntimeAssessment {
  summary: string;
  recommendation: string;
  branch: FleetGraphAssessment['branch'];
  proposedAction: FleetGraphAssessment['proposedAction'] | null;
  citations: string[];
}

export interface FleetGraphChatRuntimeResult {
  responseId: string | null;
  traceUrl?: string | null;
  steps: number;
  assessment: FleetGraphChatRuntimeAssessment;
  message: FleetGraphChatMessage;
  toolCalls: FleetGraphChatToolCallRecord[];
  rawOutputText: string;
  usage: {
    input: number;
    output: number;
  } | null;
}

export interface FleetGraphFunctionToolSchema {
  type: 'function';
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
}

export interface FleetGraphResponsesFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface FleetGraphResponsesFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface FleetGraphResponsesMessage {
  type?: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string;
  phase?: 'commentary' | 'final_answer' | null;
}

export type FleetGraphResponsesInputItem =
  | FleetGraphResponsesMessage
  | FleetGraphResponsesFunctionCallOutput;

export interface FleetGraphResponsesResponseLike {
  id: string;
  output: Array<{ type?: string; [key: string]: unknown }>;
  output_text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
}

export interface FleetGraphResponsesClientLike {
  responses: {
    create(
      body: Record<string, unknown>,
    ): Promise<FleetGraphResponsesResponseLike>;
  };
}

export interface FleetGraphChatRuntimeDependencies {
  client?: FleetGraphResponsesClientLike;
  model?: string;
  maxSteps?: number;
  stepTimeoutMs?: number;
  data?: FleetGraphChatDataAccess;
}

export interface FleetGraphChatDataAccess {
  fetchIssueContext(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchSprintContext(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchProjectContext(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchProjectSummary(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchSprintSummary(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchWorkspaceSignals(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchEntityDrift(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchRelatedDocuments(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchDocumentContent(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  callShipApi(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  fetchWorkspaceMembers(
    context: FleetGraphChatToolContext,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
