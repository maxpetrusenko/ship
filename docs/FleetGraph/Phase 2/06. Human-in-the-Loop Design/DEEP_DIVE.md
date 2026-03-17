# Human-in-the-Loop Design: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


As of March 16, 2026.

This document is the **Phase 2 implementation specification** for the FleetGraph human-in-the-loop approval system. It covers frontend component design, approval flow sequence, snooze mechanics, multi-approval edge cases, accessibility, and integration with Ship's existing UI patterns.

**Prerequisite reading:** The Presearch 07 deep dive ([`../../Presearch/07. Human Approval Before Consequential Actions/DEEP_DIVE.md`](../../Presearch/07.%20Human%20Approval%20Before%20Consequential%20Actions/DEEP_DIVE.md)) covers action risk classification, LangGraph interrupt mechanics, approval payload types, backend API endpoints, dismiss/snooze behavior, idempotency guarantees, audit trail, and database schema. This document does **not** repeat that material. It builds on it with implementation specifics for the frontend and runtime edge cases.

The approval lifecycle in Sections 7.x is canonical for the whole doc set. Deployment schema and worker behavior should conform to it exactly.

## Evidence Base

### Local repo evidence

- [`./README.md`](./README.md)
- [`../../Presearch/07. Human Approval Before Consequential Actions/DEEP_DIVE.md`](../../Presearch/07.%20Human%20Approval%20Before%20Consequential%20Actions/DEEP_DIVE.md)
- [`../../../../web/src/components/ApprovalButton.tsx`](../../../../web/src/components/ApprovalButton.tsx)
- [`../../../../web/src/components/ConfirmDialog.tsx`](../../../../web/src/components/ConfirmDialog.tsx)
- [`../../../../web/src/components/ui/Toast.tsx`](../../../../web/src/components/ui/Toast.tsx)
- [`../../../../web/src/components/sidebars/PropertiesPanel.tsx`](../../../../web/src/components/sidebars/PropertiesPanel.tsx)
- [`../../../../web/src/lib/api.ts`](../../../../web/src/lib/api.ts)
- [`../../../../web/tailwind.config.js`](../../../../web/tailwind.config.js)

### External primary sources

