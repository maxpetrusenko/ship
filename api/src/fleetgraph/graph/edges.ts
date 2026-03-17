/**
 * FleetGraph conditional edge routing functions.
 *
 * Each function inspects state and returns the name of the next node.
 * LangGraph wires these via .addConditionalEdges().
 */

import type { FleetGraphStateType } from './state.js';

// ---------------------------------------------------------------------------
// After heuristic_filter
// ---------------------------------------------------------------------------

export function afterHeuristic(
  state: FleetGraphStateType,
): 'log_clean_run' | 'reason_about_risk' | 'error_fallback' {
  if (state.branch === 'error') {
    return 'error_fallback';
  }
  // Chat mode: always route to LLM so user gets a real answer
  if (state.chatQuestion) {
    return 'reason_about_risk';
  }
  if (state.branch === 'clean') {
    return 'log_clean_run';
  }
  // Candidates exist; route to LLM reasoning
  return 'reason_about_risk';
}

// ---------------------------------------------------------------------------
// After reason_about_risk
// ---------------------------------------------------------------------------

export function afterReason(
  state: FleetGraphStateType,
): 'prepare_notification' | 'prepare_action' | 'error_fallback' {
  if (!state.assessment) {
    return 'error_fallback';
  }
  if (state.assessment.branch === 'confirm_action') {
    return 'prepare_action';
  }
  return 'prepare_notification';
}

// ---------------------------------------------------------------------------
// After human_gate
// ---------------------------------------------------------------------------

export function afterGate(
  state: FleetGraphStateType,
): 'execute_action' | 'log_dismissal' | 'log_snooze' {
  if (state.gateOutcome === 'approve') {
    return 'execute_action';
  }
  if (state.gateOutcome === 'snooze') {
    return 'log_snooze';
  }
  // Default: dismiss
  return 'log_dismissal';
}
