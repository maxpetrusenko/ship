# Cost Analysis Deep Dive
## Provenance

- Requirements-backed: assignment constraints and grader-facing deliverables from `requirements.md`. Where `FleetGraph_PRD.pdf` diverges, `requirements.md` wins.
- Codebase-backed: current Ship routes, files, UI patterns, and infra only when this doc cites specific Ship paths or endpoints.
- External-doc-backed: vendor pricing and API behavior only.
- Proposed design: FleetGraph architecture, node layouts, schemas, code sketches, and rollout plans unless explicitly marked as current Ship behavior.
- Assumption: latency budgets, scale math, token budgets, and operational estimates that are not directly measured in this repo.
- Reading rule: unlabeled code blocks are proposed FleetGraph implementation sketches, not current Ship code.


## Purpose

Engineer-ready cost model for FleetGraph. Covers OpenAI API pricing, per-run token budgets, volume assumptions at 100/1,000/10,000 users, monthly cost projections, LangSmith pricing, and cost controls. Vendor pricing and API behavior in this document are external-doc-backed snapshots rechecked on 2026-03-16. Volume projections, monthly totals, and infrastructure growth paths remain project-specific assumptions.

## 1. OpenAI API Pricing

### Model Comparison

FleetGraph uses the OpenAI Responses API. Pricing is identical to Chat Completions; the Responses API is a different interface, not a different billing tier.

| Model | Input / 1M tokens | Cached Input / 1M tokens | Output / 1M tokens | Context Window | Max Output |
|-------|-------------------|--------------------------|---------------------|----------------|------------|
| GPT-4.1 | $2.00 | $0.50 | $8.00 | 1M | 32K |
| GPT-4.1 mini | $0.40 | $0.10 | $1.60 | 1M | 32K |
| GPT-4.1 nano | $0.10 | $0.025 | $0.40 | 1M | 32K |
| GPT-4o | $2.50 | $1.25 | $10.00 | 128K | 16K |
| GPT-4o mini | $0.15 | $0.075 | $0.60 | 128K | 16K |

**Cached input pricing:** OpenAI automatically caches prompt prefixes longer than 1,024 tokens. Cached inputs are billed at 75% discount for GPT-4.1 series (25% of input price) and 50% discount for GPT-4o series (50% of input price). No configuration required. Caching activates automatically when the same prompt prefix is sent repeatedly.

**Structured outputs:** No additional cost. `responses.parse()` with a Zod schema uses guided decoding; the model is constrained to valid JSON matching the schema. Token usage is the same as unstructured output. The only cost implication is that structured outputs may produce slightly more tokens than a free-form "yes/no" answer due to JSON field names.

### Model Selection for FleetGraph

| Run Type | Recommended Model | Rationale |
|----------|-------------------|-----------|
| Proactive sweep reasoning | GPT-4.1 mini | Low-stakes triage. Heuristics already filtered; model confirms or dismisses. Cost is 80% lower than GPT-4.1. |
| On-demand first response | GPT-4.1 | User-facing quality matters. Richer context window (1M) handles large project state. |
| On-demand follow-up | GPT-4.1 mini | Shorter context, user already oriented. Acceptable quality at lower cost. |
| Approval-gated action reasoning | GPT-4.1 | Consequential decisions need stronger reasoning. Audit trail requires high-quality explanations. |

**Why GPT-4.1 over GPT-4o:** GPT-4.1 is cheaper ($2.00 vs $2.50 input, $8.00 vs $10.00 output), has a larger context window (1M vs 128K), and is the newer model family. GPT-4o remains a fallback if GPT-4.1 exhibits quality regressions on specific prompts.

**Why not GPT-4.1 nano everywhere:** At $0.10/1M input and $0.40/1M output, nano is extremely cheap. However, initial evals should validate that nano produces acceptable reasoning quality for proactive triage. If nano passes evals for proactive sweeps, the proactive cost drops by another 75%.

## 2. Token Budget per Run Type

### Proactive Sweep Candidate (after heuristic filter)

The heuristic has already flagged this entity. The LLM receives a structured entity digest and must decide: no_issue, inform_only, or confirm_action.

```
SYSTEM (instructions + schema):     ~400 tokens
ENTITY DIGEST (structured JSON):    ~1,200 tokens
RECENT SIGNALS (last 3 events):     ~400 tokens
─────────────────────────────────────────────
INPUT TOTAL:                         ~2,000 tokens

OUTPUT (structured JSON decision):   ~500 tokens
```

