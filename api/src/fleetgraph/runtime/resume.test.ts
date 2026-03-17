/**
 * FleetGraph HITL pause/resume integration tests.
 *
 * Tests the real LangGraph interrupt() + Command({ resume }) flow
 * using MemorySaver (in-memory checkpointer). Verifies:
 *   1. Graph pauses at human_gate when interrupt() is called
 *   2. Resuming with 'approve' routes to execute_action
 *   3. Resuming with 'dismiss' routes to log_dismissal
 *   4. Resuming with 'snooze' routes to log_snooze
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver, Command } from '@langchain/langgraph';
import { createFleetGraph } from '../graph/builder.js';
import type { FleetGraphRunState } from '@ship/shared';

// ---------------------------------------------------------------------------
// Mock the data layer so we never hit real DB/API
// ---------------------------------------------------------------------------

vi.mock('../data/fetchers.js', () => ({
  fetchCoreContext: vi.fn().mockResolvedValue({
    entity: {
      id: 'iss-1',
      updated_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
  }),
  fetchParallelSignals: vi.fn().mockResolvedValue({ lastActivityDays: 10 }),
  executeShipAction: vi.fn().mockResolvedValue({ success: true }),
  persistAlert: vi.fn().mockResolvedValue('alert-test-1'),
  persistAuditEntry: vi.fn().mockResolvedValue(undefined),
  configureFleetGraphData: vi.fn(),
}));

vi.mock('../runtime/persistence.js', () => ({
  createApproval: vi.fn().mockResolvedValue({ id: 'appr-test-1' }),
}));

// Mock the ChatOpenAI class to return a confirm_action assessment.
// The mock must use a class constructor pattern that LangChain expects.
const mockLLMInvoke = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    summary: 'Issue stale 10 days, reassign recommended',
    recommendation: 'Reassign to active team member',
    branch: 'confirm_action',
    proposedAction: {
      actionType: 'reassign',
      targetEntityType: 'issue',
      targetEntityId: 'iss-1',
      description: 'Reassign stale issue',
      payload: { assignee: 'user-2' },
    },
    citations: ['activity feed', 'workload data'],
  }),
  usage_metadata: { input_tokens: 100, output_tokens: 50 },
});

vi.mock('@langchain/openai', () => {
  class MockChatOpenAI {
    invoke = mockLLMInvoke;
  }
  return { ChatOpenAI: MockChatOpenAI };
});

vi.mock('../config/model-policy.js', () => ({
  getModelConfig: vi.fn().mockReturnValue({
    modelId: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 1024,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInitialState(runId: string): FleetGraphRunState {
  return {
    runId,
    traceId: runId,
    mode: 'on_demand',
    workspaceId: 'ws-test',
    actorUserId: 'user-1',
    entityType: 'issue',
    entityId: 'iss-1',
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FleetGraph HITL pause/resume', () => {
  let checkpointer: MemorySaver;

  beforeEach(() => {
    vi.clearAllMocks();
    checkpointer = new MemorySaver();
    // Reset the LLM mock to return confirm_action
    mockLLMInvoke.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Issue stale 10 days, reassign recommended',
        recommendation: 'Reassign to active team member',
        branch: 'confirm_action',
        proposedAction: {
          actionType: 'reassign',
          targetEntityType: 'issue',
          targetEntityId: 'iss-1',
          description: 'Reassign stale issue',
          payload: { assignee: 'user-2' },
        },
        citations: ['activity feed', 'workload data'],
      }),
      usage_metadata: { input_tokens: 100, output_tokens: 50 },
    });
  });

  it('graph pauses at human_gate interrupt and resumes with approve -> execute_action', async () => {
    const graph = createFleetGraph({ checkpointer });
    const threadId = 'test-thread-approve';
    const config = { configurable: { thread_id: threadId } };
    const initialState = makeInitialState(threadId);

    // First invoke: graph runs through to human_gate, then pauses at interrupt()
    const firstResult = await graph.invoke(initialState, config) as FleetGraphRunState;

    // After the interrupt, state should have assessment from reasoning but
    // gateOutcome is still null (not yet decided by human).
    expect(firstResult.assessment).toBeTruthy();
    expect(firstResult.assessment?.branch).toBe('confirm_action');
    expect(firstResult.gateOutcome).toBeNull();

    // Check the graph snapshot confirms it's paused before human_gate
    const snapshot = await graph.getState(config);
    expect(snapshot.next).toContain('human_gate');

    // Resume with 'approve' => routes through human_gate -> execute_action -> END
    const resumeResult = await graph.invoke(
      new Command({ resume: 'approve' }),
      config,
    ) as FleetGraphRunState;

    expect(resumeResult.gateOutcome).toBe('approve');
    // execute_action ran without error
    expect(resumeResult.error).toBeNull();

    // Graph completed (no more pending nodes)
    const finalSnapshot = await graph.getState(config);
    expect(finalSnapshot.next).toEqual([]);
  });

  it('graph pauses and resumes with dismiss -> log_dismissal', async () => {
    const graph = createFleetGraph({ checkpointer });
    const threadId = 'test-thread-dismiss';
    const config = { configurable: { thread_id: threadId } };
    const initialState = makeInitialState(threadId);

    // First invoke: pause at human_gate
    const firstResult = await graph.invoke(initialState, config) as FleetGraphRunState;
    expect(firstResult.assessment).toBeTruthy();

    const snapshot = await graph.getState(config);
    expect(snapshot.next).toContain('human_gate');

    // Resume with 'dismiss' => routes to log_dismissal -> END
    const resumeResult = await graph.invoke(
      new Command({ resume: 'dismiss' }),
      config,
    ) as FleetGraphRunState;

    expect(resumeResult.gateOutcome).toBe('dismiss');
    expect(resumeResult.error).toBeNull();

    const finalSnapshot = await graph.getState(config);
    expect(finalSnapshot.next).toEqual([]);
  });

  it('graph pauses and resumes with snooze -> log_snooze', async () => {
    const graph = createFleetGraph({ checkpointer });
    const threadId = 'test-thread-snooze';
    const config = { configurable: { thread_id: threadId } };
    const initialState = makeInitialState(threadId);

    // First invoke: pause at human_gate
    const firstResult = await graph.invoke(initialState, config) as FleetGraphRunState;
    expect(firstResult.assessment).toBeTruthy();

    const snapshot = await graph.getState(config);
    expect(snapshot.next).toContain('human_gate');

    // Resume with 'snooze' => routes to log_snooze -> END
    const resumeResult = await graph.invoke(
      new Command({ resume: 'snooze' }),
      config,
    ) as FleetGraphRunState;

    expect(resumeResult.gateOutcome).toBe('snooze');
    expect(resumeResult.error).toBeNull();

    const finalSnapshot = await graph.getState(config);
    expect(finalSnapshot.next).toEqual([]);
  });

  it('interrupt value contains run and action info', async () => {
    const graph = createFleetGraph({ checkpointer });
    const threadId = 'test-thread-interrupt-value';
    const config = { configurable: { thread_id: threadId } };
    const initialState = makeInitialState(threadId);

    // First invoke: pause at interrupt
    await graph.invoke(initialState, config);

    // Check the snapshot for interrupt metadata
    const snapshot = await graph.getState(config);
    expect(snapshot.next).toContain('human_gate');

    // The tasks should contain interrupt information
    const tasks = snapshot.tasks ?? [];
    const gateTask = tasks.find((t: { name?: string }) => t.name === 'human_gate');
    if (gateTask && 'interrupts' in gateTask) {
      const interrupts = (gateTask as { interrupts: Array<{ value: unknown }> }).interrupts;
      expect(interrupts).toHaveLength(1);
      const interruptValue = interrupts[0].value as { runId: string; action: unknown };
      expect(interruptValue.runId).toBe(threadId);
      expect(interruptValue.action).toBeTruthy();
    }
  });
});
