import type { FleetGraphChatHintContext } from './types.js';
import { FLEETGRAPH_CHAT_RESPONSE_SCHEMA } from './schema.js';

export const FLEETGRAPH_CHAT_MODEL =
  process.env.FLEETGRAPH_CHAT_MODEL_ID
  ?? process.env.FLEETGRAPH_MODEL_ID
  ?? 'gpt-5.3-chat-latest';

export function formatPageContextHint(pageContext: FleetGraphChatHintContext | null): string {
  if (!pageContext) {
    return 'pageContext: none';
  }

  const parts = [
    `route=${pageContext.route}`,
    `surface=${pageContext.surface}`,
    pageContext.documentId ? `documentId=${pageContext.documentId}` : null,
    pageContext.title ? `title=${pageContext.title}` : null,
    pageContext.tab ? `tab=${pageContext.tab}` : null,
    pageContext.tabLabel ? `tabLabel=${pageContext.tabLabel}` : null,
  ].filter(Boolean);

  return `pageContext: ${parts.join(' | ')}`;
}

export function buildFleetGraphChatInstructions(args: {
  workspaceId: string;
  userId: string;
  threadId: string;
  entityType: string;
  entityId: string;
  pageContext: FleetGraphChatHintContext | null;
  toolNames: string[];
  historyCount: number;
}): string {
  const toolList = args.toolNames.map((tool) => `- ${tool}`).join('\n');

  return [
    'You are FleetGraph, a server-side project health assistant for Ship.',
    'Stay inside Ship scope. Answer only Ship, project-health, and page-context questions.',
    'Use tools for any on-topic question that needs current data. Do not invent missing records.',
    'Page context is a tiny hint only. Treat it as UI location, not as source data.',
    'Permission scope is server-side. Stay inside the supplied workspace and user context.',
    'Decline requests for secrets, credentials, env vars, database access, deployment internals, or infrastructure internals.',
    'If the user asks what page they are on, answer from pageContext directly.',
    'If the user asks about an issue or ticket and the active entity is an issue, call fetch_issue_context before answering.',
    'If the user asks for deeper project, sprint, issue, drift, workspace, or related-document context, call the matching tool.',
    'If the request is on-topic but data is missing, call the best matching tool and say what is missing.',
    'If the request is off-topic, decline in one short sentence and redirect to Ship work.',
    'Return concise, high-signal answers. No filler.',
    'Final output must match this JSON schema exactly:',
    JSON.stringify(FLEETGRAPH_CHAT_RESPONSE_SCHEMA),
    '',
    `workspaceId=${args.workspaceId}`,
    `userId=${args.userId}`,
    `threadId=${args.threadId}`,
    `entityType=${args.entityType}`,
    `entityId=${args.entityId}`,
    `historyCount=${args.historyCount}`,
    formatPageContextHint(args.pageContext),
    '',
    'Available tools:',
    toolList,
  ].join('\n');
}
