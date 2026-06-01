import { describe, it, expect } from 'vitest';
import { FinancialStage } from '../../src/enrichment/stages/financial_stage';
import { createPerLeadContext, createRun } from '../../src/runtime/run_context';
import type { Lead } from '../../src/types/lead';
import type { NormalizedLead } from '../../src/types/discovery';

/**
 * R13 — the financial stage is a disabled-by-default, no-op-safe skeleton.
 * It must NEVER touch the network and NEVER break a lead.
 */

const norm = (lead: Lead): NormalizedLead => ({
  company_name: lead.company_name,
  company_name_variants: [],
  quality_score: 1,
  raw: lead,
});

describe('FinancialStage (disabled by default)', () => {
  it('is a strict no-op when not enabled', async () => {
    const run = createRun();
    const stage = new FinancialStage();
    const lead: Lead = { company_name: 'ACME SRL', vat_code: '01654010345' };
    const out = await stage.run(createPerLeadContext(run), lead, norm(lead));
    expect(out.status).toBe('skipped');
    expect(out.detail).toBe('financial_stage_disabled');
    // never writes anything while disabled
    expect(lead.vat_code_final).toBeUndefined();
  });
});

describe('FinancialStage (enabled — pure path only)', () => {
  it('promotes a checksum-valid input VAT to vat_code_final with provenance', async () => {
    const run = createRun();
    const stage = new FinancialStage({ enabled: true });
    const lead: Lead = { company_name: 'ACME SRL', vat_code: 'IT 01654010345' };
    const out = await stage.run(createPerLeadContext(run), lead, norm(lead));
    expect(out.status).toBe('success');
    expect(out.provider).toBe('input');
    expect(lead.vat_code_final).toBe('01654010345');
  });

  it('returns not_found (NOT error) when there is no financial signal', async () => {
    const run = createRun();
    const stage = new FinancialStage({ enabled: true });
    const lead: Lead = { company_name: 'NoVat SRL' };
    const out = await stage.run(createPerLeadContext(run), lead, norm(lead));
    expect(out.status).toBe('not_found');
    expect(lead.vat_code_final).toBeUndefined();
  });

  it('ignores a checksum-invalid input VAT', async () => {
    const run = createRun();
    const stage = new FinancialStage({ enabled: true });
    const lead: Lead = { company_name: 'Bad SRL', vat_code: '01654010346' };
    const out = await stage.run(createPerLeadContext(run), lead, norm(lead));
    expect(out.status).toBe('not_found');
    expect(lead.vat_code_final).toBeUndefined();
  });
});
