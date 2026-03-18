/**
 * Issue content scope drift detection.
 *
 * Three detection layers:
 * 1. Dangerous patterns in content (DROP TABLE, rm -rf, etc.)
 * 2. Content removal (significant text deleted vs previous version)
 * 3. Topic mismatch (issue content diverges from sprint/issue title)
 *
 * Sprint context softens severity: refactoring sprints allow deletions.
 */

import { extractText } from '../../utils/document-content.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SprintContext {
  sprintId: string;
  sprintTitle: string;
  sprintPlan: string | null;
  isRefactorSprint: boolean;
}

export interface ContentRemovalEvidence {
  previousLength: number;
  currentLength: number;
  removalRatio: number;
}

export interface IssueScopeDriftEvidence {
  scopeDrift: true;
  reason: 'dangerous_content' | 'content_removal' | 'topic_mismatch';
  details: string;
  sprintContext: SprintContext | null;
  severity: 'high' | 'medium';
}

export interface HistoryEntry {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

// ---------------------------------------------------------------------------
// Stop words + tokenizer (duplicated from nodes.ts to avoid coupling)
// ---------------------------------------------------------------------------

const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'but', 'by', 'do', 'for',
  'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'let',
  'of', 'on', 'or', 'our', 'project', 'ship', 'that',
  'the', 'their', 'this', 'to', 'up', 'we', 'with', 'work',
]);

export function tokenizeTopicText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !TOPIC_STOP_WORDS.has(token));
}

// ---------------------------------------------------------------------------
// Layer 1: Dangerous content patterns
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /drop\s+(table|database|schema)/i, label: 'DROP TABLE/DATABASE/SCHEMA' },
  { pattern: /delete\s+(all|database|everything|code)/i, label: 'delete all/database/everything/code' },
  { pattern: /rm\s+-rf/i, label: 'rm -rf' },
  { pattern: /truncate\s+table/i, label: 'TRUNCATE TABLE' },
  { pattern: /remove\s+(all|everything)/i, label: 'remove all/everything' },
  { pattern: /(?:^|\s)(destroy|wipe|nuke)\b/i, label: 'destroy/wipe/nuke' },
];

export function detectDangerousPatterns(contentText: string): string[] {
  const matches: string[] = [];
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(contentText)) {
      matches.push(label);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Layer 2: Content removal detection
// ---------------------------------------------------------------------------

export function detectContentRemoval(
  currentContent: unknown,
  historyEntries: HistoryEntry[],
): ContentRemovalEvidence | null {
  const contentChanges = historyEntries.filter((h) => h.field === 'content');
  if (contentChanges.length === 0) return null;

  // Find the most recent content change with a non-trivial old_value
  for (const change of contentChanges) {
    const oldText = typeof change.old_value === 'string'
      ? change.old_value
      : extractText(change.old_value);
    const previousLength = oldText.trim().length;
    if (previousLength <= 50) continue;

    const currentText = extractText(currentContent).trim();
    const currentLength = currentText.length;
    const removalRatio = 1 - (currentLength / previousLength);

    // Flag if new content is less than 20% of old content
    if (removalRatio >= 0.8) {
      return { previousLength, currentLength, removalRatio };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layer 3: Topic mismatch
// ---------------------------------------------------------------------------

export function detectIssueTopicDrift(
  contentText: string,
  sprintTitle: string | null,
  sprintPlan: string | null,
  issueTitle: string,
): boolean {
  const contentTokens = new Set(tokenizeTopicText(contentText));
  if (contentTokens.size < 3) return false;

  const topicSources: string[] = [issueTitle];
  if (sprintTitle) topicSources.push(sprintTitle);
  if (sprintPlan) topicSources.push(sprintPlan);

  const topicTokens = new Set(tokenizeTopicText(topicSources.join(' ')));
  if (topicTokens.size < 3) return false;

  const overlap = [...contentTokens].filter((token) => topicTokens.has(token));
  return overlap.length === 0;
}

// ---------------------------------------------------------------------------
// Sprint context resolver
// ---------------------------------------------------------------------------

const REFACTOR_KEYWORDS = /\b(refactor\w*|cleanup|clean-?up|migrat\w*|deprecat\w*|tech[\s-]?debt)\b/i;

export function resolveSprintContext(
  entity: Record<string, unknown>,
): SprintContext | null {
  const belongsTo = entity.belongs_to;
  if (!Array.isArray(belongsTo)) return null;

  const sprint = belongsTo.find(
    (b: Record<string, unknown>) => b && typeof b === 'object' && b.type === 'sprint',
  );
  if (!sprint || typeof sprint !== 'object') return null;

  const sprintRecord = sprint as Record<string, unknown>;
  const sprintId = typeof sprintRecord.id === 'string' ? sprintRecord.id : '';
  const sprintTitle = typeof sprintRecord.title === 'string' ? sprintRecord.title : '';

  if (!sprintId) return null;

  let sprintPlan: string | null = null;
  const properties = sprintRecord.properties;
  if (properties && typeof properties === 'object') {
    const plan = (properties as Record<string, unknown>).plan;
    if (typeof plan === 'string' && plan.trim().length > 0) {
      sprintPlan = plan;
    }
  }

  const isRefactorSprint =
    REFACTOR_KEYWORDS.test(sprintTitle) ||
    (sprintPlan !== null && REFACTOR_KEYWORDS.test(sprintPlan));

  return { sprintId, sprintTitle, sprintPlan, isRefactorSprint };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function getIssueScopeDriftEvidence(
  ctx: Record<string, unknown>,
  historyEntries: HistoryEntry[],
): IssueScopeDriftEvidence | null {
  const entity = ctx.entity;
  if (!entity || typeof entity !== 'object') return null;

  const entityRecord = entity as Record<string, unknown>;
  const contentText = extractText(entityRecord.content).trim();
  const issueTitle = typeof entityRecord.title === 'string' ? entityRecord.title : '';
  const sprintCtx = resolveSprintContext(entityRecord);
  const baseSeverity: 'high' | 'medium' = sprintCtx?.isRefactorSprint ? 'medium' : 'high';

  // Layer 1: Dangerous patterns
  const dangerousMatches = detectDangerousPatterns(contentText);
  if (dangerousMatches.length > 0) {
    return {
      scopeDrift: true,
      reason: 'dangerous_content',
      details: `Dangerous content detected: ${dangerousMatches.join(', ')}`,
      sprintContext: sprintCtx,
      severity: baseSeverity,
    };
  }

  // Layer 2: Content removal
  const removal = detectContentRemoval(entityRecord.content, historyEntries);
  if (removal) {
    return {
      scopeDrift: true,
      reason: 'content_removal',
      details: `Content reduced from ${removal.previousLength} to ${removal.currentLength} chars (${Math.round(removal.removalRatio * 100)}% removed)`,
      sprintContext: sprintCtx,
      severity: baseSeverity,
    };
  }

  // Layer 3: Topic mismatch
  if (contentText.length >= 20) {
    const topicDrift = detectIssueTopicDrift(
      contentText,
      sprintCtx?.sprintTitle ?? null,
      sprintCtx?.sprintPlan ?? null,
      issueTitle,
    );
    if (topicDrift) {
      return {
        scopeDrift: true,
        reason: 'topic_mismatch',
        details: `Issue content diverges from issue title and sprint context`,
        sprintContext: sprintCtx,
        severity: baseSeverity,
      };
    }
  }

  return null;
}
