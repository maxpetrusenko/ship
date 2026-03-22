/**
 * FleetGraph multi-turn analysis chat (Phase 2B + persistent threads).
 * Hydrates from DB-backed thread on mount, persists every message server-side.
 * Scoped to the current entity or workspace (not a general chatbot).
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/cn';
import {
  useFleetGraphChat,
  useFleetGraphAlerts,
  useFleetGraphThread,
  useFleetGraphCreateThread,
  useFleetGraphResolve,
} from '@/hooks/useFleetGraph';
import { useDocumentContextQuery } from '@/hooks/useDocumentContextQuery';
import type {
  FleetGraphEntityType,
  FleetGraphAssessment,
  FleetGraphChatMessage,
  FleetGraphChatDebugInfo,
  FleetGraphPageContext,
  FleetGraphProposedAction,
} from '@ship/shared';
import type { FleetGraphScopeType } from '@/hooks/useFleetGraphScope';

interface FleetGraphChatProps {
  entityType: FleetGraphEntityType;
  entityId: string;
  workspaceId: string;
  /** External header trigger for creating a new thread. */
  newThreadNonce?: number;
  /** Scope type for workspace-level analysis. */
  scopeType?: FleetGraphScopeType;
  /** Page context injected into every chat turn. */
  pageContext?: FleetGraphPageContext;
  /** Called when a new thread is created (so parent can react). */
  onNewThread?: () => void;
  /** Keep one workspace thread even as visible entity scope changes. */
  persistAcrossScopes?: boolean;
}

const ENTITY_LABELS: Record<string, string> = {
  issue: 'issue',
  sprint: 'sprint',
  project: 'project',
  workspace: 'workspace',
};

const QUICK_PROMPTS: Record<string, string[]> = {
  issue: [
    'Is this issue stale?',
    'Check ownership gaps',
  ],
  sprint: [
    'Scope drift check',
    'Missing standups?',
  ],
  project: [
    'Execution health',
    'Approval bottlenecks?',
  ],
  workspace: [
    'Overall execution health',
    'Any stale issues?',
    'Team velocity trends',
  ],
};

const LOG_PREFIX = '[FleetGraph:Chat]';

function getVisibleEditorText(pageContext?: FleetGraphPageContext): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const documentId = pageContext?.documentId;
  if (!documentId) {
    return undefined;
  }

  const editorWrapper = Array.from(document.querySelectorAll<HTMLElement>('[data-fleetgraph-editor="document"]'))
    .find((node) => node.dataset.documentId === documentId);
  const editorNode = editorWrapper?.querySelector<HTMLElement>('.ProseMirror');
  const rawText = editorNode?.innerText ?? editorNode?.textContent ?? '';
  const text = rawText.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function buildLivePageContext(pageContext?: FleetGraphPageContext): FleetGraphPageContext | undefined {
  if (!pageContext) {
    return undefined;
  }

  const visibleContentText = getVisibleEditorText(pageContext);
  if (!visibleContentText) {
    return pageContext;
  }

  return {
    ...pageContext,
    visibleContentText,
  };
}

interface AssessmentResultProps {
  assessment: FleetGraphAssessment;
  /** Callback to execute an action (approve/dismiss) on the proposed action's alert. */
  onAction?: (outcome: 'approve' | 'dismiss', alertId: string) => Promise<void>;
  /** Alert ID tied to this assessment (if any). */
  alertId?: string;
}

