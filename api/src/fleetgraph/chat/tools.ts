import type {
  FleetGraphChatDataAccess,
  FleetGraphChatToolCallRecord,
  FleetGraphChatToolContext,
  FleetGraphChatToolName,
  FleetGraphFunctionToolSchema,
} from './types.js';

type ToolArgs = Record<string, unknown>;

interface ToolDefinition {
  schema: FleetGraphFunctionToolSchema;
  description: string;
}

const TOOL_METHODS = {
  fetch_issue_context: 'fetchIssueContext',
  fetch_sprint_context: 'fetchSprintContext',
  fetch_project_context: 'fetchProjectContext',
  fetch_project_summary: 'fetchProjectSummary',
  fetch_sprint_summary: 'fetchSprintSummary',
  fetch_workspace_signals: 'fetchWorkspaceSignals',
  fetch_entity_drift: 'fetchEntityDrift',
  fetch_related_documents: 'fetchRelatedDocuments',
  fetch_document_content: 'fetchDocumentContent',
  call_ship_api: 'callShipApi',
} as const satisfies Record<FleetGraphChatToolName, keyof FleetGraphChatDataAccess>;

const TOOL_DEFINITIONS: Record<FleetGraphChatToolName, ToolDefinition> = {
  fetch_issue_context: {
    schema: {
      type: 'function',
      name: 'fetch_issue_context',
      description: 'Fetch a compact issue summary, history, children, associations, and drift signal.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          issueId: { type: 'string' },
        },
        required: ['issueId'],
      },
    },
    description: 'Fetch a compact issue summary, history, children, associations, and drift signal.',
  },
  fetch_sprint_context: {
    schema: {
      type: 'function',
      name: 'fetch_sprint_context',
      description: 'Fetch compact sprint context, standup or review view, and related issue summary.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sprintId: { type: 'string' },
          view: { type: 'string', enum: ['standup', 'review', 'retro'] },
        },
        required: ['sprintId', 'view'],
      },
    },
    description: 'Fetch compact sprint context, standup or review view, and related issue summary.',
  },
  fetch_project_context: {
    schema: {
      type: 'function',
      name: 'fetch_project_context',
      description: 'Fetch compact project context with retro signal and drift summary.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string' },
        },
        required: ['projectId'],
      },
    },
    description: 'Fetch compact project context with retro signal and drift summary.',
  },
  fetch_project_summary: {
    schema: {
      type: 'function',
      name: 'fetch_project_summary',
      description: 'Fetch project issue counts, sprint counts, and assignee load rollups.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string' },
        },
        required: ['projectId'],
      },
    },
    description: 'Fetch project issue counts, sprint counts, and assignee load rollups.',
  },
  fetch_sprint_summary: {
    schema: {
      type: 'function',
      name: 'fetch_sprint_summary',
      description: 'Fetch sprint issue counts, related project info, and assignee load rollups.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sprintId: { type: 'string' },
        },
        required: ['sprintId'],
      },
    },
    description: 'Fetch sprint issue counts, related project info, and assignee load rollups.',
  },
  fetch_workspace_signals: {
    schema: {
      type: 'function',
      name: 'fetch_workspace_signals',
      description: 'Fetch compact workspace-level accountability and sprint signals.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
    description: 'Fetch compact workspace-level accountability and sprint signals.',
  },
  fetch_entity_drift: {
    schema: {
      type: 'function',
      name: 'fetch_entity_drift',
      description: 'Fetch compact drift detection for the active entity or a supplied entity.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entityType: { type: 'string', enum: ['issue', 'project', 'sprint', 'workspace'] },
          entityId: { type: 'string' },
        },
        required: ['entityType', 'entityId'],
      },
    },
    description: 'Fetch compact drift detection for the active entity or a supplied entity.',
  },
  fetch_related_documents: {
    schema: {
      type: 'function',
      name: 'fetch_related_documents',
      description: 'Fetch related documents or associations for the active entity or a supplied document.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documentId: { type: 'string' },
          relationshipType: { type: ['string', 'null'] },
        },
        required: ['documentId', 'relationshipType'],
      },
    },
    description: 'Fetch related documents or associations for the active entity or a supplied document.',
  },
  fetch_document_content: {
    schema: {
      type: 'function',
      name: 'fetch_document_content',
      description: 'Fetch the active document body text for the current page or a supplied document.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documentId: { type: 'string' },
        },
        required: ['documentId'],
      },
    },
    description: 'Fetch the active document body text for the current page or a supplied document.',
  },
  call_ship_api: {
    schema: {
      type: 'function',
      name: 'call_ship_api',
      description: 'Call a read-only Ship REST endpoint as the current user. Use only GET requests for data not covered by dedicated FleetGraph tools. path must start with /api/ or be /health. bodyJson must be null for GET requests.',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          method: { type: 'string', enum: ['GET'] },
          path: { type: 'string' },
          bodyJson: { type: ['string', 'null'] },
        },
        required: ['method', 'path', 'bodyJson'],
      },
    },
    description: 'Call a read-only Ship REST endpoint as the current user. Use only GET requests for data not covered by dedicated FleetGraph tools.',
  },
};

