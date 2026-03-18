/**
 * FleetGraph LangGraph state annotation.
 *
 * Maps 1:1 to FleetGraphRunState from shared types.
 * Uses Annotation.Root so LangGraph can track partial updates per node.
 */

import { Annotation } from '@langchain/langgraph';
import type {
  FleetGraphMode,
  FleetGraphEntityType,
  FleetGraphBranch,
  FleetGraphCandidate,
  FleetGraphAssessment,
  FleetGraphErrorLog,
  HumanGateOutcome,
  FleetGraphChatMessage,
  FleetGraphPageContext,
  FleetGraphTrigger,
} from '@ship/shared';

// ---------------------------------------------------------------------------
// State annotation
// ---------------------------------------------------------------------------

export const FleetGraphState = Annotation.Root({
  // Entry context
  runId: Annotation<string>,
  traceId: Annotation<string>,
  mode: Annotation<FleetGraphMode>,
  workspaceId: Annotation<string>,
  actorUserId: Annotation<string | null>,

  // Page context (on-demand only)
  entityType: Annotation<FleetGraphEntityType | null>,
  entityId: Annotation<string | null>,
  pageContext: Annotation<FleetGraphPageContext | null>,

  // Fetched data
  coreContext: Annotation<Record<string, unknown>>,
  parallelSignals: Annotation<Record<string, unknown>>,

  // After heuristic filter
  candidates: Annotation<FleetGraphCandidate[]>,
  branch: Annotation<FleetGraphBranch>,

  // After reasoning
  assessment: Annotation<FleetGraphAssessment | null>,

  // After human gate
  gateOutcome: Annotation<HumanGateOutcome | null>,
  snoozeUntil: Annotation<string | null>,

  // Error state
  error: Annotation<FleetGraphErrorLog | null>,

  // Telemetry (Phase 2D)
  runStartedAt: Annotation<number>,
  tokenUsage: Annotation<{ input: number; output: number } | null>,

  // Chat context (Phase 2B: threaded into LLM prompt)
  chatQuestion: Annotation<string | null>,
  chatHistory: Annotation<FleetGraphChatMessage[] | null>,

  // LangSmith trace URL (Phase 2D)
  traceUrl: Annotation<string | null>,

  // Trigger source (Phase 3: page-view + webhook)
  trigger: Annotation<FleetGraphTrigger | undefined>,
});

/** Inferred state type from the annotation. */
export type FleetGraphStateType = typeof FleetGraphState.State;
