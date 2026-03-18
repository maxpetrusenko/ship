/**
 * FleetGraph runtime public API.
 * Entry point: startFleetGraph / stopFleetGraph.
 * Re-exports persistence for route handlers.
 *
 * Provides invokeGraph / resumeGraph for on-demand + HITL flows.
 */
import type pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Command, isGraphInterrupt } from '@langchain/langgraph';
import type { GraphInterrupt } from '@langchain/langgraph';
import { FleetGraphScheduler, type BroadcastFn } from './scheduler.js';
import { createFleetGraph } from '../graph/builder.js';
import { setBroadcastFn, setGatePool } from '../graph/nodes.js';
import { configureFleetGraphData } from '../data/fetchers.js';
import { expirePendingApprovals } from './persistence.js';
import type { FleetGraphRunState, HumanGateOutcome } from '@ship/shared';

// Re-export persistence functions for route handlers
export {
  findActiveAlert,
  upsertAlert,
  resolveAlert,
  getAlertsByEntity,
  getActiveAlerts,
  logAuditEntry,
  getEntityDigest,
  setEntityDigest,
  cleanExpiredSnoozed,
  isEntityAnalysisStale,
  createApproval,
  findPendingApproval,
  updateApprovalStatus,
  expirePendingApprovals,
  getPendingApprovals,
  // Recipient persistence
  createRecipient,
  createRecipients,
  getUserAlerts,
  getUnreadCount,
  markRecipientsRead,
  dismissRecipient,
  snoozeRecipient,
  // Chat thread persistence
  getActiveThread,
  getThreadById,
  createThread,
  getOrCreateActiveThread,
  appendChatMessage,
  loadRecentMessages,
  updateThreadPageContext,
} from './persistence.js';

// Re-export alert helpers
export {
  resolveAlertRecipients,
  createAlertWithRecipients,
  createApprovalFromAction,
} from './alert-helpers.js';

// Re-export queue for on-demand enqueue
export { FleetGraphQueue, buildQueueFingerprint } from './queue.js';

// Re-export scheduler type
export { FleetGraphScheduler, type BroadcastFn } from './scheduler.js';

// -------------------------------------------------------------------------
// Graph invocation result
// -------------------------------------------------------------------------

export interface GraphInvocationResult {
  /** Final state (partial if interrupted). */
  state: FleetGraphRunState;
  /** True when the graph paused at the human_gate interrupt. */
  interrupted: boolean;
  /** The thread_id to use when resuming (same as runId). */
  threadId: string;
}

interface FleetGraphInvoker {
  invoke(
    state: FleetGraphRunState | Command,
    config: { configurable: { thread_id: string } },
  ): Promise<FleetGraphRunState>;
}

// -------------------------------------------------------------------------
// Singleton lifecycle
// -------------------------------------------------------------------------

let scheduler: FleetGraphScheduler | null = null;
let checkpointer: PostgresSaver | null = null;

/** Compiled graph singleton. Populated by startFleetGraph(). */
let _compiledGraph: ReturnType<typeof createFleetGraph> | null = null;

/**
 * Boot FleetGraph: create checkpointer, compile graph, start scheduler.
 * Called once at server startup.
 */
