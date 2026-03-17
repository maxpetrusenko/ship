/**
 * FleetGraph queue unit tests.
 * Pure in-memory tests (no DB, no mocks).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FleetGraphQueue,
  buildQueueFingerprint,
  FLEETGRAPH_QUEUE_BACKPRESSURE_DROP_PROACTIVE,
} from './queue.js';

describe('buildQueueFingerprint', () => {
  it('produces deterministic fingerprint', () => {
    const fp = buildQueueFingerprint('ws-1', 'issue', 'iss-1');
    expect(fp).toBe('ws-1:issue:iss-1');
  });

  it('different entities produce different fingerprints', () => {
    const a = buildQueueFingerprint('ws-1', 'issue', 'iss-1');
    const b = buildQueueFingerprint('ws-1', 'issue', 'iss-2');
    expect(a).not.toBe(b);
  });

  it('different workspaces produce different fingerprints', () => {
    const a = buildQueueFingerprint('ws-1', 'issue', 'iss-1');
    const b = buildQueueFingerprint('ws-2', 'issue', 'iss-1');
    expect(a).not.toBe(b);
  });
});

describe('FleetGraphQueue', () => {
  let queue: FleetGraphQueue;

  beforeEach(() => {
    queue = new FleetGraphQueue();
  });

  it('enqueues a new item and returns true', () => {
    const result = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-1',
    });
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  it('deduplicates same fingerprint and returns false', () => {
    queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-1',
    });
    const dup = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-1',
    });
    expect(dup).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('allows same entity in different workspaces', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    const result = queue.enqueue({ workspaceId: 'ws-2', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    expect(result).toBe(true);
    expect(queue.size).toBe(2);
  });

  it('dequeues in FIFO order', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-2' });
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-3' });

    const first = queue.dequeue();
    expect(first?.entityId).toBe('iss-1');
    expect(queue.size).toBe(2);

    const second = queue.dequeue();
    expect(second?.entityId).toBe('iss-2');

    const third = queue.dequeue();
    expect(third?.entityId).toBe('iss-3');
  });

  it('returns null when queue is empty', () => {
    expect(queue.dequeue()).toBeNull();
  });

  it('allows re-enqueue after dequeue', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    queue.dequeue();
    const result = queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  it('hasPending checks fingerprint presence', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    expect(queue.hasPending('ws-1:issue:iss-1')).toBe(true);
    expect(queue.hasPending('ws-1:issue:iss-2')).toBe(false);
  });

  it('clear removes all pending items', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-2' });
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.dequeue()).toBeNull();
  });

  it('enqueuedAt is set on enqueue', () => {
    const before = Date.now();
    queue.enqueue({ workspaceId: 'ws-1', mode: 'proactive', entityType: 'issue', entityId: 'iss-1' });
    const item = queue.dequeue();
    expect(item?.enqueuedAt).toBeGreaterThanOrEqual(before);
    expect(item?.enqueuedAt).toBeLessThanOrEqual(Date.now());
  });

  it('fingerprint is set on enqueue', () => {
    queue.enqueue({ workspaceId: 'ws-1', mode: 'on_demand', entityType: 'sprint', entityId: 'sp-1' });
    const item = queue.dequeue();
    expect(item?.fingerprint).toBe('ws-1:sprint:sp-1');
    expect(item?.mode).toBe('on_demand');
  });

  it('event-driven trigger: issue update enqueues and deduplicates', () => {
    // Simulate what issues.ts PATCH does: enqueue on state/priority/assignee change
    const enqueued1 = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-42',
    });
    expect(enqueued1).toBe(true);

    // Second update to same issue (e.g., rapid successive edits) should dedupe
    const enqueued2 = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-42',
    });
    expect(enqueued2).toBe(false);
    expect(queue.size).toBe(1);

    // Different issue should enqueue
    const enqueued3 = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-43',
    });
    expect(enqueued3).toBe(true);
    expect(queue.size).toBe(2);
  });

  it('defers items until availableAt has passed', () => {
    const now = Date.now();

    queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-later',
      availableAt: now + 60_000,
    });
    queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-now',
      availableAt: now,
    });

    expect(queue.dequeue()?.entityId).toBe('iss-now');
    expect(queue.dequeue()).toBeNull();
  });

  it('drops proactive items under heavy queue pressure', () => {
    for (let i = 0; i < FLEETGRAPH_QUEUE_BACKPRESSURE_DROP_PROACTIVE; i++) {
      queue.enqueue({
        workspaceId: 'ws-1',
        mode: 'proactive',
        entityType: 'issue',
        entityId: `iss-${i}`,
      });
    }

    const dropped = queue.enqueue({
      workspaceId: 'ws-1',
      mode: 'proactive',
      entityType: 'issue',
      entityId: 'iss-overflow',
    });

    expect(dropped).toBe(false);
    expect(queue.size).toBe(FLEETGRAPH_QUEUE_BACKPRESSURE_DROP_PROACTIVE);
  });
});
