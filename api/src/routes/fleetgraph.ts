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
} from '../fleetgraph/runtime/index.js';
import { runFleetGraphChat } from '../fleetgraph/chat/runtime.js';
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
  FleetGraphChatMessage,
  FleetGraphChatDebugInfo,
  FleetGraphChatThreadResponse,
  FleetGraphCreateChatThreadResponse,
  FleetGraphPageViewResponse,
  FleetGraphEntityType,
  FleetGraphAlert,
  HumanGateOutcome,
} from '@ship/shared';
import { isFleetGraphReady } from '../fleetgraph/bootstrap.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

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
    const entityType = req.query.entityType as FleetGraphEntityType | undefined;
    const entityId = req.query.entityId as string | undefined;

    const thread = await getActiveThread(pool, workspaceId, userId, entityType, entityId);
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

  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const body = req.body as FleetGraphChatRequest;

    if (!body.entityType || !body.entityId || !body.question) {
      return res.status(400).json({ error: 'entityType, entityId, and question are required' });
    }

    // Resolve thread with entity scope
    let thread;
    if (body.threadId) {
      thread = await getThreadById(pool, body.threadId, workspaceId, userId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found or access denied' });
      }
    } else {
      thread = await getOrCreateActiveThread(pool, workspaceId, userId, body.entityType, body.entityId);
    }

    // Update page context if provided
    if (body.pageContext) {
      await updateThreadPageContext(pool, thread.id, body.pageContext);
    }

    // Load recent history from DB
    const history = await loadRecentMessages(pool, thread.id);

    const runId = crypto.randomUUID();

    let runtimeResult: FleetGraphChatRuntimeResult;
    try {
      runtimeResult = await runFleetGraphChat({
        workspaceId,
        userId,
        threadId: thread.id,
        entityType: body.entityType,
        entityId: body.entityId,
        question: body.question,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        pageContext: body.pageContext ?? null,
      });
    } catch (chatErr) {
      console.error('[FleetGraph] Chat graph invocation failed:', chatErr);
      return res.status(502).json({ error: 'FleetGraph chat runtime failed' });
    }

    // Fetch alerts for the entity (created during graph run or pre-existing)
    const alerts = await getAlertsByEntity(pool, body.entityType, body.entityId);
    const activeAlerts = alerts.filter((a) => a.status === 'active' && a.workspaceId === workspaceId);
    const assistantAlertId = resolveAssistantAlertId(runtimeResult.assessment, activeAlerts);
    const debugInfo = buildChatDebugInfoFromRuntime(runtimeResult, body.entityType, body.entityId);

    const assistantMessage: FleetGraphChatMessage = {
      ...runtimeResult.message,
      alertId: assistantAlertId,
      assessment: normalizeRuntimeAssessment(runtimeResult.assessment),
      debug: debugInfo,
    };

    await appendChatMessage(pool, thread.id, 'user', body.question);
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
    console.error('[FleetGraph] chat error:', err);
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

        if (body.outcome === 'approve') {
          // Mark approval as approved (CAS: only if still pending)
          const updated = await updateApprovalStatus(pool, approval.id, 'approved', userId);
          if (!updated) {
            return res.status(409).json({ error: 'Approval already processed' });
          }

          // Resume the paused graph with 'approve' outcome.
          // The graph's execute_action node handles the actual Ship API call.
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
        } else {
          // reject (CAS: only if still pending)
          const rejected = await updateApprovalStatus(pool, approval.id, 'dismissed', userId);
          if (!rejected) {
            return res.status(409).json({ error: 'Approval already processed' });
          }

          // Resume the paused graph with 'dismiss' outcome -> log_dismissal
          const threadId = approval.threadId ?? approval.runId;
          try {
            await resumeGraph(threadId, 'dismiss' as HumanGateOutcome);
          } catch (resumeErr) {
            // Non-critical: the approval is already dismissed in DB.
            // Log but do not fail the HTTP response.
            console.error('[FleetGraph] Graph resume for dismiss failed:', resumeErr);
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
