import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../../src/enricher/core/ai/service';
import { LLMService } from '../../src/enricher/core/ai/llm_service';
import { ModelRouter } from '../../src/enricher/core/ai/model_router';
import { EXTRACT_CONTACTS_PROMPT } from '../../src/enricher/core/ai/prompt_templates';

vi.mock('../../src/enricher/core/ai/llm_service', () => ({
  LLMService: {
    complete: vi.fn(),
    completeStructured: vi.fn(),
  },
}));

vi.mock('../../src/enricher/core/ai/model_router', () => ({
  ModelRouter: {
    selectTaskChain: vi.fn(() => ['gpt-4o-mini', 'deepseek-chat']),
  },
}));

describe('AIService.extractContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses structured outputs and merges deterministic contact fallback', async () => {
    vi.mocked(LLMService.completeStructured).mockResolvedValue({
      vat: null,
      pec: null,
      ceo_name: null,
      phone: null,
      email: null,
      confidence: 0.74,
    } as any);

    const service = new AIService();
    const result = await service.extractContacts(`
      <html>
        <body>
          <a href="mailto:info@acme.it">info@acme.it</a>
          <p>Telefono +39 02 1234567</p>
        </body>
      </html>
    `, 'ACME S.R.L.');

    expect(result.email).toBe('info@acme.it');
    expect(LLMService.completeStructured).toHaveBeenCalledWith(
      expect.any(String),
      EXTRACT_CONTACTS_PROMPT.schema,
      'gpt-4o-mini',
      ['deepseek-chat'],
      EXTRACT_CONTACTS_PROMPT.system,
    );
    expect(LLMService.complete).not.toHaveBeenCalled();
    expect(ModelRouter.selectTaskChain).toHaveBeenCalledWith('contact_extraction', { strictJson: true });
  });
});
