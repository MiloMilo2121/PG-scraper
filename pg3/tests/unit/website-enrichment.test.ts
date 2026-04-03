import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PecHunter } from '../../src/foundation/PecHunter';
import { EnrichmentPostProcessor } from '../../src/foundation/EnrichmentPostProcessor';
import { LLMService } from '../../src/enricher/core/ai/llm_service';

describe('PecHunter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts Cloudflare-obfuscated mail and prioritizes PEC from contact pages', async () => {
    const navigateSafe = vi.fn(async (url: string) => {
      if (url.endsWith('/contatti')) {
        return {
          status: 'OK',
          html: '<a href="mailto:amministrazione@azienda.it">mail</a><span>pec@legalmail.it</span>',
          finalUrl: url,
          blocked_resources: 0,
          duration_ms: 10,
          browser_id: 'browser-1',
        };
      }

      return {
        status: 'OK',
        html: '<span>info [at] azienda [dot] it</span>',
        finalUrl: url,
        blocked_resources: 0,
        duration_ms: 10,
        browser_id: 'browser-1',
      };
    });

    const hunter = new PecHunter({ navigateSafe } as any);
    const result = await hunter.hunt('company-1', { company_name: 'Azienda Test' } as any, 'https://www.azienda.it');

    expect(result.pec).toBe('pec@legalmail.it');
    expect(result.email).toBe('amministrazione@azienda.it');
    expect(navigateSafe).toHaveBeenCalledWith('https://www.azienda.it/contatti');
  });

  it('falls back to routed fetch extraction when browser navigation finds no contacts', async () => {
    const navigateSafe = vi.fn(async () => ({
      status: 'OK',
      html: '<html><body><p>Nessun contatto esposto</p></body></html>',
      finalUrl: 'https://www.azienda.it',
      blocked_resources: 0,
      duration_ms: 10,
      browser_id: 'browser-1',
    }));
    const route = vi.fn(async () => ({
      data: {
        data: '<html><body><a href="mailto:info@azienda.it">Contatti</a></body></html>',
      },
      provider: 'FIRECRAWL-SCRAPE-3',
    }));

    const hunter = new PecHunter({ navigateSafe } as any, { route } as any);
    const result = await hunter.hunt('company-2', { company_name: 'Azienda Test' } as any, 'https://www.azienda.it');

    expect(result.email).toBe('info@azienda.it');
    expect(result.source).toBe('FIRECRAWL-SCRAPE-3');
    expect(route).toHaveBeenCalled();
  });
});

describe('EnrichmentPostProcessor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses heuristic employee extraction before invoking the LLM', async () => {
    const navigateSafe = vi.fn(async (url: string) => ({
      status: 'OK',
      html: url.endsWith('/chi-siamo')
        ? '<html><body><p>Siamo un team di 24 dipendenti specializzati nella lavorazione CNC.</p></body></html>'
        : '<html><body><p>Benvenuti.</p></body></html>',
      finalUrl: url,
      blocked_resources: 0,
      duration_ms: 10,
      browser_id: 'browser-1',
    }));

    const llmSpy = vi.spyOn(LLMService, 'complete');
    const processor = new EnrichmentPostProcessor({ navigateSafe } as any);
    const result = await processor.estimateEmployees('company-1', { company_name: 'Azienda Test' } as any, 'https://www.azienda.it');

    expect(result).toBe('10-50');
    expect(llmSpy).not.toHaveBeenCalled();
    expect(navigateSafe).toHaveBeenCalledWith('https://www.azienda.it/chi-siamo');
  });

  it('falls back to the LLM when heuristics are inconclusive', async () => {
    const navigateSafe = vi.fn(async (url: string) => ({
      status: 'OK',
      html: `<html><body><p>${'azienda industriale '.repeat(30)}</p></body></html>`,
      finalUrl: url,
      blocked_resources: 0,
      duration_ms: 10,
      browser_id: 'browser-1',
    }));

    const llmSpy = vi.spyOn(LLMService, 'complete').mockResolvedValue('50+');
    const processor = new EnrichmentPostProcessor({ navigateSafe } as any);
    const result = await processor.estimateEmployees('company-2', { company_name: 'Azienda LLM' } as any, 'https://www.azienda.it');

    expect(result).toBe('50+');
    expect(llmSpy).toHaveBeenCalledOnce();
  });
});