export function getFleetGraphChatToolSchemas(): FleetGraphFunctionToolSchema[] {
  return Object.values(TOOL_DEFINITIONS).map((entry) => entry.schema);
}

export function getFleetGraphChatToolNames(): FleetGraphChatToolName[] {
  return Object.keys(TOOL_DEFINITIONS) as FleetGraphChatToolName[];
}

function readString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function executeFleetGraphChatTool(args: {
  name: FleetGraphChatToolName;
  rawArguments: string;
  callId: string;
  context: FleetGraphChatToolContext;
  data: FleetGraphChatDataAccess;
}): Promise<{
  output: Record<string, unknown>;
  record: FleetGraphChatToolCallRecord;
}> {
  const parsed = args.rawArguments.trim() ? JSON.parse(args.rawArguments) as ToolArgs : {};
  const dataFn = args.data[TOOL_METHODS[args.name]];
  const output = await dataFn(args.context, parsed);

  return {
    output,
    record: {
      name: args.name,
      callId: args.callId,
      arguments: parsed,
      result: output,
    },
  };
}

export function getFleetGraphChatToolDescription(name: FleetGraphChatToolName): string {
  return TOOL_DEFINITIONS[name].description;
}

export function resolveToolInput(args: {
  name: FleetGraphChatToolName;
  rawArguments: string;
  context: FleetGraphChatToolContext;
}): ToolArgs {
  const parsed = args.rawArguments.trim() ? JSON.parse(args.rawArguments) as ToolArgs : {};

  if (args.name === 'fetch_issue_context' && !readString(parsed, 'issueId')) {
    parsed.issueId = args.context.entityId;
  }
  if (args.name === 'fetch_sprint_context' && !readString(parsed, 'sprintId')) {
    parsed.sprintId = args.context.entityId;
  }
  if (args.name === 'fetch_sprint_context' && !readString(parsed, 'view')) {
    parsed.view = 'standup';
  }
  if (args.name === 'fetch_project_context' && !readString(parsed, 'projectId')) {
    parsed.projectId = args.context.entityId;
  }
  if (args.name === 'fetch_project_summary' && !readString(parsed, 'projectId')) {
    parsed.projectId = args.context.entityId;
  }
  if (args.name === 'fetch_sprint_summary' && !readString(parsed, 'sprintId')) {
    parsed.sprintId = args.context.entityId;
  }
  if (args.name === 'fetch_entity_drift' && !readString(parsed, 'entityId')) {
    parsed.entityId = args.context.entityId;
  }
  if (args.name === 'fetch_entity_drift' && !readString(parsed, 'entityType')) {
    parsed.entityType = args.context.entityType;
  }
  if (args.name === 'fetch_related_documents' && !readString(parsed, 'documentId')) {
    parsed.documentId = args.context.entityId;
  }
  if (args.name === 'fetch_related_documents' && !('relationshipType' in parsed)) {
    parsed.relationshipType = null;
  }
  if (args.name === 'fetch_document_content' && !readString(parsed, 'documentId')) {
    parsed.documentId = args.context.pageContext?.documentId ?? args.context.entityId;
  }
  if (args.name === 'call_ship_api' && !('bodyJson' in parsed)) {
    parsed.bodyJson = null;
  }

  return parsed;
}
