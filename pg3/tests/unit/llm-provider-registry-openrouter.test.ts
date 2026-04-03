import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const chatCompletionMock = vi.fn();

vi.mock('../../src/shared-runtime/ai/LLMService', () => ({
  LLMService: {
    chatCompletion: chatCompletionMock,
  },
}));

describe('LLM provider registry OpenRouter wiring', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses the centralized LLMService with the cheap OpenRouter alias for query resolvers', async () => {
    chatCompletionMock.mockResolvedValue({
      choices: [{
        message: {
          content: '[{"title":"Acme","url":"https://acme.it","snippet":"Sito ufficiale"}]',
        },
      }],
    });

    const { buildLlmProviderEntries } = await import('../../src/enricher/runtime/providers/llm_provider_registry');
    const providers = new Map(buildLlmProviderEntries());
    const results = await providers.get('OPENROUTER-FAST-2')!.execute({
      query: 'Acme Milano',
    });

    expect(chatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      temperature: 0.1,
    }), 'openrouter:fast');
    expect(results).toEqual([{
      title: 'Acme',
      url: 'https://acme.it',
      snippet: 'Sito ufficiale',
    }]);
  });

  it('keeps OPENROUTER-2 as a backwards-compatible cheap-model alias', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    chatCompletionMock.mockResolvedValue({
      id: 'chatcmpl-test',
      choices: [{ message: { content: 'raw' } }],
    });

    const { buildLlmProviderEntries } = await import('../../src/enricher/runtime/providers/llm_provider_registry');
    const providers = new Map(buildLlmProviderEntries());
    const payload = {
      messages: [{ role: 'user', content: 'hello' }],
      response_format: { type: 'json_object' },
    };

    await providers.get('OPENROUTER-2')!.execute(payload);

    expect(chatCompletionMock).toHaveBeenCalledWith(payload, 'openrouter:fast');
  });

  it('routes OPENROUTER-SMART-3 through the smart OpenRouter alias', async () => {
    chatCompletionMock.mockResolvedValue({
      choices: [{
        message: {
          content: '[{"title":"Acme","url":"https://acme.it","snippet":"Sito ufficiale"}]',
        },
      }],
    });

    const { buildLlmProviderEntries } = await import('../../src/enricher/runtime/providers/llm_provider_registry');
    const providers = new Map(buildLlmProviderEntries());

    await providers.get('OPENROUTER-SMART-3')!.execute({
      query: 'Acme Milano',
    });

    expect(chatCompletionMock).toHaveBeenCalledWith(expect.any(Object), 'openrouter:smart');
  });
});
