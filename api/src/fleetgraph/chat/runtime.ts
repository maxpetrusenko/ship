import OpenAI from 'openai';
import { traceable } from 'langsmith/traceable';
import type {
  FleetGraphChatMessage,
  FleetGraphAssessment,
} from '@ship/shared';
import {
  buildFleetGraphChatInstructions,
  FLEETGRAPH_CHAT_MODEL,
} from './prompt.js';
import { FLEETGRAPH_CHAT_RESPONSE_SCHEMA } from './schema.js';
import {
  createFleetGraphChatDataAccess,
  normalizeChatPageContext,
} from './data.js';
import {
  executeFleetGraphChatTool,
  getFleetGraphChatToolDescription,
  getFleetGraphChatToolNames,
  getFleetGraphChatToolSchemas,
  resolveToolInput,
} from './tools.js';
import type {
  FleetGraphChatDataAccess,
  FleetGraphChatRequest,
  FleetGraphChatRuntimeAssessment,
  FleetGraphChatRuntimeDependencies,
  FleetGraphChatRuntimeResult,
  FleetGraphChatToolContext,
  FleetGraphChatToolCallRecord,
  FleetGraphChatToolName,
  FleetGraphResponsesClientLike,
  FleetGraphResponsesFunctionCall,
  FleetGraphResponsesFunctionCallOutput,
  FleetGraphResponsesInputItem,
  FleetGraphResponsesResponseLike,
} from './types.js';
import {
  canUseLangSmithTracing,
  getLangSmithProjectName,
  resolveLangSmithRunUrl,
} from '../runtime/langsmith.js';

const DEFAULT_MAX_STEPS = 4;
const DETAILED_ANALYSIS_MAX_STEPS = 10;
const DEFAULT_STEP_TIMEOUT_MS = 15_000;

export class FleetGraphChatRuntimeError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = 'FleetGraphChatRuntimeError';
    this.context = context;
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createDefaultClient(): FleetGraphResponsesClientLike {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to create the FleetGraph chat client');
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as FleetGraphResponsesClientLike;
}

function toConversationInput(history: FleetGraphChatRequest['history']): FleetGraphResponsesInputItem[] {
  return (history ?? []).map((turn) => ({
    type: 'message',
    role: turn.role,
    content: turn.content,
  }));
}

function buildUserPrompt(request: FleetGraphChatRequest): string {
  return [
    `question: ${request.question}`,
    `entityType: ${request.entityType}`,
    `entityId: ${request.entityId}`,
    request.pageContext ? `pageContext.route: ${request.pageContext.route}` : 'pageContext.route: none',
    request.pageContext?.documentId ? `pageContext.documentId: ${request.pageContext.documentId}` : 'pageContext.documentId: none',
    request.pageContext?.title ? `pageContext.title: ${request.pageContext.title}` : 'pageContext.title: none',
    request.pageContext?.documentType ? `pageContext.documentType: ${request.pageContext.documentType}` : 'pageContext.documentType: none',
    request.pageContext?.tab ? `pageContext.tab: ${request.pageContext.tab}` : 'pageContext.tab: none',
  ].join('\n');
}

function questionExplicitlyTargetsAnotherIssue(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/#\d+/.test(normalized)) {
    return true;
  }

  return /\b(ticket|issue|document|doc)\s+([a-f0-9]{8}-[a-f0-9-]{27}|[a-z0-9_-]{6,})\b/i.test(normalized);
}

function normalizeAssessmentTarget(
  request: FleetGraphChatRequest,
  assessment: FleetGraphChatRuntimeAssessment,
): FleetGraphChatRuntimeAssessment {
  const proposedAction = assessment.proposedAction;
  if (!proposedAction) {
    return assessment;
  }

  if (request.entityType !== 'issue' || proposedAction.targetEntityType !== 'issue') {
    return assessment;
  }

  const currentIssueId = request.pageContext?.documentId ?? request.entityId;
  if (!currentIssueId || proposedAction.targetEntityId === currentIssueId) {
    return assessment;
  }

  if (questionExplicitlyTargetsAnotherIssue(request.question)) {
    return assessment;
  }

  const citations = assessment.citations.includes('page-context:current-issue-target')
    ? assessment.citations
    : [...assessment.citations, 'page-context:current-issue-target'];

  return {
    ...assessment,
    citations,
    proposedAction: {
      ...proposedAction,
      targetEntityId: currentIssueId,
    },
  };
}

