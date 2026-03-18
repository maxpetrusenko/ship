import { describe, it, expect } from 'vitest';
import {
  detectDangerousPatterns,
  detectContentRemoval,
  detectIssueTopicDrift,
  resolveSprintContext,
  getIssueScopeDriftEvidence,
  tokenizeTopicText,
} from '../fleetgraph/graph/scope-drift.js';
import type { HistoryEntry } from '../fleetgraph/graph/scope-drift.js';

// ---------------------------------------------------------------------------
// Helper: build TipTap-style JSON content
// ---------------------------------------------------------------------------

function makeContent(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function makeEntity(
  title: string,
  contentText: string,
  belongsTo: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    entity: {
      title,
      content: makeContent(contentText),
      belongs_to: belongsTo,
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 1: Dangerous patterns
// ---------------------------------------------------------------------------

describe('detectDangerousPatterns', () => {
  it('matches DROP TABLE', () => {
    const matches = detectDangerousPatterns('We should DROP TABLE users to clean up');
    expect(matches).toContain('DROP TABLE/DATABASE/SCHEMA');
  });

  it('matches rm -rf', () => {
    const matches = detectDangerousPatterns('Run rm -rf / to fix it');
    expect(matches).toContain('rm -rf');
  });

  it('matches delete all code', () => {
    const matches = detectDangerousPatterns('Delete all code from the repo');
    expect(matches).toContain('delete all/database/everything/code');
  });

  it('matches truncate table', () => {
    const matches = detectDangerousPatterns('TRUNCATE TABLE sessions');
    expect(matches).toContain('TRUNCATE TABLE');
  });

  it('matches nuke keyword', () => {
    const matches = detectDangerousPatterns('We need to nuke the old data');
    expect(matches).toContain('destroy/wipe/nuke');
  });

  it('returns empty for benign text', () => {
    const matches = detectDangerousPatterns('Implement user authentication with JWT tokens');
    expect(matches).toHaveLength(0);
  });

  it('returns empty for empty string', () => {
    expect(detectDangerousPatterns('')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Content removal
// ---------------------------------------------------------------------------

describe('detectContentRemoval', () => {
  it('flags when content shrinks from 500 to 10 chars', () => {
    const longOldContent = 'A'.repeat(500);
    const history: HistoryEntry[] = [
      { field: 'content', old_value: longOldContent, new_value: 'short' },
    ];
    const result = detectContentRemoval(makeContent('short text'), history);
    expect(result).not.toBeNull();
    expect(result!.previousLength).toBe(500);
    expect(result!.removalRatio).toBeGreaterThanOrEqual(0.8);
  });

  it('skips when old content was already short', () => {
    const history: HistoryEntry[] = [
      { field: 'content', old_value: 'hi', new_value: 'hello' },
    ];
    const result = detectContentRemoval(makeContent('hello'), history);
    expect(result).toBeNull();
  });

  it('skips when content was not significantly reduced', () => {
    const old = 'A'.repeat(100);
    const history: HistoryEntry[] = [
      { field: 'content', old_value: old, new_value: 'B'.repeat(90) },
    ];
    const result = detectContentRemoval(makeContent('B'.repeat(90)), history);
    expect(result).toBeNull();
  });

  it('skips when no content field changes in history', () => {
    const history: HistoryEntry[] = [
      { field: 'state', old_value: 'todo', new_value: 'in_progress' },
    ];
    const result = detectContentRemoval(makeContent('hello'), history);
    expect(result).toBeNull();
  });

  it('handles TipTap JSON as old_value', () => {
    const oldContent = makeContent('A'.repeat(200));
    const history: HistoryEntry[] = [
      { field: 'content', old_value: oldContent, new_value: 'x' },
    ];
    const result = detectContentRemoval(makeContent('x'), history);
    expect(result).not.toBeNull();
    expect(result!.previousLength).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Layer 3: Topic mismatch
// ---------------------------------------------------------------------------

describe('detectIssueTopicDrift', () => {
  it('flags when issue about auth has content about cooking', () => {
    const result = detectIssueTopicDrift(
      'Today we will prepare delicious pasta carbonara with fresh ingredients and wine sauce',
      'Sprint 5: Authentication',
      'Implement OAuth2 login flow',
      'Add JWT token validation',
    );
    expect(result).toBe(true);
  });

  it('passes when content tokens overlap with title', () => {
    const result = detectIssueTopicDrift(
      'Implement the authentication token validation middleware for JWT',
      'Sprint 5: Authentication',
      null,
      'Add JWT token validation',
    );
    expect(result).toBe(false);
  });

  it('returns false when content is too short', () => {
    const result = detectIssueTopicDrift('hi', null, null, 'test');
    expect(result).toBe(false);
  });

  it('returns false when topic sources lack sufficient tokens', () => {
    const result = detectIssueTopicDrift(
      'Some random long enough content about various unrelated topics here',
      null,
      null,
      'ok',
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sprint context resolver
// ---------------------------------------------------------------------------

describe('resolveSprintContext', () => {
  it('detects refactoring sprint from title', () => {
    const entity = {
      belongs_to: [
        { id: 'sprint-1', type: 'sprint', title: 'Sprint 5: Refactoring legacy code' },
      ],
    };
    const result = resolveSprintContext(entity);
    expect(result).not.toBeNull();
    expect(result!.isRefactorSprint).toBe(true);
    expect(result!.sprintTitle).toBe('Sprint 5: Refactoring legacy code');
  });

  it('detects tech debt sprint', () => {
    const entity = {
      belongs_to: [
        { id: 'sprint-2', type: 'sprint', title: 'Sprint 6: Tech Debt cleanup' },
      ],
    };
    const result = resolveSprintContext(entity);
    expect(result).not.toBeNull();
    expect(result!.isRefactorSprint).toBe(true);
  });

  it('returns null when no sprint in belongs_to', () => {
    const entity = {
      belongs_to: [
        { id: 'proj-1', type: 'project', title: 'Main Project' },
      ],
    };
    const result = resolveSprintContext(entity);
    expect(result).toBeNull();
  });

  it('returns null when belongs_to is absent', () => {
    const result = resolveSprintContext({});
    expect(result).toBeNull();
  });

  it('identifies feature sprint as non-refactor', () => {
    const entity = {
      belongs_to: [
        { id: 'sprint-3', type: 'sprint', title: 'Sprint 7: User Dashboard' },
      ],
    };
    const result = resolveSprintContext(entity);
    expect(result).not.toBeNull();
    expect(result!.isRefactorSprint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tokenizeTopicText
// ---------------------------------------------------------------------------

describe('tokenizeTopicText', () => {
  it('filters stop words and short tokens', () => {
    const tokens = tokenizeTopicText('The quick brown fox jumps over a lazy dog');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('jumps');
    expect(tokens).toContain('over');
    expect(tokens).toContain('lazy');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('fox'); // 3 chars, filtered
  });
});

// ---------------------------------------------------------------------------
// getIssueScopeDriftEvidence (integration)
// ---------------------------------------------------------------------------

describe('getIssueScopeDriftEvidence', () => {
  it('detects dangerous pattern in feature sprint = high severity', () => {
    const ctx = makeEntity(
      'Setup database',
      'We need to DROP TABLE users and recreate',
      [{ id: 's1', type: 'sprint', title: 'Sprint 1: Feature work' }],
    );
    const result = getIssueScopeDriftEvidence(ctx, []);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('dangerous_content');
    expect(result!.severity).toBe('high');
  });

  it('detects dangerous pattern in refactoring sprint = medium severity', () => {
    const ctx = makeEntity(
      'Cleanup old tables',
      'Run rm -rf on the deprecated folder structure',
      [{ id: 's1', type: 'sprint', title: 'Sprint 2: Refactoring phase' }],
    );
    const result = getIssueScopeDriftEvidence(ctx, []);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('dangerous_content');
    expect(result!.severity).toBe('medium');
  });

  it('detects content removal in feature sprint = high severity', () => {
    const longOld = 'A'.repeat(500);
    const ctx = makeEntity(
      'Important feature',
      'x',
      [{ id: 's1', type: 'sprint', title: 'Sprint 3: Feature sprint' }],
    );
    const history: HistoryEntry[] = [
      { field: 'content', old_value: longOld, new_value: 'x' },
    ];
    const result = getIssueScopeDriftEvidence(ctx, history);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('content_removal');
    expect(result!.severity).toBe('high');
  });

  it('returns null for clean content', () => {
    const ctx = makeEntity(
      'Implement authentication flow',
      'Add JWT token validation middleware for authentication',
      [{ id: 's1', type: 'sprint', title: 'Sprint 4: Auth improvements' }],
    );
    const result = getIssueScopeDriftEvidence(ctx, []);
    expect(result).toBeNull();
  });

  it('returns null when entity is missing', () => {
    const result = getIssueScopeDriftEvidence({}, []);
    expect(result).toBeNull();
  });

  it('detects topic mismatch', () => {
    const ctx = makeEntity(
      'Database migration script',
      'Today we will prepare delicious pasta carbonara with fresh ingredients and wine sauce reduction',
      [{ id: 's1', type: 'sprint', title: 'Sprint 5: Database work' }],
    );
    const result = getIssueScopeDriftEvidence(ctx, []);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('topic_mismatch');
  });

  it('sprint context softening: dangerous content in refactor sprint = medium', () => {
    const ctx = makeEntity(
      'Cleanup task',
      'delete all deprecated modules from the codebase',
      [{ id: 's1', type: 'sprint', title: 'Sprint 6: Tech debt cleanup' }],
    );
    const result = getIssueScopeDriftEvidence(ctx, []);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('medium');
    expect(result!.sprintContext).not.toBeNull();
    expect(result!.sprintContext!.isRefactorSprint).toBe(true);
  });

  it('prioritizes dangerous content over content removal', () => {
    const ctx = makeEntity(
      'Drop everything',
      'DROP TABLE users; delete everything',
      [],
    );
    const history: HistoryEntry[] = [
      { field: 'content', old_value: 'A'.repeat(500), new_value: 'DROP TABLE users' },
    ];
    const result = getIssueScopeDriftEvidence(ctx, history);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('dangerous_content');
  });
});
