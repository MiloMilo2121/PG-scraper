import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const createMock = vi.fn();
const openAiCtorMock = vi.fn(() => ({
  chat: {
    completions: {
      create: createMock,
    },
  },
}));

vi.mock('openai', () => ({
  default: openAiCtorMock,
}));

async function loadService(overrides: Record<string, string>) {
  vi.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    OPENROUTER_MODEL_FAST: '',
    OPENROUTER_MODEL_SMART: '',
    ...overrides,
  };

  return import('../../src/shared-runtime/ai/LLMService');
}

describe('LLMService system prompt wiring', () => {
  beforeEach(() => {
    createMock.mockReset();
    openAiCtorMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes system and user messages to complete()', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { LLMService } = await loadService({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENROUTER_MODEL_FAST: 'openai/gpt-5-nano',
      OPENROUTER_MODEL_SMART: 'google/gemini-2.5-flash-lite',
    });

    await LLMService.complete('USER_PROMPT', 'openrouter:fast', undefined, 'SYSTEM_PROMPT');

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: 'SYSTEM_PROMPT' },
        { role: 'user', content: 'USER_PROMPT' },
      ],
    }));
  });

  it('passes system and user messages to completeStructured()', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { LLMService } = await loadService({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENROUTER_MODEL_FAST: 'openai/gpt-5-nano',
      OPENROUTER_MODEL_SMART: 'google/gemini-2.5-flash-lite',
    });

    await LLMService.completeStructured(
      'USER_PROMPT',
      {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      'openrouter:fast',
      undefined,
      'SYSTEM_PROMPT',
    );

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: 'SYSTEM_PROMPT' },
        { role: 'user', content: 'USER_PROMPT' },
      ],
    }));
  });
});