**Example input shape:**
```json
{
  "entity_type": "issue",
  "entity_id": "doc_abc123",
  "title": "Integrate OAuth provider",
  "status": "blocked",
  "blocked_since": "2026-03-14T10:00:00Z",
  "assignee": "alice",
  "project": "Auth Overhaul",
  "week": "Week 12",
  "recent_signals": [
    {"type": "status_change", "from": "in_progress", "to": "blocked", "at": "2026-03-14T10:00:00Z"},
    {"type": "comment", "by": "bob", "summary": "Waiting on API key from vendor", "at": "2026-03-14T11:00:00Z"}
  ]
}
```

**Example output shape:**
```json
{
  "decision": "inform_only",
  "severity": "medium",
  "summary": "Issue blocked for 48+ hours awaiting external dependency. No internal action can unblock.",
  "suggested_action": "Notify project lead to escalate with vendor.",
  "notify": ["project_lead"]
}
```

**Cost per proactive call (GPT-4.1 mini):**
- Input: 2,000 tokens * $0.40 / 1M = $0.0008
- Output: 500 tokens * $1.60 / 1M = $0.0008
- **Total: $0.0016 per call**

With caching (stable instructions prefix ~400 tokens, below 1,024 threshold, so no cache benefit on instructions alone; but if batch processing multiple entities with same system prompt at 1,024+ tokens, cached rate applies):
- Cached input (400 tokens): 400 * $0.10 / 1M = $0.00004
- Fresh input (1,600 tokens): 1,600 * $0.40 / 1M = $0.00064
- Output: 500 * $1.60 / 1M = $0.0008
- **Total with caching: ~$0.00148 per call**

### On-Demand First Response

User opens chat on an issue/sprint/project. Graph fetches full context and delivers an initial assessment.

```
SYSTEM (instructions + schema):              ~600 tokens
ENTITY CONTEXT (full document + props):      ~1,500 tokens
RELATED ENTITIES (linked issues, team):      ~1,200 tokens
USER QUERY:                                  ~200 tokens
CONVERSATION HISTORY:                        ~500 tokens (first turn, minimal)
─────────────────────────────────────────────────────
INPUT TOTAL:                                  ~4,000 tokens

OUTPUT (structured response + reasoning):     ~1,000 tokens
```

**Cost per on-demand first response (GPT-4.1):**
- Input: 4,000 * $2.00 / 1M = $0.008
- Output: 1,000 * $8.00 / 1M = $0.008
- **Total: $0.016 per call**

### On-Demand Follow-Up

Subsequent turn in an existing chat session. Context is trimmed; only recent turns and delta data.

```
SYSTEM (instructions + schema):              ~600 tokens
ENTITY CONTEXT (digest, not full):           ~600 tokens
CONVERSATION (last 2-3 turns):              ~600 tokens
USER QUERY:                                 ~200 tokens
─────────────────────────────────────────────────────
INPUT TOTAL:                                 ~2,000 tokens

OUTPUT (response):                           ~500 tokens
```

**Cost per follow-up (GPT-4.1 mini):**
- Input: 2,000 * $0.40 / 1M = $0.0008
- Output: 500 * $1.60 / 1M = $0.0008
- **Total: $0.0016 per call**

### Approval-Gated Action Reasoning

Model must produce a defensible explanation for a consequential action (reassign issue, update status, send notification).

```
SYSTEM (instructions + action schema):      ~600 tokens
ENTITY CONTEXT (full):                      ~1,200 tokens
ACTION CONTEXT (what will change):          ~400 tokens
RISK ASSESSMENT PROMPT:                     ~400 tokens
PRIOR REASONING (from earlier node):        ~400 tokens
─────────────────────────────────────────────────────
INPUT TOTAL:                                 ~3,000 tokens

OUTPUT (action plan + justification):        ~800 tokens
```

**Cost per action reasoning (GPT-4.1):**
- Input: 3,000 * $2.00 / 1M = $0.006
- Output: 800 * $8.00 / 1M = $0.0064
- **Total: $0.0124 per call**

### Token Budget Summary

