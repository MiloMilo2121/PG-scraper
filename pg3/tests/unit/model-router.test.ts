import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadModelRouter(overrides: Record<string, string>) {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    Z_AI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    KIMI_API_KEY: '',
    ...overrides,
  };

  return import('../../src/enricher/core/ai/model_router');
}

describe('ModelRouter task chains', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('prioritizes precision-oriented chains for company validation and serp selection', async () => {
    const { ModelRouter } = await loadModelRouter({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENAI_API_KEY: 'sk-test',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      Z_AI_API_KEY: 'sk-zai',
    });

    const validationChain = ModelRouter.selectTaskChain('company_validation', { strictJson: true });
    const serpChain = ModelRouter.selectTaskChain('serp_url_selection', { strictJson: true });

    expect(validationChain[0]).toBe('openrouter:smart');
    expect(validationChain).toContain('gpt-4o-mini');
    expect(serpChain[0]).toBe('openrouter:smart');
    expect(serpChain).toContain('gpt-4o-mini');
  });
});
