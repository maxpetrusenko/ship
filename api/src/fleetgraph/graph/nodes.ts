/**
 * FleetGraph core graph nodes (1-5).
 *
 * Each node is an async function: (state) => Partial<state>.
 * Nodes only return the fields they change; LangGraph merges them.
 *
 * Terminal nodes (6-14) live in nodes-terminal.ts.
 */

import { ChatOpenAI } from '@langchain/openai';
import { traceable } from 'langsmith/traceable';
import type {
  FleetGraphCandidate,
  FleetGraphAssessment,
  FleetGraphBranch,
  FleetGraphErrorLog,
  ManagerMissingStandupEvidence,
} from '@ship/shared';
import {
  DEFAULT_THRESHOLDS as THRESHOLDS,
} from '@ship/shared';
import type { FleetGraphStateType } from './state.js';
import {
  fetchCoreContext,
  fetchParallelSignals,
} from '../data/fetchers.js';
import { getModelConfig } from '../config/model-policy.js';
import {
  canUseLangSmithTracing,
  getLangSmithProjectName,
  resolveLangSmithRunUrl,
} from '../runtime/langsmith.js';
import { extractText } from '../../utils/document-content.js';
import { sortCandidatesByPriority } from './candidate-priority.js';
import { getIssueScopeDriftEvidence } from './scope-drift.js';

// Re-export terminal nodes so builder can import from one place
export {
  prepareNotification,
  deliverAlert,
  setBroadcastFn,
  prepareAction,
  humanGate,
  setGatePool,
  executeAction,
  logCleanRun,
  logDismissal,
  logSnooze,
  errorFallback,
} from './nodes-terminal.js';
export type { BroadcastFn } from './nodes-terminal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorLog(
  state: FleetGraphStateType,
  failedNode: string,
  errorClass: string,
  retryable: boolean = false,
): FleetGraphErrorLog {
  return {
    runId: state.runId,
    traceId: state.traceId,
    mode: state.mode,
    entityType: state.entityType,
    entityId: state.entityId,
    workspaceId: state.workspaceId,
    failedNode,
    failedRoute: null,
    errorClass,
    retryable,
    inputFingerprint: null,
    partialAnswerReturned: false,
    followUpAction: 'retry',
  };
}

/** Fingerprint for dedup: signal + entity + workspace. */
function fingerprint(
  signalType: string,
  entityType: string,
  entityId: string,
  workspaceId: string,
): string {
  return `${workspaceId}:${entityType}:${entityId}:${signalType}`;
}

function getContextOwnerUserId(ctx: Record<string, unknown>): string | null {
  const metadata = ctx.metadata;
  if (metadata && typeof metadata === 'object') {
    const ownerUserId = (metadata as Record<string, unknown>).ownerUserId;
    return typeof ownerUserId === 'string' ? ownerUserId : null;
  }
  const ownerUserId = ctx.ownerUserId;
  return typeof ownerUserId === 'string' ? ownerUserId : null;
}

function getIssueUpdatedAtDaysAgo(ctx: Record<string, unknown>): number | null {
  const entity = ctx.entity;
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const updatedAt = (entity as Record<string, unknown>).updated_at;
  if (typeof updatedAt !== 'string') {
    return null;
  }

  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const DAY_MS = 86_400_000;
  return Math.floor((Date.now() - timestamp) / DAY_MS);
}

const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'but', 'by', 'do', 'for',
  'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'let',
  'of', 'on', 'or', 'our', 'project', 'ship', 'that',
  'the', 'their', 'this', 'to', 'up', 'we', 'with', 'work',
]);

function tokenizeTopicText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !TOPIC_STOP_WORDS.has(token));
}

