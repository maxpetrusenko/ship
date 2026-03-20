import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFleetGraphChat } from './runtime.js';
import { FLEETGRAPH_CHAT_RESPONSE_SCHEMA } from './schema.js';
import { getFleetGraphChatToolSchemas } from './tools.js';
import type {
  FleetGraphChatDataAccess,
  FleetGraphChatRequest,
  FleetGraphResponsesClientLike,
  FleetGraphResponsesResponseLike,
} from './types.js';

function createClient(responses: FleetGraphResponsesResponseLike[]): FleetGraphResponsesClientLike & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;

  return {
    calls,
    responses: {
      create: vi.fn(async (body: Record<string, unknown>) => {
        calls.push(body);
        const response = responses[index];
        index += 1;
        if (!response) {
          throw new Error('No mock response configured');
        }
        return response;
      }),
    },
  };
}

function makeRequest(overrides: Partial<FleetGraphChatRequest> = {}): FleetGraphChatRequest {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    threadId: 'thread-1',
    entityType: 'issue',
    entityId: 'iss-1',
    question: 'what changed?',
    history: [],
    pageContext: {
      route: '/documents/iss-1/details',
      surface: 'issue',
      documentId: 'iss-1',
      title: 'Issue title',
      tab: 'details',
      tabLabel: 'Details',
    },
    ...overrides,
  };
}

function createData(overrides: Partial<FleetGraphChatDataAccess> = {}): FleetGraphChatDataAccess {
  return {
    async fetchIssueContext(_context, args) {
      return {
        found: true,
        issueId: args.issueId,
        summary: 'issue context',
      };
    },
    async fetchSprintContext(_context, args) {
      return {
        found: true,
        sprintId: args.sprintId,
        view: args.view,
      };
    },
    async fetchProjectContext(_context, args) {
      return {
        found: true,
        projectId: args.projectId,
      };
    },
    async fetchProjectSummary(_context, args) {
      return {
        found: true,
        projectId: args.projectId,
        counts: {
          total: 4,
          done: 1,
          in_progress: 2,
          todo: 1,
        },
        overloadedAssignees: [],
      };
    },
    async fetchSprintSummary(_context, args) {
      return {
        found: true,
        sprintId: args.sprintId,
        counts: {
          total: 3,
          done: 1,
          in_progress: 1,
          todo: 1,
        },
        overloadedAssignees: [],
      };
    },
    async fetchWorkspaceSignals(context) {
      return {
        found: true,
        workspaceId: context.workspaceId,
        accountability: { total: 1, overdue: 1, dueToday: 0, items: [] },
        managerActionItems: [],
      };
    },
    async fetchEntityDrift(_context, args) {
      return {
        found: true,
        entityType: args.entityType,
        entityId: args.entityId,
        scopeDrift: false,
      };
    },
    async fetchRelatedDocuments(_context, args) {
      return {
        found: true,
        documentId: args.documentId,
        relationshipType: args.relationshipType ?? null,
        relatedDocuments: [],
      };
    },
    async fetchDocumentContent(_context, args) {
      return {
        found: true,
        documentId: args.documentId,
        documentType: 'issue',
        title: 'Issue title',
        contentText: 'code is 123',
      };
    },
    async callShipApi(_context, args) {
      return {
        ok: true,
        method: args.method,
        path: args.path,
        body: args.bodyJson ?? null,
        status: 200,
        data: { success: true },
      };
    },
    ...overrides,
  };
}