| Run Type | Model | Input Tokens | Output Tokens | Cost/Call |
|----------|-------|-------------|---------------|-----------|
| Proactive candidate | GPT-4.1 mini | 2,000 | 500 | $0.0016 |
| On-demand first response | GPT-4.1 | 4,000 | 1,000 | $0.016 |
| On-demand follow-up | GPT-4.1 mini | 2,000 | 500 | $0.0016 |
| Action reasoning | GPT-4.1 | 3,000 | 800 | $0.0124 |

## 3. Volume Assumptions

### Entities and Activity

| Metric | 100 Users | 1,000 Users | 10,000 Users |
|--------|-----------|-------------|--------------|
| Active projects | 20 | 200 | 2,000 |
| Active issues per project | ~15 | ~15 | ~15 |
| Total active entities | ~300 | ~3,000 | ~30,000 |
| Active weeks (sprints) per project | 1 | 1 | 1 |
| Team members per project | ~5 | ~5 | ~5 |

### Proactive Mode Volume

Sweeps run every 4 minutes = 360 sweeps/day. Each sweep evaluates all active entities against deterministic heuristics. Only flagged candidates go to the LLM.

| Metric | 100 Users | 1,000 Users | 10,000 Users |
|--------|-----------|-------------|--------------|
| Sweeps per day | 360 | 360 | 360 |
| Entities scanned per sweep (heuristic) | 300 | 3,000 | 30,000 |
| Candidate rate (flagged by heuristic) | 3% | 3% | 3% |
| Candidates per sweep | ~9 | ~90 | ~900 |
| Dedup filter (skip recently surfaced) | 70% skipped | 70% skipped | 70% skipped |
| LLM calls per sweep | ~3 | ~27 | ~270 |
| **LLM calls per day (proactive)** | **~864** | **~7,776** | **~77,760** |

Note: At 10,000 users, sweeps should be sharded and parallelized. The heuristic scan itself is cheap (in-memory data comparison), but the 77,760 daily LLM calls become the cost driver.

**Refinement for realism:** Many flagged candidates will be the same entity flagged across consecutive sweeps. The dedup/digest-cache layer prevents re-reasoning over unchanged state. In practice, the "unique new candidates per day" is much lower:

| Metric | 100 Users | 1,000 Users | 10,000 Users |
|--------|-----------|-------------|--------------|
| Unique new candidates per day | ~30 | ~300 | ~3,000 |
| Re-check after state change | ~10 | ~100 | ~1,000 |
| **Realistic LLM calls/day (proactive)** | **~40** | **~400** | **~4,000** |

The realistic estimate assumes entities are cached after first reasoning and only re-evaluated when their underlying data changes. This is the primary cost control lever.

### On-Demand Mode Volume

| Metric | 100 Users | 1,000 Users | 10,000 Users |
|--------|-----------|-------------|--------------|
| Active users (daily) | ~30 (30%) | ~250 (25%) | ~2,000 (20%) |
| Sessions per active user per day | 2 | 2 | 1.5 |
| Sessions per day | 60 | 500 | 3,000 |
| Turns per session | 3 | 3 | 3 |
| First responses per day | 60 | 500 | 3,000 |
| Follow-ups per day | 120 | 1,000 | 6,000 |
| Action reasoning per day (10% of sessions) | 6 | 50 | 300 |

### Combined Daily LLM Calls

| Call Type | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Proactive (realistic) | 40 | 400 | 4,000 |
| On-demand first response | 60 | 500 | 3,000 |
| On-demand follow-up | 120 | 1,000 | 6,000 |
| Action reasoning | 6 | 50 | 300 |
| **Total LLM calls/day** | **226** | **1,950** | **13,300** |

## 4. Monthly Cost Projections

### OpenAI API Costs

**Formula:** `monthly_cost = daily_calls * cost_per_call * 30`

#### Proactive OpenAI

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Daily calls | 40 | 400 | 4,000 |
| Cost per call (GPT-4.1 mini) | $0.0016 | $0.0016 | $0.0016 |
| **Monthly** | **$1.92** | **$19.20** | **$192.00** |

#### On-Demand OpenAI

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| First response (daily) | 60 | 500 | 3,000 |
| First response cost (GPT-4.1) | $0.016 | $0.016 | $0.016 |
| Follow-up (daily) | 120 | 1,000 | 6,000 |
| Follow-up cost (GPT-4.1 mini) | $0.0016 | $0.0016 | $0.0016 |
| Action reasoning (daily) | 6 | 50 | 300 |
| Action cost (GPT-4.1) | $0.0124 | $0.0124 | $0.0124 |
| **Monthly** | **$36.86** | **$307.20** | **$1,843.20** |