function getProjectContentScopeDriftEvidence(ctx: Record<string, unknown>): Record<string, unknown> | null {
  const entity = ctx.entity;
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const entityRecord = entity as Record<string, unknown>;
  const contentText = extractText(entityRecord.content).trim();
  if (contentText.length < 20) {
    return null;
  }

  const contentTokens = new Set(tokenizeTopicText(contentText));
  if (contentTokens.size < 3) {
    return null;
  }

  const topicSources: string[] = [];
  if (typeof entityRecord.title === 'string') {
    topicSources.push(entityRecord.title);
  }

  const properties = entityRecord.properties;
  if (properties && typeof properties === 'object') {
    const plan = (properties as Record<string, unknown>).plan;
    if (typeof plan === 'string' && plan.trim().length > 0) {
      topicSources.push(plan);
    }
  }

  const relatedEntities = ctx.relatedEntities;
  if (Array.isArray(relatedEntities)) {
    for (const related of relatedEntities) {
      if (!related || typeof related !== 'object') continue;
      const title = (related as Record<string, unknown>).title
        ?? (related as Record<string, unknown>).related_title;
      if (typeof title === 'string' && title.trim().length > 0) {
        topicSources.push(title);
      }
    }
  }

  const topicTokens = new Set(tokenizeTopicText(topicSources.join(' ')));
  if (topicTokens.size < 3) {
    return null;
  }

  const overlap = [...contentTokens].filter((token) => topicTokens.has(token));
  if (overlap.length > 0) {
    return null;
  }

  return {
    scopeDrift: true,
    reason: 'project_content_topic_mismatch',
    contentExcerpt: contentText.slice(0, 200),
    topicReference: topicSources.slice(0, 5),
  };
}

interface AccountabilityItemLike {
  title?: string;
  accountability_target_id?: string | null;
  project_id?: string | null;
  week_number?: number | null;
  days_overdue?: number;
}

function getAccountabilityItems(state: FleetGraphStateType): AccountabilityItemLike[] {
  const accountability = (state.parallelSignals as Record<string, unknown>).accountability;
  if (!accountability || typeof accountability !== 'object') {
    return [];
  }

  const items = (accountability as Record<string, unknown>).items;
  return Array.isArray(items) ? items as AccountabilityItemLike[] : [];
}

