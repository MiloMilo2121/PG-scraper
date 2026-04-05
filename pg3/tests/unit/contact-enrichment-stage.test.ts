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

  it('preserves provenance when a confirmed PG email is promoted upstream', async () => {
    const pecHunter = { hunt: vi.fn() };
    const stage = new ContactEnrichmentStage(pecHunter as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      email: 'contatti@acmeimmobiliare.it',
      email_source: 'paginegialle',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-3', input, null);

    expect(pecHunter.hunt).not.toHaveBeenCalled();
    expect(result.email).toBe('contatti@acmeimmobiliare.it');
    expect(result.pec).toBeNull();
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.reason_code).toBe('CONTACTS_CONFIRMED_PG_EMAIL');
    expect(result.outcome.provider).toBe('paginegialle_contact');
  });

  it('falls back to a promoted PG email when website scan finds no contacts', async () => {
    const pecHunter = { hunt: vi.fn().mockResolvedValue({ pec: null, email: null, source: null }) };
    const stage = new ContactEnrichmentStage(pecHunter as any);
    const input = {
      company_name: 'ACME Immobiliare',
      company_name_variants: ['ACME Immobiliare'],
      city: 'Milano',
      email: 'contatti@acmeimmobiliare.it',
      email_source: 'paginegialle',
      quality_score: 0.9,
    } as any;

    const result = await stage.run('cmp-4', input, 'https://www.acmeimmobiliare.it');

    expect(pecHunter.hunt).toHaveBeenCalledOnce();
    expect(result.email).toBe('contatti@acmeimmobiliare.it');
    expect(result.pec).toBeNull();
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.reason_code).toBe('CONTACTS_FALLBACK_PG_EMAIL');
    expect(result.outcome.provider).toBe('paginegialle_contact');
    expect(result.outcome.source_url).toBe('https://www.acmeimmobiliare.it');
    expect(result.outcome.attempted_count).toBe(1);
  });
});
