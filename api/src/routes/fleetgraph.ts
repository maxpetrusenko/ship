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
  invokeGraph,
  resumeGraph,
  isEntityAnalysisStale,
  getActiveThread,
  getThreadById,
  createThread,
  getOrCreateActiveThread,
  appendChatMessage,
  loadRecentMessages,
  updateThreadPageContext,
} from '../fleetgraph/runtime/index.js';
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
// POST /api/fleetgraph/chat (DB-backed persistent threads)
// -------------------------------------------------------------------------

function buildChatDebugInfo(state: FleetGraphRunState): FleetGraphChatDebugInfo {
  const signals = state.parallelSignals as Record<string, unknown>;
  const accountability = (signals.accountability as Record<string, unknown> | undefined)?.items;
  const managerActionItems = signals.managerActionItems;
  const accountabilityItems = Array.isArray(accountability)
    ? accountability as Array<{ days_overdue?: number }>
    : [];

  return {
    traceUrl: state.traceUrl,
    branch: state.branch,
    entityType: state.entityType,
    entityId: state.entityId,
    candidateSignals: state.candidates.map((candidate) => candidate.signalType),
    accountability: {
      total: accountabilityItems.length,
      overdue: accountabilityItems.filter((item) => typeof item.days_overdue === 'number' && item.days_overdue > 0).length,
      dueToday: accountabilityItems.filter((item) => item.days_overdue === 0).length,
    },
    managerActionItems: Array.isArray(managerActionItems) ? managerActionItems.length : 0,
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

    const thread = await createThread(pool, workspaceId, userId);
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

    // Resolve thread: explicit threadId > get-or-create active
    let thread;
    if (body.threadId) {
      thread = await getThreadById(pool, body.threadId, workspaceId, userId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found or access denied' });
      }
    } else {
      thread = await getOrCreateActiveThread(pool, workspaceId, userId);
    }

    // Update page context if provided
    if (body.pageContext) {
      await updateThreadPageContext(pool, thread.id, body.pageContext);
    }

    // Load recent history from DB
    const history = await loadRecentMessages(pool, thread.id);

    const runId = crypto.randomUUID();

    // Build initial state with chat question + history threaded in
    const initialState: FleetGraphRunState = {
      runId,
      traceId: runId,
      mode: 'on_demand',
      workspaceId,
      actorUserId: userId,
      entityType: body.entityType,
      entityId: body.entityId,
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
      chatQuestion: body.question,
      chatHistory: history,
      traceUrl: null,
      trigger: 'on_demand',
    };

    let finalState: FleetGraphRunState = initialState;
    try {
      const result = await invokeGraph(initialState);
      finalState = result.state;
    } catch (graphErr) {
      console.error('[FleetGraph] Chat graph invocation failed:', graphErr);
    }

    // Build assistant message
    const assistantMessage: FleetGraphChatMessage = {
      role: 'assistant',
      content: finalState.assessment?.summary ?? 'Everything looks healthy here. Ask me anything about this entity.',
      assessment: finalState.assessment ?? undefined,
      debug: buildChatDebugInfo(finalState),
      timestamp: new Date().toISOString(),
    };

    // Persist both messages to DB
    await appendChatMessage(pool, thread.id, 'user', body.question);
    await appendChatMessage(
      pool,
      thread.id,
      'assistant',
      assistantMessage.content,
      assistantMessage.assessment,
      assistantMessage.debug,
    );

    const alerts = await getAlertsByEntity(pool, body.entityType, body.entityId);
    const activeAlerts = alerts.filter((a) => a.status === 'active' && a.workspaceId === workspaceId);

    const response: FleetGraphChatResponse = {
      conversationId: thread.id,
      threadId: thread.id,
      runId,
      branch: finalState.branch,
      assessment: finalState.assessment,
      alerts: activeAlerts,
      message: assistantMessage,
      traceUrl: finalState.traceUrl ?? undefined,
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
    queue.enqueue({
      workspaceId,
      mode: 'on_demand',
      entityType,
      entityId,
      trigger: 'page_view',
    });

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
// GET /api/fleetgraph/alerts
// -------------------------------------------------------------------------

router.get('/alerts', async (req: Request, res: Response) => {
  // No isFleetGraphReady() gate: alerts are a DB read, not a graph operation.
  // This allows the endpoint to work even when OPENAI_API_KEY is missing.
  try {
    const workspaceId = req.workspaceId!;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;
    const status = req.query.status as string | undefined;

    let alerts;

    if (entityType && entityId) {
      alerts = await getAlertsByEntity(pool, entityType, entityId);
      // Scope to workspace: filter out alerts from other workspaces
      alerts = alerts.filter((a) => a.workspaceId === workspaceId);
    } else {
      alerts = await getActiveAlerts(pool, workspaceId);
    }

    // Filter by status if provided
    if (status) {
      alerts = alerts.filter((a) => a.status === status);
    }

    // Include pending approvals so the UI can match alerts to real action data
    const pendingApprovals = await getPendingApprovals(pool, workspaceId);

    const response: FleetGraphAlertsResponse = {
      alerts,
      pendingApprovals,
      total: alerts.length,
    };

    return res.json(response);
  } catch (err) {
    console.error('[FleetGraph] alerts error:', err);
    return res.status(500).json({ error: 'Failed to fetch alerts' });
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

    // Resolve the alert itself
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
