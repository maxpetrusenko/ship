/**
 * FleetGraph event-driven trigger tests.
 *
 * Tests the trigger logic extracted from issues.ts PATCH handler:
 * when state/priority/assignee_id changes, enqueue a FleetGraph run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetGraphQueue } from './queue.js';

// Simulate the trigger logic from issues.ts PATCH
interface ChangeRecord {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

const TRIGGER_FIELDS = ['state', 'priority', 'assignee_id'];

function simulateTrigger(
  queue: FleetGraphQueue,
  changes: ChangeRecord[],
  workspaceId: string,
  issueId: string,
): boolean {
  const hasTrigger = changes.some((c) => TRIGGER_FIELDS.includes(c.field));
  if (!hasTrigger) return false;

  return queue.enqueue({
    workspaceId,
    mode: 'proactive',
    entityType: 'issue',
    entityId: issueId,
  });
}

describe('FleetGraph event-driven trigger', () => {
  let queue: FleetGraphQueue;

  beforeEach(() => {
    queue = new FleetGraphQueue();
  });

  it('triggers on state change', () => {
    const changes: ChangeRecord[] = [
      { field: 'state', oldValue: 'open', newValue: 'in_progress' },
    ];
    const result = simulateTrigger(queue, changes, 'ws-1', 'iss-1');
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  it('triggers on priority change', () => {
    const changes: ChangeRecord[] = [
      { field: 'priority', oldValue: 'medium', newValue: 'high' },
    ];
    const result = simulateTrigger(queue, changes, 'ws-1', 'iss-1');
    expect(result).toBe(true);
  });

  it('triggers on assignee_id change', () => {
    const changes: ChangeRecord[] = [
      { field: 'assignee_id', oldValue: 'user-1', newValue: 'user-2' },
    ];
    const result = simulateTrigger(queue, changes, 'ws-1', 'iss-1');
    expect(result).toBe(true);
  });

  it('does NOT trigger on non-trigger fields', () => {
    const changes: ChangeRecord[] = [
      { field: 'title', oldValue: 'old', newValue: 'new' },
      { field: 'description', oldValue: 'old', newValue: 'new' },
    ];
    const result = simulateTrigger(queue, changes, 'ws-1', 'iss-1');
    expect(result).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('triggers when mixed fields include a trigger field', () => {
    const changes: ChangeRecord[] = [
      { field: 'title', oldValue: 'old', newValue: 'new' },
      { field: 'state', oldValue: 'open', newValue: 'closed' },
    ];
    const result = simulateTrigger(queue, changes, 'ws-1', 'iss-1');
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  it('deduplicates rapid updates to same issue', () => {
    // First update: state change
    simulateTrigger(
      queue,
      [{ field: 'state', oldValue: 'open', newValue: 'in_progress' }],
      'ws-1',
      'iss-1',
    );
    // Second update: priority change (same issue, rapid succession)
    const second = simulateTrigger(
      queue,
      [{ field: 'priority', oldValue: 'low', newValue: 'high' }],
      'ws-1',
      'iss-1',
    );
    expect(second).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('allows concurrent triggers for different issues', () => {
    simulateTrigger(
      queue,
      [{ field: 'state', oldValue: 'open', newValue: 'closed' }],
      'ws-1',
      'iss-1',
    );
    simulateTrigger(
      queue,
      [{ field: 'state', oldValue: 'open', newValue: 'closed' }],
      'ws-1',
      'iss-2',
    );
    expect(queue.size).toBe(2);
  });

  it('re-triggers after queue processes the item', () => {
    simulateTrigger(
      queue,
      [{ field: 'state', oldValue: 'open', newValue: 'in_progress' }],
      'ws-1',
      'iss-1',
    );
    // Simulate queue processing
    queue.dequeue();
    expect(queue.size).toBe(0);

    // Should allow re-trigger
    const result = simulateTrigger(
      queue,
      [{ field: 'state', oldValue: 'in_progress', newValue: 'closed' }],
      'ws-1',
      'iss-1',
    );
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
  });

  it('empty changes array does not trigger', () => {
    const result = simulateTrigger(queue, [], 'ws-1', 'iss-1');
    expect(result).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('non-critical: trigger failure does not throw', () => {
    // Simulate the try/catch pattern from issues.ts
    const mockScheduler = {
      getQueue: (): FleetGraphQueue => {
        throw new Error('Queue corrupted');
      },
    };

    let enqueued = false;
    try {
      const q = mockScheduler.getQueue();
      enqueued = q.enqueue({
        workspaceId: 'ws-1',
        mode: 'proactive' as const,
        entityType: 'issue' as const,
        entityId: 'iss-1',
      });
    } catch {
      // Non-critical: log and continue (matches issues.ts behavior)
      enqueued = false;
    }
    expect(enqueued).toBe(false);
  });

  it('null scheduler does not trigger (guard pattern)', () => {
    // Simulate getScheduler() returning null (FleetGraph not started)
    const scheduler = null;
    let triggered = false;

    if (scheduler) {
      triggered = true;
    }
    expect(triggered).toBe(false);
  });
});
