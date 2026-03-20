import { describe, expect, it } from 'vitest';
import { buildFleetGraphChatInstructions } from './prompt.js';

describe('buildFleetGraphChatInstructions', () => {
  it('tells the model to stay evidence-based for project drift answers', () => {
    const instructions = buildFleetGraphChatInstructions({
      workspaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      entityType: 'project',
      entityId: 'proj-1',
      pageContext: null,
      toolNames: ['fetch_project_context', 'fetch_related_documents', 'fetch_entity_drift'],
      historyCount: 0,
    });

    expect(instructions).toContain('For project drift questions, call fetch_project_context and fetch_related_documents before answering');
    expect(instructions).toContain('Do not say "clearly scoped" or "no drift detected"');
    expect(instructions).toContain('no obvious drift signals in the inspected evidence');
    expect(instructions).toContain('If evidence is mixed or incomplete, say exactly what was inspected and what remains unknown.');
  });

  it('tells the model to broaden tool use for detailed analysis and default issue actions to the active issue', () => {
    const instructions = buildFleetGraphChatInstructions({
      workspaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      entityType: 'issue',
      entityId: 'iss-1',
      pageContext: {
        route: '/documents/iss-1',
        surface: 'issue',
        documentId: 'iss-1',
        title: 'Issue: Set up project structure',
        documentType: 'issue',
      },
      toolNames: ['fetch_issue_context', 'fetch_related_documents', 'fetch_document_content', 'fetch_entity_drift'],
      historyCount: 0,
    });

    expect(instructions).toContain('For detailed, root-cause, or comprehensive analysis, do not stop after a single tool');
    expect(instructions).toContain('For detailed issue analysis, inspect issue context, related documents, document content, and drift');
    expect(instructions).toContain('treat the active issue as the default action target unless the user explicitly names another ticket or document');
    expect(instructions).toContain('documentType=issue');
    expect(instructions).toContain('do not mutate data directly in chat');
    expect(instructions).toContain('Use call_ship_api only for read-only GET requests');
  });
});
