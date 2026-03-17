/**
 * FleetGraph centralized model-selection policy.
 *
 * All LLM model IDs, temperatures, and token budgets are configured here.
 * Graph nodes reference named policy roles instead of hardcoded model IDs.
 *
 * Default rollout: one configured OpenAI model bound to all roles.
 * Role-specific overrides added only after eval-backed optimization.
 */

export type ModelRole =
  | 'reasoning_primary'
  | 'reasoning_fallback'
  | 'conversation_summary'
  | 'chat_streaming';

export interface ModelPolicyEntry {
  modelId: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_MODEL_ID = process.env.FLEETGRAPH_MODEL_ID ?? 'gpt-4o-mini';

const MODEL_POLICY: Record<ModelRole, ModelPolicyEntry> = {
  reasoning_primary: { modelId: DEFAULT_MODEL_ID, temperature: 0.2, maxTokens: 1024 },
  reasoning_fallback: { modelId: DEFAULT_MODEL_ID, temperature: 0.2, maxTokens: 1024 },
  conversation_summary: { modelId: DEFAULT_MODEL_ID, temperature: 0.1, maxTokens: 512 },
  chat_streaming: { modelId: DEFAULT_MODEL_ID, temperature: 0.3, maxTokens: 2048 },
};

export function getModelConfig(role: ModelRole): ModelPolicyEntry {
  return MODEL_POLICY[role];
}