function AssessmentResult({ assessment, onAction, alertId }: AssessmentResultProps) {
  const [actionState, setActionState] = useState<'idle' | 'pending' | 'done'>('idle');
  const branchLabel = assessment.branch === 'confirm_action'
    ? 'Action Suggested'
    : 'Informational';
  const branchColor = assessment.branch === 'confirm_action'
    ? 'text-accent bg-accent/10'
    : 'text-muted bg-border/30';

  const isActionable = !!assessment.proposedAction && !!alertId && !!onAction;
  const actionTarget = assessment.proposedAction
    ? <ActionTargetSummary proposedAction={assessment.proposedAction} />
    : null;

  const handleAction = async (outcome: 'approve' | 'dismiss') => {
    if (!onAction || !alertId) return;
    setActionState('pending');
    try {
      await onAction(outcome, alertId);
      setActionState('done');
    } catch {
      setActionState('idle');
    }
  };

  if (assessment.branch === 'inform_only' && !assessment.proposedAction) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-foreground leading-relaxed">{assessment.summary}</p>
        {assessment.citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {assessment.citations.map((cite, i) => {
              const isUrl = cite.startsWith('http://') || cite.startsWith('https://');
              if (isUrl) {
                return (
                  <a
                    key={i}
                    href={cite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded hover:bg-accent/20 transition-colors"
                  >
                    Source {i + 1}
                  </a>
                );
              }
              return (
                <span key={i} className="text-[10px] text-muted bg-border/30 px-1.5 py-0.5 rounded">
                  {cite}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-border/10 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', branchColor)}>
          {branchLabel}
        </span>
      </div>
      <p className="text-xs text-foreground leading-relaxed">{assessment.summary}</p>
      {assessment.recommendation && (
        <div className="rounded border border-border bg-background/50 p-2">
          <div className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1">
            Recommendation
          </div>
          <p className="text-xs text-foreground">{assessment.recommendation}</p>
        </div>
      )}
      {assessment.proposedAction && (
        <div className="rounded border border-accent/20 bg-accent/5 p-2">
          <div className="text-[10px] font-medium text-accent uppercase tracking-wider mb-1">
            Suggested Change
          </div>
          <p className="text-xs text-foreground">{assessment.proposedAction.description}</p>
          {actionTarget && (
            <div className="mt-1.5">
              {actionTarget}
            </div>
          )}
        </div>
      )}
      {/* Inline action controls for confirm_action */}
      {isActionable && actionState === 'idle' && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => handleAction('approve')}
            aria-label="Approve"
            title="Approve"
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded font-medium transition-colors',
              'bg-green-500/15 text-green-400 hover:bg-green-500/25',
            )}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 8.25 6.5 11 12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleAction('dismiss')}
            aria-label="Dismiss"
            title="Dismiss"
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded transition-colors',
              'bg-red-500/15 text-red-400 hover:bg-red-500/25',
            )}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4 12 12M12 4 4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      {isActionable && actionState === 'pending' && (
        <div className="text-[10px] text-muted py-1">Processing...</div>
      )}
      {isActionable && actionState === 'done' && (
        <div className="space-y-1 rounded bg-green-500/10 px-2 py-1.5 text-center">
          <div className="text-[10px] text-green-400">
            {formatCompletedActionLabel(assessment.proposedAction?.actionType)}
          </div>
          {actionTarget && (
            <div className="flex justify-center">
              {actionTarget}
            </div>
          )}
        </div>
      )}
      {/* Suggestion-only label when no linked alert */}
      {assessment.proposedAction && !alertId && (
        <div className="text-[10px] text-muted italic py-0.5">
          Suggested only (no linked alert)
        </div>
      )}
      {assessment.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {assessment.citations.map((cite, i) => {
            const isUrl = cite.startsWith('http://') || cite.startsWith('https://');
            if (isUrl) {
              return (
                <a
                  key={i}
                  href={cite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded hover:bg-accent/20 transition-colors"
                >
                  Source {i + 1}
                </a>
              );
            }
            return (
              <span key={i} className="text-[10px] text-muted bg-border/30 px-1.5 py-0.5 rounded">
                {cite}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatCompletedActionLabel(actionType?: string): string {
  switch (actionType) {
    case 'add_comment':
      return 'Comment added';
    case 'change_state':
      return 'State updated';
    case 'escalate_priority':
      return 'Priority updated';
    case 'reassign_issue':
      return 'Issue reassigned';
    case 'flag_issue':
      return 'Issue flagged';
    default:
      return 'Action completed';
  }
}

function ActionTargetSummary({ proposedAction }: { proposedAction: FleetGraphProposedAction }) {
  const { data } = useDocumentContextQuery(proposedAction.targetEntityId);
  const target = data?.current;
  const targetLabel = target
    ? target.ticket_number
      ? `#${target.ticket_number} ${target.title}`
      : target.title
    : `${proposedAction.targetEntityType}:${proposedAction.targetEntityId.slice(0, 8)}`;

  return (
    <div className="text-[10px] text-muted">
      <span className="mr-1">Target:</span>
      <a
        href={`/documents/${proposedAction.targetEntityId}`}
        className="text-accent hover:underline"
      >
        {targetLabel}
      </a>
    </div>
  );
}

function DebugPopover({ debug }: { debug: FleetGraphChatDebugInfo }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="text-[10px] text-muted hover:text-foreground transition-colors"
          aria-label="Debug"
        >
          Debug
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-[10000] w-72 rounded-md border border-border bg-background p-3 shadow-lg space-y-2"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted uppercase tracking-wider">
              <TraceArrowsIcon className="w-3 h-3" />
              <span>Trace</span>
            </div>
            {debug.traceUrl ? (
              <a
                href={debug.traceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent"
              >
                <TraceArrowsIcon className="w-3 h-3 flex-shrink-0" />
                <span>Open trace</span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 17L17 7M9 7h8v8" />
                </svg>
              </a>
            ) : (
              <div className="text-xs text-muted">Unavailable</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Branch</div>
              <div className="text-foreground">{debug.branch}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Scope</div>
              <div className="text-foreground break-all">{debug.entityId ?? 'n/a'}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Total</div>
              <div className="text-foreground">{debug.accountability.total}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Overdue</div>
              <div className="text-foreground">{debug.accountability.overdue}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Due Today</div>
              <div className="text-foreground">{debug.accountability.dueToday}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Signals</div>
            <div className="text-xs text-foreground break-words">
              {debug.candidateSignals.length > 0 ? debug.candidateSignals.join(', ') : 'none'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Manager Items</div>
            <div className="text-xs text-foreground">{debug.managerActionItems}</div>
          </div>

          {debug.toolCalls && debug.toolCalls.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Tools</div>
              <div className="space-y-1">
                {debug.toolCalls.map((toolCall, index) => (
                  <div key={`${toolCall.name}-${index}`} className="rounded border border-border bg-background/50 p-2">
                    <div className="text-xs text-foreground">{toolCall.name}</div>
                    <div className="text-[10px] text-muted break-words">
                      {JSON.stringify(toolCall.arguments)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TraceArrowsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
    </svg>
  );
}

interface ChatBubbleProps {
  message: FleetGraphChatMessage;
  onAction?: (outcome: 'approve' | 'dismiss', alertId: string) => Promise<void>;
  alertId?: string;
}

function ChatBubble({ message, onAction, alertId }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const contentMatchesAssessmentSummary = !!message.assessment
    && message.content.trim() === message.assessment.summary.trim();
  const traceUrl = !isUser ? message.debug?.traceUrl ?? null : null;

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-lg px-2.5 py-1.5 space-y-1.5',
        isUser
          ? 'bg-accent/15 text-foreground'
          : 'bg-border/20 text-foreground',
      )}>
        {!contentMatchesAssessmentSummary && (
          <p className="text-xs leading-relaxed">{message.content}</p>
        )}
        {message.assessment && (
          <AssessmentResult
            assessment={message.assessment}
            onAction={onAction}
            alertId={alertId}
          />
        )}
        {!isUser && (message.debug || traceUrl) && (
          <div className="flex items-center justify-end gap-2">
            {traceUrl && (
              <a
                href={traceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-accent hover:underline"
              >
                Trace
              </a>
            )}
            {message.debug && <DebugPopover debug={message.debug} />}
          </div>
        )}
      </div>
    </div>
  );
}

function resolveMessageAlertId(
  message: FleetGraphChatMessage,
  activeAlerts: Array<{ id: string; summary: string; signalType: string; status: string }>,
): string | undefined {
  if (message.alertId) {
    return message.alertId;
  }

  if (!message.assessment?.proposedAction) {
    return undefined;
  }

  const matchingAlerts = activeAlerts.filter((alert) =>
    alert.status === 'active'
    && alert.signalType === 'chat_suggestion'
    && alert.summary === message.assessment?.summary,
  );

  if (matchingAlerts.length === 1) {
    return matchingAlerts[0]?.id;
  }

  return undefined;
}

export function FleetGraphChat({
  entityType,
  entityId,
  workspaceId,
  newThreadNonce = 0,
  scopeType,
  pageContext,
  onNewThread,
  persistAcrossScopes = false,
}: FleetGraphChatProps) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<FleetGraphChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHandledNewThreadNonceRef = useRef(newThreadNonce);
  const chat = useFleetGraphChat();
  const alertsQuery = useFleetGraphAlerts(entityType, entityId);
  const threadEntityType = persistAcrossScopes ? undefined : entityType;
  const threadEntityId = persistAcrossScopes ? undefined : entityId;
  const threadQuery = useFleetGraphThread(threadEntityType, threadEntityId);
  const createThread = useFleetGraphCreateThread(threadEntityType, threadEntityId);
  const resolve = useFleetGraphResolve();

  // Fence: track the entity that was active when mutation started
  const entityFenceRef = useRef({ entityType, entityId });
  const entityKey = useMemo(() => `${entityType}:${entityId}`, [entityType, entityId]);
  const threadKey = useMemo(
    () => (persistAcrossScopes ? `workspace:${workspaceId}` : `${threadEntityType}:${threadEntityId}`),
    [persistAcrossScopes, workspaceId, threadEntityType, threadEntityId],
  );
  useEffect(() => {
    entityFenceRef.current = { entityType, entityId };
  }, [entityType, entityId]);

  useEffect(() => {
    hydrated.current = false;
    setMessages([]);
    setThreadId(null);
  }, [threadKey]);

  const effectiveScopeType = scopeType ?? entityType;
  const entityLabel = ENTITY_LABELS[effectiveScopeType] ?? effectiveScopeType;
  const quickPrompts = QUICK_PROMPTS[effectiveScopeType] ?? [];

  // Hydrate from DB thread on mount / when thread data arrives
  const hydrated = useRef(false);
  useEffect(() => {
    if (!threadQuery.data) return;

    const { thread, messages: dbMessages } = threadQuery.data;
    if (!thread) return;
    const isCurrentThread = threadId === null || thread.id === threadId;

    if (!isCurrentThread) {
      return;
    }

    const shouldInitialHydrate = !hydrated.current && messages.length === 0;
    const shouldSyncLateDbMessages = hydrated.current
      && !chat.isPending
      && thread.id === threadId
      && dbMessages.length > messages.length;

    if (!shouldInitialHydrate && !shouldSyncLateDbMessages) {
      if (!hydrated.current && threadId === null) {
        setThreadId(thread.id);
        hydrated.current = true;
      }
      return;
    }

    setThreadId(thread.id);
    if (dbMessages.length > 0) {
      setMessages(dbMessages);
      console.log(`${LOG_PREFIX} hydrated messages`, {
        threadId: thread.id,
        count: dbMessages.length,
        messages: dbMessages,
      });
    }
    hydrated.current = true;
  }, [chat.isPending, messages.length, threadId, threadQuery.data]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleNewThread = useCallback(async () => {
    try {
      const result = await createThread.mutateAsync();
      setThreadId(result.thread.id);
      setMessages([]);
      hydrated.current = true; // prevent re-hydration from stale query
      console.log(`${LOG_PREFIX} new thread`, { threadId: result.thread.id });
      onNewThread?.();
    } catch {
      // Ignore — thread creation is non-critical
    }
  }, [createThread, onNewThread]);

  useEffect(() => {
    if (newThreadNonce <= lastHandledNewThreadNonceRef.current) return;
    lastHandledNewThreadNonceRef.current = newThreadNonce;
    handleNewThread();
  }, [handleNewThread, newThreadNonce]);

  const handleResolveAction = useCallback(async (outcome: 'approve' | 'dismiss', alertId: string) => {
    const msg = messages.find((m) => m.alertId === alertId || resolveMessageAlertId(m, alertsQuery.data?.alerts ?? []) === alertId);
    const action = msg?.assessment?.proposedAction;
    await resolve.mutateAsync({
      alertId,
      outcome,
      targetEntityType: action?.targetEntityType as FleetGraphEntityType | undefined,
      targetEntityId: action?.targetEntityId,
    });
  }, [resolve, messages, alertsQuery.data]);

  const runAnalysis = useCallback(async (q: string) => {
    if (!q.trim()) return;

    // Handle /new command
    if (q.trim().toLowerCase() === '/new') {
      setQuestion('');
      handleNewThread();
      return;
    }

    const callerKey = entityKey;

    const userMsg: FleetGraphChatMessage = {
      role: 'user',
      content: q.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    console.log(`${LOG_PREFIX} user message`, userMsg);
    setQuestion('');

    const livePageContext = buildLivePageContext(pageContext);

    try {
      const result = await chat.mutateAsync({
        entityType,
        entityId,
        workspaceId,
        question: q.trim(),
        threadId: threadId ?? undefined,
        pageContext: livePageContext,
      });

      // Discard result if entity changed while request was in-flight
      const currentKey = `${entityFenceRef.current.entityType}:${entityFenceRef.current.entityId}`;
      if (callerKey !== currentKey) return;

      if (result.threadId) {
        setThreadId(result.threadId);
      }

      if (result.message) {
        const assistantMessage = result.traceUrl && result.message.debug
          ? {
            ...result.message,
            debug: {
              ...result.message.debug,
              traceUrl: result.message.debug.traceUrl ?? result.traceUrl,
            },
          }
          : result.message;
        setMessages((prev) => [...prev, assistantMessage]);
        console.log(`${LOG_PREFIX} assistant message`, assistantMessage);
      }
    } catch (err) {
      const currentKey = `${entityFenceRef.current.entityType}:${entityFenceRef.current.entityId}`;
      if (callerKey !== currentKey) return;

      console.error(`${LOG_PREFIX} request failed`, {
        entityType,
        entityId,
        workspaceId,
        threadId,
        question: q.trim(),
        pageRoute: livePageContext?.route ?? null,
        error: err instanceof Error ? err.message : String(err),
      });

      const errorMsg: FleetGraphChatMessage = {
        role: 'assistant',
        content: 'Analysis failed. Try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, [entityType, entityId, entityKey, workspaceId, threadId, pageContext, chat, handleNewThread]);

  const handleSubmit = useCallback(() => {
    runAnalysis(question);
  }, [question, runAnalysis]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const activeAlerts = useMemo(
    () => (alertsQuery.data?.alerts ?? []).filter((alert) => alert.status === 'active'),
    [alertsQuery.data],
  );

  return (
    <div className="space-y-2">
      {/* Conversation history */}
      {messages.length > 0 && (
        <div className="space-y-1.5">
          <div
            ref={scrollRef}
            className="max-h-[240px] overflow-y-auto space-y-1.5 pr-0.5"
          >
            {messages.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                onAction={handleResolveAction}
                alertId={resolveMessageAlertId(msg, activeAlerts)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Analysis in progress */}
      {chat.isPending && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-border/20">
          <svg className="w-3.5 h-3.5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-muted">Analyzing {entityLabel}...</span>
        </div>
      )}

      {/* Quick prompts (shown when conversation is empty and not loading) */}
      {messages.length === 0 && !chat.isPending && quickPrompts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quickPrompts.map((prompt) => (
            <button
              type="button"
              key={prompt}
              onClick={() => runAnalysis(prompt)}
              className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:bg-border/30 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={messages.length > 0 ? 'Follow up... (or /new)' : `Analyze this ${entityLabel}...`}
          aria-label="FleetGraph analysis question"
          disabled={chat.isPending}
          className={cn(
            'flex-1 text-xs px-2.5 py-1.5 rounded border border-border bg-background',
            'text-foreground placeholder:text-muted/60',
            'focus:outline-none focus:border-accent/50',
            'disabled:opacity-50',
          )}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!question.trim() || chat.isPending}
          className={cn(
            'text-xs px-2.5 py-1.5 rounded font-medium transition-colors',
            'bg-accent text-white hover:bg-accent/90',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {messages.length > 0 ? 'Ask' : 'Analyze'}
        </button>
      </div>
    </div>
  );
}
