import { describe, expect, it, vi } from 'vitest';
import { ContactEnrichmentStage } from '../../src/enricher/runtime/stages/contact_enrichment_stage';

describe('ContactEnrichmentStage', () => {
  it('reuses a confirmed input email when website discovery is missing', async () => {
    const pecHunter = { hunt: vi.fn() };
    const stage = new ContactEnrichmentStage(pecHunter as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      email: 'info@acmeimmobiliare.it',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-1', input, null);

    expect(pecHunter.hunt).not.toHaveBeenCalled();
    expect(result.email).toBe('info@acmeimmobiliare.it');
    expect(result.pec).toBeNull();
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.reason_code).toBe('CONTACTS_CONFIRMED_INPUT_EMAIL');
    expect(result.outcome.provider).toBe('input_contact');
    expect(result.outcome.attempted_count).toBe(0);
  });

  it('still skips contacts when neither website nor confirmed input contact is available', async () => {
    const pecHunter = { hunt: vi.fn() };
    const stage = new ContactEnrichmentStage(pecHunter as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-2', input, null);

    expect(pecHunter.hunt).not.toHaveBeenCalled();
    expect(result.email).toBeNull();
    expect(result.pec).toBeNull();
    expect(result.outcome.status).toBe('skipped');
    expect(result.outcome.reason_code).toBe('CONTACTS_SKIPPED_NO_WEBSITE');
  });
});