function getSprintNumber(state: FleetGraphStateType): number | null {
  const entity = (state.coreContext as Record<string, unknown>).entity;
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const rawSprintNumber = (entity as Record<string, unknown>).sprint_number
    ?? ((entity as Record<string, unknown>).properties as Record<string, unknown> | undefined)?.sprint_number;
  if (typeof rawSprintNumber === 'number') {
    return rawSprintNumber;
  }
  if (typeof rawSprintNumber === 'string') {
    const parsed = Number.parseInt(rawSprintNumber, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getScopeRelevantAccountabilityItems(
  state: FleetGraphStateType,
  items: AccountabilityItemLike[],
): AccountabilityItemLike[] {
  if (state.entityType === 'workspace') {
    return items;
  }

  if (!state.entityId) {
    return [];
  }

  if (state.entityType === 'sprint') {
    const sprintNumber = getSprintNumber(state);
    return items.filter((item) =>
      item.accountability_target_id === state.entityId
      || (typeof item.week_number === 'number' && sprintNumber !== null && item.week_number === sprintNumber),
    );
  }

  if (state.entityType === 'project') {
    return items.filter((item) =>
      item.accountability_target_id === state.entityId || item.project_id === state.entityId,
    );
  }

  return items.filter((item) => item.accountability_target_id === state.entityId);
}

function countOverdue(items: AccountabilityItemLike[]): number {
  return items.filter((item) => typeof item.days_overdue === 'number' && item.days_overdue > 0).length;
}

function countDueToday(items: AccountabilityItemLike[]): number {
  return items.filter((item) => item.days_overdue === 0).length;
}

function summarizeTopItems(items: AccountabilityItemLike[]): string {
  const titles = items
    .map((item) => item.title)
    .filter((title): title is string => typeof title === 'string' && title.length > 0)
    .slice(0, 2);

  if (titles.length === 0) {
    return 'Open the accountability list and clear the oldest overdue items first.';
  }

  return `Start with ${titles.join(' and ')}.`;
}

function isActionItemsQuestion(question: string | null): boolean {
  return typeof question === 'string'
    && /(overdue|action items|pending items|accountability|what needs my attention)/i.test(question);
}

interface DeterministicTracePayload {
  workspaceId: string;
  entityType: string | null;
  entityId: string | null;
  chatQuestion: string | null;
  branch: FleetGraphBranch;
  accountability: {
    total: number;
    overdue: number;
    dueToday: number;
    scopeOverdue: number;
    scopeDueToday: number;
  };
  candidateSignals: string[];
}

async function traceDeterministicAssessment(
  state: FleetGraphStateType,
  assessment: FleetGraphAssessment,
): Promise<string | null> {
  if (!canUseLangSmithTracing(process.env)) {
    return state.traceUrl;
  }

  const allItems = getAccountabilityItems(state);
  const relevantItems = getScopeRelevantAccountabilityItems(state, allItems);
  const payload: DeterministicTracePayload = {
    workspaceId: state.workspaceId,
    entityType: state.entityType,
    entityId: state.entityId,
    chatQuestion: state.chatQuestion,
    branch: state.branch,
    accountability: {
      total: allItems.length,
      overdue: countOverdue(allItems),
      dueToday: countDueToday(allItems),
      scopeOverdue: countOverdue(relevantItems),
      scopeDueToday: countDueToday(relevantItems),
    },
    candidateSignals: state.candidates.map((candidate) => candidate.signalType),
  };

  let traceUrl = state.traceUrl;
  let traceRunId: string | null = null;
  let traceClient: {
    readRunSharedLink: (runId: string) => Promise<string | undefined>;
    shareRun: (runId: string) => Promise<string>;
  } | null = null;
  const tracedDeterministicAssessment = traceable(
    async (_payload: DeterministicTracePayload) => assessment,
    {
      name: 'fleetgraph_deterministic_chat_assessment',
      run_type: 'chain',
      project_name: getLangSmithProjectName(process.env) ?? undefined,
      tags: ['fleetgraph', 'deterministic'],
      processInputs: (inputs) => inputs,
      processOutputs: (outputs) => outputs,
      on_start(runTree) {
        if (runTree) {
          traceRunId = runTree.id;
          traceClient = runTree.client;
        }
      },
    },
  );

  try {
    await tracedDeterministicAssessment(payload);
  } catch (err) {
    console.warn('[FleetGraph:Node5] deterministic trace capture failed:', err);
  }

  if (traceRunId) {
    const resolvedTraceUrl = await resolveLangSmithRunUrl(traceRunId, traceClient ?? undefined);
    if (resolvedTraceUrl) {
      traceUrl = resolvedTraceUrl;
    }
  }

  return traceUrl;
}

export function buildDeterministicChatAssessment(
  state: FleetGraphStateType,
): FleetGraphAssessment | null {
  if (!isActionItemsQuestion(state.chatQuestion)) {
    return null;
  }

  const allItems = getAccountabilityItems(state);
  const relevantItems = getScopeRelevantAccountabilityItems(state, allItems);
  const overallOverdue = countOverdue(allItems);
  const relevantOverdue = countOverdue(relevantItems);
  const relevantDueToday = countDueToday(relevantItems);

  if (allItems.length === 0) {
    return {
      summary: 'You have no pending accountability items right now.',
      recommendation: 'Keep monitoring.',
      branch: 'inform_only',
      citations: ['accountability:overall_overdue=0', 'accountability:scope_overdue=0'],
    };
  }

  const scopeLabel = state.entityType ?? 'scope';
  let scopeSummary = '';
  if (relevantOverdue > 0) {
    scopeSummary = ` ${relevantOverdue} tied to this ${scopeLabel}.`;
  } else if (relevantDueToday > 0) {
    scopeSummary = ` ${relevantDueToday} due today in this ${scopeLabel}.`;
  } else if (state.entityType !== 'workspace') {
    scopeSummary = ` None are tied directly to this ${scopeLabel}.`;
  }

  const recommendationItems = relevantOverdue > 0 || relevantDueToday > 0 ? relevantItems : allItems;
  return {
    summary: `You have ${overallOverdue} overdue accountability items overall.${scopeSummary}`.trim(),
    recommendation: summarizeTopItems(recommendationItems),
    branch: 'inform_only',
    citations: [
      `accountability:overall_overdue=${overallOverdue}`,
      `accountability:scope_overdue=${relevantOverdue}`,
    ],
  };
}

function getIssueState(ctx: Record<string, unknown>): string | null {
  const entity = ctx.entity;
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const properties = (entity as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object') {
    return null;
  }

  const state = (properties as Record<string, unknown>).state;
  return typeof state === 'string' ? state : null;
}

// ---------------------------------------------------------------------------
// 1. trigger_context
// ---------------------------------------------------------------------------

export async function triggerContext(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node1] trigger_context: runId=${state.runId} mode=${state.mode} entity=${state.entityType}:${state.entityId}`);
  // Preserve entity context regardless of mode.
  // Proactive runs are scoped to a specific entity (e.g. sprint)
  // set by the scheduler; clearing them breaks sprint-scoped detection.
  return {
    entityType: state.entityType,
    entityId: state.entityId,
    runStartedAt: state.runStartedAt || Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 2. fetch_core_context
// ---------------------------------------------------------------------------

export async function fetchCoreContextNode(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node2] fetch_core_context: ${state.entityType}:${state.entityId}`);
  try {
    const result = await fetchCoreContext(
      state.workspaceId,
      state.entityType,
      state.entityId,
    );
    console.log(`[FleetGraph:Node2] fetch_core_context: OK`);
    return { coreContext: result as unknown as Record<string, unknown> };
  } catch (err) {
    console.error(`[FleetGraph:Node2] fetch_core_context failed:`, err);
    const error = makeErrorLog(
      state,
      'fetch_core_context',
      err instanceof Error ? err.message : 'unknown_fetch_error',
      true,
    );
    return { coreContext: {}, error, branch: 'error' as FleetGraphBranch };
  }
}

// ---------------------------------------------------------------------------
// 3. fetch_parallel_signals
// ---------------------------------------------------------------------------

export async function fetchParallelSignalsNode(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node3] fetch_parallel_signals: ${state.entityType}:${state.entityId}`);
  try {
    const ownerUserId = getContextOwnerUserId(state.coreContext);
    const result = await fetchParallelSignals(
      state.workspaceId,
      state.entityType,
      state.entityId,
      state.actorUserId,
      ownerUserId,
    );
    console.log(`[FleetGraph:Node3] fetch_parallel_signals: OK`);
    return { parallelSignals: result as unknown as Record<string, unknown> };
  } catch (err) {
    console.error(`[FleetGraph:Node3] fetch_parallel_signals failed:`, err);
    const error = makeErrorLog(
      state,
      'fetch_parallel_signals',
      err instanceof Error ? err.message : 'unknown_fetch_error',
      true,
    );
    return { parallelSignals: {}, error, branch: 'error' as FleetGraphBranch };
  }
}

// ---------------------------------------------------------------------------
// 4. heuristic_filter
// ---------------------------------------------------------------------------

export async function heuristicFilter(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  // If a prior node set error branch, propagate
  if (state.branch === 'error') {
    return { candidates: [], branch: 'error' };
  }

  console.log(`[FleetGraph:Node4] heuristic_filter: entity=${state.entityType}:${state.entityId} branch=${state.branch}`);
  const candidates: FleetGraphCandidate[] = [];
  const ctx = state.coreContext;
  const signals = state.parallelSignals;
  const ownerUserId = getContextOwnerUserId(ctx);

  // --- Stale issue check ---
  const lastActivityDays = (signals as Record<string, unknown>)['lastActivityDays'];
  const updatedAtDays = state.entityType === 'issue' ? getIssueUpdatedAtDaysAgo(ctx) : null;
  const issueState = state.entityType === 'issue' ? getIssueState(ctx) : null;
  const issueCanGoStale = issueState === 'in_progress' || issueState === 'in_review';
  const effectiveLastActivityDays = typeof lastActivityDays === 'number'
    ? Math.min(lastActivityDays, updatedAtDays ?? lastActivityDays)
    : updatedAtDays;
  if (
    issueCanGoStale &&
    typeof effectiveLastActivityDays === 'number' &&
    effectiveLastActivityDays >= THRESHOLDS.staleIssueDays &&
    state.entityType === 'issue' &&
    state.entityId
  ) {
    candidates.push({
      signalType: 'stale_issue',
      entityType: 'issue',
      entityId: state.entityId,
      severity: effectiveLastActivityDays >= THRESHOLDS.staleIssueDays * 2 ? 'high' : 'medium',
      evidence: {
        lastActivityDays: effectiveLastActivityDays,
        ...(typeof updatedAtDays === 'number' ? { updatedAtDays } : {}),
      },
      ownerUserId,
      fingerprint: fingerprint('stale_issue', 'issue', state.entityId, state.workspaceId),
    });
  }

  // --- Missing standup check ---
  const missingStandup = (signals as Record<string, unknown>)['missingStandup'];
  if (missingStandup === true && THRESHOLDS.missingStandupSameDay) {
    const eType = state.entityType ?? 'project';
    const eId = state.entityId ?? state.workspaceId;
    candidates.push({
      signalType: 'missing_standup',
      entityType: eType,
      entityId: eId,
      severity: 'low',
      evidence: { missingStandup: true },
      ownerUserId,
      fingerprint: fingerprint('missing_standup', eType, eId, state.workspaceId),
    });
  }

  // --- Approval bottleneck check ---
  const pendingApprovalDays = (signals as Record<string, unknown>)['pendingApprovalDays'];
  if (
    typeof pendingApprovalDays === 'number' &&
    pendingApprovalDays >= THRESHOLDS.approvalBottleneckDays &&
    state.entityId
  ) {
    const eType = state.entityType ?? 'issue';
    candidates.push({
      signalType: 'approval_bottleneck',
      entityType: eType,
      entityId: state.entityId,
      severity: pendingApprovalDays >= THRESHOLDS.approvalBottleneckDays * 2 ? 'high' : 'medium',
      evidence: { pendingApprovalDays },
      ownerUserId,
      fingerprint: fingerprint('approval_bottleneck', eType, state.entityId, state.workspaceId),
    });
  }

  // --- Scope drift check ---
  const scopeDrift = (signals as Record<string, unknown>)['scopeDrift'];
  const projectContentScopeDrift = state.entityType === 'project'
    ? getProjectContentScopeDriftEvidence(ctx)
    : null;
  const issueContentScopeDrift = state.entityType === 'issue'
    ? getIssueScopeDriftEvidence(
        ctx,
        ((signals as Record<string, unknown>).issueHistory as Array<{ field: string; old_value: unknown; new_value: unknown }>) ?? [],
      )
    : null;
  if ((scopeDrift === true || projectContentScopeDrift || issueContentScopeDrift) && THRESHOLDS.scopeDriftImmediate && state.entityId) {
    const eType = state.entityType ?? 'sprint';
    candidates.push({
      signalType: 'scope_drift',
      entityType: eType,
      entityId: state.entityId,
      severity: issueContentScopeDrift?.severity ?? 'high',
      evidence: (issueContentScopeDrift ?? projectContentScopeDrift ?? { scopeDrift: true }) as Record<string, unknown>,
      ownerUserId,
      fingerprint: fingerprint('scope_drift', eType, state.entityId, state.workspaceId),
    });
  }

  // --- Manager missed-standup check ---
  // Surface alerts when a direct report's standup is >= 5 minutes overdue
  const managerActionItems = (signals as Record<string, unknown>)['managerActionItems'];
  if (Array.isArray(managerActionItems)) {
    const MANAGER_STANDUP_THRESHOLD_MINUTES = 5;
    for (const item of managerActionItems) {
      const overdueMinutes = typeof item.overdueMinutes === 'number' ? item.overdueMinutes : 0;
      if (overdueMinutes >= MANAGER_STANDUP_THRESHOLD_MINUTES) {
        const eType = state.entityType ?? 'sprint';
        const eId = item.sprintId ?? state.entityId ?? state.workspaceId;
        const evidence: ManagerMissingStandupEvidence = {
          targetUserId: ownerUserId ?? '',
          employeeName: item.employeeName ?? 'Unknown',
          employeeId: item.employeeId ?? '',
          overdueMinutes,
          dueTime: item.dueTime ?? '',
          sprintId: item.sprintId ?? '',
          sprintTitle: item.sprintTitle ?? '',
          projectId: item.projectId ?? null,
          projectTitle: item.projectTitle ?? null,
        };
        candidates.push({
          signalType: 'manager_missing_standup',
          entityType: eType,
          entityId: eId,
          severity: overdueMinutes >= 60 ? 'high' : 'medium',
          evidence: evidence as unknown as Record<string, unknown>,
          ownerUserId,
          fingerprint: fingerprint(
            `manager_missing_standup:${item.employeeId}`,
            eType,
            eId,
            state.workspaceId,
          ),
        });
      }
    }
  }

  const orderedCandidates = sortCandidatesByPriority(candidates);
  const branch: FleetGraphBranch = orderedCandidates.length === 0 ? 'clean' : 'inform_only';
  console.log(`[FleetGraph:Node4] heuristic_filter -> branch=${branch} candidates=${orderedCandidates.length} signals=[${orderedCandidates.map(c => c.signalType).join(',')}]`);
  return { candidates: orderedCandidates, branch };
}

// ---------------------------------------------------------------------------
// 5. reason_about_risk
// ---------------------------------------------------------------------------

export const REASONING_SYSTEM_PROMPT = `You are FleetGraph for Ship.

Keep chat answers short, direct, and grounded in the provided Ship data.
Stay inside the provided Ship scope, entity, workspace, page context, and chat history. Do not imply access beyond that scope.

If userQuestion is unrelated to Ship, project health, the current page, or the current workspace/entity, do not answer it. Reply with a short redirect to Ship-only help. In that case, use branch="inform_only", proposedAction=null, and cite "chat:unsupported_topic".

If parallelSignals.accountability.items contains pending or overdue items, lead with the exact counts. Never say there are no overdue items when any item has days_overdue >= 0. If managerActionItems contains entries, mention who is affected and how overdue they are. Treat workspace-summary questions as cross-workspace triage for the current actor.

If pageContext is present, treat pageContext.tabLabel, pageContext.route, and pageContext.title as authoritative. If the user asks what page they are on, answer with that page name directly.

When no userQuestion is present, analyze signal candidates and return a concise summary, recommendation, branch, optional proposedAction, and citations. For manager_missing_standup, mention the employee, sprint, and overdue time.
If candidates include both stale_issue and approval_bottleneck for the same issue, lead with the stale_issue signal first and mention pending approval as secondary context.

Always respond in valid JSON matching this schema:
{
  "summary": string,
  "recommendation": string,
  "branch": "inform_only" | "confirm_action",
  "proposedAction": { "actionType": string, "targetEntityType": string, "targetEntityId": string, "description": string, "payload": object } | null,
  "citations": string[]
}`;

export async function reasonAboutRisk(
  state: FleetGraphStateType,
): Promise<Partial<FleetGraphStateType>> {
  console.log(`[FleetGraph:Node5] reason_about_risk: candidates=${state.candidates.length} chatQuestion=${!!state.chatQuestion}`);
  const deterministicAssessment = buildDeterministicChatAssessment(state);
  if (deterministicAssessment) {
    const traceUrl = await traceDeterministicAssessment(state, deterministicAssessment);
    return {
      assessment: deterministicAssessment,
      tokenUsage: null,
      traceUrl,
    };
  }
  const llmStart = Date.now();
  try {
    const modelCfg = getModelConfig('reasoning_primary');
    const llm = new ChatOpenAI({
      modelName: modelCfg.modelId,
      temperature: modelCfg.temperature,
      maxTokens: modelCfg.maxTokens,
    });

    const userPayload: Record<string, unknown> = {
      mode: state.mode,
      entityType: state.entityType,
      entityId: state.entityId,
      candidates: state.candidates,
      coreContext: state.coreContext,
      parallelSignals: state.parallelSignals,
    };

    // Thread chat question + history so follow-ups actually influence reasoning
    if (state.chatQuestion) {
      userPayload.userQuestion = state.chatQuestion;
    }
    if (state.chatHistory && state.chatHistory.length > 0) {
      userPayload.conversationHistory = state.chatHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    }
    if (state.pageContext) {
      userPayload.pageContext = state.pageContext;
    }

    const userMessage = JSON.stringify(userPayload);

    // Capture LangSmith trace URL via callback when tracing is enabled
    let traceUrl: string | null = null;
    let traceRunId: string | null = null;
    const callbacks: Array<{ handleLLMEnd?: (output: unknown, runId: string) => void }> = [];
    if (canUseLangSmithTracing(process.env)) {
      callbacks.push({
        handleLLMEnd(_output: unknown, runId: string) {
          traceRunId = runId;
        },
      });
    }

    const response = await llm.invoke(
      [
        { role: 'system', content: REASONING_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      callbacks.length > 0 ? { callbacks } : undefined,
    );

    // Extract token usage from LLM response metadata (Phase 2D)
    let tokenUsage: { input: number; output: number } | null = null;
    const usageMeta = response.usage_metadata;
    if (usageMeta && typeof usageMeta.input_tokens === 'number') {
      tokenUsage = {
        input: usageMeta.input_tokens,
        output: usageMeta.output_tokens ?? 0,
      };
    }

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as FleetGraphAssessment;
    console.log(`[FleetGraph:Node5] LLM completed in ${Date.now() - llmStart}ms branch=${parsed.branch} tokens=${tokenUsage ? `${tokenUsage.input}/${tokenUsage.output}` : 'n/a'}`);

    if (traceRunId) {
      traceUrl = await resolveLangSmithRunUrl(traceRunId);
    }

    return {
      assessment: {
        summary: parsed.summary,
        recommendation: parsed.recommendation,
        branch: parsed.branch,
        proposedAction: parsed.proposedAction ?? undefined,
        citations: parsed.citations ?? [],
      },
      tokenUsage,
      traceUrl,
    };
  } catch (err) {
    console.error(`[FleetGraph:Node5] reason_about_risk failed after ${Date.now() - llmStart}ms:`, err);
    const error = makeErrorLog(
      state,
      'reason_about_risk',
      err instanceof Error ? err.message : 'llm_error',
      true,
    );
    return {
      assessment: null,
      error,
      branch: 'error' as FleetGraphBranch,
    };
  }
}