function expectStrictObjectSchemas(schema: unknown): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  const record = schema as Record<string, unknown>;
  if (record.type === 'object') {
    expect(record.additionalProperties).toBe(false);
    const properties = record.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      expect(record.required).toEqual(Object.keys(properties as Record<string, unknown>));
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        expectStrictObjectSchemas(entry);
      }
      continue;
    }
    expectStrictObjectSchemas(value);
  }
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.LANGSMITH_TRACING = 'false';
  delete process.env.LANGCHAIN_TRACING_V2;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('runFleetGraphChat', () => {
  it('exports OpenAI-compatible tool schemas with explicit required arrays', () => {
    const schemas = getFleetGraphChatToolSchemas();
    const schemaNames = schemas.map((schema) => schema.name);

    expect(schemas).not.toHaveLength(0);
    expect(schemaNames).toEqual(expect.arrayContaining([
      'fetch_project_summary',
      'fetch_sprint_summary',
      'call_ship_api',
    ]));
    for (const schema of schemas) {
      const parameters = schema.parameters as {
        properties?: Record<string, unknown>;
        required?: unknown;
      };
      const propertyKeys = Object.keys(parameters.properties ?? {});
      expect(parameters.required).toEqual(propertyKeys);
    }
  });

  it('exports an OpenAI-compatible strict response schema', () => {
    expectStrictObjectSchemas(FLEETGRAPH_CHAT_RESPONSE_SCHEMA);
  });

  it('executes a tool call, feeds the output back, and returns the final assessment', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'fetch_issue_context',
            arguments: JSON.stringify({ issueId: 'iss-1' }),
          },
        ],
        output_text: '',
        usage: { input_tokens: 20, output_tokens: 3 },
      },
      {
        id: 'resp-2',
        output: [],
        output_text: JSON.stringify({
          summary: 'Issue is stale and should be reviewed.',
          recommendation: 'Ping the assignee.',
          branch: 'inform_only',
          proposedAction: null,
          citations: ['issue-context'],
        }),
        usage: { input_tokens: 18, output_tokens: 10 },
      },
    ]);

    const data = createData({
      async fetchIssueContext(_context, args) {
        return {
          found: true,
          issueId: args.issueId,
          title: 'Issue title',
        };
      },
    });

    const result = await runFleetGraphChat(makeRequest(), {
      client,
      data,
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    });

    expect(result.responseId).toBe('resp-2');
    expect(result.steps).toBe(2);
    expect(result.assessment.summary).toBe('Issue is stale and should be reviewed.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('fetch_issue_context');
    expect(result.toolCalls[0]?.arguments).toEqual({ issueId: 'iss-1' });
    expect(result.toolCalls[0]?.result).toEqual({
      found: true,
      issueId: 'iss-1',
      title: 'Issue title',
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.tools).toBeTruthy();
  });

  it('rewrites ambiguous issue actions back to the active issue page target', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [],
        output_text: JSON.stringify({
          summary: 'Add setup steps to the issue and move it into review.',
          recommendation: 'Approve the issue update.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'change_state',
            targetEntityType: 'issue',
            targetEntityId: 'iss-2',
            description: 'Move the issue into review.',
            payload: {
              state: 'in_review',
            },
          },
          citations: ['issue-context'],
        }),
        usage: { input_tokens: 18, output_tokens: 10 },
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      question: 'fix it',
    }), {
      client,
      data: createData(),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 1,
    });

    expect(result.assessment.proposedAction?.targetEntityId).toBe('iss-1');
    expect(result.assessment.citations).toContain('page-context:current-issue-target');
  });

  it('keeps an explicitly requested alternate issue target', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [],
        output_text: JSON.stringify({
          summary: 'Move ticket #42 into review.',
          recommendation: 'Approve the ticket update.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'change_state',
            targetEntityType: 'issue',
            targetEntityId: 'iss-42',
            description: 'Move ticket #42 into review.',
            payload: {
              state: 'in_review',
            },
          },
          citations: ['issue-context'],
        }),
        usage: { input_tokens: 18, output_tokens: 10 },
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      question: 'move ticket #42 into review',
    }), {
      client,
      data: createData(),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 1,
    });

    expect(result.assessment.proposedAction?.targetEntityId).toBe('iss-42');
    expect(result.assessment.citations).not.toContain('page-context:current-issue-target');
  });

  it('supports project summary rollup tools for count questions', async () => {
    const client = createClient([
      {
        id: 'resp-rollup-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-rollup-1',
            name: 'fetch_project_summary',
            arguments: JSON.stringify({ projectId: 'proj-1' }),
          },
        ],
        output_text: '',
        usage: { input_tokens: 12, output_tokens: 3 },
      },
      {
        id: 'resp-rollup-2',
        output: [],
        output_text: JSON.stringify({
          summary: 'There are 2 items in progress for this project.',
          recommendation: 'Review assignee load before adding more work.',
          branch: 'inform_only',
          proposedAction: null,
          citations: ['project-summary'],
        }),
        usage: { input_tokens: 10, output_tokens: 9 },
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      entityType: 'project',
      entityId: 'proj-1',
      question: 'how many items are in progress for this project?',
    }), {
      client,
      data: createData({
        async fetchProjectSummary(_context, args) {
          return {
            found: true,
            projectId: args.projectId,
            counts: {
              total: 6,
              done: 2,
              in_progress: 2,
              todo: 2,
            },
            overloadedAssignees: [{ assigneeId: 'user-2', assigneeName: 'Taylor', activeCount: 5 }],
          };
        },
      }),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    });

    expect(result.assessment.summary).toContain('2 items in progress');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('fetch_project_summary');
    expect(result.toolCalls[0]?.result).toMatchObject({
      counts: {
        in_progress: 2,
      },
    });
  });

  it('sends conservative project drift guidance into the model request', async () => {
    const client = createClient([
      {
        id: 'resp-drift-1',
        output: [],
        output_text: JSON.stringify({
          summary: 'No obvious drift signals in the inspected evidence.',
          recommendation: 'Review the related issue titles before deciding on scope changes.',
          branch: 'inform_only',
          proposedAction: null,
          citations: ['project-context'],
        }),
        usage: { input_tokens: 11, output_tokens: 7 },
      },
    ]);

    await runFleetGraphChat(makeRequest({
      entityType: 'project',
      entityId: 'proj-1',
      question: 'is this project drifting?',
    }), {
      client,
      data: createData({
        async fetchProjectContext(_context, args) {
          return {
            found: true,
            entityType: 'project',
            project: {
              id: args.projectId,
              title: 'Authentication - Bug Fixes',
              plan: 'Resolve auth defects to improve retention and reduce support costs.',
              ownerId: 'user-1',
              accountableId: 'user-1',
              status: 'active',
            },
            drift: {
              scopeDrift: false,
              reason: null,
              evidence: {
                alignedIssueTitles: ['Add auth tests'],
                offTopicIssueTitles: [],
              },
            },
            retroContext: null,
          };
        },
        async fetchRelatedDocuments(_context, args) {
          return {
            found: true,
            documentId: args.documentId,
            relationshipType: args.relationshipType ?? null,
            relatedDocuments: [
              { id: 'iss-1', title: 'Add auth tests', type: 'issue', relationshipType: 'project' },
            ],
          };
        },
        async fetchEntityDrift(_context, args) {
          return {
            found: true,
            entityType: args.entityType,
            entityId: args.entityId,
            scopeDrift: false,
          };
        },
      }),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 2,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.instructions).toContain('For project drift questions, call fetch_project_context and fetch_related_documents before answering');
    expect(client.calls[0]?.instructions).toContain('Do not say "clearly scoped" or "no drift detected"');
    expect(client.calls[0]?.instructions).toContain('fetch_project_context');
    expect(client.calls[0]?.instructions).toContain('fetch_related_documents');
    expect(client.calls[0]?.instructions).toContain('fetch_entity_drift');
  });

  it('supports generic Ship API tool calls for read-only GET requests', async () => {
    const client = createClient([
      {
        id: 'resp-api-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-api-1',
            name: 'call_ship_api',
            arguments: JSON.stringify({
              method: 'GET',
              path: '/api/documents/doc-1/context',
              bodyJson: null,
            }),
          },
        ],
        output_text: '',
        usage: { input_tokens: 14, output_tokens: 3 },
      },
      {
        id: 'resp-api-2',
        output: [],
        output_text: JSON.stringify({
          summary: 'The document context was loaded.',
          recommendation: 'Review the returned issue metadata.',
          branch: 'inform_only',
          proposedAction: null,
          citations: ['ship-api'],
        }),
        usage: { input_tokens: 10, output_tokens: 7 },
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      entityType: 'project',
      entityId: 'doc-1',
      question: 'load this doc context',
    }), {
      client,
      data: createData({
        async callShipApi(_context, args) {
          return {
            ok: true,
            method: args.method,
            path: args.path,
            body: args.bodyJson ?? null,
            status: 200,
            data: { id: 'doc-1', title: 'Doc 1' },
          };
        },
      }),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'call_ship_api',
      arguments: {
        method: 'GET',
        path: '/api/documents/doc-1/context',
      },
      result: {
        ok: true,
        status: 200,
      },
    });
  });

  it('preloads issue context and document content for issue write requests before the model responds', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [],
        output_text: JSON.stringify({
          summary: 'Add setup content to the current issue.',
          recommendation: 'Approve the comment.',
          branch: 'confirm_action',
          proposedAction: {
            actionType: 'add_comment',
            targetEntityType: 'issue',
            targetEntityId: 'iss-1',
            description: 'Add initial setup content.',
            payload: {
              content: 'Setup content',
            },
          },
          citations: ['issue-context', 'document-content'],
        }),
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      question: 'please do that',
    }), {
      client,
      data: createData(),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 1,
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]?.name).toBe('fetch_issue_context');
    expect(result.toolCalls[1]?.name).toBe('fetch_document_content');

    const initialInput = client.calls[0]?.input as Array<{ role?: string; content?: string }>;
    expect(initialInput.some((item) =>
      item.role === 'developer' && item.content?.includes('Preloaded current issue context for this write request.'))).toBe(true);
  });

  it('attaches tool-step context when a chat tool throws', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'fetch_issue_context',
            arguments: JSON.stringify({ issueId: 'iss-1' }),
          },
        ],
        output_text: '',
        usage: { input_tokens: 20, output_tokens: 3 },
      },
    ]);

    await expect(runFleetGraphChat(makeRequest(), {
      client,
      data: createData({
        async fetchIssueContext() {
          throw new Error('issue query failed');
        },
      }),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    })).rejects.toMatchObject({
      message: 'FleetGraph chat tool failed: fetch_issue_context: issue query failed',
      context: expect.objectContaining({
        step: 1,
        toolName: 'fetch_issue_context',
        callId: 'call-1',
        arguments: { issueId: 'iss-1' },
        entityType: 'issue',
        entityId: 'iss-1',
        threadId: 'thread-1',
        pageRoute: '/documents/iss-1/details',
        causeMessage: 'issue query failed',
      }),
    });
  });

  it('answers current-page content questions directly from document body context', async () => {
    const client = createClient([]);
    const result = await runFleetGraphChat(makeRequest({
      question: 'what is the code?',
    }), {
      client,
      data: createData(),
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    });

    expect(result.assessment.summary).toBe('The code is 123.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('fetch_document_content');
    expect(result.toolCalls[0]?.callId).toBe('direct-page-content');
    expect(result.toolCalls[0]?.arguments).toEqual({ documentId: 'iss-1' });
    expect(result.toolCalls[0]?.result).toEqual({
      found: true,
      documentId: 'iss-1',
      documentType: 'issue',
      title: 'Issue title',
      contentText: 'code is 123',
    });
    expect(client.calls).toEqual([]);
  });

  it('prefers live page content over persisted server content for current-page questions', async () => {
    const client = createClient([]);
    const data = createData({
      async fetchDocumentContent(_context, args) {
        return {
          found: true,
          documentId: args.documentId,
          documentType: 'issue',
          title: 'Issue title',
          contentText: 'persisted content that is stale',
        };
      },
    });

    const result = await runFleetGraphChat(makeRequest({
      question: 'what is the code?',
      pageContext: {
        route: '/documents/iss-1/details',
        surface: 'issue',
        documentId: 'iss-1',
        title: 'Issue title',
        visibleContentText: 'code is 123',
      },
    }), {
      client,
      data,
      model: 'gpt-5.3-chat-latest',
      maxSteps: 3,
    });

    expect(result.assessment.summary).toBe('The code is 123.');
    expect(result.toolCalls).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it('stops after the configured max step count', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'fetch_issue_context',
            arguments: JSON.stringify({ issueId: 'iss-1' }),
          },
        ],
        output_text: '',
      },
      {
        id: 'resp-2',
        output: [
          {
            type: 'function_call',
            call_id: 'call-2',
            name: 'fetch_issue_context',
            arguments: JSON.stringify({ issueId: 'iss-1' }),
          },
        ],
        output_text: '',
      },
    ]);

    await expect(
      runFleetGraphChat(makeRequest(), {
        client,
        data: createData(),
        maxSteps: 1,
      }),
    ).rejects.toThrow(/max tool steps/i);
  });

  it('allows longer tool chains for detailed analysis requests', async () => {
    const client = createClient([
      {
        id: 'resp-1',
        output: [
          {
            type: 'function_call',
            call_id: 'call-1',
            name: 'fetch_issue_context',
            arguments: JSON.stringify({ issueId: 'iss-1' }),
          },
        ],
        output_text: '',
      },
      {
        id: 'resp-2',
        output: [
          {
            type: 'function_call',
            call_id: 'call-2',
            name: 'fetch_related_documents',
            arguments: JSON.stringify({ documentId: 'iss-1', relationshipType: 'project' }),
          },
        ],
        output_text: '',
      },
      {
        id: 'resp-3',
        output: [
          {
            type: 'function_call',
            call_id: 'call-3',
            name: 'fetch_document_content',
            arguments: JSON.stringify({ documentId: 'iss-1' }),
          },
        ],
        output_text: '',
      },
      {
        id: 'resp-4',
        output: [
          {
            type: 'function_call',
            call_id: 'call-4',
            name: 'fetch_entity_drift',
            arguments: JSON.stringify({ entityType: 'issue', entityId: 'iss-1' }),
          },
        ],
        output_text: '',
      },
      {
        id: 'resp-5',
        output: [],
        output_text: JSON.stringify({
          summary: 'Detailed analysis complete.',
          recommendation: 'Review the issue with the linked project context.',
          branch: 'inform_only',
          proposedAction: null,
          citations: ['issue-context', 'document-content', 'entity-drift'],
        }),
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      question: 'give me a detailed root cause analysis of this issue',
    }), {
      client,
      data: createData(),
      model: 'gpt-5.3-chat-latest',
    });

    expect(result.steps).toBe(5);
    expect(result.toolCalls).toHaveLength(4);
    expect(result.assessment.summary).toBe('Detailed analysis complete.');
  });

  it.each([
    'database url?',
    'prod access details?',
    'which env vars are used for deploy?',
    'hostinger config',
  ])('denies sensitive prompt without a disclosure verb: %s', async (question) => {
    const client = createClient([
      {
        id: 'resp-should-not-run',
        output: [],
        output_text: '',
      },
    ]);

    const result = await runFleetGraphChat(makeRequest({
      entityType: 'workspace',
      entityId: 'ws-1',
      question,
    }), {
      client,
      data: createData(),
    });

    expect(result.assessment.branch).toBe('inform_only');
    expect(result.assessment.summary).toMatch(/can't help with secrets/i);
    expect(result.toolCalls).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it('fails fast when a chat model step times out', async () => {
    const client = createClient([]);
    client.responses.create = vi.fn(async () => new Promise(() => {}));

    await expect(
      runFleetGraphChat(makeRequest({
        entityType: 'workspace',
        entityId: 'ws-1',
        question: 'overall execution health',
      }), {
        client,
        data: createData(),
        stepTimeoutMs: 10,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
