import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMValidator } from '../../src/enricher/core/ai/llm_validator';
import { LLMService } from '../../src/enricher/core/ai/llm_service';
import { ModelRouter } from '../../src/enricher/core/ai/model_router';
import { SELECT_BEST_URL_PROMPT, VALIDATE_COMPANY_PROMPT } from '../../src/enricher/core/ai/prompt_templates';

vi.mock('../../src/enricher/core/ai/llm_service', () => ({
  LLMService: {
    completeStructured: vi.fn(),
    completeJSON: vi.fn(),
  },
}));

vi.mock('../../src/enricher/core/ai/model_router', () => ({
  ModelRouter: {
    selectTaskChain: vi.fn(() => ['gpt-4o-mini', 'deepseek-chat']),
    logTaskSelection: vi.fn(),
  },
}));

describe('LLMValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test';
  });

  it('passes the validation system prompt into completeStructured()', async () => {
    vi.mocked(LLMService.completeStructured).mockResolvedValue({
      isValid: true,
      confidence: 0.91,
      reasoning: 'strong signals',
      matched_signals: ['vat_match'],
      rejected_signals: [],
      entity_type: 'official_site',
      next_action: 'accept',
    } as any);

    const result = await LLMValidator.validateCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      vat_code: '12345678901',
    } as any, '<html>ACME S.R.L. P.IVA 12345678901 Milano</html>');

    expect(result.isValid).toBe(true);
    expect(LLMService.completeStructured).toHaveBeenCalledWith(
      expect.any(String),
      VALIDATE_COMPANY_PROMPT.schema,
      'gpt-4o-mini',
      ['deepseek-chat'],
      VALIDATE_COMPANY_PROMPT.system,
    );
  });

  it('never blindly returns a directory/social result when LLM selection fails', async () => {
    vi.mocked(LLMService.completeStructured).mockRejectedValue(new Error('LLM down'));

    const result = await LLMValidator.selectBestUrl(
      { company_name: 'ACME S.R.L.', city: 'Milano' } as any,
      [
        {
          url: 'https://www.paginegialle.it/acme',
          title: 'ACME S.R.L. - Milano',
          snippet: 'Scheda azienda ACME S.R.L.',
        },
        {
          url: 'https://www.facebook.com/acme',
          title: 'ACME | Facebook',
          snippet: 'Pagina Facebook di ACME',
        },
      ],
    );

    expect(result.bestUrl).toBeNull();
    expect(result.reasoning).toContain('No non-directory/social result');
  });

  it('falls back to the strongest non-directory candidate when LLM returns a bad directory choice', async () => {
    vi.mocked(LLMService.completeStructured).mockResolvedValue({
      bestUrl: 'https://www.paginegialle.it/acme',
      confidence: 0.85,
      reasoning: 'bad choice',
      signals: ['directory_only'],
    } as any);

    const result = await LLMValidator.selectBestUrl(
      { company_name: 'ACME S.R.L.', city: 'Milano' } as any,
      [
        {
          url: 'https://www.paginegialle.it/acme',
          title: 'ACME S.R.L. - Milano',
          snippet: 'Scheda azienda ACME S.R.L.',
        },
        {
          url: 'https://www.acmesrl.it',
          title: 'ACME S.R.L. - Servizi industriali',
          snippet: 'ACME S.R.L. Milano produzione e servizi industriali',
        },
      ],
    );

    expect(result.bestUrl).toBe('https://www.acmesrl.it');
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(LLMService.completeStructured).toHaveBeenCalledWith(
      expect.any(String),
      SELECT_BEST_URL_PROMPT.schema,
      'gpt-4o-mini',
      ['deepseek-chat'],
      SELECT_BEST_URL_PROMPT.system,
    );
  });
});
