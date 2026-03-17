# Ship Philosophy

This document explains Ship's core philosophy and organizational hierarchy.

> **Related**: See [Week Documentation Philosophy](./week-documentation-philosophy.md) for week workflow details and [Unified Document Model](./unified-document-model.md) for data model implementation.

## The Hierarchy

Ship organizes work in four levels:

```
Programs (long-lived initiatives)
└── Projects (scientific experiments with ICE scoring)
    └── Weeks (accountability windows)
        └── Issues (work units)
```

Each level serves a distinct purpose. Understanding these distinctions is key to using Ship effectively.

## Programs: Long-Lived Initiatives

**Programs exist whether work is happening or not.**

A program represents a persistent area of responsibility or initiative. Examples:

- "Platform Security" - Always exists, always needs attention
- "Customer Onboarding" - Ongoing concern with periodic investment
- "Internal Tools" - Permanent bucket for supporting work

### Characteristics

- **Persistent**: Programs don't "complete" - they continue indefinitely
- **Categorical**: They organize work into meaningful buckets
- **Ownership**: Typically owned by teams or organizational units
- **Resource Visibility**: Show where investment is going

### Why This Matters

Programs provide continuity. When a project ends, the program remains. When people change teams, the program's history stays intact. This enables:

- Long-term trend analysis ("How has Platform Security velocity changed over time?")
- Resource allocation decisions ("We're investing 60% in Customer Onboarding")
- Organizational memory (new team members can see program history)

## Projects: Scientific Method Experiments

**Projects are hypotheses that must be validated or invalidated.**

Unlike programs, projects have a clear lifecycle. Every project:

1. Starts with a hypothesis about what value it will deliver
2. Executes work to test that hypothesis
3. Ends with a retrospective that validates or invalidates the hypothesis

### The ICE Method

Projects are prioritized using ICE scoring (1-5 scale):

| Factor | Question | 1 (Low) | 5 (High) |
|--------|----------|---------|----------|
| **Impact** | How much will this move the needle? | Minor improvement | Game-changing |
| **Confidence** | How certain are we this will work? | Just a guess | Proven pattern |
| **Ease** | How easy is this to implement? | Massive effort | Quick win |

**ICE Score = Impact × Confidence × Ease** (Max: 125)

### Tying Impact to Monetary Value

Impact should connect to measurable outcomes. Examples:

| Impact Score | Description | Example |
|--------------|-------------|---------|
| 5 | >$1M annual value | "Reduce infrastructure costs by 40%" |
| 4 | $500K-$1M value | "Automate manual process saving 2 FTEs" |
| 3 | $100K-$500K value | "Reduce customer churn by 5%" |
| 2 | $10K-$100K value | "Cut support tickets by 20%" |
| 1 | <$10K value | "Minor UX improvement" |

These thresholds are examples - adjust for your organization's scale.

### Binary Hypothesis Validation

**Projects are either validated or invalidated. There is no partial success.**

This forces intellectual honesty:

- ✅ **Validated**: The hypothesis was correct. The project achieved its stated goals.
- ❌ **Invalidated**: The hypothesis was wrong. We learned something, but didn't achieve the goal.

"We partially achieved our goals" is not an option. This prevents:

- Moving goalposts ("Well, we didn't hit 40% but 15% is still good")
- Declaring victory on failed experiments
- Avoiding accountability for outcomes

### Documenting Next Steps

Even invalidated projects generate value through learning. The project retrospective captures:

- What was learned from the experiment
- Actual monetary impact (vs. expected)
- Recommended next steps (which may be a new project)

## Weeks: Accountability Windows

**Weeks are derived 7-day time windows for tracking issue completion.**

Weeks provide the rhythm for execution:

- Fixed 7-day windows (calculated from workspace start date)
- Shared cadence across all programs
- Clear boundaries for planning and retrospection

### Week Owner Accountability

Every week has an owner - a single person accountable for:

- Weekly planning (what will we commit to?)
- Execution oversight (are we on track?)
- Weekly review (what did we actually deliver?)

**Only people can be held accountable, not projects.**

### Weekly Reviews vs. Project Retros

| Aspect | Weekly Review | Project Retro |
|--------|---------------|---------------|
| Frequency | Every week | End of project |
| Scope | What happened this week | Did the hypothesis validate |
| Focus | Issues completed, plan vs reality | Business outcome achieved |
| Validation | N/A (execution tracking) | Validated or Invalidated |

## Issues: Work Units

**Issues are the atomic units of work.**

An issue represents a discrete piece of work:

- Bug fixes
- Feature implementations
- Research tasks
- Documentation updates

### Issue Relationships

Issues belong to **programs** (always) and can be associated with **weeks** (when worked on during that week) and **projects** (to track which experiment they support):

```
Program: Platform Security
├── Issue: Fix SQL injection vulnerability    ← associated with Week of Jan 27
├── Issue: Implement rate limiting            ← associated with Week of Jan 27
├── Issue: Research OAuth alternatives        ← (backlog)
└── Issue: Update security docs               ← (backlog)
```

Issues are a trailing indicator -- they record what was done. The weekly plan is the leading indicator that declares intent.

### Issue States

```
triage → backlog → todo → in_progress → in_review → done
                                               ↓
                                          cancelled
```

- **triage**: New issues awaiting categorization
- **backlog**: Accepted but not yet scheduled
- **todo**: Planned for current week
- **in_progress**: Active work
- **in_review**: Complete, awaiting verification
- **done**: Finished
- **cancelled**: Dropped (with reason documented)

## The Typical Workflow

1. **Program Setup**: Create programs for long-lived initiatives
2. **Project Planning**: Define projects with hypotheses and ICE scores
3. **Weekly Plan**: Write a plan declaring what you intend to accomplish this week and why
4. **Execution**: Do the work; issues track what was actually done (todo -> done)
5. **Weekly Retro**: Reflect on what happened vs. what was planned
6. **Project Retro**: Validate or invalidate the hypothesis

## Standups: Asynchronous Progress Updates

Standups in Ship are **comment-like entries on weeks**:

- Anyone can post a standup to any week at any time
- Multiple standups per person per day are allowed
- Entries appear in a timeline feed with timestamps
- Content is free-form (planned work, completed items, blockers)

This differs from traditional standup meetings:

| Traditional | Ship |
|-------------|------|
| Synchronous meeting | Asynchronous posts |
| Once per day | Any time, any frequency |
| Verbal (lost) | Written (preserved) |
| Same time zone | Works across time zones |

## Observer Dashboard

Ship provides a cross-program dashboard for managers and stakeholders:

- All active weeks with progress indicators
- Recent standups across programs
- Project status summary (in progress, pending retro, completed)

This enables visibility without interrupting the teams doing the work.

## API-First Design

**Everything a user can do in the UI is accessible via API.**

This enables:

- Claude Code integration for automated updates
- CI/CD integration for deployment tracking
- Custom dashboards and reports
- Programmatic issue management

## Key Principles

1. **Programs persist, projects validate**: Know which you're creating
2. **Hypotheses are binary**: Validated or invalidated, no middle ground
3. **People own outcomes**: Accountability is personal, not organizational
4. **Documentation is learning**: Retros capture knowledge, not just compliance
5. **Transparency by default**: Observer dashboards make work visible

## References

- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow details
- [Document Model Conventions](./document-model-conventions.md) - Data model terminology
- [Unified Document Model](./unified-document-model.md) - Technical implementation
- [Ship Claude CLI Integration](./ship-claude-cli-integration.md) - API and CLI usage