function isIssueWriteIntent(request: FleetGraphChatRequest): boolean {
  if (request.entityType !== 'issue') {
    return false;
  }

  const normalized = request.question.trim().toLowerCase();
  if (!normalized || isCurrentPageContentQuestion(request)) {
    return false;
  }

  return /\b(add|update|edit|change|rewrite|comment|move|reassign|set|mark|apply|approve|do it|do that|please do it|please do that|fix)\b/.test(normalized)
    || /^(yes|ok|okay|sure)\b/.test(normalized);
}

function isDetailedAnalysisRequest(request: FleetGraphChatRequest): boolean {
  const normalized = request.question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(detailed|detail|deeper|deep|comprehensive|thorough|root cause|investigate|full analysis|full review|trace)\b/.test(normalized);
}

function compactPreloadedValue(value: unknown, maxLength = 1600): string {
  const text = JSON.stringify(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

async function maybePreloadIssueWriteContext(
  request: FleetGraphChatRequest,
  data: FleetGraphChatDataAccess,
  context: FleetGraphChatToolContext,
): Promise<{
  inputItems: FleetGraphResponsesInputItem[];
  records: FleetGraphChatToolCallRecord[];
} | null> {
  if (!isIssueWriteIntent(request)) {
    return null;
  }

  const issueId = request.pageContext?.documentId ?? request.entityId;
  const [issueContext, documentContent] = await Promise.all([
    data.fetchIssueContext(context, { issueId }),
    data.fetchDocumentContent(context, { documentId: issueId }),
  ]);

  return {
    inputItems: [{
      type: 'message',
      role: 'developer',
      content: [
        'Preloaded current issue context for this write request.',
        `issueContext=${compactPreloadedValue(issueContext)}`,
        `documentContent=${compactPreloadedValue(documentContent)}`,
        'Use this evidence to choose the correct current issue target and approval action.',
      ].join('\n'),
    }],
    records: [
      {
        name: 'fetch_issue_context',
        callId: 'preflight-issue-context',
        arguments: { issueId },
        result: issueContext,
      },
      {
        name: 'fetch_document_content',
        callId: 'preflight-document-content',
        arguments: { documentId: issueId },
        result: documentContent,
      },
    ],
  };
}

type ResponseOutputItem = FleetGraphResponsesResponseLike['output'][number];
type ResponseFunctionCallItem = ResponseOutputItem & {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
};

function isResponseFunctionCallItem(item: ResponseOutputItem): item is ResponseFunctionCallItem {
  return item.type === 'function_call'
    && typeof item.call_id === 'string'
    && typeof item.name === 'string'
    && typeof item.arguments === 'string';
}

function extractFunctionCalls(response: FleetGraphResponsesResponseLike): FleetGraphResponsesFunctionCall[] {
  return response.output.flatMap((item) => {
    if (!isResponseFunctionCallItem(item)) {
      return [];
    }

    return [{
      type: 'function_call',
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    }];
  });
}

function asFleetGraphChatToolName(name: string): FleetGraphChatToolName {
  if (!getFleetGraphChatToolNames().includes(name as FleetGraphChatToolName)) {
    throw new Error(`Unsupported FleetGraph chat tool requested: ${name}`);
  }

  return name as FleetGraphChatToolName;
}

function parseAssessment(value: string): FleetGraphChatRuntimeAssessment {
  try {
    const parsed = JSON.parse(value) as FleetGraphAssessment;
    return {
      summary: parsed.summary,
      recommendation: parsed.recommendation,
      branch: parsed.branch,
      proposedAction: parsed.proposedAction ?? null,
      citations: parsed.citations ?? [],
    };
  } catch {
    return {
      summary: value.trim() || 'No response produced.',
      recommendation: 'Continue monitoring.',
      branch: 'inform_only',
      proposedAction: null,
      citations: [],
    };
  }
}

function buildMessage(assessment: FleetGraphChatRuntimeAssessment): FleetGraphChatMessage {
  return {
    role: 'assistant',
    content: assessment.summary,
    assessment: {
      summary: assessment.summary,
      recommendation: assessment.recommendation,
      branch: assessment.branch,
      citations: assessment.citations,
      ...(assessment.proposedAction ? { proposedAction: assessment.proposedAction } : {}),
    },
    timestamp: new Date().toISOString(),
  };
}

function buildResponseFormat() {
  return {
    format: {
      type: 'json_schema',
      name: 'fleetgraph_chat_assessment',
      description: 'FleetGraph chat response in the Ship assessment shape.',
      schema: FLEETGRAPH_CHAT_RESPONSE_SCHEMA,
      strict: true,
    },
    verbosity: 'medium' as const,
  };
}

function normalizeUsage(response: FleetGraphResponsesResponseLike): { input: number; output: number } | null {
  const input = response.usage?.input_tokens;
  const output = response.usage?.output_tokens;

  if (typeof input !== 'number') {
    return null;
  }

  return {
    input,
    output: typeof output === 'number' ? output : 0,
  };
}

function buildImmediateResult(assessment: FleetGraphChatRuntimeAssessment): FleetGraphChatRuntimeResult {
  return {
    responseId: null,
    traceUrl: null,
    steps: 0,
    assessment,
    message: buildMessage(assessment),
    toolCalls: [],
    rawOutputText: assessment.summary,
    usage: null,
  };
}

function isCurrentPageContentQuestion(request: FleetGraphChatRequest): boolean {
  if (!request.pageContext?.documentId) {
    return false;
  }

  const normalized = request.question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /\bwhat(?:'s| is)\b/.test(normalized)
    || /\b(show|tell|give|extract)\b/.test(normalized)
  ) && (
    /\bcode\b/.test(normalized)
    || /\b(content|text)\b/.test(normalized)
    || /\bthis page\b/.test(normalized)
    || /\bdocument\b/.test(normalized)
    || /\b(ticket|issue)\b.*\b(say|says|written)\b/.test(normalized)
  );
}

function buildCurrentPageContentAssessment(contentText: string): FleetGraphChatRuntimeAssessment {
  const exactCodeMatch = contentText.match(/\bcode\s+is\s+([A-Za-z0-9_-]+)\b/i);
  if (exactCodeMatch?.[1]) {
    return {
      summary: `The code is ${exactCodeMatch[1]}.`,
      recommendation: `Use ${exactCodeMatch[1]}.`,
      branch: 'inform_only',
      proposedAction: null,
      citations: ['document-content'],
    };
  }

  return {
    summary: `The current page says: ${contentText}`,
    recommendation: 'Ask for a shorter excerpt if you need a specific part.',
    branch: 'inform_only',
    proposedAction: null,
    citations: ['document-content'],
  };
}

async function resolveCurrentPageContentQuestion(
  request: FleetGraphChatRequest,
  data: FleetGraphChatDataAccess,
): Promise<FleetGraphChatRuntimeResult | null> {
  if (!isCurrentPageContentQuestion(request)) {
    return null;
  }

  const pageContext = normalizeChatPageContext(request.pageContext ?? null);
  const context: FleetGraphChatToolContext = {
    workspaceId: request.workspaceId,
    userId: request.userId,
    threadId: request.threadId,
    entityType: request.entityType,
    entityId: request.entityId,
    pageContext,
  };

  const visibleContentText = typeof pageContext?.visibleContentText === 'string'
    ? pageContext.visibleContentText.trim()
    : '';
  if (visibleContentText) {
    const assessment = buildCurrentPageContentAssessment(visibleContentText);
    const message = buildMessage(assessment);
    return {
      responseId: null,
      traceUrl: null,
      steps: 0,
      assessment,
      message,
      toolCalls: [],
      rawOutputText: message.content,
      usage: null,
    };
  }

  const documentId = pageContext?.documentId ?? request.entityId;
  const output = await data.fetchDocumentContent(context, { documentId });
  const contentText = typeof output.contentText === 'string' ? output.contentText.trim() : '';

  if (!contentText) {
    return buildImmediateResult({
      summary: 'I could not find document body text on this page.',
      recommendation: 'Refresh the page content or ask about a specific document section.',
      branch: 'inform_only',
      proposedAction: null,
      citations: [],
    });
  }

  const assessment = buildCurrentPageContentAssessment(contentText);
  const message = buildMessage(assessment);
  return {
    responseId: null,
    traceUrl: null,
    steps: 0,
    assessment,
    message,
    toolCalls: [{
      name: 'fetch_document_content',
      callId: 'direct-page-content',
      arguments: { documentId },
      result: output,
    }],
    rawOutputText: message.content,
    usage: null,
  };
}

function classifyBlockedQuestion(question: string): FleetGraphChatRuntimeAssessment | null {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const sensitiveTarget = /(secret|password|api[\s_-]?key|token|credential|private key|ssh key|\.env|env vars?|database|db\b|database url|connection string|deployment|deploy config|production server|prod server|access details?|infra(?:structure)?|hostinger|ssh access)/i;

  if (!sensitiveTarget.test(normalized)) {
    return null;
  }

  return {
    summary: "I can't help with secrets, database access, deployment internals, or other sensitive system details.",
    recommendation: 'Ask about Ship issues, sprints, projects, workspace health, or documented API behavior instead.',
    branch: 'inform_only',
    proposedAction: null,
    citations: [],
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runFleetGraphChatInternal(
  request: FleetGraphChatRequest,
  deps: FleetGraphChatRuntimeDependencies = {},
): Promise<FleetGraphChatRuntimeResult> {
  const blockedAssessment = classifyBlockedQuestion(request.question);
  if (blockedAssessment) {
    return buildImmediateResult(blockedAssessment);
  }

  const client = deps.client ?? createDefaultClient();
  const data = deps.data ?? createFleetGraphChatDataAccess();
  const directCurrentPageAnswer = await resolveCurrentPageContentQuestion(request, data);
  if (directCurrentPageAnswer) {
    return directCurrentPageAnswer;
  }
  const maxSteps = deps.maxSteps ?? (isDetailedAnalysisRequest(request) ? DETAILED_ANALYSIS_MAX_STEPS : DEFAULT_MAX_STEPS);
  const stepTimeoutMs = deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const toolSchemas = getFleetGraphChatToolSchemas();
  const toolNames = getFleetGraphChatToolNames();
  const toolContext: FleetGraphChatToolContext = {
    workspaceId: request.workspaceId,
    userId: request.userId,
    threadId: request.threadId,
    entityType: request.entityType,
    entityId: request.entityId,
    pageContext: normalizeChatPageContext(request.pageContext ?? null),
  };
  const preloadedIssueWriteContext = await maybePreloadIssueWriteContext(request, data, toolContext);

  let responseId: string | null = null;
  let step = 0;
  let input: FleetGraphResponsesInputItem[] = [
    ...toConversationInput(request.history),
    {
      type: 'message',
      role: 'user',
      content: buildUserPrompt(request),
    },
    ...(preloadedIssueWriteContext?.inputItems ?? []),
  ];
  const toolCalls: FleetGraphChatToolCallRecord[] = [...(preloadedIssueWriteContext?.records ?? [])];

  while (step < maxSteps) {
    let response: FleetGraphResponsesResponseLike;
    try {
      response = await withTimeout(
        client.responses.create({
          model: deps.model ?? FLEETGRAPH_CHAT_MODEL,
          input,
          previous_response_id: responseId ?? undefined,
          instructions: buildFleetGraphChatInstructions({
            workspaceId: request.workspaceId,
            userId: request.userId,
            threadId: request.threadId,
            entityType: request.entityType,
            entityId: request.entityId,
            pageContext: toolContext.pageContext,
            toolNames,
            historyCount: request.history?.length ?? 0,
          }),
          tools: toolSchemas,
          tool_choice: 'auto',
          text: buildResponseFormat(),
          truncation: 'auto',
        }) as Promise<FleetGraphResponsesResponseLike>,
        stepTimeoutMs,
        'FleetGraph chat model step',
      );
    } catch (err) {
      const causeMessage = getErrorMessage(err);
      throw new FleetGraphChatRuntimeError(`FleetGraph chat model step failed: ${causeMessage}`, {
        step: step + 1,
        entityType: request.entityType,
        entityId: request.entityId,
        threadId: request.threadId,
        pageRoute: toolContext.pageContext?.route ?? null,
        responseId,
        historyCount: request.history?.length ?? 0,
        causeMessage,
      });
    }

    responseId = response.id ?? responseId;
    const functionCalls = extractFunctionCalls(response);

    if (functionCalls.length === 0) {
      const assessment = normalizeAssessmentTarget(request, parseAssessment(response.output_text));
      return {
        responseId,
        traceUrl: null,
        steps: step + 1,
        assessment,
        message: buildMessage(assessment),
        toolCalls,
        rawOutputText: response.output_text,
        usage: normalizeUsage(response),
      };
    }

    const outputs: FleetGraphResponsesFunctionCallOutput[] = [];
    for (const call of functionCalls) {
      const toolName = asFleetGraphChatToolName(call.name);
      const inputArgs = resolveToolInput({
        name: toolName,
        rawArguments: call.arguments,
        context: toolContext,
      });
      let result;
      try {
        result = await executeFleetGraphChatTool({
          name: toolName,
          rawArguments: JSON.stringify(inputArgs),
          callId: call.call_id,
          context: toolContext,
          data,
        });
      } catch (err) {
        const causeMessage = getErrorMessage(err);
        throw new FleetGraphChatRuntimeError(`FleetGraph chat tool failed: ${toolName}: ${causeMessage}`, {
          step: step + 1,
          toolName,
          callId: call.call_id,
          arguments: inputArgs,
          entityType: request.entityType,
          entityId: request.entityId,
          threadId: request.threadId,
          pageRoute: toolContext.pageContext?.route ?? null,
          causeMessage,
        });
      }

      toolCalls.push(result.record);
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result.output),
      });
    }

    input = outputs;
    step += 1;
  }

  throw new Error(`FleetGraph chat exceeded max tool steps (${maxSteps})`);
}

export async function runFleetGraphChat(
  request: FleetGraphChatRequest,
  deps: FleetGraphChatRuntimeDependencies = {},
): Promise<FleetGraphChatRuntimeResult> {
  if (!canUseLangSmithTracing(process.env)) {
    return runFleetGraphChatInternal(request, deps);
  }

  let traceRunId: string | null = null;
  let traceClient: {
    readRunSharedLink: (runId: string) => Promise<string | undefined>;
    shareRun: (runId: string) => Promise<string>;
  } | null = null;

  const tracedRun = traceable(
    async (payload: FleetGraphChatRequest) => runFleetGraphChatInternal(payload, deps),
    {
      name: 'fleetgraph_chat_runtime',
      run_type: 'chain',
      project_name: getLangSmithProjectName(process.env) ?? undefined,
      tags: ['fleetgraph', 'chat'],
      processInputs: (inputs) => inputs,
      processOutputs: (outputs) => outputs,
      on_start(runTree) {
        if (runTree) {
          traceRunId = runTree.id;
          traceClient = runTree.client;
        }
      },
    },
  );

  const result = await tracedRun(request);
  if (!traceRunId) {
    return result;
  }

  const traceUrl = await resolveLangSmithRunUrl(traceRunId, traceClient ?? undefined);
  return {
    ...result,
    traceUrl: traceUrl ?? result.traceUrl ?? null,
  };
}

export function createFleetGraphChatRuntime(
  deps: FleetGraphChatRuntimeDependencies = {},
) {
  return {
    run: (request: FleetGraphChatRequest) => runFleetGraphChat(request, deps),
  };
}