Breakdown of on-demand monthly:
- First responses: 60 * $0.016 * 30 = $28.80 | 500 * $0.016 * 30 = $240.00 | 3,000 * $0.016 * 30 = $1,440.00
- Follow-ups: 120 * $0.0016 * 30 = $5.76 | 1,000 * $0.0016 * 30 = $48.00 | 6,000 * $0.0016 * 30 = $288.00
- Action reasoning: 6 * $0.0124 * 30 = $2.23 | 50 * $0.0124 * 30 = $18.60 | 300 * $0.0124 * 30 = $111.60
- Rounding: $36.79 | $306.60 | $1,839.60 (table uses rounded values)

#### Total OpenAI

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Proactive | $1.92 | $19.20 | $192.00 |
| On-demand | $36.79 | $306.60 | $1,839.60 |
| **Total OpenAI/month** | **$38.71** | **$325.80** | **$2,031.60** |

### LangSmith Tracing Costs

LangSmith pricing snapshot used for planning:

| Plan | Monthly Cost | Included Traces | Overage |
|------|-------------|-----------------|---------|
| Developer (free) | $0 | 5,000 traces/month | Hard limit |
| Plus | $39/seat | 10,000 traces/seat/month | $0.005/trace |
| Enterprise | Custom | Custom | Negotiated |

**Trace volume projection:**

Each LLM call = 1 LangSmith trace (the full graph run may be 1 parent trace with child spans, but billing is per top-level run).

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Graph runs/month (LLM calls) | ~6,780 | ~58,500 | ~399,000 |
| Plan needed | Plus (1 seat) | Plus (1 seat) + overage | Enterprise |
| Base cost | $39 | $39 | Custom (~$200+) |
| Overage traces | 0 (under 10K) | 48,500 * $0.005 | Negotiated |
| **Monthly LangSmith** | **$39** | **$281.50** | **~$500** |

Note: At 10,000 users, Enterprise pricing is negotiated. The $500 estimate assumes a volume discount. Actual cost may range $300 to $1,000 depending on contract.

At the Developer free tier (5,000 traces/month), FleetGraph at 100 users would exceed the limit in the first month. The Plus plan is required from day one for production use.

### Infrastructure Costs (AWS)

FleetGraph runs inside the existing Ship backend on Elastic Beanstalk. The proactive sweep scheduler is a recurring task in the same EB environment.

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Elastic Beanstalk (incremental) | $0 (shared) | $50 (larger instance) | $200 (dedicated workers) |
| RDS PostgreSQL (incremental) | $0 (shared) | $20 (more IOPS) | $100 (read replicas) |
| Redis/cache (entity digests) | $0 (in-memory) | $15 (ElastiCache t4g.micro) | $50 (ElastiCache t4g.small) |
| CloudWatch/logging | $5 | $15 | $50 |
| **Monthly infrastructure** | **$5** | **$100** | **$400** |

At 100 users, FleetGraph shares existing Ship infrastructure with negligible incremental cost. At 10,000 users, dedicated worker instances and a cache layer are needed.

### Total Monthly Cost

| Component | 100 Users | 1,000 Users | 10,000 Users |
|-----------|-----------|-------------|--------------|
| Proactive OpenAI | $1.92 | $19.20 | $192.00 |
| On-demand OpenAI | $36.79 | $306.60 | $1,839.60 |
| LangSmith tracing | $39.00 | $281.50 | ~$500.00 |
| Infrastructure (EB, RDS, cache) | $5.00 | $100.00 | $400.00 |
| **Total** | **$82.71** | **$707.30** | **$2,931.60** |

**Per-user monthly cost:**

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Total/user/month | $0.83 | $0.71 | $0.29 |
| OpenAI only/user/month | $0.39 | $0.33 | $0.20 |

Cost scales sublinearly because proactive sweeps are per-project (not per-user) and infrastructure has fixed-cost components.

## 5. Cost Controls and Optimization

### Tier 1: Deterministic Heuristics Before LLM (Highest Impact)

This is the single largest cost saver. Without heuristics, every entity in every sweep goes to the LLM.

