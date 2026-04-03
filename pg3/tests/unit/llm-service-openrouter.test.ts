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

describe('LLMService OpenRouter glue', () => {
  beforeEach(() => {
    createMock.mockReset();
    openAiCtorMock.mockClear();
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
      },
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('routes openrouter:fast through the configured cheap OpenRouter model', async () => {
    const { LLMService } = await loadService({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENROUTER_MODEL_FAST: 'openai/gpt-5-nano',
      OPENROUTER_MODEL_SMART: 'google/gemini-2.5-flash-lite',
    });

    await LLMService.chatCompletion({
      messages: [{ role: 'user', content: 'ciao' }],
      temperature: 0.1,
    }, 'openrouter:fast');

    expect(openAiCtorMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-or-v1-test',
      baseURL: 'https://openrouter.ai/api/v1',
    }));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-5-nano',
    }));
  });

  it('routes openrouter:smart through the configured smart OpenRouter model', async () => {
    const { LLMService } = await loadService({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENROUTER_MODEL_FAST: 'openai/gpt-5-nano',
      OPENROUTER_MODEL_SMART: 'google/gemini-2.5-flash-lite',
    });

    await LLMService.chatCompletion({
      messages: [{ role: 'user', content: 'ciao' }],
      temperature: 0.1,
    }, 'openrouter:smart');

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'google/gemini-2.5-flash-lite',
    }));
  });
});
