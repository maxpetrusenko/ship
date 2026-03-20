import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResponsesCreate, mockOpenAI } = vi.hoisted(() => {
  const responsesCreate = vi.fn();
  const OpenAI = vi.fn(function MockOpenAI(this: { responses: { create: typeof responsesCreate } }) {
    this.responses = {
      create: responsesCreate,
    };
  });

  return {
    mockResponsesCreate: responsesCreate,
    mockOpenAI: OpenAI,
  };
});

vi.mock('openai', () => ({
  default: mockOpenAI,
}));

describe('AI analysis service', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.SHIP_AI_ANALYSIS_MODEL;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.SHIP_AI_ANALYSIS_MODEL;
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }

    if (originalModel === undefined) {
      delete process.env.SHIP_AI_ANALYSIS_MODEL;
    } else {
      process.env.SHIP_AI_ANALYSIS_MODEL = originalModel;
    }
  });

  it('reports available when OPENAI_API_KEY is configured', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const { isAiAvailable } = await import('./ai-analysis.js');

    await expect(isAiAvailable()).resolves.toBe(true);
  });

  it('uses OpenAI responses for plan analysis', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SHIP_AI_ANALYSIS_MODEL = 'gpt-5.3-chat-latest';
    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        overall_score: 0.8,
        items: [
          {
            text: 'Ship OAuth login page',
            score: 0.8,
            feedback: 'Specific deliverable.',
            issues: [],
            conciseness_score: 0.9,
            is_verbose: false,
            conciseness_feedback: '',
          },
        ],
        workload_assessment: 'moderate',
        workload_feedback: 'Reasonable weekly scope.',
      }),
    });

    const { analyzePlan } = await import('./ai-analysis.js');
    const result = await analyzePlan({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Ship OAuth login page' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(mockOpenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      overall_score: 0.8,
      workload_assessment: 'moderate',
    });
  });
});