**Without heuristic filter (10,000 users):**
- 30,000 entities * 288 sweeps/day * $0.0016/call = $13,824/day = **$414,720/month**

**With heuristic filter (3% candidate rate + 70% dedup):**
- 4,000 calls/day * $0.0016/call = $6.40/day = **$192/month**

**Savings: 99.95%**

The heuristic filter is not optional. It is the architecture.

### Tier 2: Entity Digest Caching

After reasoning about an entity, store a digest (hash of the entity state that was reasoned about). On the next sweep, compare current entity state hash against the stored digest. If unchanged, skip LLM.

**Implementation:** SHA-256 hash of the serialized entity snapshot. Store in Redis or in-memory map. TTL = 1 hour (ensures stale entities are re-evaluated periodically even without changes).

**Impact:** Reduces the "realistic" LLM calls by an additional 30-50% during quiet periods when entity state is stable.

### Tier 3: Prompt/Schema Stability for API-Level Caching

OpenAI automatically caches prompt prefixes longer than 1,024 tokens. To benefit:

- Keep system instructions and schema definitions at the start of the prompt (the stable prefix).
- Put variable data (entity digest, signals) after the stable prefix.
- Ensure the stable prefix exceeds 1,024 tokens.

**Practical approach:** Pad the system prompt with detailed instructions and the full Zod schema description to reach 1,024+ tokens. This is not waste; detailed instructions improve output quality and unlock the 75% cached input discount.

**Impact at scale (10,000 users, proactive calls):**
- Without caching: 4,000 * 2,000 tokens * $0.40/1M = $3.20/day input
- With caching (1,024 cached, 976 fresh): 4,000 * (1,024 * $0.10/1M + 976 * $0.40/1M) = $1.97/day input
- **Savings: ~38% on input tokens**

### Tier 4: Model Tiering

Already reflected in the projections above:
- GPT-4.1 mini for proactive and follow-ups: 80% cheaper than GPT-4.1
- GPT-4.1 for user-facing first responses and action reasoning: quality where it matters

**If GPT-4.1 nano passes evals for proactive:**
- Proactive cost drops from $192/month to $48/month at 10,000 users (75% further reduction)

### Tier 5: Token Budget Enforcement

Hard-cap input and output tokens per node using the `max_output_tokens` parameter and input truncation.

| Node | Max Input | Max Output |
|------|-----------|------------|
| Proactive reasoning | 3,000 | 800 |
| On-demand first response | 6,000 | 1,500 |
| On-demand follow-up | 3,000 | 800 |
| Action reasoning | 5,000 | 1,200 |

If entity context exceeds the input budget, truncate the least-recent signals first, then trim related entity details. Never truncate the system prompt or schema.

### Tier 6: Rolling Window for On-Demand Chat

On-demand sessions carry conversation history. Without trimming, a 10-turn conversation could exceed 20,000 input tokens.

**Strategy:** Keep only the last 3 turns (user + assistant) in the prompt. Summarize earlier turns into a single "conversation summary" block (~200 tokens) generated by the graph's context node.

**Impact:** Caps on-demand input at ~4,000 tokens regardless of conversation length.

### Cost Control Summary

| Control | Reduces | Impact |
|---------|---------|--------|
| Heuristic filter | Proactive LLM calls | 99.95% reduction vs no filter |
| Entity digest cache | Redundant re-reasoning | 30-50% reduction in proactive calls |
| Prompt prefix caching | Input token cost | 38% reduction on cached prefix |
| Model tiering | Per-call cost | 80% reduction for non-critical calls |
| Token budget caps | Runaway token usage | Hard ceiling per node |
| Rolling chat window | Chat history bloat | Caps input regardless of session length |

## 6. Development Cost Tracking

### Data Sources

| Source | What It Tracks | How to Access |
|--------|---------------|---------------|
| OpenAI Usage Dashboard | Token usage by model, by day | platform.openai.com/usage |
| LangSmith Dashboard | Run counts, latency, traces | smith.langchain.com |
| FleetGraph token logger | Per-run input/output tokens, model, mode | Custom middleware in graph |

### Token Logging Middleware

Every LLM call in the FleetGraph graph should log:

```typescript
interface FleetGraphRunLog {
  run_id: string;
  mode: 'proactive' | 'on_demand';
  node: string;           // e.g., 'reason_about_risk', 'chat_respond'
  model: string;          // e.g., 'gpt-4.1-mini'
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;       // computed from model pricing
  workspace_id: string;
  entity_type?: string;
  entity_id?: string;
  timestamp: string;
}
```

