---
title: Claude Context API for AI-Powered Skills
problem_type: integration
component: api/routes/claude.ts
root_cause: AI skills needed comprehensive project context for intelligent questioning
solution_verified: true
created_at: 2025-01-13
tags: [claude, api, context, skills, ship-integration]
related_issues: []
---

# Claude Context API for AI-Powered Skills

## Problem

When building AI-powered skills (like `/ship:standup`, `/ship:review`, `/ship:retro`), the AI needs comprehensive context about the project hierarchy to ask intelligent clarifying questions. Without full context, the AI can only generate generic questions.

**Symptoms:**
- AI skills asking generic questions not relevant to the project
- No hypothesis tracking or validation prompts
- Missing connections between weeks, projects, and programs
- Can't analyze patterns across standups or week reviews

## Root Cause

AI skills were making multiple API calls to piece together context, losing the relationships between:
- Program → Project → Week hierarchy
- Week hypotheses and their validation status
- Standup history and blockers
- Issue completion rates and scope changes

## Solution

Create a dedicated `/api/claude/context` endpoint that returns the full context chain in a single request.

### Endpoint Design

```typescript
// api/src/routes/claude.ts

/**
 * GET /api/claude/context
 * Query params:
 * - context_type: 'standup' | 'review' | 'retro'
 * - week_id: Week ID (required for standup/review) - uses sprint_id param for historical compatibility
 * - project_id: Project ID (required for retro)
 */
router.get('/context', authMiddleware, async (req: Request, res: Response) => {
  const { context_type, sprint_id, project_id } = req.query; // sprint_id = week ID (historical param name)
  const workspaceId = req.workspaceId;

  switch (context_type) {
    case 'standup':
      return getStandupContext(sprint_id, workspaceId);
    case 'review':
      return getReviewContext(sprint_id, workspaceId);
    case 'retro':
      return getRetroContext(project_id, workspaceId);
  }
});
```

### Context Response Structure

Each context type returns:

```typescript
{
  context_type: 'standup' | 'review' | 'retro',
  week: {  // Note: key remains 'sprint' in API for historical compatibility
    id, title, number, status,
    start_date, end_date,
    hypothesis,  // Key for validation tracking
    goal
  },
  program: {
    id, name, description, goals
  },
  project: {
    id, name,
    hypothesis,  // Project-level hypothesis
    goal,
    ice_scores: { impact, confidence, ease },
    monetary_impact_expected
  },
  recent_standups: [...],  // Or all standups for review
  issues: {
    stats: { total, completed, in_progress, ... },
    items: [...]
  },
  clarifying_questions_context: [...]  // AI-generated questions
}
```

### Clarifying Questions Generation

The endpoint generates context-aware questions:

```typescript
function generateStandupQuestions(week, issueStats) {
  const questions = [];

  // Hypothesis alignment
  if (week.hypothesis) {
    questions.push(`How does today's work relate to: "${week.hypothesis}"?`);
  }

  // Progress tracking
  if (issueStats.in_progress > 0) {
    questions.push(`You have ${issueStats.in_progress} issues in progress. Status?`);
  }

  // Goal alignment
  if (week.goal) {
    questions.push(`On track for: "${week.goal}"?`);
  }

  return questions;
}
```

### Key Design Decisions

1. **Single endpoint, multiple context types**: One `/context` endpoint handles all three use cases, reducing API surface area

2. **Full hierarchy in response**: Always include program → project → week chain, even if some levels are null

3. **Pre-computed questions**: Generate clarifying questions server-side based on data patterns

4. **Read-only, no CSRF**: This endpoint only reads data, so it bypasses CSRF protection (Bearer tokens aren't CSRF-vulnerable anyway)

### Usage in Skills

Skills fetch context before interviewing the user:

```bash
# In skill SKILL.md
CONTEXT=$(curl -s "$SHIP_URL/api/claude/context?context_type=standup&sprint_id=$WEEK_ID" \
  -H "Authorization: Bearer $SHIP_API_TOKEN")

# Extract key fields (API returns 'sprint' key for historical compatibility)
WEEK_HYPOTHESIS=$(echo "$CONTEXT" | jq -r '.sprint.hypothesis')
PROJECT_GOAL=$(echo "$CONTEXT" | jq -r '.project.goal')
CLARIFYING_QUESTIONS=$(echo "$CONTEXT" | jq -r '.clarifying_questions_context')
```

## Prevention

When building AI-powered features:

1. **Design context-first**: Start by listing what context the AI needs, then build the endpoint
2. **Include hypothesis tracking**: Any planning/review feature needs hypothesis validation
3. **Pre-compute analysis**: Generate pattern analysis server-side, not in prompts
4. **Return hierarchy**: Always include the full object hierarchy for relationship understanding

## Files Changed

- `api/src/routes/claude.ts` - New endpoint (707 lines)
- `api/src/app.ts` - Route registration
- `~/.claude/skills/ship-standup/SKILL.md` - Updated to use context endpoint
- `~/.claude/skills/ship-review/SKILL.md` - Updated to use context endpoint
- `~/.claude/skills/ship-retro/SKILL.md` - Updated to use context endpoint

## Related Patterns

- **Unified Document Model**: The context endpoint leverages the document model where everything (programs, projects, weeks, standups) is a document with relationships
- **TipTap Content Structure**: Context includes TipTap JSON content for rich text analysis
- **Hypothesis-Driven Development**: Central to Ship's philosophy - the context API makes hypotheses queryable
