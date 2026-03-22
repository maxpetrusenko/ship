const ISSUE_ENTITY_TYPE_SCHEMA = {
  type: 'string',
  enum: ['issue'],
} as const;

const ANY_ENTITY_TYPE_SCHEMA = {
  type: 'string',
  enum: ['issue', 'project', 'sprint', 'workspace'],
} as const;

const REASSIGN_ISSUE_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['reassign_issue'] },
    targetEntityType: ISSUE_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['assignee_id'],
      properties: {
        assignee_id: { type: 'string' },
      },
    },
  },
} as const;

const CHANGE_STATE_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['change_state'] },
    targetEntityType: ISSUE_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['state'],
      properties: {
        state: {
          type: 'string',
          enum: ['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
        },
      },
    },
  },
} as const;

const ESCALATE_PRIORITY_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['escalate_priority'] },
    targetEntityType: ISSUE_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['priority'],
      properties: {
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
        },
      },
    },
  },
} as const;

const FLAG_ISSUE_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['flag_issue'] },
    targetEntityType: ISSUE_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['priority', 'reason'],
      properties: {
        priority: { type: 'string', enum: ['urgent'] },
        reason: {
          anyOf: [
            { type: 'string' },
            { type: 'null' },
          ],
        },
      },
    },
  },
} as const;

const ADD_COMMENT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['add_comment'] },
    targetEntityType: ANY_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string' },
      },
    },
  },
} as const;

const UPDATE_CONTENT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actionType',
    'targetEntityType',
    'targetEntityId',
    'description',
    'payload',
  ],
  properties: {
    actionType: { type: 'string', enum: ['update_content'] },
    targetEntityType: ANY_ENTITY_TYPE_SCHEMA,
    targetEntityId: { type: 'string' },
    description: { type: 'string' },
    payload: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Plain-text content to set as the document body. Use markdown-style formatting: paragraphs separated by blank lines, headings with # prefix, bullet lists with - prefix.' },
      },
    },
  },
} as const;

export const FLEETGRAPH_CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'recommendation', 'branch', 'proposedAction', 'citations'],
  properties: {
    summary: { type: 'string' },
    recommendation: { type: 'string' },
    branch: {
      type: 'string',
      enum: ['inform_only', 'confirm_action'],
    },
    proposedAction: {
      anyOf: [
        { type: 'null' },
        REASSIGN_ISSUE_ACTION_SCHEMA,
        CHANGE_STATE_ACTION_SCHEMA,
        ESCALATE_PRIORITY_ACTION_SCHEMA,
        FLAG_ISSUE_ACTION_SCHEMA,
        ADD_COMMENT_ACTION_SCHEMA,
        UPDATE_CONTENT_ACTION_SCHEMA,
      ],
    },
    citations: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;
