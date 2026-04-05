import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostDiscoveryEnrichmentStage } from '../../src/enricher/runtime/stages/post_discovery_enrichment_stage';
import { FatturatoItaliaHarvester } from '../../src/enricher/core/directories/fatturato_italia';

describe('PostDiscoveryEnrichmentStage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips website-dependent stages until website discovery succeeds', async () => {
    vi.spyOn(FatturatoItaliaHarvester, 'harvest').mockResolvedValue(null as any);

    const bilancioHunter = { hunt: vi.fn().mockResolvedValue(null) };
    const linkedinSniper = { snipeDetailed: vi.fn() };
    const postProcessor = { estimateEmployees: vi.fn() };
    const pecHunter = { hunt: vi.fn() };

    const stage = new PostDiscoveryEnrichmentStage({
      bilancioHunter: bilancioHunter as any,
      linkedinSniper: linkedinSniper as any,
      postProcessor: postProcessor as any,
      pecHunter: pecHunter as any,
    });

    const result = await stage.run('company-1', { company_name: 'Acme', vat_code: null } as any, null);

    expect(result.financial).toBeNull();
    expect(result.decisionMaker).toBeNull();
    expect(result.employees).toBeNull();
    expect(result.pec).toBeNull();
    expect(result.email).toBeNull();
    expect(result.stageOutcomes.financial.status).toBe('not_found');
    expect(result.stageOutcomes.decision_maker.status).toBe('skipped');
    expect(result.stageOutcomes.employee_estimation.status).toBe('skipped');
    expect(result.stageOutcomes.contacts.status).toBe('skipped');
    expect(linkedinSniper.snipeDetailed).not.toHaveBeenCalled();
    expect(postProcessor.estimateEmployees).not.toHaveBeenCalled();
    expect(pecHunter.hunt).not.toHaveBeenCalled();
  });

  it('runs stages sequentially and uses employee estimation as fallback', async () => {
    vi.spyOn(FatturatoItaliaHarvester, 'harvest').mockResolvedValue(null as any);

    const bilancioHunter = { hunt: vi.fn().mockResolvedValue({ fatturato_current: 100000, year: 2024 }) };
    const linkedinSniper = {
      snipeDetailed: vi.fn().mockResolvedValue({
        decisionMaker: { name: 'Mario Rossi', confidence: 0.85 },
        attempted_count: 1,
        evidence_count: 1,
        entity_match_status: 'matched',
        providers: ['SERPER-API-1'],
        detail: 'decision maker found from linkedin search results',
      }),
    };
    const postProcessor = { estimateEmployees: vi.fn().mockResolvedValue('10-50') };
    const pecHunter = { hunt: vi.fn().mockResolvedValue({ pec: 'info@pec.example.it', email: 'info@example.it' }) };

    const stage = new PostDiscoveryEnrichmentStage({
      bilancioHunter: bilancioHunter as any,
      linkedinSniper: linkedinSniper as any,
      postProcessor: postProcessor as any,
      pecHunter: pecHunter as any,
    });

    const result = await stage.run('company-2', { company_name: 'Acme', vat_code: null } as any, 'https://example.it');

    expect(result.financial).toEqual({ fatturato_current: 100000, year: 2024 });
    expect(result.decisionMaker).toEqual({ name: 'Mario Rossi', confidence: 0.85 });
    expect(result.employees).toBe('10-50');
    expect(result.isEstimatedEmployees).toBe(true);
    expect(result.pec).toBe('info@pec.example.it');
    expect(result.email).toBe('info@example.it');
    expect(result.stageOutcomes.financial.status).toBe('success');
    expect(result.stageOutcomes.decision_maker.status).toBe('success');
    expect(result.stageOutcomes.employee_estimation.status).toBe('success');
    expect(result.stageOutcomes.contacts.status).toBe('success');
    expect(bilancioHunter.hunt).toHaveBeenCalledOnce();
    expect(linkedinSniper.snipeDetailed).toHaveBeenCalledOnce();
    expect(postProcessor.estimateEmployees).toHaveBeenCalledOnce();
    expect(pecHunter.hunt).toHaveBeenCalledOnce();
  });
});