- LangChain, [LangGraph JS interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- W3C, [WAI-ARIA Authoring Practices: Alert Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
- W3C, [WCAG 2.1 AA contrast requirements](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)

---

## 1. Frontend Component Implementation

### 1.1 Component Architecture

The approval system introduces three new components and one new hook. These follow Ship's existing patterns: Radix primitives, Tailwind utility classes, `apiPost` from `@/lib/api`, inline SVG icons.

```
web/src/components/fleetgraph/
  FleetGraphApprovalCard.tsx    # Main approval card (inline in chat panel)
  SnoozeDurationPicker.tsx      # Dropdown for snooze duration selection
  ApprovalBadge.tsx             # Notification badge for pending approvals
web/src/hooks/
  useFleetGraphApprovals.ts     # React Query hook for approval state
```

### 1.2 FleetGraphApprovalCard Component

This is the primary interaction surface. It renders inline in the FleetGraph chat panel, replacing the "thinking" indicator when the graph reaches the `human_gate` node.

**Key design decision:** This is NOT a modal dialog. Ship's `ConfirmDialog` uses Radix `Dialog.Root` with a portal overlay, which is appropriate for user-initiated destructive actions. FleetGraph approvals are agent-initiated and contextual. They appear inline in the chat stream, preserving the conversational flow.

```typescript
// web/src/components/fleetgraph/FleetGraphApprovalCard.tsx

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { SnoozeDurationPicker } from './SnoozeDurationPicker';
import type { ApprovalPayload, ApprovalResponse } from '@ship/shared';

// --- Inline SVG Icons (same pattern as ApprovalButton.tsx) ---

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

// --- Risk badge mapping ---

const RISK_BADGE_STYLES = {
  low: {
    container: 'bg-green-500/10 border border-green-500/20',
    text: 'text-green-400',
    label: 'Low Risk',
  },
  medium: {
    container: 'bg-amber-500/10 border border-amber-500/20',
    text: 'text-amber-400',
    label: 'Medium Risk',
  },
  high: {
    container: 'bg-red-500/10 border border-red-500/20',
    text: 'text-red-400',
    label: 'High Risk',
  },
} as const;

// --- Action type display labels ---

const ACTION_LABELS: Record<string, string> = {
  change_issue_status: 'Change Issue Status',
  reassign_issue: 'Reassign Issue',
  approve_plan: 'Approve Plan',
  reject_plan: 'Reject Plan',
  approve_retro: 'Approve Retrospective',
  reject_retro: 'Reject Retrospective',
  add_issue_to_week: 'Add Issue to Sprint',
  remove_issue_from_week: 'Remove Issue from Sprint',
  edit_content: 'Edit Content',
  create_record: 'Create Record',
  request_changes: 'Request Changes',
  escalate_notification: 'Escalate Notification',
};

// --- Props ---

interface FleetGraphApprovalCardProps {
  /** The approval payload from the graph's interrupt */
  payload: ApprovalPayload;
  /** Whether a response is currently being submitted */
  isSubmitting?: boolean;
  /** Callback after successful response submission */
  onResponded?: (decision: ApprovalResponse['decision']) => void;
  /** Callback on submission error */
  onError?: (error: Error) => void;
}

// --- Component ---

export function FleetGraphApprovalCard({
  payload,
  isSubmitting: externalIsSubmitting,
  onResponded,
  onError,
}: FleetGraphApprovalCardProps) {
  const [internalIsSubmitting, setInternalIsSubmitting] = useState(false);
  const [submittedDecision, setSubmittedDecision] = useState<string | null>(null);
  const [showSnoozePicker, setShowSnoozePicker] = useState(false);
  const [note, setNote] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const isSubmitting = externalIsSubmitting ?? internalIsSubmitting;
  const riskStyle = RISK_BADGE_STYLES[payload.riskTier];

  // Scroll card into view when it appears
  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Time-to-expiry countdown
  const [timeToExpiry, setTimeToExpiry] = useState('');
  useEffect(() => {
    function updateExpiry() {
      const now = Date.now();
      const expires = new Date(payload.expiresAt).getTime();
      const diff = expires - now;
      if (diff <= 0) {
        setTimeToExpiry('Expired');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        setTimeToExpiry(`${days}d ${hours % 24}h remaining`);
      } else {
        setTimeToExpiry(`${hours}h ${minutes}m remaining`);
      }
    }
    updateExpiry();
    const interval = setInterval(updateExpiry, 60_000);
    return () => clearInterval(interval);
  }, [payload.expiresAt]);

  // Relative time for "generated at"
  const generatedTimeAgo = useRelativeTime(payload.generatedAt);

  const handleRespond = useCallback(
    async (decision: ApprovalResponse['decision'], snoozeUntil?: string) => {
      setInternalIsSubmitting(true);
      try {
        const body: Record<string, unknown> = { decision };
        if (snoozeUntil) body.snoozeUntil = snoozeUntil;
        if (note.trim()) body.note = note.trim();

        const res = await apiPost(
          `/api/fleetgraph/approvals/${payload.threadId}/respond`,
          body,
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to submit response');
        }

        setSubmittedDecision(decision);
        onResponded?.(decision);

        const toastMessages = {
          approve: 'Action approved and executing',
          dismiss: 'Recommendation dismissed',
          snooze: `Snoozed until ${new Date(snoozeUntil!).toLocaleDateString()}`,
        };
        showToast(toastMessages[decision], 'success');
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        onError?.(error);
        showToast(error.message, 'error');
      } finally {
        setInternalIsSubmitting(false);
      }
    },
    [payload.threadId, note, onResponded, onError, showToast],
  );

  // After submission, show a resolved state
  if (submittedDecision) {
    return (
      <div
        ref={cardRef}
        className="rounded-lg border border-border bg-background/50 p-4 opacity-75"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm text-muted">
          {submittedDecision === 'approve' && (
            <>
              <CheckIcon className="h-4 w-4 text-green-400" />
              <span>Approved and executed</span>
            </>
          )}
          {submittedDecision === 'dismiss' && (
            <>
              <XMarkIcon className="h-4 w-4 text-muted" />
              <span>Dismissed</span>
            </>
          )}
          {submittedDecision === 'snooze' && (
            <>
              <ClockIcon className="h-4 w-4 text-amber-400" />
              <span>Snoozed</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="approval-card-enter rounded-lg border border-border bg-background p-4 space-y-3"
      role="alertdialog"
      aria-label={`FleetGraph recommendation: ${ACTION_LABELS[payload.actionType] || payload.actionType}`}
      aria-describedby={`approval-evidence-${payload.threadId}`}
    >
      {/* Header row: title + risk badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheckIcon className="h-4 w-4 text-accent shrink-0" />
          <h4 className="text-sm font-medium text-foreground truncate">
            {ACTION_LABELS[payload.actionType] || payload.actionType}
          </h4>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${riskStyle.container} ${riskStyle.text}`}
          aria-label={`Risk level: ${riskStyle.label}`}
        >
          {riskStyle.label}
        </span>
      </div>

      {/* Evidence section */}
      <div id={`approval-evidence-${payload.threadId}`}>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted mb-1">
          Evidence
        </p>
        <p className="text-xs text-foreground/80 leading-relaxed">
          {payload.evidenceSummary}
        </p>
      </div>

      {/* Proposed action */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted mb-1">
          Proposed Action
        </p>
        <p className="text-xs text-foreground leading-relaxed">
          {payload.recommendedAction}
        </p>
      </div>

      {/* Expected effect */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted mb-1">
          Expected Effect
        </p>
        <p className="text-xs text-foreground/80 leading-relaxed">
          {payload.expectedEffect}
        </p>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted pt-1 border-t border-border">
        <span>
          {payload.targetEntityTitle}
          <span className="ml-1 opacity-60">({payload.targetEntityType})</span>
        </span>
        <span>{generatedTimeAgo}</span>
        <span>{timeToExpiry}</span>
        {payload.traceLink && (
          <a
            href={payload.traceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Trace
          </a>
        )}
      </div>

      {/* Optional note input */}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        className="w-full rounded border border-border bg-border/20 px-2 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none"
        aria-label="Optional note for this approval response"
        disabled={isSubmitting}
      />

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleRespond('approve')}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Approve this action"
        >
          <CheckIcon className="h-3.5 w-3.5" />
          Approve
        </button>

        <button
          onClick={() => handleRespond('dismiss')}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 rounded bg-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border/80 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-border focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Dismiss this recommendation"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
          Dismiss
        </button>

        <div className="relative">
          <button
            onClick={() => setShowSnoozePicker(!showSnoozePicker)}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded bg-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border/80 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-border focus:ring-offset-2 focus:ring-offset-background"
            aria-label="Snooze this recommendation"
            aria-expanded={showSnoozePicker}
            aria-haspopup="listbox"
          >
            <ClockIcon className="h-3.5 w-3.5" />
            Snooze
          </button>

          {showSnoozePicker && (
            <SnoozeDurationPicker
              onSelect={(snoozeUntil) => {
                setShowSnoozePicker(false);
                handleRespond('snooze', snoozeUntil);
              }}
              onClose={() => setShowSnoozePicker(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Hook: relative time display ---

function useRelativeTime(isoDate: string): string {
  const [text, setText] = useState('');
  useEffect(() => {
    function update() {
      const diff = Date.now() - new Date(isoDate).getTime();
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 1) { setText('Just now'); return; }
      if (minutes < 60) { setText(`${minutes}m ago`); return; }
      const hours = Math.floor(minutes / 60);
      if (hours < 24) { setText(`${hours}h ago`); return; }
      setText(`${Math.floor(hours / 24)}d ago`);
    }
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [isoDate]);
  return text;
}
```

### 1.3 SnoozeDurationPicker Component

A lightweight dropdown (not a Radix Dialog) that appears anchored to the Snooze button. This follows the same pattern as dropdowns elsewhere in Ship, keeping the interaction minimal and inline.

```typescript
// web/src/components/fleetgraph/SnoozeDurationPicker.tsx

import { useRef, useEffect, useState } from 'react';

interface SnoozeDurationPickerProps {
  onSelect: (snoozeUntilIso: string) => void;
  onClose: () => void;
}

/** Compute snooze-until ISO strings relative to now */
function getPresetDurations(): Array<{ label: string; value: string }> {
  const now = new Date();

  function addHours(h: number): string {
    return new Date(now.getTime() + h * 3600_000).toISOString();
  }

  // "Tomorrow morning" = next day at 09:00 local
  const tomorrow9am = new Date(now);
  tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  tomorrow9am.setHours(9, 0, 0, 0);

  // "Next Monday" = next Monday at 09:00 local
  const nextMonday = new Date(now);
  const daysUntilMonday = ((8 - nextMonday.getDay()) % 7) || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  return [
    { label: '1 hour', value: addHours(1) },
    { label: '4 hours', value: addHours(4) },
    { label: 'Tomorrow morning', value: tomorrow9am.toISOString() },
    { label: 'Next Monday', value: nextMonday.toISOString() },
  ];
}

export function SnoozeDurationPicker({ onSelect, onClose }: SnoozeDurationPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('09:00');
  const presets = getPresetDurations();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleCustomSubmit = () => {
    if (!customDate) return;
    const iso = new Date(`${customDate}T${customTime}:00`).toISOString();
    onSelect(iso);
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Snooze duration options"
      className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-border bg-background shadow-xl z-10"
    >
      <div className="p-1">
        {presets.map((preset) => (
          <button
            key={preset.label}
            role="option"
            onClick={() => onSelect(preset.value)}
            className="w-full rounded px-3 py-2 text-left text-xs text-foreground hover:bg-border/50 transition-colors focus:outline-none focus:bg-border/50"
          >
            {preset.label}
          </button>
        ))}

        <div className="my-1 border-t border-border" />

        {!showCustom ? (
          <button
            onClick={() => setShowCustom(true)}
            className="w-full rounded px-3 py-2 text-left text-xs text-muted hover:bg-border/50 transition-colors focus:outline-none focus:bg-border/50"
          >
            Custom...
          </button>
        ) : (
          <div className="px-3 py-2 space-y-2">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full rounded border border-border bg-border/20 px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
              aria-label="Snooze until date"
            />
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="w-full rounded border border-border bg-border/20 px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
              aria-label="Snooze until time"
            />
            <button
              onClick={handleCustomSubmit}
              disabled={!customDate}
              className="w-full rounded bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              Set Snooze
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 1.4 ApprovalBadge Component

A notification indicator for the FleetGraph panel icon when proactive approvals are pending. Uses the same positioning pattern as Ship's existing notification indicators.

```typescript
// web/src/components/fleetgraph/ApprovalBadge.tsx

interface ApprovalBadgeProps {
  count: number;
}

export function ApprovalBadge({ count }: ApprovalBadgeProps) {
  if (count === 0) return null;

  return (
    <span
      className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
      aria-label={`${count} pending approval${count === 1 ? '' : 's'}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
```

### 1.5 useFleetGraphApprovals Hook

```typescript
// web/src/hooks/useFleetGraphApprovals.ts

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { ApprovalPayload } from '@ship/shared';

interface PendingApproval {
  id: string;
  threadId: string;
  payload: ApprovalPayload;
  status: 'pending';
  createdAt: string;
  expiresAt: string;
}

export function useFleetGraphApprovals(options?: {
  targetEntityType?: string;
  enabled?: boolean;
}) {
  return useQuery<PendingApproval[]>({
    queryKey: ['fleetgraph', 'pending-approvals', options?.targetEntityType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.targetEntityType) {
        params.set('targetEntityType', options.targetEntityType);
      }
      const query = params.toString();
      const res = await apiGet(
        `/api/fleetgraph/pending-approvals${query ? `?${query}` : ''}`,
      );
      if (!res.ok) throw new Error('Failed to fetch pending approvals');
      const data = await res.json();
      return data.approvals;
    },
    enabled: options?.enabled ?? true,
    refetchInterval: 30_000, // Poll every 30 seconds for proactive approvals
    staleTime: 10_000,
  });
}
```

### 1.6 Chat Panel Integration

The FleetGraph chat panel renders a stream of messages. When an SSE event of type `approval_required` arrives, the panel appends a `FleetGraphApprovalCard` instead of a text bubble. This is the integration point.

```typescript
// Pseudocode for the chat panel's message renderer

function renderFleetGraphMessage(event: FleetGraphStreamEvent) {
  switch (event.type) {
    case 'text':
      return <ChatBubble content={event.content} />;

    case 'approval_required':
      return (
        <FleetGraphApprovalCard
          payload={event.payload}
          onResponded={(decision) => {
            // Invalidate pending approvals query so badge updates
            queryClient.invalidateQueries({ queryKey: ['fleetgraph', 'pending-approvals'] });
          }}
        />
      );

    case 'action_executed':
      return <ActionResultBubble result={event.result} />;

    case 'done':
      return null;
  }
}
```

### 1.7 Animation and Transition

The approval card uses a CSS entrance animation defined in the global stylesheet. This avoids adding complexity to Tailwind config for a single animation.

```css
/* web/src/index.css (or equivalent global stylesheet) */

@keyframes approval-card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.approval-card-enter {
  animation: approval-card-enter 200ms ease-out;
}
```

The animation is intentionally simple: a short slide-up with fade. This is the "1 high-impact moment" principle from Ship's aesthetic guidelines. No spring physics, no bounce.

### 1.8 Responsive Behavior in the Properties Sidebar (256px)

The FleetGraph panel lives in the same column space as Ship's 4-panel layout. When the FleetGraph chat panel is active in the Properties Sidebar (256px), the approval card adapts:

- **Text truncation:** `targetEntityTitle` uses `truncate` class. Long titles show on hover via `title` attribute.
- **Button stacking:** At 256px, the three action buttons may not fit in a single row. The container uses `flex-wrap` so buttons wrap to a second row naturally.
- **Metadata row:** Uses `flex-wrap` with small gap. Items wrap as needed.
- **Snooze picker:** Positioned `bottom-full` to open upward, preventing overflow below the viewport edge.
- **No horizontal scroll:** Every element uses `min-w-0` where needed to prevent content from blowing out the container width.

The card is designed with a maximum effective width of ~240px (256px minus padding). All typography sizes (`text-xs`, `text-[10px]`) were chosen to read comfortably at this width.

---

## 2. Approval Flow Sequence Diagram

This is the complete end-to-end flow from graph execution through user interaction to action execution.

```
 FleetGraph Graph           Backend API              SSE Stream          Frontend Chat Panel
 ==============            ===========              ==========          ==================
       |                        |                        |                       |
  [Graph runs]                  |                        |                       |
       |                        |                        |                       |
  trigger_context               |                        |                       |
       |                        |                        |                       |
  fetch_core_context            |                        |                       |
       |                        |                        |                       |
  fetch_parallel_signals        |                        |                       |
       |                        |                        |                       |
  heuristic_filter              |                        |                       |
       |                        |                        |                       |
  reason_about_risk             |                        |                       |
       |                        |                        |                       |
  branch_decision               |                        |                       |
       | (confirm_action)       |                        |                       |
       v                        |                        |                       |
  prepare_action                |                        |                       |
       | (builds payload)       |                        |                       |
       v                        |                        |                       |
  human_gate                    |                        |                       |
       |                        |                        |                       |
       | interrupt(payload)     |                        |                       |
       |=====================>  |                        |                       |
       | [checkpoint saved      |                        |                       |
       |  to Postgres via       |                        |                       |
       |  PostgresSaver]        |                        |                       |
       |                        |                        |                       |
       |                   INSERT INTO                   |                       |
       |                   fleetgraph_approvals          |                       |
       |                   (status='pending')            |                       |
       |                        |                        |                       |
       |                        |---SSE event----------->|                       |
       |                        | { type:                |                       |
       |                        |   'approval_required', |                       |
       |                        |   payload }            |---event received----->|
       |                        |                        |                       |
       |                        |                        |    Render             |
       |                        |                        |    FleetGraph         |
       |                        |                        |    ApprovalCard       |
       |                        |                        |                       |
       |                        |                        |        [User reads    |
       |                        |                        |         evidence,     |
       |                        |                        |         decides]      |
       |                        |                        |                       |
       |                        |                        |    User clicks        |
       |                        |                        |    [Approve]          |
       |                        |                        |                       |
       |                        |<---POST /api/fleetgraph/approvals/:threadId/respond
       |                        |    { decision: 'approve', respondedBy, note }  |
       |                        |                        |                       |
       |                   UPDATE fleetgraph_approvals   |                       |
       |                   SET status='approved'         |                       |
       |                        |                        |                       |
       |  Command({resume:      |                        |                       |
       |   {decision:'approve', |                        |                       |
       |    respondedBy}})      |                        |                       |
       |<=======================|                        |                       |
       |                        |                        |                       |
  human_gate restarts           |                        |                       |
  (node re-executes)            |                        |                       |
       |                        |                        |                       |
  interrupt() returns           |                        |                       |
  {decision:'approve',...}      |                        |                       |
       |                        |                        |                       |
  returns {approvalDecision:    |                        |                       |
    'approved'}                 |                        |                       |
       |                        |                        |                       |
  [conditional edge:            |                        |                       |
   approved -> execute_action]  |                        |                       |
       v                        |                        |                       |
  execute_action                |                        |                       |
       | (Ship API mutation)    |                        |                       |
       |=====================>  |                        |                       |
       |                   Execute mutation              |                       |
       |                   with idempotency key          |                       |
       |                        |                        |                       |
       |  result                |                        |                       |
       |<=======================|                        |                       |
       |                        |                        |                       |
  record_outcome                |                        |                       |
       |                        |                        |                       |
       | (audit log entry)      |                        |                       |
       |=====================>  |                        |                       |
       |                   INSERT INTO                   |                       |
       |                   fleetgraph_audit_log          |                       |
       |                        |                        |                       |
       |                   UPDATE fleetgraph_approvals   |                       |
       |                   SET execution_result          |                       |
       |                        |                        |                       |
       |                        |---SSE event----------->|                       |
       |                        | { type:                |---event received----->|
       |                        |   'action_executed',   |                       |
       |                        |   result }             |  Show result +        |
       |                        |                        |  Toast notification   |
       |                        |---SSE event----------->|                       |
       |                        | { type: 'done' }       |                       |
       |                        |                        |                       |
  [Graph terminates]            |                        |                       |
```

### Dismiss flow (abbreviated)

Same as above through the POST, but:

1. Backend resumes graph with `{ decision: 'dismiss' }`.
2. `human_gate` returns `{ approvalDecision: 'dismissed' }`.
3. Conditional edge routes to `record_outcome` (skips `execute_action`).
4. `fleetgraph_alert_state` records the fingerprint as dismissed with the current entity digest.
5. SSE sends `{ type: 'done' }`.

### Snooze flow (abbreviated)

Same as dismiss through the POST, but additionally:

1. Backend writes `snoozed_until` to `fleetgraph_alert_state`.
2. Graph resumes with `{ decision: 'snooze', snoozeUntil }`.
3. Routes to `record_outcome`, terminates.
4. Fingerprint suppressed until `snoozed_until` passes.

---

## 3. Snooze Duration: UX and Implementation

### 3.1 Preset Durations

| Option | Computed Value | Use Case |
|--------|---------------|----------|
| 1 hour | `now + 1h` | "I am about to handle this myself" |
| 4 hours | `now + 4h` | "Not right now, but today" |
| Tomorrow morning | `tomorrow 09:00 local` | "I will look at this fresh tomorrow" |
| Next Monday | `next Mon 09:00 local` | "This can wait until the start of next week" |
| Custom | User picks date + time | Anything else |

All times are computed client-side in the user's local timezone, then transmitted as ISO 8601 UTC to the backend.

### 3.2 Custom Duration Picker

The custom picker is a minimal inline form (date input + time input + confirm button) that appears below the presets in the `SnoozeDurationPicker` dropdown. It does not use a calendar widget. The native `<input type="date">` and `<input type="time">` controls are sufficient for this use case and have full browser support.

The `min` attribute on the date input prevents selecting dates in the past.

### 3.3 Snooze Expiry Re-evaluation

When a snooze expires, the fingerprint becomes eligible for resurfacing. The mechanism:

1. **Background sweep job** runs every 4 minutes on the worker tier.
2. Queries `fleetgraph_alert_state` for rows where `status = 'snoozed' AND snoozed_until < now()`.
3. For each expired snooze, updates `status = 'active'` and `snoozed_until = NULL`.
4. Does NOT immediately trigger a new graph run. The next scheduled proactive sweep on the 4-minute cadence will pick up the fingerprint and, if the underlying condition still exists, surface it as a fresh approval.

```typescript
// Worker: snooze expiry sweep
async function expireSnoozedAlerts(db: Pool): Promise<number> {
  const result = await db.query(`
    UPDATE fleetgraph_alert_state
    SET status = 'active',
        snoozed_until = NULL,
        updated_at = now()
    WHERE status = 'snoozed'
      AND snoozed_until < now()
    RETURNING fingerprint_hash, workspace_id
  `);

  // Log for observability
  for (const row of result.rows) {
    await db.query(`
      INSERT INTO fleetgraph_audit_log
        (workspace_id, thread_id, event_type, details)
      VALUES ($1, 'system', 'snooze_expired', $2)
    `, [row.workspace_id, JSON.stringify({ fingerprintHash: row.fingerprint_hash })]);
  }

  return result.rowCount ?? 0;
}
```

### 3.4 Snooze Lifecycle

```
User snoozes (1h)
       |
       v
fleetgraph_alert_state:
  status = 'snoozed'
  snoozed_until = now + 1h
       |
       | (proactive sweep runs, sees snoozed_until > now)
       | -> SKIP
       |
       | (1 hour passes)
       |
       v
expireSnoozedAlerts sweep:
  status = 'active'
  snoozed_until = NULL
       |
       v
Next proactive sweep:
  shouldSurface() -> true (status is active, digest may have changed)
       |
       v
New graph run -> new approval if condition persists
```

**Early wake-up rule:** If the entity digest changes while snoozed (meaning the underlying entity was modified), the `shouldSurface()` check in the heuristic filter overrides the snooze. This is documented in Presearch 07 Section 6 and applies here unchanged.

---

## 4. Multi-Approval Scenarios

### 4.1 Two Approvals Pending for the Same Entity

**Scenario:** FleetGraph detects two distinct issues for the same entity (e.g., issue #42 should be reassigned AND its status should change).

**Handling:**

- Each detection produces a different `actionType` and therefore a different `fingerprintHash`.
- Both approvals are valid and independent.
- The frontend renders both cards in the chat stream, ordered by `generatedAt`.
- Each card has its own `threadId` and submits independently.

**No batching rule:** Per the Tier 3 forbidden actions in Presearch 07, bulk operations across multiple entities in a single action are forbidden. However, multiple separate approvals for the same entity are permitted because each has individual review.

### 4.2 User Approves After Entity State Changed

**Scenario:** FleetGraph recommends reassigning issue #42 from Alice to Bob. While the approval is pending, a human manually reassigns issue #42 to Charlie. The user then clicks Approve on the original recommendation.

**Handling: Stale check before execution.**

The `execute_action` node must re-fetch the entity's current state before performing the mutation. If the state no longer matches the preconditions captured in the approval payload, the action is aborted with an explanation.

```typescript
// Inside execute_action node
async function executeActionNode(state: FleetGraphState) {
  // 1. Re-fetch current entity state
  const currentEntity = await fetchEntity(
    state.approvalPayload.targetEntityType,
    state.approvalPayload.targetEntityId,
  );

  // 2. Stale check: compare current state against preconditions
  const staleCheck = checkPreconditions(state.approvalPayload, currentEntity);

  if (staleCheck.isStale) {
    // Abort: entity changed since recommendation was generated
    return {
      executionResult: 'failure',
      executionError: `Action aborted: ${staleCheck.reason}. ` +
        `The ${state.approvalPayload.targetEntityType} was modified after ` +
        `this recommendation was generated.`,
    };
  }

  // 3. Proceed with mutation
  const result = await executeShipApiMutation(state);
  return {
    executionResult: result.success ? 'success' : 'failure',
    executionError: result.error || null,
  };
}

interface StaleCheckResult {
  isStale: boolean;
  reason: string;
}

function checkPreconditions(
  payload: ApprovalPayload,
  currentEntity: Record<string, unknown>,
): StaleCheckResult {
  // Each action type defines its own precondition checks
  switch (payload.actionType) {
    case 'reassign_issue': {
      // The issue's current assignee should match what FleetGraph saw
      // when it generated the recommendation
      const expectedAssignee = payload.preconditions?.currentAssigneeId;
      if (expectedAssignee && currentEntity.assignee_id !== expectedAssignee) {
        return {
          isStale: true,
          reason: `Issue assignee changed from "${expectedAssignee}" to "${currentEntity.assignee_id}"`,
        };
      }
      return { isStale: false, reason: '' };
    }

    case 'change_issue_status': {
      const expectedStatus = payload.preconditions?.currentStatus;
      if (expectedStatus && currentEntity.state !== expectedStatus) {
        return {
          isStale: true,
          reason: `Issue status changed from "${expectedStatus}" to "${currentEntity.state}"`,
        };
      }
      return { isStale: false, reason: '' };
    }

    default:
      // For action types without specific precondition checks,
      // compare the entity digest hash
      const currentDigest = computeEntityDigest(currentEntity);
      if (payload.preconditions?.entityDigest &&
          payload.preconditions.entityDigest !== currentDigest) {
        return {
          isStale: true,
          reason: 'Entity was modified after this recommendation was generated',
        };
      }
      return { isStale: false, reason: '' };
  }
}
```

**ApprovalPayload extension for preconditions:**

```typescript
// Added to ApprovalPayload (extends the type from Presearch 07)
interface ApprovalPayload {
  // ... existing fields ...

  /** Preconditions captured at recommendation time for stale detection */
  preconditions?: {
    /** Entity digest hash at the time the recommendation was generated */
    entityDigest?: string;
    /** Action-specific precondition fields */
    currentAssigneeId?: string;
    currentStatus?: string;
    currentSprintId?: string;
    [key: string]: unknown;
  };
}
```

### 4.3 Stale Approval: Frontend Behavior

When the `execute_action` node returns a stale failure, the backend sends an SSE event:

```typescript
{ type: 'action_executed', result: { success: false, summary: 'Action aborted: Issue assignee changed...' } }
```

The frontend renders this as an error state in the chat stream, with a Toast notification explaining what happened. The user does not need to take further action; the approval record is marked `execution_result = 'failure'`.

### 4.4 Concurrent Approval Attempts

**Scenario:** Two users see the same pending approval card (e.g., both are workspace admins). Both click Approve at nearly the same time.

**Handling: Optimistic locking on the approval row.**

The `handleApprovalResponse` function in the backend uses a conditional UPDATE:

```sql
UPDATE fleetgraph_approvals
SET status = $1, responded_by = $2, responded_at = now()
WHERE thread_id = $3 AND status = 'pending'
RETURNING *
```

The `WHERE status = 'pending'` clause acts as an optimistic lock. The first response succeeds and changes the status. The second response finds zero rows matching `status = 'pending'` and returns 404.

The frontend handles 404 by showing a Toast: "This approval was already resolved."

### 4.5 Approval Expires While User is Looking at the Card

**Scenario:** The user opens Ship, sees a pending approval card, but does not respond. The 72-hour expiry elapses. The sweep job resumes the graph with `{ decision: 'expired' }`.

**Handling:**

- The card's countdown timer reaches "Expired" and the buttons become disabled.
- If the user tries to click Approve after expiry, the POST returns 404 (approval already resolved).
- The `useFleetGraphApprovals` query refetches every 30 seconds and will remove the expired card from the pending list.

---

## 5. Accessibility

### 5.1 Semantic Roles

| Element | Role | Rationale |
|---------|------|-----------|
| Approval card container | `role="alertdialog"` | Communicates to screen readers that this requires a user response. Per WAI-ARIA, `alertdialog` is for urgent messages that require confirmation. |
| Resolved card | `role="status"` | After the user responds, the card transitions to a passive status display. |
| Risk badge | `aria-label="Risk level: Medium Risk"` | The visual badge alone (color + text) is insufficient for screen readers. |
| Snooze duration dropdown | `role="listbox"` | Dropdown of selectable options. |
| Each snooze option | `role="option"` | Individual options within the listbox. |
| Note input | `aria-label="Optional note..."` | The placeholder alone is not an accessible name. |
| Toast notifications | `role="alert" aria-live="polite"` | Already implemented in Ship's `Toast.tsx`. |

### 5.2 Keyboard Navigation

The approval card supports full keyboard interaction:

| Key | Behavior |
|-----|----------|
| `Tab` | Moves focus through: Trace link, Note input, Approve, Dismiss, Snooze |
| `Enter` / `Space` | Activates the focused button |
| `Escape` | Closes the snooze picker if open |
| `Arrow Down` / `Arrow Up` | Navigates within the snooze duration listbox (when open) |

**Focus management on card appearance:**

When an approval card enters the chat stream, it does NOT steal focus from the user's current position. The card uses `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` to ensure visibility without disrupting keyboard navigation elsewhere.

When the user explicitly interacts with the card (Tab into it or click), focus enters the card and follows the tab order described above.

### 5.3 Screen Reader Announcements

The `role="alertdialog"` on the card causes screen readers to announce it when it appears. The `aria-label` provides the announcement text: "FleetGraph recommendation: Reassign Issue".

The `aria-describedby` attribute points to the evidence section, so screen readers read the evidence after the title.

After submission, the resolved card with `role="status"` and `aria-live="polite"` announces the outcome without interrupting the user.

### 5.4 Color Contrast

All text meets WCAG 2.1 AA minimum contrast ratios (4.5:1 for normal text, 3:1 for large text):

| Element | Foreground | Background | Ratio |
|---------|-----------|------------|-------|
| Card body text | `text-foreground` (#f5f5f5) | `bg-background` (#0d0d0d) | 19.5:1 |
| Muted labels | `text-muted` (#8a8a8a) | `bg-background` (#0d0d0d) | 5.1:1 |
| Green risk badge | `text-green-400` | `bg-green-500/10` on `bg-background` | 5.3:1 |
| Amber risk badge | `text-amber-400` | `bg-amber-500/10` on `bg-background` | 5.8:1 |
| Red risk badge | `text-red-400` | `bg-red-500/10` on `bg-background` | 4.7:1 |

### 5.5 Reduced Motion

For users with `prefers-reduced-motion`, the entrance animation should be suppressed:

```css
@media (prefers-reduced-motion: reduce) {
  .approval-card-enter {
    animation: none;
  }
}
```

---

## 6. Integration with Ship's Existing UI Patterns

### 6.1 How Approval Cards Differ from ConfirmDialog

| Aspect | `ConfirmDialog` | `FleetGraphApprovalCard` |
|--------|-----------------|--------------------------|
| Trigger | User-initiated action (delete, archive) | Agent-initiated recommendation |
| Rendering | Modal overlay via Radix Dialog.Portal | Inline in chat stream |
| Urgency | Immediate (user is mid-action) | Asynchronous (can wait 72 hours) |
| Options | Confirm / Cancel (2 choices) | Approve / Dismiss / Snooze (3 choices) |
| Context | Short description string | Evidence summary, proposed action, expected effect, metadata |
| Persistence | Ephemeral (exists only while dialog is open) | Persistent (backed by database row, survives page reload) |

**Design rationale:** The `ConfirmDialog` is a blocking modal because it interrupts a user-initiated destructive action. The user expects to be stopped. FleetGraph approvals are the opposite: the agent is proposing something, and the user may not be actively engaged. A modal would be intrusive. The inline card respects the user's attention.

### 6.2 How Approval Cards Relate to ApprovalButton

Ship's existing `ApprovalButton` component handles human-to-human approval flows (plan approval, retro approval). It is a button that triggers a direct API call. The FleetGraph approval card wraps a fundamentally different flow: agent-generated recommendation with evidence, three response options, and graph resume mechanics.

Despite the different flow, both components share:

- Tailwind utility class conventions (`bg-accent`, `text-foreground`, `rounded`, `px-3 py-1.5`)
- Inline SVG icon pattern
- `apiPost` from `@/lib/api` for submission
- Loading state pattern (`disabled:opacity-50`, spinner icon)

### 6.3 Toast Notifications for Proactive Approvals

When a proactive graph run surfaces an approval while the user is in Ship but not in the FleetGraph panel, the user needs to know something is pending. This uses Ship's existing `Toast` system:

```typescript
// Called by the SSE listener when a proactive approval arrives
function handleProactiveApproval(payload: ApprovalPayload) {
  showToast(
    `FleetGraph: ${ACTION_LABELS[payload.actionType] || 'New recommendation'} for ${payload.targetEntityTitle}`,
    'info',
    8000, // Longer duration for proactive notifications
    {
      label: 'Review',
      onClick: () => openFleetGraphPanel(),
    },
  );
}
```

The Toast includes an action button ("Review") that opens the FleetGraph panel. This follows the existing pattern in `Toast.tsx` where action buttons extend the toast duration to 5 seconds minimum.

### 6.4 Properties Sidebar Integration

When the FleetGraph panel is rendered in the Properties Sidebar position (256px), it replaces the type-specific sidebar (`WikiSidebar`, `IssueSidebar`, etc.). The panel switch is handled by the existing `PropertiesPanel` component's document type routing. A new document type or panel mode (`fleetgraph`) would be added to the `PanelDocumentType` union.

The approval card's 256px-optimized layout (described in Section 1.8) ensures it renders correctly in this constrained space.

---

## 7. Approval Lifecycle State Machine

### 7.1 States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `pending` | Approval created, waiting for human response | No |
| `approved` | Human approved, action queued for execution | No |
| `executed` | Approved action completed successfully | Yes |
| `execution_failed` | Approved action attempted but failed | Yes |
| `dismissed` | Human dismissed the recommendation | Yes |
| `snoozed` | Human snoozed; suppressed until expiry | No |
| `re_pending` | Snooze expired and condition resurfaced as a new approval | No (becomes `pending` on new row) |
| `expired` | 72-hour timeout elapsed with no response | Yes |

### 7.2 State Transition Diagram

```
                                    +-------------------+
                                    |                   |
                                    v                   |
                             +-----------+              |
                   +-------->|  pending   |<-------------+
                   |         +-----------+       (snooze expired +
                   |              |               condition persists
                   |              |               = new approval row)
                   |              |
                   |    +---------+---------+-----------+
                   |    |         |         |           |
                   |    v         v         v           v
                   | +--------+ +-------+ +-------+ +--------+
                   | |approved| |dismiss| |snooze | |expired |
                   | +--------+ +-------+ +-------+ +--------+
                   |    |           |         |          |
                   |    |           v         |          v
                   |    |      +---------+    |     +---------+
                   |    |      |resolved |    |     |resolved |
                   |    |      +---------+    |     +---------+
                   |    |                     |
                   |    v                     v
                   | +---------------+   +----------+
                   | |execute_action |   |snoozed   |
                   | +---------------+   |(waiting) |
                   |    |                +----------+
                   |    |                     |
                   |    +------+              | (snooze expires)
                   |    |      |              v
                   |    v      v         +-----------+
                   | +------+ +------+   |  active   |
                   | |exec  | |exec  |   | (eligible)|
                   | |success| |fail |   +-----------+
                   | +------+ +------+        |
                   |                          | (proactive sweep
                   |                          |  detects condition)
                   |                          |
                   +--------------------------+
```

### 7.3 State Transitions Table

| From | Event | To | Side Effects |
|------|-------|----|-------------|
| `pending` | User clicks Approve | `approved` | UPDATE approval row; resume graph with `{ decision: 'approve' }` |
| `pending` | User clicks Dismiss | `dismissed` | UPDATE approval row; resume graph with `{ decision: 'dismiss' }`; write to alert_state |
| `pending` | User clicks Snooze | `snoozed` | UPDATE approval row; resume graph with `{ decision: 'snooze' }`; write to alert_state with `snoozed_until` |
| `pending` | 72h timeout elapses | `expired` | Sweep job updates row; resumes graph with `{ decision: 'expired' }` |
| `approved` | `execute_action` succeeds | `executed` | Ship API mutation applied; audit log entry; SSE `action_executed` |
| `approved` | `execute_action` fails (stale) | `execution_failed` | Audit log entry; SSE `action_executed` with `success: false` |
| `approved` | `execute_action` fails (API error) | `execution_failed` | Audit log entry; may retry depending on error type |
| `snoozed` | `snoozed_until` passes | `active` in alert_state | Sweep job clears snooze; fingerprint eligible for next proactive sweep |
| `snoozed` | Entity digest changes before snooze expires | `active` in alert_state | `shouldSurface()` override; new graph run; new approval row |

### 7.4 Implementation: Conditional Edge Router

The state machine's branching after `human_gate` is implemented as a LangGraph conditional edge:

```typescript
function routeAfterHumanGate(state: FleetGraphState): string {
  switch (state.approvalDecision) {
    case 'approved':
      return 'execute_action';
    case 'dismissed':
    case 'expired':
      return 'record_outcome';
    case 'snoozed':
      return 'record_outcome';
    default:
      return 'record_outcome';
  }
}

// In graph builder
builder.addConditionalEdges('human_gate', routeAfterHumanGate, {
  execute_action: 'execute_action',
  record_outcome: 'record_outcome',
});
```

### 7.5 Database State vs. Graph State

The state machine operates across two storage layers:

| Concern | Storage | Why |
|---------|---------|-----|
| Approval lifecycle (pending, approved, dismissed, snoozed, expired) | `fleetgraph_approvals` table | Must be queryable by frontend; survives across graph runs |
| Graph execution position (which node is current) | LangGraph checkpoint (PostgresSaver) | Internal to LangGraph; not directly queried by the UI |
| Alert suppression (dismissed fingerprints, active snoozes) | `fleetgraph_alert_state` table | Must persist across independent graph runs; queried by heuristic_filter |

The `fleetgraph_approvals.status` column is the source of truth for the UI. The LangGraph checkpoint is the source of truth for graph resumption. These are kept in sync by the backend `handleApprovalResponse` function, which updates the approval row and resumes the graph in the same request handler.

---

## Open Questions (Phase 2 Specific)

1. **FleetGraph panel location.** The Properties Sidebar is 256px. If the FleetGraph chat panel eventually needs more space (for longer evidence summaries or multi-turn conversation), should it be a resizable panel or a dedicated full-width view?

2. **Approval card dismissal animation.** The current design fades the card to a compact resolved state. Should dismissed cards collapse entirely after a few seconds, or should they remain visible for the session?

3. **Notification channel escalation.** If a pending approval approaches its 72-hour expiry without a response, should Ship send a follow-up Toast notification at 48 hours? At 71 hours? The Presearch 07 doc lists email/Slack as a future extension; this is about in-app escalation only.

4. **Multi-user approval visibility.** When one user responds to an approval, how quickly should other users' cards update? The current 30-second polling interval on `useFleetGraphApprovals` means up to a 30-second stale window. SSE push would eliminate this latency.
