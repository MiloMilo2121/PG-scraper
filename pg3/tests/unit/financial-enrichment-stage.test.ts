import { describe, expect, it, vi } from 'vitest';
import { FinancialEnrichmentStage } from '../../src/enricher/runtime/stages/financial_enrichment_stage';
import { FatturatoItaliaHarvester } from '../../src/enricher/core/directories/fatturato_italia';

describe('FinancialEnrichmentStage', () => {
  it('marks high-confidence revenue and employees as a full financial success', async () => {
    vi.spyOn(FatturatoItaliaHarvester, 'harvest').mockResolvedValue({
      url: 'https://www.fatturatoitalia.it/acme-srl-12345678901',
      revenue: '€ 1.200.000',
      revenueYear: '2023',
      employees: '10-20',
      vat: '12345678901',
    } as any);

    const stage = new FinancialEnrichmentStage({
      hunt: vi.fn().mockResolvedValue({
        source_url: 'https://docs.example.com/acme-bilancio-2023.pdf',
        source_provider: 'SERPER',
        source_trust: 'medium',
        confidence: 0.72,
        entity_match_status: 'matched',
        attempted_queries: 4,
      }),
    } as any);

    const result = await stage.run('company-1', {
      company_name: 'ACME SRL',
      vat_code: null,
    } as any);

    expect(result.financial?.fatturato_current).toBe(1200000);
    expect(result.financial?.source_provider).toBe('fatturatoitalia');
    expect(result.financial?.source_trust).toBe('high');
    expect(result.employees).toBe('10-20');
    expect(result.vat).toBe('12345678901');
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.reason_code).toBe('FINANCIAL_REVENUE_AND_EMPLOYEES');
    expect(result.outcome.entity_match_status).toBe('matched');
    expect(result.outcome.attempted_count).toBe(5);
    expect(result.outcome.provider).toContain('SERPER');
    expect(result.outcome.provider).toContain('fatturatoitalia');
  });

  it('surfaces source-only evidence as partial instead of not_found', async () => {
    vi.spyOn(FatturatoItaliaHarvester, 'harvest').mockResolvedValue(null as any);

    const stage = new FinancialEnrichmentStage({
      hunt: vi.fn().mockResolvedValue({
        source_url: 'https://www.registroimprese.it/acme-srl',
        source_provider: 'BING',
        source_trust: 'high',
        confidence: 0.78,
        entity_match_status: 'matched',
        attempted_queries: 3,
      }),
    } as any);

    const result = await stage.run('company-2', {
      company_name: 'ACME SRL',
      vat_code: null,
    } as any);

    expect(result.financial).toEqual({
      source_url: 'https://www.registroimprese.it/acme-srl',
      source_provider: 'BING',
      source_trust: 'high',
      confidence: 0.78,
      entity_match_status: 'matched',
      attempted_queries: 3,
    });
    expect(result.outcome.status).toBe('partial');
    expect(result.outcome.reason_code).toBe('FINANCIAL_SOURCE_IDENTIFIED');
    expect(result.outcome.entity_match_status).toBe('matched');
    expect(result.outcome.attempted_count).toBe(3);
  });
});