The `usage` field on the OpenAI Responses API response object provides `input_tokens`, `output_tokens`, and `input_tokens_details.cached_tokens`. Extract these after every call.

### Cost Attribution

FleetGraph runs are attributable by:
1. **LangSmith project name:** Tag all FleetGraph runs under a dedicated LangSmith project (e.g., `fleetgraph-prod`), separate from any other Ship AI features.
2. **OpenAI API key:** If Ship has other AI features, use a separate API key or OpenAI project for FleetGraph to isolate billing.
3. **Custom logging:** The `FleetGraphRunLog` above enables per-mode, per-node cost rollups.

### Development Spend Tracking

During development, track cumulative spend using:

```bash
# Regenerate from Claude Code sessions (FleetGraph-specific)
npx ccusage session --instances -p ShipShapeProject

# OpenAI API usage (check dashboard or use the API)
# Filter by date range of the development sprint
```

At submission, fill the PRD table:

| Item | Source |
|------|--------|
| OpenAI input tokens | Sum from FleetGraphRunLog or OpenAI dashboard |
| OpenAI output tokens | Sum from FleetGraphRunLog or OpenAI dashboard |
| Total invocations | Count of FleetGraphRunLog entries |
| Total development spend | Sum of cost_usd from FleetGraphRunLog |

## 7. LangSmith Pricing

### Plan Comparison

| Feature | Developer (Free) | Plus | Enterprise |
|---------|------------------|------|------------|
| Monthly cost | $0 | $39/seat | Custom |
| Traces included | 5,000/month | 10,000/seat/month | Custom |
| Overage rate | Hard limit (blocked) | $0.005/trace | Negotiated |
| Data retention | 14 days | 30 days | 90+ days |
| Team members | 1 | Unlimited | Unlimited |
| Datasets & evals | Limited | Full | Full |
| Annotation queues | No | Yes | Yes |
| RBAC | No | No | Yes |

### FleetGraph Trace Volume

Each graph run produces one top-level trace. Child spans (individual nodes within the graph) are captured within the parent trace and do not count as separate traces for billing.

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Proactive runs/month | 1,200 | 12,000 | 120,000 |
| On-demand sessions/month | 1,800 | 15,000 | 90,000 |
| Action reasoning/month | 180 | 1,500 | 9,000 |
| **Total traces/month** | **3,180** | **28,500** | **219,000** |

Note: The "graph runs" count here is lower than "LLM calls" because a single on-demand session (3 turns) is one graph run with multiple LLM calls inside it, but counted as one trace.

| | 100 Users | 1,000 Users | 10,000 Users |
|--|-----------|-------------|--------------|
| Plan | Plus (1 seat) | Plus (1 seat) | Enterprise |
| Included traces | 10,000 | 10,000 | Custom |
| Overage traces | 0 | 18,500 | 0 (included) |
| **Monthly cost** | **$39** | **$131.50** | **~$300-500** |

**Development phase:** The free Developer tier (5,000 traces) is sufficient during development. Switch to Plus before production launch.

## 8. Cost Cliff Analysis

Cost cliffs are scenarios where a small architectural mistake causes costs to jump by 10x or more. These are the traps to avoid.

### Cliff 1: Sending Full Document Bodies

**Trigger:** Including the full TipTap JSON content of wiki documents or issue descriptions in the LLM prompt.

**Scale of damage:** A typical wiki document is 2,000 to 10,000 tokens. If the proactive sweep includes full document bodies for context:
- 4,000 daily calls * 8,000 extra tokens * $0.40/1M = $12.80/day extra = **$384/month** at 10,000 users

**Versus:** Using a 200-token summary digest of the document content.

**Prevention:** Entity digests include only: title, status, key dates, owner, and a pre-computed summary (generated once when the document changes, not on every sweep). Full document content is fetched only in on-demand mode when the user is looking at that specific document.

### Cliff 2: Re-Reasoning Over Unchanged Entities

**Trigger:** Missing or broken entity digest cache. Every sweep re-evaluates all flagged candidates, even if nothing changed.

**Scale of damage:** Without dedup, the 10,000-user tier goes from 4,000 to 77,760 LLM calls/day:
- 77,760 * $0.0016 = $124.42/day = **$3,732/month** (vs $192/month with caching)

