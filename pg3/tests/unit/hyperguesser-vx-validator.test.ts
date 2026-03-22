import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperGuesserVXValidator } from '../../src/enricher/core/discovery/hyperguesser_vx/validator';
import { LLMService } from '../../src/enricher/core/ai/llm_service';

vi.mock('../../src/enricher/core/ai/llm_service');

describe('HyperGuesserVXValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to deterministic scoring when structured triage is unavailable', async () => {
    vi.mocked(LLMService.completeStructured).mockResolvedValue(null);

    const result = await HyperGuesserVXValidator.validateBatch({
      company_name: 'Impianti Industriali S.R.L.',
      city: 'Milano',
      province: 'MI',
    } as any, [
      {
        domain: 'micraimpianti.com',
        url: 'https://micraimpianti.com',
        title: 'Micra Impianti',
        text: 'Micra impianti elettronici industriali a Torino.',
      },
      {
        domain: 'impiantiindustriali.it',
        url: 'https://www.impiantiindustriali.it',
        title: 'Impianti Industriali S.R.L. - Milano',
        text: 'Impianti Industriali S.R.L. opera a Milano nel settore impianti industriali.',
      },
    ]);

    expect(result.selected_url).toBe('https://www.impiantiindustriali.it');
    expect(result.confidence).toBeGreaterThanOrEqual(0.72);
  });

  it('penalizes directory-style candidates even when they mention the target company', async () => {
    vi.mocked(LLMService.completeStructured).mockResolvedValue(null);

    const result = await HyperGuesserVXValidator.validateBatch({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      province: 'MI',
    } as any, [
      {
        domain: 'signalhire.com',
        url: 'https://www.signalhire.com/companies/acme-srl',
        title: 'ACME S.R.L. company profile',
        text: 'SignalHire company profile for ACME S.R.L. in Milano.',
      },
      {
        domain: 'acme.it',
        url: 'https://acme.it',
        title: 'ACME S.R.L. - Home',
        text: 'ACME S.R.L. Milano, produzione componenti industriali.',
      },
    ]);

    expect(result.selected_url).toBe('https://acme.it');
  });
});
