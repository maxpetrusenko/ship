/**
 * FleetGraph run queue with fingerprint-based deduplication.
 * In-memory Map for MVP; upgrade to Redis/PG advisory locks later.
 */
import type {
  FleetGraphMode,
  FleetGraphEntityType,
  FleetGraphTrigger,
} from '@ship/shared';

export interface FleetGraphQueueItem {
  fingerprint: string;
  workspaceId: string;
  mode: FleetGraphMode;
  entityType: FleetGraphEntityType;
  entityId: string;
  enqueuedAt: number;
  availableAt: number;
  attempt: number;
  digest?: string;
  trigger?: FleetGraphTrigger;
}

export const FLEETGRAPH_QUEUE_BACKPRESSURE_WARN = 50;
export const FLEETGRAPH_QUEUE_BACKPRESSURE_DROP_PROACTIVE = 200;
export const FLEETGRAPH_QUEUE_MAX_SIZE = 500;

export interface FleetGraphEnqueueItem {
  workspaceId: string;
  mode: FleetGraphMode;
  entityType: FleetGraphEntityType;
  entityId: string;
  availableAt?: number;
  attempt?: number;
  digest?: string;
  trigger?: FleetGraphTrigger;
}

/**
 * Build a deterministic fingerprint for queue deduplication.
 * Same workspace + entity + signal = same fingerprint.
 */
export function buildQueueFingerprint(
  workspaceId: string,
  entityType: string,
  entityId: string,
): string {
  return `${workspaceId}:${entityType}:${entityId}`;
}

export class FleetGraphQueue {
  private pending = new Map<string, FleetGraphQueueItem>();

  /** Add a run to the queue. Skips if same fingerprint already pending. */
  enqueue(item: FleetGraphEnqueueItem): boolean {
    const fingerprint = buildQueueFingerprint(
      item.workspaceId,
      item.entityType,
      item.entityId,
    );

    if (this.pending.has(fingerprint)) {
      console.log(`[FleetGraph:Queue] dedupe: ${fingerprint} already pending (depth=${this.pending.size})`);
      return false; // deduplicated
    }

    if (this.pending.size >= FLEETGRAPH_QUEUE_MAX_SIZE) {
      console.warn(`[FleetGraph:Queue] drop: ${fingerprint} queue full (depth=${this.pending.size})`);
      return false;
    }

    if (
      item.mode === 'proactive' &&
      this.pending.size >= FLEETGRAPH_QUEUE_BACKPRESSURE_DROP_PROACTIVE
    ) {
      console.warn(`[FleetGraph:Queue] drop: ${fingerprint} proactive backpressure (depth=${this.pending.size})`);
      return false;
    }

    if (this.pending.size >= FLEETGRAPH_QUEUE_BACKPRESSURE_WARN) {
      console.warn(`[FleetGraph:Queue] pressure: depth=${this.pending.size}`);
    }

    this.pending.set(fingerprint, {
      ...item,
      fingerprint,
      enqueuedAt: Date.now(),
      availableAt: item.availableAt ?? Date.now(),
      attempt: item.attempt ?? 0,
      trigger: item.trigger,
    });
    console.log(`[FleetGraph:Queue] enqueued: ${fingerprint} mode=${item.mode} (depth=${this.pending.size})`);
    return true;
  }

  /** Pop the next item from the queue (FIFO by enqueue time). */
  dequeue(): FleetGraphQueueItem | null {
    if (this.pending.size === 0) return null;
    const now = Date.now();

    // Sort by availableAt first, then enqueue time.
    let earliest: FleetGraphQueueItem | null = null;
    for (const item of this.pending.values()) {
      if (item.availableAt > now) {
        continue;
      }

      if (
        !earliest ||
        item.availableAt < earliest.availableAt ||
        (item.availableAt === earliest.availableAt && item.enqueuedAt < earliest.enqueuedAt)
      ) {
        earliest = item;
      }
    }

    if (earliest) {
      this.pending.delete(earliest.fingerprint);
      const waitMs = Date.now() - earliest.enqueuedAt;
      console.log(`[FleetGraph:Queue] dequeued: ${earliest.fingerprint} (waited ${waitMs}ms, remaining=${this.pending.size})`);
    }
    return earliest;
  }

  /** Check if a fingerprint is already queued. */
  hasPending(fingerprint: string): boolean {
    return this.pending.has(fingerprint);
  }

  /** Current queue depth. */
  get size(): number {
    return this.pending.size;
  }

  /** Clear all pending items. */
  clear(): void {
    this.pending.clear();
  }
}
