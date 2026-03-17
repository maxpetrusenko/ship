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
  useFleetGraphThread,
  useFleetGraphCreateThread,
  useFleetGraphResolve,
} from '@/hooks/useFleetGraph';
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
  /** Optional scope label shown in chat header. */
  scopeLabel?: string;
  /** Scope type for workspace-level analysis. */
  scopeType?: FleetGraphScopeType;
  /** Page context injected into every chat turn. */
  pageContext?: FleetGraphPageContext;
  /** Called when a new thread is created (so parent can react). */
  onNewThread?: () => void;
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

  const isActionable = assessment.branch === 'confirm_action' && assessment.proposedAction && alertId && onAction;

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
        </div>
      )}
      {/* Inline action controls for confirm_action */}
      {isActionable && actionState === 'idle' && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            onClick={() => handleAction('approve')}
            className={cn(
              'text-[11px] px-2.5 py-1 rounded font-medium transition-colors',
              'bg-accent text-white hover:bg-accent/90',
            )}
          >
            Approve
          </button>
          <button
            onClick={() => handleAction('dismiss')}
            className={cn(
              'text-[11px] px-2 py-1 rounded transition-colors',
              'bg-border/40 text-muted hover:text-foreground hover:bg-border/60',
            )}
          >
            Dismiss
          </button>
        </div>
      )}
      {isActionable && actionState === 'pending' && (
        <div className="text-[10px] text-muted py-1">Processing...</div>
      )}
      {isActionable && actionState === 'done' && (
        <div className="text-[10px] text-green-400 bg-green-500/10 px-2 py-1 rounded text-center">
          Action completed
        </div>
      )}
      {/* Suggestion-only label when no linked alert */}
      {assessment.branch === 'confirm_action' && assessment.proposedAction && !alertId && (
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
            <div className="text-[10px] font-medium text-muted uppercase tracking-wider">Trace</div>
            {debug.traceUrl ? (
              <a
                href={debug.traceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent break-all"
              >
                {debug.traceUrl}
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
        {!isUser && message.debug && (
          <div className="flex justify-end">
            <DebugPopover debug={message.debug} />
          </div>
        )}
      </div>
    </div>
  );
}

export function FleetGraphChat({
  entityType,
  entityId,
  workspaceId,
  scopeLabel,
  scopeType,
  pageContext,
  onNewThread,
}: FleetGraphChatProps) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<FleetGraphChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [latestAlertId, setLatestAlertId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chat = useFleetGraphChat();
  const threadQuery = useFleetGraphThread();
  const createThread = useFleetGraphCreateThread();
  const resolve = useFleetGraphResolve();

  // Fence: track the entity that was active when mutation started
  const entityFenceRef = useRef({ entityType, entityId });
  const entityKey = useMemo(() => `${entityType}:${entityId}`, [entityType, entityId]);
  useEffect(() => {
    entityFenceRef.current = { entityType, entityId };
  }, [entityType, entityId]);

  const effectiveScopeType = scopeType ?? entityType;
  const entityLabel = ENTITY_LABELS[effectiveScopeType] ?? effectiveScopeType;
  const quickPrompts = QUICK_PROMPTS[effectiveScopeType] ?? [];

  // Hydrate from DB thread on mount / when thread data arrives
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    if (!threadQuery.data) return;

    const { thread, messages: dbMessages } = threadQuery.data;
    if (thread) {
      setThreadId(thread.id);
      if (dbMessages.length > 0) {
        setMessages(dbMessages);
      }
    }
    hydrated.current = true;
  }, [threadQuery.data]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset conversation when entity changes
  useEffect(() => {
    setMessages([]);
    // Keep threadId — the thread persists across entity switches.
    // The server stores pageContext per turn so it knows the current entity.
  }, [entityType, entityId]);

  const handleNewThread = useCallback(async () => {
    try {
      const result = await createThread.mutateAsync();
      setThreadId(result.thread.id);
      setMessages([]);
      hydrated.current = true; // prevent re-hydration from stale query
      onNewThread?.();
    } catch {
      // Ignore — thread creation is non-critical
    }
  }, [createThread, onNewThread]);

  const handleResolveAction = useCallback(async (outcome: 'approve' | 'dismiss', alertId: string) => {
    await resolve.mutateAsync({ alertId, outcome });
  }, [resolve]);

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
    setQuestion('');

    try {
      const result = await chat.mutateAsync({
        entityType,
        entityId,
        workspaceId,
        question: q.trim(),
        threadId: threadId ?? undefined,
        pageContext,
      });

      // Discard result if entity changed while request was in-flight
      const currentKey = `${entityFenceRef.current.entityType}:${entityFenceRef.current.entityId}`;
      if (callerKey !== currentKey) return;

      if (result.threadId) {
        setThreadId(result.threadId);
      }

      // Track latest alert ID for actionable controls
      if (result.alerts?.length > 0) {
        setLatestAlertId(result.alerts[0].id);
      }

      if (result.message) {
        setMessages((prev) => [...prev, result.message]);
      }
    } catch {
      const currentKey = `${entityFenceRef.current.entityType}:${entityFenceRef.current.entityId}`;
      if (callerKey !== currentKey) return;

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

  return (
    <div className="space-y-2">
      {/* Scope label badge (when provided) */}
      {scopeLabel && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted uppercase tracking-wider font-medium">Scope</span>
          <span className="text-[10px] text-foreground bg-border/40 px-1.5 py-0.5 rounded truncate max-w-[200px]">
            {scopeLabel}
          </span>
        </div>
      )}

      {/* Conversation history */}
      {messages.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted uppercase tracking-wider font-medium">
              Conversation ({messages.length})
            </span>
            <button
              onClick={handleNewThread}
              disabled={createThread.isPending}
              className="text-[10px] text-muted hover:text-foreground transition-colors disabled:opacity-40"
            >
              New Thread
            </button>
          </div>
          <div
            ref={scrollRef}
            className="max-h-[240px] overflow-y-auto space-y-1.5 pr-0.5"
          >
            {messages.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                onAction={handleResolveAction}
                alertId={latestAlertId ?? undefined}
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
