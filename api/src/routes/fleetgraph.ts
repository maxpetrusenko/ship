/**
 * FleetGraph API routes.
 * On-demand analysis, alert management, scheduler status.
 *
 * HITL flow: on-demand/chat invoke the shared graph via invokeGraph().
 * When the graph interrupts at human_gate, the resolve route calls
 * resumeGraph() with the user's gate outcome instead of executing
 * the action inline.
 */
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  resolveAlert,
  getAlertsByEntity,
  getActiveAlerts,
  getScheduler,
  updateApprovalStatus,
  getPendingApprovals,
  upsertAlert,
  invokeGraph,
  resumeGraph,
  isEntityAnalysisStale,
  buildQueueFingerprint,
  getActiveThread,
  getThreadById,
  createThread,
  getOrCreateActiveThread,
  appendChatMessage,
  loadRecentMessages,
  updateThreadPageContext,
  getUserAlerts,
  getUnreadCount,
  markRecipientsRead,
  dismissRecipient,
  snoozeRecipient,
  createRecipients,
  createApproval,
} from '../fleetgraph/runtime/index.js';
import { executeShipAction } from '../fleetgraph/data/fetchers.js';
import { runFleetGraphChat } from '../fleetgraph/chat/runtime.js';
import { buildModalFeed, lookupEntityTitles, lookupIssueParents } from '../fleetgraph/modal-feed.js';
import { seedFleetGraphDemoFlow } from '../fleetgraph/demo-seed.js';
import { consumeUserBurstRateLimit } from '../services/user-burst-rate-limit.js';
import type {
  FleetGraphChatRuntimeResult,
  FleetGraphChatToolCallRecord,
} from '../fleetgraph/chat/types.js';
import type {
  FleetGraphOnDemandRequest,
  FleetGraphOnDemandResponse,
  FleetGraphAlertsResponse,
  FleetGraphAlertResolveRequest,
  FleetGraphStatusResponse,
  FleetGraphRunState,
  FleetGraphChatRequest,
  FleetGraphChatResponse,
  FleetGraphDemoSeedRequest,
  FleetGraphDemoSeedResponse,
  FleetGraphChatMessage,
  FleetGraphChatDebugInfo,
  FleetGraphChatThreadResponse,
  FleetGraphCreateChatThreadResponse,
  FleetGraphPageViewResponse,
  FleetGraphEntityType,
  FleetGraphAlert,
  FleetGraphModalFeedResponse,
  HumanGateOutcome,
} from '@ship/shared';
import { isFleetGraphReady } from '../fleetgraph/bootstrap.js';

const router = Router();
const CHAT_RATE_LIMIT_NAMESPACE = 'fleetgraph-chat';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getFleetGraphChatRateLimitConfig() {
  const defaultMax = process.env.NODE_ENV === 'test' ? 1000 : process.env.NODE_ENV === 'production' ? 12 : 60;
  return {
    max: parsePositiveInt(process.env.FLEETGRAPH_CHAT_RATE_LIMIT_MAX, defaultMax),
    windowMs: parsePositiveInt(process.env.FLEETGRAPH_CHAT_RATE_LIMIT_WINDOW_MS, 60_000),
  };
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(typeof (err as Error & { context?: unknown }).context !== 'undefined'
        ? { context: (err as Error & { context?: unknown }).context }
        : {}),
    };
  }

  return { message: String(err) };
}

function normalizeRecipientMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._+\-\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveExplicitChatRecipientIds(
  workspaceId: string,
  question: string,
): Promise<string[]> {
  const normalizedQuestion = normalizeRecipientMatchText(question);
  if (!normalizedQuestion) {
    return [];
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.name
     FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1`,
    [workspaceId],
  );

  const matched = new Set<string>();

  for (const row of result.rows) {
    const email = typeof row.email === 'string' ? row.email : '';
    const name = typeof row.name === 'string' ? row.name : '';
    const normalizedEmail = normalizeRecipientMatchText(email);
    const normalizedName = normalizeRecipientMatchText(name);

    if (
      (normalizedEmail && normalizedQuestion.includes(normalizedEmail))
      || (normalizedName && normalizedQuestion.includes(normalizedName))
    ) {
      matched.add(row.id as string);
    }
  }

  return [...matched];
}

// All routes require authentication
router.use(authMiddleware);

// -------------------------------------------------------------------------
// POST /api/fleetgraph/demo/seed-flow
// -------------------------------------------------------------------------

router.post('/demo/seed-flow', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!isFleetGraphReady()) {
    return res.status(503).json({ error: 'FleetGraph is not initialized' });
  }

  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const body = req.body as Partial<FleetGraphDemoSeedRequest>;

    if (!body.entityType || !body.entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const response: FleetGraphDemoSeedResponse = await seedFleetGraphDemoFlow({
      pool,
      workspaceId,
      userId,
      entityType: body.entityType,
      entityId: body.entityId,
      invokeGraph,
      upsertAlert,
      createRecipients,
      createApproval,
      getOrCreateActiveThread,
      appendChatMessage,
    });

    if (response.seededIssueCount === 0) {
      return res.status(409).json({ error: 'No eligible issues found for demo seeding' });
    }

    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] demo seed error:', err);
    return res.status(500).json({ error: 'Failed to seed FleetGraph demo flow' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/on-demand
// -------------------------------------------------------------------------

router.post('/on-demand', async (req: Request, res: Response) => {
  if (!isFleetGraphReady()) {
    return res.status(503).json({ error: 'FleetGraph is not initialized' });
  }

  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const body = req.body as FleetGraphOnDemandRequest;

    if (!body.entityType || !body.entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const runId = crypto.randomUUID();

    // Build initial run state
    const initialState: FleetGraphRunState = {
      runId,
      traceId: runId,
      mode: 'on_demand',
      workspaceId,
      actorUserId: userId,
      entityType: body.entityType,
      entityId: body.entityId,
      pageContext: null,
      coreContext: {},
      parallelSignals: {},
      candidates: [],
      branch: 'clean',
      assessment: null,
      gateOutcome: null,
      snoozeUntil: null,
      error: null,
      runStartedAt: Date.now(),
      tokenUsage: null,
      chatQuestion: null,
      chatHistory: null,
      traceUrl: null,
      trigger: 'on_demand',
    };

    // Invoke graph via shared runtime (supports HITL interrupt)
    let finalState: FleetGraphRunState = initialState;
    let interrupted = false;
    try {
      const result = await invokeGraph(initialState);
      finalState = result.state;
      interrupted = result.interrupted;
    } catch (graphErr) {
      console.error('[FleetGraph] Graph invocation failed, returning partial state:', graphErr);
      // Fall through: return whatever state we have + any existing alerts
    }

    // Fetch alerts created during this run (or pre-existing) for the entity
    const alerts = await getAlertsByEntity(pool, body.entityType, body.entityId);
    const activeAlerts = alerts.filter((a) => a.status === 'active' && a.workspaceId === workspaceId);

    const response: FleetGraphOnDemandResponse = {
      runId,
      branch: interrupted ? 'confirm_action' : finalState.branch,
      assessment: finalState.assessment,
      alerts: activeAlerts,
      traceUrl: finalState.traceUrl ?? undefined,
    };

    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] on-demand error:', err);
    return res.status(500).json({ error: 'Failed to run on-demand analysis' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/chat (DB-backed persistent threads, graph parity)
// -------------------------------------------------------------------------

function buildChatDebugInfoFromGraph(
  state: FleetGraphRunState,
  entityType: FleetGraphChatDebugInfo['entityType'],
  entityId: FleetGraphChatDebugInfo['entityId'],
): FleetGraphChatDebugInfo {
  const signals = state.parallelSignals as Record<string, unknown> | null;
  const candidates = (state.candidates ?? []) as Array<{ signalType?: string }>;
  const candidateSignals = candidates
    .map((c) => c.signalType)
    .filter((s): s is FleetGraphChatDebugInfo['candidateSignals'][number] => !!s);
  const accountability = signals?.accountability as Record<string, unknown> | undefined;
  const managerItems = signals?.managerActionItems;
  return {
    traceUrl: state.traceUrl ?? null,
    branch: state.assessment?.branch ?? state.branch,
    entityType,
    entityId,
    candidateSignals,
    accountability: {
      total: typeof accountability?.total === 'number' ? accountability.total : 0,
      overdue: typeof accountability?.overdue === 'number' ? accountability.overdue : 0,
      dueToday: typeof accountability?.dueToday === 'number' ? accountability.dueToday : 0,
    },
    managerActionItems: Array.isArray(managerItems) ? managerItems.length : 0,
  };
}

function buildChatDebugInfoFromRuntime(
  result: FleetGraphChatRuntimeResult,
  entityType: FleetGraphChatDebugInfo['entityType'],
  entityId: FleetGraphChatDebugInfo['entityId'],
): FleetGraphChatDebugInfo {
  let accountability: FleetGraphChatDebugInfo['accountability'] = {
    total: 0,
    overdue: 0,
    dueToday: 0,
  };
  let managerActionItems = 0;

  for (const toolCall of result.toolCalls) {
    if (toolCall.name !== 'fetch_workspace_signals') {
      continue;
    }

    const output = toolCall.result;
    const outputAccountability = output.accountability as Record<string, unknown> | undefined;
    const outputManagerItems = output.managerActionItems;
    accountability = {
      total: typeof outputAccountability?.total === 'number' ? outputAccountability.total : 0,
      overdue: typeof outputAccountability?.overdue === 'number' ? outputAccountability.overdue : 0,
      dueToday: typeof outputAccountability?.dueToday === 'number' ? outputAccountability.dueToday : 0,
    };
    managerActionItems = Array.isArray(outputManagerItems) ? outputManagerItems.length : 0;
  }

  return {
    traceUrl: result.traceUrl ?? null,
    branch: result.assessment.branch,
    entityType,
    entityId,
    toolCalls: result.toolCalls.map((toolCall) => ({
      name: toolCall.name,
      arguments: toolCall.arguments,
    })),
    candidateSignals: [],
    accountability,
    managerActionItems,
  };
}

function resolveAssistantAlertId(
  assessment: FleetGraphChatRuntimeResult['assessment'],
  alerts: FleetGraphAlert[],
): string | undefined {
  if (!assessment.proposedAction) {
    return undefined;
  }

  const matchingAlerts = alerts.filter((alert) =>
    alert.status === 'active'
    && alert.signalType === 'chat_suggestion'
    && alert.summary === assessment.summary
    && alert.recommendation === assessment.recommendation,
  );

  if (matchingAlerts.length === 1) {
    return matchingAlerts[0]?.id;
  }

  return undefined;
}

function normalizeRuntimeAssessment(
  assessment: FleetGraphChatRuntimeResult['assessment'],
): NonNullable<FleetGraphChatMessage['assessment']> {
  return {
    summary: assessment.summary,
    recommendation: assessment.recommendation,
    branch: assessment.branch,
    citations: assessment.citations,
    ...(assessment.proposedAction ? { proposedAction: assessment.proposedAction } : {}),
  };
}

// -------------------------------------------------------------------------
// GET /api/fleetgraph/chat/thread  (load active thread + messages)
// -------------------------------------------------------------------------

router.get('/chat/thread', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const thread = await getActiveThread(pool, workspaceId, userId);
    const messages = thread ? await loadRecentMessages(pool, thread.id) : [];

    const response: FleetGraphChatThreadResponse = { thread, messages };
    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] get thread error:', err);
    return res.status(500).json({ error: 'Failed to load chat thread' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/chat/thread  (create new thread)
// -------------------------------------------------------------------------

router.post('/chat/thread', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const { entityType, entityId } = req.body as { entityType?: FleetGraphEntityType; entityId?: string };
    const hasPartialScope = (!!entityType) !== (!!entityId);

    if (hasPartialScope) {
      return res.status(400).json({ error: 'entityType and entityId must be provided together' });
    }

    const thread = await createThread(pool, workspaceId, userId, entityType, entityId);
    const response: FleetGraphCreateChatThreadResponse = { thread };
    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] create thread error:', err);
    return res.status(500).json({ error: 'Failed to create chat thread' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/chat  (send message, DB-persisted)
// -------------------------------------------------------------------------

router.post('/chat', async (req: Request, res: Response) => {
  if (!isFleetGraphReady()) {
    return res.status(503).json({ error: 'FleetGraph is not initialized' });
  }

  const body = req.body as Partial<FleetGraphChatRequest>;
  let thread: Awaited<ReturnType<typeof getOrCreateActiveThread>> | Awaited<ReturnType<typeof getThreadById>> | null = null;
  let history: Awaited<ReturnType<typeof loadRecentMessages>> = [];
  let runtimeResult: FleetGraphChatRuntimeResult | null = null;
  let effectivePageContext: FleetGraphChatRequest['pageContext'] = body.pageContext;

  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const chatBody = body as FleetGraphChatRequest;

    if (!chatBody.entityType || !chatBody.entityId || !chatBody.question) {
      return res.status(400).json({ error: 'entityType, entityId, and question are required' });
    }

    if (chatBody.threadId) {
      thread = await getThreadById(pool, chatBody.threadId, workspaceId, userId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found or access denied' });
      }
    } else {
      thread = await getOrCreateActiveThread(pool, workspaceId, userId, undefined, undefined);
    }

    if (chatBody.pageContext) {
      await updateThreadPageContext(pool, thread.id, chatBody.pageContext);
    }

    // Load recent history from DB
    history = await loadRecentMessages(pool, thread.id);

    const rateLimitConfig = getFleetGraphChatRateLimitConfig();
    const rateLimit = consumeUserBurstRateLimit(
      CHAT_RATE_LIMIT_NAMESPACE,
      userId,
      rateLimitConfig.max,
      rateLimitConfig.windowMs,
    );
    if (!rateLimit.allowed) {
      res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        error: `Rate limit exceeded. Max ${rateLimit.limit} FleetGraph chat requests per minute.`,
      });
    }

    const runId = crypto.randomUUID();

    try {
      effectivePageContext = chatBody.pageContext ?? thread.lastPageContext ?? undefined;
      runtimeResult = await runFleetGraphChat({
        workspaceId,
        userId,
        threadId: thread.id,
        entityType: chatBody.entityType,
        entityId: chatBody.entityId,
        question: chatBody.question,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        pageContext: effectivePageContext,
      });
    } catch (chatErr) {
      console.error('[FleetGraph] Chat graph invocation failed:', {
        error: serializeError(chatErr),
        request: {
          userId,
          workspaceId,
          threadId: thread.id,
          entityType: chatBody.entityType,
          entityId: chatBody.entityId,
          question: chatBody.question,
          pageRoute: effectivePageContext?.route ?? null,
          historyCount: history.length,
        },
      });
      return res.status(502).json({ error: 'FleetGraph chat runtime failed' });
    }

    // If the chat produced a confirm_action with a proposedAction, persist an
    // alert so the inline accept/dismiss buttons have an alertId to resolve.
    if (
      runtimeResult.assessment.branch === 'confirm_action'
      && runtimeResult.assessment.proposedAction
    ) {
      const fingerprint = `chat:${workspaceId}:${chatBody.entityType}:${chatBody.entityId}:${runId}`;
      try {
        const proposedAction = runtimeResult.assessment.proposedAction!;
        const explicitRecipientIds = await resolveExplicitChatRecipientIds(
          workspaceId,
          chatBody.question,
        );
        const recipientIds = [...new Set([userId, ...explicitRecipientIds])];
        const chatAlert = await upsertAlert(pool, {
          workspaceId,
          fingerprint,
          signalType: 'chat_suggestion',
          entityType: chatBody.entityType,
          entityId: chatBody.entityId,
          severity: 'medium',
          summary: runtimeResult.assessment.summary,
          recommendation: runtimeResult.assessment.recommendation,
          citations: runtimeResult.assessment.citations,
          ownerUserId: userId,
          status: 'active',
        });
        await createRecipients(pool, chatAlert.id, recipientIds);
        // Create approval record so the resolve route can execute the action
        await createApproval(pool, {
          workspaceId,
          alertId: chatAlert.id,
          runId,
          threadId: `chat:${thread.id}`,
          checkpointId: null,
          actionType: proposedAction.actionType,
          targetEntityType: proposedAction.targetEntityType,
          targetEntityId: proposedAction.targetEntityId,
          description: proposedAction.description,
          payload: proposedAction.payload,
          status: 'pending',
          expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
        });
        console.log(`[FleetGraph] Chat suggestion alert+approval created: id=${chatAlert.id}`);
      } catch (alertErr) {
        // Non-critical: buttons won't work but chat still functions
        console.error('[FleetGraph] Failed to create chat suggestion alert:', alertErr);
      }
    }

    // Fetch alerts for the entity (created during graph run or pre-existing)
    const alerts = await getAlertsByEntity(pool, chatBody.entityType, chatBody.entityId);
    const activeAlerts = alerts.filter((a) => a.status === 'active' && a.workspaceId === workspaceId);
    const assistantAlertId = resolveAssistantAlertId(runtimeResult.assessment, activeAlerts);
    const debugInfo = buildChatDebugInfoFromRuntime(runtimeResult, chatBody.entityType, chatBody.entityId);

    const assistantMessage: FleetGraphChatMessage = {
      ...runtimeResult.message,
      alertId: assistantAlertId,
      assessment: normalizeRuntimeAssessment(runtimeResult.assessment),
      debug: debugInfo,
    };

    await appendChatMessage(pool, thread.id, 'user', chatBody.question);
    await appendChatMessage(
      pool,
      thread.id,
      'assistant',
      assistantMessage.content,
      assistantMessage.assessment,
      assistantMessage.debug,
      assistantMessage.alertId,
      assistantMessage.debug?.traceUrl,
    );

    const response: FleetGraphChatResponse = {
      conversationId: thread.id,
      threadId: thread.id,
      runId,
      branch: runtimeResult.assessment.branch,
      assessment: normalizeRuntimeAssessment(runtimeResult.assessment),
      alerts: activeAlerts,
      message: assistantMessage,
      traceUrl: runtimeResult.traceUrl ?? undefined,
    };

    return res.json(response);
  } catch (err) {
    const body = req.body as Partial<FleetGraphChatRequest>;
    console.error('[FleetGraph] chat error:', {
      error: serializeError(err),
      request: {
        userId: req.userId ?? null,
        workspaceId: req.workspaceId ?? null,
        threadId: thread?.id ?? body.threadId ?? null,
        entityType: body.entityType ?? null,
        entityId: body.entityId ?? null,
        question: body.question ?? null,
        pageRoute: effectivePageContext?.route ?? body.pageContext?.route ?? null,
        historyCount: history.length,
      },
      runtime: {
        branch: runtimeResult?.assessment.branch ?? null,
        traceUrl: runtimeResult?.traceUrl ?? null,
        toolNames: runtimeResult?.toolCalls.map((toolCall) => toolCall.name) ?? [],
      },
    });
    return res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/page-view
// -------------------------------------------------------------------------

router.post('/page-view', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const { entityType, entityId } = req.body as { entityType?: FleetGraphEntityType; entityId?: string };

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const stale = await isEntityAnalysisStale(pool, workspaceId, entityType, entityId);
    if (!stale) {
      const response: FleetGraphPageViewResponse = { triggered: false, reason: 'recent analysis exists' };
      return res.json(response);
    }

    const scheduler = getScheduler();
    if (!scheduler) {
      const response: FleetGraphPageViewResponse = { triggered: false, reason: 'scheduler not running' };
      return res.json(response);
    }

    const queue = scheduler.getQueue();
    const fingerprint = buildQueueFingerprint(workspaceId, entityType, entityId);
    if (queue.hasPending(fingerprint)) {
      const response: FleetGraphPageViewResponse = { triggered: false, reason: 'analysis already queued' };
      return res.json(response);
    }

    const enqueued = queue.enqueue({
      workspaceId,
      mode: 'on_demand',
      entityType,
      entityId,
      trigger: 'page_view',
    });
    if (!enqueued) {
      const response: FleetGraphPageViewResponse = { triggered: false, reason: 'analysis queue unavailable' };
      return res.json(response);
    }

    console.log(`[FleetGraph] page-view: enqueued ${entityType}:${entityId}`);

    // Fire-and-forget queue processing
    setImmediate(() => {
      scheduler.processQueueImmediate().catch((err) =>
        console.error('[FleetGraph] page-view processQueue error:', err),
      );
    });

    const response: FleetGraphPageViewResponse = { triggered: true, reason: 'analysis enqueued' };
    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] page-view error:', err);
    return res.status(500).json({ error: 'Failed to process page view' });
  }
});

// -------------------------------------------------------------------------
// GET /api/fleetgraph/modal-feed (server-prioritized for ActionItemsModal)
// -------------------------------------------------------------------------

router.get('/modal-feed', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const [alerts, pendingApprovals] = await Promise.all([
      getUserAlerts(pool, userId, workspaceId),
      getPendingApprovals(pool, workspaceId),
    ]);

    // Look up entity titles + parent associations for suppression
    const entityIds = alerts.map((a) => a.entityId);
    const issueIds = alerts.filter((a) => a.entityType === 'issue').map((a) => a.entityId);

    const [entityTitles, parentEntityMap] = await Promise.all([
      lookupEntityTitles(pool, entityIds, workspaceId),
      lookupIssueParents(pool, issueIds, workspaceId),
    ]);

    const feed: FleetGraphModalFeedResponse = buildModalFeed(
      alerts,
      pendingApprovals,
      { entityTitles, parentEntityMap },
    );
    return res.json(feed);
  } catch (err) {
    console.error('[FleetGraph] modal-feed error:', err);
    return res.status(500).json({ error: 'Failed to fetch modal feed' });
  }
});

// -------------------------------------------------------------------------
// GET /api/fleetgraph/alerts (recipient-based)
// -------------------------------------------------------------------------

router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;
    const status = req.query.status as FleetGraphAlert['status'] | undefined;

    // Use recipient-based query for the current user
    let alerts = await getUserAlerts(pool, userId, workspaceId);

    // Optionally filter by entity
    if (entityType && entityId) {
      alerts = alerts.filter((a) => a.entityType === entityType && a.entityId === entityId);
    }
    if (status) {
      alerts = alerts.filter((a) => a.status === status);
    }

    const unreadCount = await getUnreadCount(pool, userId, workspaceId);
    const pendingApprovals = await getPendingApprovals(pool, workspaceId);

    const response: FleetGraphAlertsResponse = {
      alerts,
      pendingApprovals,
      total: alerts.length,
      unreadCount,
    };

    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] alerts error:', err);
    return res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/alerts/mark-read
// -------------------------------------------------------------------------

router.post('/alerts/mark-read', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { alertIds } = req.body as { alertIds?: string[] };
    const count = await markRecipientsRead(pool, userId, alertIds);
    return res.json({ success: true, markedCount: count });
  } catch (err) {
    console.error('[FleetGraph] mark-read error:', err);
    return res.status(500).json({ error: 'Failed to mark alerts as read' });
  }
});

// -------------------------------------------------------------------------
// POST /api/fleetgraph/alerts/:id/resolve
// -------------------------------------------------------------------------

const VALID_OUTCOMES: FleetGraphAlertResolveRequest['outcome'][] = ['approve', 'reject', 'dismiss', 'snooze'];

router.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const alertId = req.params.id as string;

    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const body = req.body as FleetGraphAlertResolveRequest;

    if (!body.outcome) {
      return res.status(400).json({ error: 'outcome is required' });
    }

    if (!VALID_OUTCOMES.includes(body.outcome)) {
      return res.status(400).json({
        error: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}`,
      });
    }

    // For approve/reject, check if there is a pending approval tied to this alert
    if (body.outcome === 'approve' || body.outcome === 'reject') {
      const pendingApprovals = await getPendingApprovals(pool, workspaceId);
      const approval = pendingApprovals.find((a) => a.alertId === alertId);

      if (approval) {
        // Enforce expiry server-side: reject stale approvals
        if (new Date(approval.expiresAt).getTime() <= Date.now()) {
          await updateApprovalStatus(pool, approval.id, 'expired', null);
          return res.status(410).json({ error: 'Approval has expired' });
        }

        const isChatSuggestion = approval.threadId?.startsWith('chat:');

        if (body.outcome === 'approve') {
          // Mark approval as approved (CAS: only if still pending)
          const updated = await updateApprovalStatus(pool, approval.id, 'approved', userId);
          if (!updated) {
            return res.status(409).json({ error: 'Approval already processed' });
          }

          if (isChatSuggestion) {
            // Chat suggestions: execute action directly (no paused graph)
            try {
              await executeShipAction(
                workspaceId,
                approval.actionType,
                approval.targetEntityType,
                approval.targetEntityId,
                approval.payload,
              );
              await updateApprovalStatus(pool, approval.id, 'executed', userId);
            } catch (execErr) {
              console.error('[FleetGraph] Chat suggestion action failed:', execErr);
              await updateApprovalStatus(pool, approval.id, 'execution_failed', userId);
              return res.status(502).json({
                success: false,
                error: 'Action execution failed',
                approvalStatus: 'execution_failed',
              });
            }
          } else {
            // Graph-based: resume the paused graph with 'approve' outcome.
            const threadId = approval.threadId ?? approval.runId;
            try {
              const result = await resumeGraph(threadId, 'approve' as HumanGateOutcome);
              if (result.state.error) {
                console.error('[FleetGraph] Graph resume execute_action failed:', result.state.error.errorClass);
                await updateApprovalStatus(pool, approval.id, 'execution_failed', userId);
                return res.status(502).json({
                  success: false,
                  error: 'Action execution failed',
                  approvalStatus: 'execution_failed',
                });
              }
              await updateApprovalStatus(pool, approval.id, 'executed', userId);
            } catch (resumeErr) {
              console.error('[FleetGraph] Graph resume failed:', resumeErr);
              await updateApprovalStatus(pool, approval.id, 'execution_failed', userId);
              return res.status(502).json({
                success: false,
                error: 'Action execution failed',
                approvalStatus: 'execution_failed',
              });
            }
          }
        } else {
          // reject (CAS: only if still pending)
          const rejected = await updateApprovalStatus(pool, approval.id, 'dismissed', userId);
          if (!rejected) {
            return res.status(409).json({ error: 'Approval already processed' });
          }

          if (!isChatSuggestion) {
            // Graph-based: resume the paused graph with 'dismiss' outcome
            const threadId = approval.threadId ?? approval.runId;
            try {
              await resumeGraph(threadId, 'dismiss' as HumanGateOutcome);
            } catch (resumeErr) {
              // Non-critical: the approval is already dismissed in DB.
              console.error('[FleetGraph] Graph resume for dismiss failed:', resumeErr);
            }
          }
        }
      }
    }

    // Dismiss/snooze are recipient-level actions (don't change global alert status)
    if (body.outcome === 'dismiss') {
      const dismissed = await dismissRecipient(pool, alertId, userId);
      if (!dismissed) {
        return res.status(404).json({ error: 'Alert recipient not found' });
      }
      return res.json({ success: true });
    }

    if (body.outcome === 'snooze') {
      let snoozedUntil: Date;
      if (body.snoozedUntil) {
        snoozedUntil = new Date(body.snoozedUntil);
      } else {
        const mins = body.snoozeDurationMinutes ?? 60;
        snoozedUntil = new Date(Date.now() + mins * 60_000);
      }
      const snoozed = await snoozeRecipient(pool, alertId, userId, snoozedUntil);
      if (!snoozed) {
        return res.status(404).json({ error: 'Alert recipient not found' });
      }
      return res.json({ success: true });
    }

    // approve/reject still use global alert status transition (handled above)
    const resolved = await resolveAlert(
      pool,
      alertId,
      workspaceId,
      body.outcome,
      body.snoozedUntil,
      body.snoozeDurationMinutes,
    );

    if (!resolved) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    return res.json({ success: true, alert: resolved });
  } catch (err) {
    console.error('[FleetGraph] resolve alert error:', err);
    return res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

// -------------------------------------------------------------------------
// GET /api/fleetgraph/status
// -------------------------------------------------------------------------

router.get('/status', async (req: Request, res: Response) => {
  try {
    const scheduler = getScheduler();
    const workspaceId = req.workspaceId!;

    // Count active alerts for this workspace
    let alertsActive = 0;
    try {
      const activeAlerts = await getActiveAlerts(pool, workspaceId);
      alertsActive = activeAlerts.length;
    } catch {
      // Non-critical; return 0 if query fails
    }

    const response: FleetGraphStatusResponse = {
      running: scheduler?.running ?? false,
      lastSweepAt: scheduler?.lastSweepAt?.toISOString() ?? null,
      nextSweepAt: scheduler?.nextSweepAt?.toISOString() ?? null,
      sweepIntervalMs: scheduler?.sweepIntervalMs ?? 240000,
      alertsActive,
    };

    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] status error:', err);
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

export const fleetgraphRoutes = router;
