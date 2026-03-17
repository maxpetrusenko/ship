/**
 * FleetGraph scheduler: 4-minute sweep loop.
 * Enumerates active sprints, enqueues proactive runs, processes queue.
 */
import type pg from 'pg';
import type { FleetGraphRunState } from '@ship/shared';
import { FleetGraphQueue } from './queue.js';
import {
  cleanExpiredSnoozed,
  expirePendingApprovals,
  getEntityDigest,
  setEntityDigest,
} from './persistence.js';
import { fetchActiveSprints, fetchIssues } from '../data/fetchers.js';
import { ShipApiClient } from '../data/client.js';
import crypto from 'node:crypto';
import { computeFleetGraphEntityDigest } from './digest.js';
import type { ShipIssueSummary, ShipSprint } from '../data/types.js';

const SWEEP_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
const RUN_RETRY_BASE_MS = 1_000;
const RUN_RETRY_MAX_MS = 30_000;
const RUN_RETRY_LIMIT = 2;

export type BroadcastFn = (userId: string, eventType: string, data?: Record<string, unknown>) => void;

type ActiveSprint = {
  workspaceId: string;
  entityId: string;
  source: ShipSprint;
};

function isProactiveIssueCandidate(issue: ShipIssueSummary): boolean {
  return issue.state !== 'done' && issue.state !== 'cancelled';
}

/** Minimal graph interface the scheduler calls into. */
export interface FleetGraphExecutor {
  invoke(state: FleetGraphRunState): Promise<FleetGraphRunState>;
}

export class FleetGraphScheduler {
  private pool: pg.Pool;
  private graph: FleetGraphExecutor | null;
  private broadcastFn: BroadcastFn;
  private queue: FleetGraphQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _lastSweepAt: Date | null = null;
  private _running = false;
  private _sweepInProgress = false;

  constructor(
    pool: pg.Pool,
    graph: FleetGraphExecutor | null,
    broadcastFn: BroadcastFn,
  ) {
    this.pool = pool;
    this.graph = graph;
    this.broadcastFn = broadcastFn;
    this.queue = new FleetGraphQueue();
  }

