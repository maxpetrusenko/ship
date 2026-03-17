/**
 * FleetGraph graph builder.
 *
 * Wires all nodes and conditional edges into a compiled LangGraph StateGraph.
 * Call createFleetGraph() to get a runnable graph instance.
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { FleetGraphState } from './state.js';
import {
  triggerContext,
  fetchCoreContextNode,
  fetchParallelSignalsNode,
  heuristicFilter,
  reasonAboutRisk,
  prepareNotification,
  deliverAlert,
  prepareAction,
  humanGate,
  executeAction,
  logCleanRun,
  logDismissal,
  logSnooze,
  errorFallback,
} from './nodes.js';
import {
  afterHeuristic,
  afterReason,
  afterGate,
} from './edges.js';

// ---------------------------------------------------------------------------
// Node name union (used for type-safe edge wiring)
// ---------------------------------------------------------------------------

type NodeName =
  | 'trigger_context'
  | 'fetch_core_context'
  | 'fetch_parallel_signals'
  | 'heuristic_filter'
  | 'reason_about_risk'
  | 'prepare_notification'
  | 'deliver_alert'
  | 'prepare_action'
  | 'human_gate'
  | 'execute_action'
  | 'log_clean_run'
  | 'log_dismissal'
  | 'log_snooze'
  | 'error_fallback';

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface CreateFleetGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export function createFleetGraph(opts?: CreateFleetGraphOptions) {
  // Register all nodes via record overload so the returned graph type
  // knows every node name. This avoids the per-call generic widening
  // issue with chained .addNode() calls.
  const graph = new StateGraph(FleetGraphState)
    .addNode('trigger_context', triggerContext)
    .addNode('fetch_core_context', fetchCoreContextNode)
    .addNode('fetch_parallel_signals', fetchParallelSignalsNode)
    .addNode('heuristic_filter', heuristicFilter)
    .addNode('reason_about_risk', reasonAboutRisk)
    .addNode('prepare_notification', prepareNotification)
    .addNode('deliver_alert', deliverAlert)
    .addNode('prepare_action', prepareAction)
    .addNode('human_gate', humanGate)
    .addNode('execute_action', executeAction)
    .addNode('log_clean_run', logCleanRun)
    .addNode('log_dismissal', logDismissal)
    .addNode('log_snooze', logSnooze)
    .addNode('error_fallback', errorFallback);

  // --- Linear chain: entry through heuristic ---
  graph.addEdge(START, 'trigger_context');
  graph.addEdge('trigger_context', 'fetch_core_context');
  graph.addEdge('fetch_core_context', 'fetch_parallel_signals');
  graph.addEdge('fetch_parallel_signals', 'heuristic_filter');

  // --- Conditional: after heuristic filter ---
  graph.addConditionalEdges('heuristic_filter', afterHeuristic, {
    log_clean_run: 'log_clean_run',
    reason_about_risk: 'reason_about_risk',
    error_fallback: 'error_fallback',
  });

  // --- Conditional: after reasoning ---
  graph.addConditionalEdges('reason_about_risk', afterReason, {
    prepare_notification: 'prepare_notification',
    prepare_action: 'prepare_action',
    error_fallback: 'error_fallback',
  });

  // --- After notification: deliver and end ---
  graph.addEdge('prepare_notification', 'deliver_alert');
  graph.addEdge('deliver_alert', END);

  // --- After action prep: human gate ---
  graph.addEdge('prepare_action', 'human_gate');

  // --- Conditional: after human gate ---
  graph.addConditionalEdges('human_gate', afterGate, {
    execute_action: 'execute_action',
    log_dismissal: 'log_dismissal',
    log_snooze: 'log_snooze',
  });

  // --- Terminal nodes ---
  graph.addEdge('execute_action', END);
  graph.addEdge('log_clean_run', END);
  graph.addEdge('log_dismissal', END);
  graph.addEdge('log_snooze', END);
  graph.addEdge('error_fallback', END);

  // --- Compile with optional checkpointer for HITL interrupt ---
  // The human_gate node calls interrupt() internally, so we do NOT
  // need interruptBefore. The checkpointer enables pause/resume.
  return graph.compile({
    checkpointer: opts?.checkpointer,
  });
}
