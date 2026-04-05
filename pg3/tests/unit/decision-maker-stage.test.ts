import { describe, expect, it, vi } from 'vitest';
import { DecisionMakerStage } from '../../src/enricher/runtime/stages/decision_maker_stage';

describe('DecisionMakerStage', () => {
  it('uses input website as fallback anchor and persists rich diagnostics', async () => {
    const sniper = {
      snipeDetailed: vi.fn().mockResolvedValue({
        decisionMaker: {
          name: 'Mario Rossi',
          role: 'Founder',
          linkedin_url: 'https://www.linkedin.com/in/mario-rossi',
          source: 'SERPER-API-1',
          source_kind: 'linkedin_profile',
          confidence: 0.87,
          entity_match_status: 'matched',
          providers: ['SERPER-API-1', 'EXA-API-2'],
        },
        attempted_count: 6,
        evidence_count: 4,
        entity_match_status: 'matched',
        providers: ['SERPER-API-1', 'EXA-API-2'],
        detail: 'decision maker found from linkedin search results',
      }),
    };

    const stage = new DecisionMakerStage(sniper as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      website: 'https://www.acmeimmobiliare.it',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-1', input, null);

    expect(sniper.snipeDetailed).toHaveBeenCalledWith('cmp-1', input, 'https://www.acmeimmobiliare.it');
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.attempted_count).toBe(6);
    expect(result.outcome.evidence_count).toBe(4);
    expect(result.outcome.provider).toBe('SERPER-API-1,EXA-API-2');
    expect(result.outcome.reason_code).toBe('DM_SOURCE_FOUND');
    expect(result.outcome.entity_match_status).toBe('matched');
  });

  it('returns a richer not_found outcome when evidence was searched but no person was found', async () => {
    const sniper = {
      snipeDetailed: vi.fn().mockResolvedValue({
        decisionMaker: null,
        attempted_count: 5,
        evidence_count: 3,
        entity_match_status: 'unknown',
        providers: ['SERPER-API-1'],
        detail: 'serp results collected but no credible person candidate',
      }),
    };

    const stage = new DecisionMakerStage(sniper as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      website: 'https://www.acmeimmobiliare.it',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-2', input, 'https://www.acmeimmobiliare.it');

    expect(result.outcome.status).toBe('not_found');
    expect(result.outcome.attempted_count).toBe(5);
    expect(result.outcome.evidence_count).toBe(3);
    expect(result.outcome.provider).toBe('SERPER-API-1');
    expect(result.outcome.detail).toContain('no credible person candidate');
  });

  it('allows decision-maker search without website when company name and location are present', async () => {
    const sniper = {
      snipeDetailed: vi.fn().mockResolvedValue({
        decisionMaker: {
          name: 'Mario Rossi',
          role: 'Titolare',
          linkedin_url: 'https://www.linkedin.com/in/mario-rossi',
          source: 'SERPER-API-1',
          source_kind: 'linkedin_profile',
          confidence: 0.82,
          entity_match_status: 'semantic',
          providers: ['SERPER-API-1'],
        },
        attempted_count: 4,
        evidence_count: 2,
        entity_match_status: 'semantic',
        providers: ['SERPER-API-1'],
        detail: 'decision maker found from linkedin search results',
      }),
    };

    const stage = new DecisionMakerStage(sniper as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      provincia: 'MI',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-3', input, null);

    expect(sniper.snipeDetailed).toHaveBeenCalledWith('cmp-3', input, null);
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.reason_code).toBe('DM_SOURCE_FOUND');
  });

  it('still skips decision-maker search when website is missing and identity is weak', async () => {
    const sniper = {
      snipeDetailed: vi.fn(),
    };

    const stage = new DecisionMakerStage(sniper as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-4', input, null);

    expect(sniper.snipeDetailed).not.toHaveBeenCalled();
    expect(result.outcome.status).toBe('skipped');
    expect(result.outcome.reason_code).toBe('DM_SKIPPED_WEAK_IDENTITY');
  });
});