  /** Start the 4-minute sweep loop. */
  start(): void {
    if (this._running) return;
    this._running = true;

    console.log('[FleetGraph] Scheduler started, sweep every 4 minutes');

    // Run first sweep after a short delay (let server finish booting)
    setTimeout(() => {
      this.sweep().catch((err) =>
        console.error('[FleetGraph] Initial sweep failed:', err),
      );
    }, 5_000);

    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        console.error('[FleetGraph] Sweep failed:', err),
      );
    }, SWEEP_INTERVAL_MS);
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this._running = false;
    this.queue.clear();
    console.log('[FleetGraph] Scheduler stopped');
  }

  /** Set or replace the graph executor (allows lazy init). */
  setGraph(graph: FleetGraphExecutor): void {
    this.graph = graph;
  }

  get running(): boolean {
    return this._running;
  }

  get lastSweepAt(): Date | null {
    return this._lastSweepAt;
  }

  get nextSweepAt(): Date | null {
    if (!this._running || !this._lastSweepAt) return null;
    return new Date(this._lastSweepAt.getTime() + SWEEP_INTERVAL_MS);
  }

  get sweepIntervalMs(): number {
    return SWEEP_INTERVAL_MS;
  }

  /** Get underlying queue for direct enqueue (on-demand runs). */
  getQueue(): FleetGraphQueue {
    return this.queue;
  }

  /** Process the queue immediately (used by page-view and webhook triggers). */
  processQueueImmediate(): Promise<void> {
    return this.processQueue();
  }

  // -----------------------------------------------------------------------
  // Sweep logic
  // -----------------------------------------------------------------------

  private async sweep(): Promise<void> {
    if (this._sweepInProgress) {
      console.warn('[FleetGraph] Sweep already running, skipping overlap');
      return;
    }

    this._sweepInProgress = true;
    const sweepStart = Date.now();
    console.log('[FleetGraph] Sweep starting...');

    try {
      // 1a. Reactivate expired snoozed alerts
      const reactivated = await cleanExpiredSnoozed(this.pool);
      if (reactivated > 0) {
        console.log(`[FleetGraph] Reactivated ${reactivated} expired snoozed alerts`);
      }

      // 1b. Expire stale pending approvals
      const expired = await expirePendingApprovals(this.pool);
      if (expired > 0) {
        console.log(`[FleetGraph] Expired ${expired} stale pending approvals`);
      }

      // 2. Enumerate active sprints across all workspaces
      const sprints = await this.getActiveSprints();
      console.log(`[FleetGraph] Found ${sprints.length} active sprints`);

      // 3. Enqueue proactive runs for each sprint and its issues
      let enqueued = 0;
      let skippedUnchanged = 0;
      for (const sprint of sprints) {
        const sprintDigest = computeFleetGraphEntityDigest('sprint', sprint.source);
        const previousSprintDigest = await getEntityDigest(
          this.pool,
          sprint.workspaceId,
          'sprint',
          sprint.entityId,
        );
        if (previousSprintDigest === sprintDigest) {
          skippedUnchanged++;
        } else {
          const added = this.queue.enqueue({
            workspaceId: sprint.workspaceId,
            mode: 'proactive',
            entityType: 'sprint',
            entityId: sprint.entityId,
            digest: sprintDigest,
          });
          if (added) enqueued++;
        }

        const issues = await this.getSprintIssues(sprint.entityId);
        for (const issue of issues.filter(isProactiveIssueCandidate)) {
          const issueDigest = computeFleetGraphEntityDigest('issue', issue);
          const previousIssueDigest = await getEntityDigest(
            this.pool,
            sprint.workspaceId,
            'issue',
            issue.id,
          );
          if (previousIssueDigest === issueDigest) {
            skippedUnchanged++;
            continue;
          }

          const added = this.queue.enqueue({
            workspaceId: sprint.workspaceId,
            mode: 'proactive',
            entityType: 'issue',
            entityId: issue.id,
            digest: issueDigest,
          });
          if (added) enqueued++;
        }
      }

      if (enqueued > 0) {
        console.log(`[FleetGraph] Enqueued ${enqueued} proactive runs`);
      }
      if (skippedUnchanged > 0) {
        console.log(`[FleetGraph] Skipped ${skippedUnchanged} unchanged proactive runs`);
      }

      // 4. Process queue
      await this.processQueue();
    } catch (err) {
      console.error('[FleetGraph] Sweep error:', err);
    } finally {
      this._sweepInProgress = false;
    }

    this._lastSweepAt = new Date();
    const elapsed = Date.now() - sweepStart;
    console.log(`[FleetGraph] Sweep complete in ${elapsed}ms`);
  }

  /** Fetch active sprints via Ship REST API.
   *  The API token is workspace-scoped, so all returned sprints belong
   *  to the configured workspace (FLEETGRAPH_WORKSPACE_ID). */
  private async getActiveSprints(): Promise<ActiveSprint[]> {
    const workspaceId = process.env.FLEETGRAPH_WORKSPACE_ID ?? '';
    if (!workspaceId) {
      console.warn('[FleetGraph] FLEETGRAPH_WORKSPACE_ID not set; skipping sprint enumeration');
      return [];
    }

    try {
      const client = new ShipApiClient();
      const sprints = await fetchActiveSprints(client);
      return sprints.map((s) => ({
        workspaceId,
        entityId: s.id,
        source: s,
      }));
    } catch (err) {
      console.error('[FleetGraph] Failed to fetch active sprints:', err);
      return [];
    }
  }

  /** Fetch the issues that belong to a sprint so the scheduler can fan out issue-level proactive runs. */
  private async getSprintIssues(
    sprintId: string,
  ): Promise<ShipIssueSummary[]> {
    try {
      const client = new ShipApiClient();
      return await fetchIssues(client, { sprint_id: sprintId });
    } catch (err) {
      console.error(`[FleetGraph] Failed to fetch issues for sprint ${sprintId}:`, err);
      return [];
    }
  }

  /** Drain the queue and invoke the graph for each item. */
  private async processQueue(): Promise<void> {
    if (!this.graph) {
      console.log('[FleetGraph] No graph executor set, skipping queue processing');
      return;
    }

    let processed = 0;
    let item = this.queue.dequeue();

    while (item) {
      try {
        const runId = crypto.randomUUID();
        console.log(`[FleetGraph] Processing run: ${runId} entity=${item.entityType}:${item.entityId} mode=${item.mode}`);
        const state: FleetGraphRunState = {
          runId,
          traceId: runId,
          mode: item.mode,
          workspaceId: item.workspaceId,
          actorUserId: null,
          entityType: item.entityType,
          entityId: item.entityId,
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
          trigger: item.trigger ?? 'sweep',
        };

        await this.graph.invoke(state);
        if (item.mode === 'proactive' && item.digest) {
          await setEntityDigest(this.pool, item.workspaceId, item.entityType, item.entityId, item.digest);
        }
        processed++;
      } catch (err) {
        console.error(
          `[FleetGraph] Run failed for ${item.entityType}:${item.entityId}:`,
          err,
        );
        if (item.attempt < RUN_RETRY_LIMIT) {
          const nextAttempt = item.attempt + 1;
          const backoffMs = Math.min(RUN_RETRY_BASE_MS * 2 ** item.attempt, RUN_RETRY_MAX_MS);
          this.queue.enqueue({
            workspaceId: item.workspaceId,
            mode: item.mode,
            entityType: item.entityType,
            entityId: item.entityId,
            attempt: nextAttempt,
            availableAt: Date.now() + backoffMs,
            digest: item.digest,
          });
          console.warn(
            `[FleetGraph] Requeued ${item.entityType}:${item.entityId} after failure ` +
              `(attempt=${nextAttempt}, backoff=${backoffMs}ms)`,
          );
        }
      }

      item = this.queue.dequeue();
    }

    if (processed > 0) {
      console.log(`[FleetGraph] Processed ${processed} runs`);
    }
  }
}
