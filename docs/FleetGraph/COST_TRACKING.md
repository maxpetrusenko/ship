# FleetGraph Development Cost Tracking

Generated and maintained via `ccusage` (Claude Code) and `@ccusage/codex` (Codex).

## How To Regenerate

```bash
# Claude Code - ShipShape project only
npx ccusage session --instances -p ShipShapeProject

# Claude Code - daily breakdown
npx ccusage daily --since 20260315 --breakdown

# Codex - all sessions (no per-project filter available)
npx @ccusage/codex daily

# Codex - session-level detail
npx @ccusage/codex session
```

Note: Codex (`@ccusage/codex`) does not support per-project filtering. Codex totals below represent all Gauntlet projects, not just ShipShape/FleetGraph. Claude Code (`ccusage`) supports `--project` filtering.

## Snapshot: 2026-03-16

### Claude Code (ShipShape project sessions only)

| Metric | Value |
|--------|-------|
| Input tokens | 18,086,762 |
| Output tokens | 697,756 |
| Cache creation tokens | 164,991 |
| Cache read tokens | 195,112,717 |
| Total tokens | 214,062,226 |
| Total cost (USD) | $41.13 |
| Sessions | 3 |
| Models used | opus-4-6, glm-4.7, sonnet-4-5, glm-4.5-air |

### Codex (all Gauntlet projects combined)

| Metric | Value |
|--------|-------|
| Input tokens | 14,361,038,226 |
| Output tokens | 55,534,583 |
| Total tokens | 14,416,572,809 |
| Total cost (USD) | $4,527.55 |
| Model | gpt-5.4 |

### Codex last 3 days

| Date | Input | Output | Cached | Cost |
|------|-------|--------|--------|------|
| Mar 14 | 495,526,714 | 2,611,078 | 452,514,048 | $259.83 |
| Mar 15 | 159,936,703 | 961,273 | 145,886,848 | $86.02 |
| Mar 16 | 4,828,219 | 82,931 | 4,038,912 | $4.23 |

## PRD Required Tables

### Development and Testing Costs

To be filled in FLEETGRAPH.md at submission. Source data from this file.

| Item | Amount |
|------|--------|
| OpenAI input tokens | (sum at submission) |
| OpenAI output tokens | (sum at submission) |
| Total invocations during development | (sum at submission) |
| Total development spend | (sum at submission) |

### Production Cost Projections

Estimated in FLEETGRAPH.md using OpenAI gpt-4o-mini direct API pricing ($0.15/1M input, $0.60/1M output).

| 100 Users | 1,000 Users | 10,000 Users |
|-----------|-------------|--------------|
| $15/month | $90/month | $600/month |

Assumptions:
- Proactive runs per project per day: 360 (one per active sprint per 4-min sweep)
- On-demand invocations per user per day: 3
- Average tokens per invocation: ~1,500 input + ~400 output
- Clean runs (no LLM call): ~70% of proactive sweeps
- Cost per run: ~$0.0005

### Note on real token data

Real token usage will be populated from LangSmith traces once production runs are captured. The `tokenUsage` field on `FleetGraphAuditEntry` records actual input/output token counts per run. Aggregate these via `fleetgraph_audit_log` queries to validate the projection assumptions above.
