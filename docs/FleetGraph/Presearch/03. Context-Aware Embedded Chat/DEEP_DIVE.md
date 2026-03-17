# Context-Aware Embedded Chat: Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


As of March 16, 2026.

## Scope

This document covers everything an engineer needs to implement FleetGraph's embedded chat panel inside Ship's existing UI. It covers: where the panel lives in the 4-panel layout, how page context flows from frontend to graph, what gets preloaded per entity type, the chat API endpoint design, streaming architecture, approval card integration, and comparison with how Notion, Asana, and ClickUp handle the same problem.

## Evidence Base

### Local repo evidence

- `web/src/pages/App.tsx` (4-panel layout, icon rail, contextual sidebar, properties portal)
- `web/src/components/Editor.tsx` (properties sidebar portal rendering, collapse behavior)
- `web/src/components/UnifiedEditor.tsx` (document type routing, sidebar composition)
- `web/src/components/sidebars/PropertiesPanel.tsx` (unified sidebar, panel props per type)
- `web/src/components/sidebars/QualityAssistant.tsx` (existing AI sidebar pattern: quiet fetch, CSRF, polling)
- `api/src/routes/claude.ts` (context API: standup/review/retro context loading)
- `api/src/routes/ai.ts` (AI analysis routes, rate limiting, status check)
- `api/src/routes/associations.ts` (document context tree: ancestors, children, siblings)
- `FLEETGRAPH.md` (agent responsibility, on-demand context loading rules)

### External primary sources