export async function startFleetGraph(
  pool: pg.Pool,
  broadcastFn: BroadcastFn,
): Promise<FleetGraphScheduler> {
  if (scheduler) {
    console.warn('[FleetGraph] Already running, returning existing scheduler');
    return scheduler;
  }

  console.log('[FleetGraph] Starting runtime...');
  // Wire data layer
  configureFleetGraphData(pool);
  console.log('[FleetGraph] Data layer configured');

  // Wire broadcast + gate pool into graph nodes
  setBroadcastFn((workspaceId, userId, event, payload) => {
    if (userId) {
      broadcastFn(userId, event, payload);
    } else {
      // Proactive runs have no actorUserId; broadcast to all workspace members
      pool.query(
        `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1`,
        [workspaceId],
      ).then((result) => {
        for (const row of result.rows) {
          broadcastFn(row.user_id as string, event, payload);
        }
      }).catch((err) => {
        console.error('[FleetGraph] Workspace broadcast failed:', err);
      });
    }
  });
  setGatePool(pool);

  // Initialize PostgresSaver for HITL checkpointing
  try {
    const connStr = process.env.DATABASE_URL;
    if (connStr) {
      checkpointer = PostgresSaver.fromConnString(connStr);
      await checkpointer.setup();
      console.log('[FleetGraph] PostgresSaver checkpointer initialized');
    } else {
      console.warn('[FleetGraph] No DATABASE_URL; running without checkpointer (no HITL pause/resume)');
    }
  } catch (err) {
    console.error('[FleetGraph] Checkpointer setup failed, continuing without HITL:', err);
    checkpointer = null;
  }

  // Compile graph with checkpointer
  _compiledGraph = createFleetGraph({ checkpointer: checkpointer ?? undefined });
  console.log(`[FleetGraph] Graph compiled (checkpointer=${!!checkpointer})`);

  // Create scheduler and wire graph
  scheduler = new FleetGraphScheduler(pool, null, broadcastFn);
  scheduler.setGraph({
    invoke: async (state) => {
      const result = await invokeGraph(state);
      return result.state;
    },
  });

  // Expire stale approvals on startup
  try {
    const expired = await expirePendingApprovals(pool);
    if (expired > 0) {
      console.log(`[FleetGraph] Expired ${expired} stale pending approvals on startup`);
    }
  } catch {
    // Non-critical; table might not exist yet
  }

  scheduler.start();
  console.log('[FleetGraph] Runtime started');
  return scheduler;
}

/** Graceful shutdown. */
export function stopFleetGraph(): void {
  console.log('[FleetGraph] Stopping runtime...');
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
  _compiledGraph = null;
}

/** Get the running scheduler instance (for routes/status endpoint). */
export function getScheduler(): FleetGraphScheduler | null {
  return scheduler;
}

/** Get the checkpointer instance (for resume operations). */
export function getCheckpointer(): PostgresSaver | null {
  return checkpointer;
}

/** Get the compiled graph (for direct invocation in routes). */
export function getCompiledGraph(): ReturnType<typeof createFleetGraph> | null {
  return _compiledGraph;
}

// -------------------------------------------------------------------------
// Graph invocation helpers (used by routes + scheduler)
// -------------------------------------------------------------------------

/**
 * Invoke the graph from initial state.
 * If the graph hits the human_gate interrupt(), returns
 * { interrupted: true, state: <partial state>, threadId }.
 */
export async function invokeGraph(
  initialState: FleetGraphRunState,
): Promise<GraphInvocationResult> {
  const graph = _compiledGraph;
  if (!graph) {
    throw new Error('FleetGraph not initialized');
  }

  const threadId = initialState.runId;
  const config = { configurable: { thread_id: threadId } };

  try {
    const finalState = await graph.invoke(initialState, config) as FleetGraphRunState;
    return { state: finalState, interrupted: false, threadId };
  } catch (err) {
    if (isGraphInterrupt(err)) {
      // Graph paused at interrupt(). Read the current state from checkpoint.
      console.log(`[FleetGraph] Graph interrupted at human_gate (threadId=${threadId})`);
      const snapshot = await graph.getState(config);
      return {
        state: snapshot.values as FleetGraphRunState,
        interrupted: true,
        threadId,
      };
    }
    throw err;
  }
}

/**
 * Resume a paused graph with a human gate outcome.
 * Called from the /resolve route when a user approves/dismisses/snoozes.
 */
export async function resumeGraph(
  threadId: string,
  gateOutcome: HumanGateOutcome,
): Promise<GraphInvocationResult> {
  const graph = _compiledGraph;
  if (!graph) {
    throw new Error('FleetGraph not initialized');
  }

  const config = { configurable: { thread_id: threadId } };

  // Command({ resume }) replays from the interrupt, passing the outcome
  // as the return value of the interrupt() call in human_gate.
  const resumeCmd = new Command({ resume: gateOutcome });

  const resumableGraph = graph as ReturnType<typeof createFleetGraph> & FleetGraphInvoker;
  const finalState = await resumableGraph.invoke(resumeCmd, config);
  return { state: finalState, interrupted: false, threadId };
}