**Prevention:** Entity digest hashing with Redis/in-memory cache. Alert on cache miss rate > 20%.

### Cliff 3: Unbounded Chat History

**Trigger:** Appending every turn to the prompt without trimming. A 10-turn conversation:
- 10 turns * ~1,500 tokens/turn = 15,000 tokens input per call
- Compared to rolling window: 3 turns * 1,500 = 4,500 tokens

**Scale of damage per session:** 3.3x cost increase per follow-up call. At 10,000 users:
- Follow-up baseline: $288/month
- Without trimming: ~$950/month
- **Extra: $662/month**

**Prevention:** Rolling window of 3 turns + conversation summary. Hard cap `max_tokens` on input.

### Cliff 4: Every Sweep Invoking the LLM

**Trigger:** Removing or bypassing the heuristic filter (e.g., "let the LLM decide everything").

**Scale of damage:** This is the catastrophic cliff.
- 30,000 entities * 288 sweeps * 2,500 tokens * $0.40/1M = **$8,640/day = $259,200/month** at 10,000 users

**Versus with heuristics:** $192/month

**Prevention:** The heuristic filter is a hard architectural requirement, not an optimization. The graph must not reach the LLM node without passing the heuristic gate.

### Cliff 5: Using GPT-4.1 for All Calls

**Trigger:** Not implementing model tiering; routing all calls through the expensive model.

**Scale of damage at 10,000 users:**
- Proactive with GPT-4.1: 4,000 * ($2.00 * 2,000/1M + $8.00 * 500/1M) * 30 = **$1,200/month**
- Proactive with GPT-4.1 mini: **$192/month**
- **Extra: $1,008/month**

**Prevention:** Model selection is a per-node configuration, not a global setting. Default to mini; escalate to full model only for user-facing and action-reasoning nodes.

### Cost Cliff Summary

| Cliff | Without Guard | With Guard | Multiplier |
|-------|--------------|------------|------------|
| Full doc bodies | +$384/mo | $0 | Avoidable |
| No digest cache | $3,732/mo | $192/mo | 19x |
| Unbounded chat | +$662/mo | $0 | 3.3x |
| No heuristic filter | $259,200/mo | $192/mo | 1,350x |
| No model tiering | $1,200/mo | $192/mo | 6.3x |

The heuristic filter is non-negotiable. It is a 1,350x cost multiplier if removed.

## 9. Sensitivity Analysis

### What If Assumptions Are Wrong?

| Variable | Optimistic | Baseline | Pessimistic | Cost Impact (10K users) |
|----------|-----------|----------|-------------|------------------------|
| Candidate rate | 1% | 3% | 5% | $64 / $192 / $320 proactive |
| On-demand sessions/user/day | 1 | 1.5 | 3 | $920 / $1,840 / $3,680 on-demand |
| Turns per session | 2 | 3 | 5 | $1,228 / $1,840 / $3,064 on-demand |
| Cache hit rate | 90% | 70% | 50% | $96 / $192 / $320 proactive |

**Worst-case realistic scenario (10,000 users):** 5% candidate rate, 3 sessions/user/day, 5 turns/session, 50% cache hit rate:
- Proactive: $320/month
- On-demand: ~$5,500/month
- LangSmith: ~$500/month
- Infrastructure: $400/month
- **Total: ~$6,720/month ($0.67/user/month)**

Even the pessimistic scenario is manageable. The architecture ensures costs scale linearly, not exponentially.

## 10. Recommendations

1. **Launch with GPT-4.1 mini for proactive, GPT-4.1 for on-demand.** Evaluate GPT-4.1 nano for proactive after initial evals.
2. **Implement entity digest caching before launch.** Without it, proactive costs are 19x higher.
3. **Set token budget caps on every LLM node.** Prevents accidental cost spikes from large entities.
4. **Monitor cost per run in LangSmith custom metadata.** Alert if any single run exceeds 2x the expected token budget.
5. **Start on LangSmith Plus (1 seat).** Free tier is insufficient for production. Enterprise only needed past ~50,000 traces/month.
6. **Log every LLM call with the FleetGraphRunLog schema.** This is the source of truth for the PRD cost tables.
7. **Run weekly cost audits during development.** Compare actual token usage against these projections to catch budget drift early.