- LangGraph JS, [Streaming](https://langchain-ai.github.io/langgraphjs/how-tos/stream-tokens/) (token-level SSE from graph nodes)
- LangGraph JS, [Persistence and memory](https://langchain-ai.github.io/langgraphjs/concepts/persistence/) (thread-based conversation state)
- Notion AI Agent, [Notion blog](https://www.notion.com/blog/notion-ai) (current-page context injection, inline assistant)
- Asana AI Teammates, [Asana blog](https://blog.asana.com/2024/10/ai-teammates/) (role-scoped agents, project-aware context)
- ClickUp AI, [ClickUp docs](https://clickup.com/ai) (task-scoped assistant, embedded in task view)
- Microsoft Copilot in Planner, [Microsoft blog](https://techcommunity.microsoft.com/blog/planner/copilot-in-planner/) (plan-aware assistant, SSE streaming)

---

## 1. Ship's 4-Panel Layout and Where FleetGraph Lives

### Current layout (from `App.tsx` and `document-model-conventions.md`)

```
+--------+----------------+---------------------------------+----------------+
|        |                | Header: <- Badge Title   Saved  |                |
|  Icon  |   Contextual   +---------------------------------+   Properties   |
|  Rail  |    Sidebar     |                                 |    Sidebar     |
|        |                |   Large Title                   |                |
|  48px  |    224px       |   Body content...               |     256px      |
|        |  (mode list)   |                                 |  (doc props)   |
|        |                |         (flex-1)                |                |
+--------+----------------+---------------------------------+----------------+
```

All four panels always visible. Properties sidebar renders via React Portal into `<aside id="properties-portal">` in `App.tsx:549`.

### Where FleetGraph chat goes

FleetGraph occupies the properties sidebar slot. It does **not** add a 5th panel, because:

1. Ship's layout is fixed at 4 panels. Adding a 5th would break the responsive behavior and the documented layout contract.
2. The properties sidebar already has a collapse/expand toggle (stored in `localStorage` as `ship:rightSidebarCollapsed`). FleetGraph reuses this mechanism.
3. The existing QualityAssistant already renders inside the properties sidebar, proving the pattern works for AI features.

The implementation adds a **tab system** to the properties sidebar: one tab for "Properties" (current content) and one tab for "FleetGraph" (chat panel). This is the minimum-disruption approach.

### Component hierarchy

```
App.tsx
  <aside id="properties-portal">          // Portal target
    Editor.tsx (createPortal into above)
      <div className="w-64">              // Properties sidebar container
        <PropertiesSidebarTabs>            // NEW: tab switcher
          <TabPanel id="properties">
            <PropertiesPanel ... />        // Existing
          </TabPanel>
          <TabPanel id="fleetgraph">
            <FleetGraphPanel ... />        // NEW
          </TabPanel>
        </PropertiesSidebarTabs>
      </div>
```

### Tab header design

Two icon tabs at the top of the 256px sidebar. Not text tabs (too wide for 256px).

```tsx
// PropertiesSidebarTabs.tsx
<div className="flex h-10 items-center border-b border-border px-3 gap-1">
  <button
    className={cn('h-7 w-7 rounded flex items-center justify-center',
      activeTab === 'properties' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-foreground'
    )}
    onClick={() => setActiveTab('properties')}
    aria-label="Properties"
  >
    <SlidersIcon className="w-4 h-4" />
  </button>
  <button
    className={cn('h-7 w-7 rounded flex items-center justify-center',
      activeTab === 'fleetgraph' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-foreground'
    )}
    onClick={() => setActiveTab('fleetgraph')}
    aria-label="FleetGraph"
  >
    <SparklesIcon className="w-4 h-4" />
    {hasUnreadInsight && <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full" />}
  </button>
  <div className="flex-1" />
  <CollapseButton />
</div>
```

The `hasUnreadInsight` dot signals proactive findings without interrupting the user.

---

## 2. Context Injection Architecture

### Frontend payload shape

When FleetGraph panel mounts (or the user switches to its tab), the frontend constructs a context payload from data already available in the React component tree. No new API call is needed for the initial context envelope; the page component already has the document loaded.

```typescript
// shared/src/types/fleetgraph.ts

interface FleetGraphContext {
  entityType: 'issue' | 'sprint' | 'project';
  entityId: string;
  workspaceId: string;
  actorUserId: string;
}
```

This matches the contract already defined in `FLEETGRAPH.md:132-138`.

### How it flows

```
Page component (e.g., Issues.tsx)
  |
  | has: document object, sidebarData, workspaceId, userId
  |
  v
UnifiedEditor
  |
  | passes document.id, document.document_type as props
  |
  v
PropertiesPanel / FleetGraphPanel
  |
  | constructs FleetGraphContext from props
  |
  v
POST /api/fleetgraph/chat
  |
  | server enriches context by calling existing Ship APIs internally
  |
  v
LangGraph on-demand graph execution
```

The frontend sends the thin `FleetGraphContext` envelope. The backend does the heavy context loading. This keeps the frontend simple and avoids duplicating context-loading logic across three page types.

### Per-entity context (what gets passed from the page)

**Issue page:** The `UnifiedEditor` already receives the full issue document as its `document` prop (type `IssueDocument` from `UnifiedEditor.tsx:48-63`), which includes: `id`, `state`, `priority`, `estimate`, `assignee_id`, `assignee_name`, `program_id`, `sprint_id`, `source`, `belongs_to[]`. The frontend passes only `entityId` and `entityType`; the backend fetches the rest server-side.

**Week (sprint) page:** The `SprintDocument` is loaded with: `id`, `status`, `program_id`, `owner_id`, `plan`, `plan_approval`, `review_approval`, `issue_count`, `completed_count`. Again, the frontend passes the thin envelope.

**Project page:** The `ProjectDocument` includes: `id`, `impact`, `confidence`, `ease`, `ice_score`, `color`, `program_id`, `owner_id`, `accountable_id`, `consulted_ids`, `informed_ids`, `sprint_count`, `issue_count`. Thin envelope to backend.

---

## 3. Existing Ship API Routes That Support Context Loading

### `GET /api/claude/context` (from `api/src/routes/claude.ts`)

This is the existing context API. It already does exactly what FleetGraph needs: given an entity type and ID, it loads the full context chain including program, project, sprint, standups, issues, and review data.

**Current parameters:**
```
?context_type=standup&sprint_id=UUID    -> getStandupContext()
?context_type=review&sprint_id=UUID     -> getReviewContext()
?context_type=retro&project_id=UUID     -> getRetroContext()
```

**What it returns per type:**

| context_type | Returns |
|---|---|
| `standup` | sprint (id, title, number, status, plan), program (id, name, description, goals), project (id, name, plan, ICE scores), recent standups (last 5), issues (stats + top 10), clarifying questions |
| `review` | Same as standup + ALL standups + detailed issue stats (mid-sprint additions, cancellations) + existing review document |
| `retro` | project details + program + all sprints + sprint reviews + recent standups (last 20) + project-level issue stats + existing retro |

### What needs to be added

The existing context API covers sprint and project contexts well but does not have an `issue` context type. FleetGraph needs:

```typescript
// New context_type: 'issue'
?context_type=issue&issue_id=UUID
```

This should return:
- Issue details (all properties)
- Issue history (recent changes from `document_history`)
- Linked sprint context (if issue belongs to a sprint)
- Linked project context (if issue belongs to a project)
- Issue associations (parent, children, related via `document_associations`)
- Assignee details

### Other relevant existing APIs

| Route | What it provides | Used for |
|---|---|---|
| `GET /api/documents/:id/context` | Ancestor chain, children, siblings | Breadcrumb context, relationship understanding |
| `GET /api/issues/:id` | Full issue with all properties | Issue entity details |
| `GET /api/issues/:id/history` | State change history | Understanding drift patterns |
| `GET /api/weeks/:id` | Sprint details with issues | Sprint-level context |
| `GET /api/weeks/:id/issues` | All issues for a sprint | Sprint health assessment |
| `GET /api/projects/:id` | Full project with ICE, owner, sprints | Project-level context |
| `GET /api/projects/:id/sprints` | All sprints for project | Project timeline |
| `GET /api/team/accountability-grid-v3` | Team workload and accountability | Ownership gap detection |
| `GET /api/accountability/action-items` | Outstanding action items | Accountability signals |

### Recommendation: extend `claude.ts`, do not create a new route file

The `claude.ts` file already implements the pattern of "given entity type + ID, load everything the AI needs." FleetGraph should add a `context_type: 'fleetgraph'` with sub-parameter `entity_type` to this file, or create a parallel `api/src/routes/fleetgraph.ts` that imports the same context-loading functions.

The cleanest approach: create `api/src/routes/fleetgraph.ts` that imports shared context helpers extracted from `claude.ts`. This avoids bloating the existing file and keeps FleetGraph concerns isolated.

---

## 4. Chat UX Design

### First message behavior

The first message in a FleetGraph conversation must already understand the page. The user should never see "What would you like help with?" as the opening prompt.

When the FleetGraph tab opens, the panel immediately shows a context-aware greeting and initial assessment. This is the "proactive first turn" pattern used by Notion AI and Copilot in Planner.

**Issue view first message example:**
```
Looking at ISS-42: "Fix login timeout handling"

This issue has been in_progress for 6 days with no standup
mentions since Tuesday. It's assigned to Alex Chen but
the linked sprint (Week 12) closes in 2 days.

Risk: likely to carry over. Ask me about unblocking it
or reassigning.
```

**Implementation:** The first turn is a `POST /api/fleetgraph/chat` with an empty `messages` array but a populated `context` field. The graph treats an empty message history as "generate an initial assessment." This is equivalent to the proactive mode's `reason_about_risk` node, but scoped to the single entity.

### Conversation history

**Rolling window:** Keep the last 20 message pairs (user + assistant) per thread. Older messages are summarized into a `conversation_summary` field that gets prepended to the system prompt on each turn. This prevents token bloat while preserving long-running conversation state.

**Thread identity:** Each thread is keyed by `(workspaceId, userId, entityType, entityId)`. Navigating away from an issue and back restores the conversation. Different entities get different threads.

**Storage:** Threads are stored server-side via LangGraph's persistence layer (checkpoint saver). The frontend does not persist messages; it fetches the thread state on panel mount.

### Streaming responses

Ship does not currently use SSE or WebSocket for AI responses (the existing `QualityAssistant` uses polling). FleetGraph introduces SSE for chat streaming because:

1. Chat requires token-by-token display for perceived responsiveness
2. LangGraph natively supports SSE streaming via `.streamEvents()`
3. The existing WebSocket infrastructure is reserved for Yjs collaboration; mixing chat into it would add protocol complexity

**Frontend streaming implementation:**

```typescript
// hooks/useFleetGraphChat.ts

async function sendMessage(message: string, context: FleetGraphContext) {
  const response = await fetch(`${API_URL}/api/fleetgraph/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    credentials: 'include',
    body: JSON.stringify({
      thread_id: threadId,
      message,
      context,
    }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    // Parse SSE format: "data: {...}\n\n"
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        const event = JSON.parse(line.slice(6));
        handleStreamEvent(event);
      }
    }
  }
}
```

**Stream event types:**

```typescript
type FleetGraphStreamEvent =
  | { type: 'token'; content: string }                    // Streaming text token
  | { type: 'context_loaded'; summary: string }           // Context fetch complete
  | { type: 'reasoning_start'; node: string }             // Graph node entered
  | { type: 'approval_card'; action: ApprovalAction }     // HITL gate reached
  | { type: 'done'; thread_id: string }                   // Stream complete
  | { type: 'error'; message: string }                    // Error occurred
```

### Human approval cards in the chat flow

When FleetGraph reaches a human gate node (any consequential action), the stream emits an `approval_card` event. The frontend renders this as an inline card within the chat message list:

```tsx
// FleetGraphApprovalCard.tsx
<div className="rounded border border-border bg-background p-3 my-2">
  <div className="text-xs text-muted mb-1">FleetGraph wants to:</div>
  <p className="text-sm font-medium text-foreground">{action.description}</p>
  <p className="text-xs text-muted mt-1">{action.rationale}</p>
  <div className="flex gap-2 mt-3">
    <button
      onClick={() => handleApproval(action.id, 'approve')}
      className="px-3 py-1 text-xs rounded bg-green-500/10 text-green-500 hover:bg-green-500/20"
    >
      Approve
    </button>
    <button
      onClick={() => handleApproval(action.id, 'dismiss')}
      className="px-3 py-1 text-xs rounded bg-border text-muted hover:text-foreground"
    >
      Dismiss
    </button>
    <button
      onClick={() => handleApproval(action.id, 'snooze')}
      className="px-3 py-1 text-xs rounded bg-border text-muted hover:text-foreground"
    >
      Snooze 24h
    </button>
  </div>
</div>
```

Approval decisions are sent to `POST /api/fleetgraph/approval` which resumes the paused graph execution. See [Presearch 07: Human Approval](../07.%20Human%20Approval%20Before%20Consequential%20Actions/README.md) for the full approval design.

---

## 5. Frontend Component Architecture

### New files

```
web/src/components/fleetgraph/
  FleetGraphPanel.tsx           // Main panel component (chat container)
  FleetGraphMessage.tsx         // Individual message rendering
  FleetGraphApprovalCard.tsx    // HITL approval card
  FleetGraphInput.tsx           // Chat input with submit
  FleetGraphContextBadge.tsx    // Shows what entity context is loaded
  PropertiesSidebarTabs.tsx     // Tab switcher for Properties/FleetGraph

web/src/hooks/
  useFleetGraphChat.ts          // SSE streaming, message state, thread management
  useFleetGraphContext.ts       // Builds FleetGraphContext from current page
```

### `FleetGraphPanel.tsx` (main panel)

```typescript
interface FleetGraphPanelProps {
  entityType: 'issue' | 'sprint' | 'project';
  entityId: string;
}

function FleetGraphPanel({ entityType, entityId }: FleetGraphPanelProps) {
  const { workspaceId } = useWorkspace();
  const { user } = useAuth();
  const {
    messages,
    isStreaming,
    sendMessage,
    loadThread,
  } = useFleetGraphChat();

  // Load existing thread on mount or entity change
  useEffect(() => {
    loadThread({ entityType, entityId, workspaceId, actorUserId: user.id });
  }, [entityType, entityId]);

  return (
    <div className="flex flex-col h-full">
      <FleetGraphContextBadge entityType={entityType} entityId={entityId} />
      <div className="flex-1 overflow-auto px-3 py-2 space-y-3">
        {messages.map((msg) => (
          <FleetGraphMessage key={msg.id} message={msg} />
        ))}
      </div>
      <FleetGraphInput
        onSubmit={sendMessage}
        disabled={isStreaming}
        placeholder={`Ask about this ${entityType}...`}
      />
    </div>
  );
}
```

### Integration into `Editor.tsx`

The `Editor.tsx` component already accepts a `sidebar` prop (React node) and renders it via portal into `#properties-portal`. The modification is in `UnifiedEditor.tsx` where the sidebar is composed.

Current code in `UnifiedEditor.tsx:361-369`:
```typescript
return (
  <PropertiesPanel
    document={document as PanelDocument}
    panelProps={panelProps}
    onUpdate={onUpdate as (updates: Partial<PanelDocument>) => Promise<void>}
    highlightedFields={missingFields}
    weeklyReviewState={weeklyReviewState}
  />
);
```

Modified to wrap with tabs:
```typescript
return (
  <PropertiesSidebarTabs
    propertiesContent={
      <PropertiesPanel
        document={document as PanelDocument}
        panelProps={panelProps}
        onUpdate={onUpdate}
        highlightedFields={missingFields}
        weeklyReviewState={weeklyReviewState}
      />
    }
    fleetGraphContent={
      isFleetGraphEntity(document.document_type) ? (
        <FleetGraphPanel
          entityType={mapDocTypeToEntityType(document.document_type)}
          entityId={document.id}
        />
      ) : null
    }
  />
);
```

Where `isFleetGraphEntity` returns true for `issue`, `sprint`, and `project` document types. Wiki, program, person, and weekly plan/retro types do not get the FleetGraph tab (no properties sidebar tab for FleetGraph on those types).

### `useFleetGraphChat` hook

```typescript
interface UseFleetGraphChatReturn {
  messages: FleetGraphMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  loadThread: (context: FleetGraphContext) => Promise<void>;
  clearThread: () => void;
}

interface FleetGraphMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  approvalCard?: ApprovalAction;
  isStreaming?: boolean;
}
```

The hook uses the same `quietFetch` pattern from `QualityAssistant.tsx` for non-critical requests that must not trigger session expiration redirects. This prevents the FleetGraph panel from forcibly logging users out if their session expires mid-stream.

---

## 6. Backend Chat Endpoint Design

### Route: `POST /api/fleetgraph/chat`

```typescript
// api/src/routes/fleetgraph.ts

interface ChatRequest {
  thread_id?: string;              // Null for new conversation
  message?: string;                // Null for initial assessment (first turn)
  context: {
    entityType: 'issue' | 'sprint' | 'project';
    entityId: string;
  };
}
```

**Response:** SSE stream (`Content-Type: text/event-stream`).

**Flow:**

1. Auth middleware validates session
2. Extract `workspaceId` and `userId` from session
3. If no `thread_id`, create new LangGraph thread
4. Load entity context using existing context helpers (extracted from `claude.ts`)
5. Invoke LangGraph with context + message history + new message
6. Stream events back as SSE

```typescript
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  const { thread_id, message, context } = req.body;
  const workspaceId = req.workspaceId!;
  const userId = req.userId!;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    // 1. Load entity context
    const entityContext = await loadFleetGraphContext(
      context.entityType,
      context.entityId,
      workspaceId,
    );

    res.write(`data: ${JSON.stringify({ type: 'context_loaded', summary: entityContext.summary })}\n\n`);

    // 2. Build or resume thread
    const threadConfig = {
      configurable: {
        thread_id: thread_id || `${workspaceId}:${userId}:${context.entityType}:${context.entityId}`,
      },
    };

    // 3. Stream graph execution
    const stream = await graph.streamEvents(
      {
        messages: message ? [{ role: 'human', content: message }] : [],
        entity_context: entityContext,
        actor: { userId, workspaceId },
      },
      { ...threadConfig, streamMode: 'messages' },
    );

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream') {
        res.write(`data: ${JSON.stringify({ type: 'token', content: event.data.chunk.content })}\n\n`);
      }
      if (event.event === 'on_custom_event' && event.name === 'approval_required') {
        res.write(`data: ${JSON.stringify({ type: 'approval_card', action: event.data })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', thread_id: threadConfig.configurable.thread_id })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Graph execution failed' })}\n\n`);
  } finally {
    res.end();
  }
});
```

### Route: `GET /api/fleetgraph/thread/:threadId`

Returns the message history for a thread. Used when the user navigates back to an entity and the FleetGraph panel needs to restore the conversation.

```typescript
router.get('/thread/:threadId', authMiddleware, async (req, res) => {
  const threadId = req.params.threadId;
  const state = await graph.getState({ configurable: { thread_id: threadId } });
  res.json({ messages: state.values.messages });
});
```

### Route: `POST /api/fleetgraph/approval`

```typescript
interface ApprovalRequest {
  thread_id: string;
  action_id: string;
  decision: 'approve' | 'dismiss' | 'snooze';
  snooze_until?: string;     // ISO timestamp, only for snooze
}
```

Resumes the paused LangGraph thread with the human decision injected into graph state.

### Rate limiting

Follow the existing pattern from `ai.ts`: per-user rate limit. FleetGraph should allow 30 chat messages per user per hour (more generous than the 10/hr for plan analysis because chat is the primary interaction mode).

---

## 7. Context Preloading Strategy

### What gets fetched before the first LLM call

Context loading happens server-side in the `loadFleetGraphContext` function. It runs **before** the graph's reasoning node executes. The LLM never sees a blank context.

| Entity type | Preloaded data | Source API / Query |
|---|---|---|
| **Issue** | Issue properties (state, priority, assignee, estimate) | `issues` table direct query |
| | Issue history (last 10 state changes) | `document_history` table |
| | Parent sprint (if any): status, plan, approval state | `document_associations` + `documents` |
| | Parent project (if any): name, owner, ICE scores | `document_associations` + `documents` |
| | Sibling issues in same sprint (count + high-priority list) | Sprint issues query |
| | Recent standup mentions of this issue | `standups` content search |
| **Sprint** | Sprint properties (status, plan, approval states) | `documents` table |
| | All issues with stats (done/in_progress/todo/blocked) | Reuse `getStandupContext` from `claude.ts` |
| | Recent standups (last 5) | Reuse `getStandupContext` from `claude.ts` |
| | Existing review document (if any) | Reuse `getReviewContext` from `claude.ts` |
| | Parent project context | `document_associations` + `documents` |
| | Scope changes since plan approval | Issue `added_mid_sprint` flags |
| | Approval state (plan and review) | Sprint properties |
| **Project** | Project properties (ICE, plan, owner, accountable) | `documents` table |
| | All sprints with outcomes | Reuse `getRetroContext` from `claude.ts` |
| | Issue stats (total/done/active/cancelled) | Reuse `getRetroContext` from `claude.ts` |
| | Recent standups (last 20 across sprints) | Reuse `getRetroContext` from `claude.ts` |
| | Sprint reviews | Reuse `getRetroContext` from `claude.ts` |
| | Active accountability items | `/api/accountability/action-items` |
| | Ownership chain (owner, accountable, reports_to) | Person documents |

### Loading priority order (from `FLEETGRAPH.md:149-153`)

1. Current entity first
2. Nearby graph second (direct associations)
3. Wider project only when needed (deferred to graph expansion nodes)

### Token budget

Preloaded context should fit within 4,000 tokens after compression. The strategy:
- Issue names and states: compact key-value pairs, not full documents
- Standup content: last 3 only, truncated to 200 chars each
- Issue list: stats summary + top 5 flagged issues, not full list
- Plan/retro content: first 500 chars only

The reasoning node can request deeper context via tool calls if needed (fetching full standup content, complete issue history, etc.).

---

## 8. Comparison with Product Patterns

### Notion AI Agent

**What they do:** Notion's AI agent operates from the current page. When invoked on a project page, it has access to the page content, linked databases, and sub-pages. It uses the page as the root context and expands outward.

**What Ship should take:** The "page is the context" principle. FleetGraph should never ask "which project are you working on?" because the answer is already on screen. Notion also streams responses token-by-token, which FleetGraph adopts.

**What Ship should not take:** Notion's agent is general-purpose (writing, summarizing, brainstorming). FleetGraph is scoped to execution drift detection. A narrower scope means a more useful first response.

### Asana AI Teammates

**What they do:** Asana creates role-shaped agents (project manager, designer, etc.) that each have a specific responsibility scope. Agents are aware of the project they're assigned to and monitor it proactively.

**What Ship should take:** The role-scoping pattern. FleetGraph is not "Ship AI." It is specifically the execution-drift agent. This matches `FLEETGRAPH.md:5-8`. Asana also separates proactive monitoring from on-demand queries, exactly as FleetGraph's two modes do.

**What Ship should not take:** Asana requires explicit agent creation and assignment. FleetGraph should be zero-config: it exists on every issue/sprint/project page automatically.

### ClickUp AI

**What they do:** ClickUp embeds an AI assistant in the task sidebar. When viewing a task, the assistant knows the task's status, assignee, due date, and parent project. It offers contextual actions like "summarize progress" or "draft update."

**What Ship should take:** The sidebar embedding pattern. ClickUp proves that a 250-300px sidebar is sufficient for a chat interface when messages are concise. FleetGraph's 256px width matches this.

**What Ship should not take:** ClickUp's AI is reactive only (user must invoke it). FleetGraph combines proactive first-turn assessment with on-demand follow-up.

### Microsoft Copilot in Planner

**What they do:** Copilot in Planner is aware of the current plan, its tasks, assignments, and timeline. It generates plan summaries, identifies risks, and suggests task reassignments, all scoped to the active plan view.

**What Ship should take:** The "initial assessment on open" pattern. When you open Copilot on a plan, it immediately shows relevant insights without requiring a prompt. FleetGraph's empty-first-message behavior mirrors this.

**What Ship should not take:** Copilot in Planner operates within Microsoft's broader Copilot ecosystem with cross-app context (Teams, Outlook). FleetGraph is self-contained within Ship.

### Summary table

| Pattern | Notion | Asana | ClickUp | Copilot | FleetGraph |
|---|---|---|---|---|---|
| Current-page context | Yes | Yes | Yes | Yes | Yes |
| Proactive first message | No | Yes (via assigned agent) | No | Yes | Yes |
| Sidebar embedding | No (inline/modal) | No (dedicated view) | Yes (task sidebar) | No (panel overlay) | Yes (properties tab) |
| Role-scoped | No (general) | Yes | No (general) | Partial | Yes (drift only) |
| Streaming | Yes | No | Yes | Yes | Yes (SSE) |
| HITL approval cards | No | No | No | No | Yes |
| Conversation persistence | Yes | N/A | Yes | Yes | Yes (LangGraph threads) |

FleetGraph's differentiator is the combination of role-scoped proactive assessment + HITL approval cards + sidebar embedding. No existing product has all three.

---

## 9. Implementation Sequence

### Phase 1: Foundation (Days 1-2)

1. Extract context-loading functions from `claude.ts` into `api/src/services/context-loader.ts`
2. Add `issue` context type to the context loader
3. Create `api/src/routes/fleetgraph.ts` with SSE chat endpoint (stub graph, real streaming)
4. Create `FleetGraphPanel.tsx` with message list, input, and streaming display
5. Create `PropertiesSidebarTabs.tsx` and integrate into `UnifiedEditor.tsx`
6. Create `useFleetGraphChat.ts` hook

### Phase 2: Graph Integration (Days 2-3)

7. Wire the chat endpoint to actual LangGraph execution
8. Implement thread persistence via LangGraph checkpoint saver
9. Implement the proactive first-turn assessment (empty message = generate assessment)
10. Add approval card rendering and `POST /api/fleetgraph/approval` endpoint

### Phase 3: Polish (Days 3-4)

11. Add the notification dot for proactive insights
12. Thread restoration on navigation (GET thread history)
13. Rate limiting
14. Error states and fallback rendering
15. Token budget enforcement in context preloading

---

## 10. Open Questions

1. **Thread expiry:** How long should threads persist? Suggestion: 7 days of inactivity, then auto-summarize and archive. New conversation starts with the summary as context.

2. **Multi-user threads:** Should two users viewing the same issue see the same FleetGraph thread? Recommendation: no. Threads are per-user. Different users may have different questions and different permission levels.

3. **Keyboard shortcut:** Should there be a keyboard shortcut to toggle between Properties and FleetGraph tabs? Suggestion: `Cmd+Shift+G` (G for Graph), consistent with `Cmd+K` for command palette.

4. **Mobile/narrow viewports:** The 4-panel layout does not collapse on narrow viewports today. If it ever does, FleetGraph should be accessible via a bottom sheet or modal. Not blocking for MVP.

5. **Offline behavior:** Ship has offline-tolerant patterns via Yjs. FleetGraph requires a server connection and should show a clear "offline" state when the API is unreachable, reusing the `quietGet('/api/ai/status')` pattern from `QualityAssistant.tsx`.
