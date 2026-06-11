import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { Lead } from '../../src/types/lead';
import { CostLedger } from '../../src/runtime/cost_ledger';
import { runFieldCascade, runFieldCascades, runFieldDescriptor } from '../../src/enrichment/fields/run_field_cascade';
import { FIELD_REGISTRY, fieldHasFreeTier } from '../../src/enrichment/fields/field_registry';
import type { EnrichmentFieldDescriptor, EnrichmentStep } from '../../src/enrichment/fields/field_types';

const FIX = path.join(__dirname, '..', 'fixtures', 'extract');
const load = (n: string): string => fs.readFileSync(path.join(FIX, n), 'utf8');
const lead = (o: Partial<Lead>): Lead => ({ company_name: 'X', ...o });

describe('per-field cascade — free tiers (€0, from the already-fetched body)', () => {
  it('resolves email + pec from the website body at zero cost', () => {
    const l = lead({ company_name: 'Neri', official_website: 'https://neriservizi.it' });
    const ledger = new CostLedger();
    const [email, pec] = runFieldCascades(l, ['email', 'pec'], { body: load('it_site_pec_and_phone.html'), ledger });
    expect(email.resolved).toBe(true);
    expect(l.email_inferred).toBe('contatti@neriservizi.it');
    expect(pec.resolved).toBe(true);
    expect(l.pec).toBe('neriservizi@pec.it');
    expect(email.costEur).toBe(0);
    expect(ledger.getTotal()).toBe(0); // free tiers spend nothing
  });

  it('resolves VAT (checksum-valid) and socials from the body', () => {
    const lv = lead({ company_name: 'Verdi', official_website: 'https://verdicostruzioni.it' });
    expect(runFieldCascade(lv, 'vat', { body: load('it_site_legal_footer_piva.html') }).resolved).toBe(true);
    expect(lv.vat_code_final).toBe('01234567897');

    const ls = lead({ company_name: 'Bianchi', official_website: 'https://bianchicase.it' });
    const social = runFieldCascades(ls, ['instagram', 'facebook', 'linkedin'], { body: load('it_site_footer_socials.html') });
    expect(social.every((s) => s.resolved)).toBe(true);
    expect(ls.instagram).toBe('https://instagram.com/agenziabianchi');
  });

  it('parses the body ONCE and shares it across fields', () => {
    const l = lead({ company_name: 'Neri', official_website: 'https://neriservizi.it' });
    // pass a precomputed extraction implicitly via body; both fields fill
    const out = runFieldCascades(l, ['email', 'pec', 'vat'], { body: load('it_site_pec_and_phone.html') });
    expect(out.filter((o) => o.resolved).length).toBeGreaterThanOrEqual(2);
  });

  it('never overwrites an existing value (fill-only-missing)', () => {
    const l = lead({ company_name: 'Neri', official_website: 'https://neriservizi.it', email_inferred: 'preset@neriservizi.it' });
    runFieldCascade(l, 'email', { body: load('it_site_pec_and_phone.html') });
    expect(l.email_inferred).toBe('preset@neriservizi.it');
  });
});

describe('per-field cascade — gating (the safety triple-gate)', () => {
  it('wired-but-disabled paid steps NEVER run; registry ships all paid disabled', () => {
    const l = lead({ company_name: 'X', official_website: 'https://x.it' });
    const out = runFieldCascade(l, 'email', { body: '<html></html>', paidEnabled: true });
    const finder = out.steps.find((s) => s.id === 'email.finder_api')!;
    expect(finder.ran).toBe(false);
    expect(finder.reason).toBe('disabled');
    // sanity: the whole shipped registry has no enabled paid step
    const anyEnabledPaid = FIELD_REGISTRY.some((d) => d.cascade.some((s) => s.tier >= 2 && s.enabled));
    expect(anyEnabledPaid).toBe(false);
  });

  it('an ENABLED tier-2 step is gated off when paidEnabled is false', () => {
    const paidStep: EnrichmentStep = { id: 't2', tier: 2, costEur: 0.02, enabled: true, run: () => ({ value: 'x@y.it', confidence: 0.9, source: 'api', costEur: 0.02 }) };
    const d: EnrichmentFieldDescriptor = { field: 'email', target: 'email_inferred', cascade: [paidStep], ceilingEur: 1, stopConfidence: 0.5 };
    const l = lead({});
    const out = runFieldDescriptor(l, d, { paidEnabled: false });
    expect(out.resolved).toBe(false);
    expect(out.steps[0].reason).toBe('paid_gated');
    expect(l.email_inferred).toBeUndefined();
  });

  it('respects the per-field ceiling: a paid step over budget is skipped (€0 spent)', () => {
    const expensive: EnrichmentStep = { id: 'pricey', tier: 2, costEur: 0.5, enabled: true, run: () => ({ value: 'v', confidence: 1, source: 'api', costEur: 0.5 }) };
    const d: EnrichmentFieldDescriptor = { field: 'email', target: 'email_inferred', cascade: [expensive], ceilingEur: 0.02, stopConfidence: 0.5 };
    const ledger = new CostLedger();
    const out = runFieldDescriptor(lead({}), d, { paidEnabled: true, ledger });
    expect(out.steps[0].reason).toBe('budget');
    expect(out.resolved).toBe(false);
    expect(ledger.getTotal()).toBe(0);
  });

  it('an enabled paid step within budget runs, records cost, and resolves', () => {
    const ok: EnrichmentStep = { id: 'finder', tier: 2, costEur: 0.02, enabled: true, run: () => ({ value: 'found@y.it', confidence: 0.9, source: 'api', costEur: 0.02 }) };
    const d: EnrichmentFieldDescriptor = { field: 'email', target: 'email_inferred', cascade: [ok], ceilingEur: 0.05, stopConfidence: 0.75 };
    const l = lead({});
    const ledger = new CostLedger();
    const out = runFieldDescriptor(l, d, { paidEnabled: true, ledger, meta: { tenant_id: 't', lead_id: 'l1' } });
    expect(out.resolved).toBe(true);
    expect(l.email_inferred).toBe('found@y.it');
    expect(out.costEur).toBeCloseTo(0.02, 6);
    expect(ledger.getTotal()).toBeCloseTo(0.02, 6);
  });

  it('stops at the first step meeting stopConfidence (does not run later steps)', () => {
    const strong: EnrichmentStep = { id: 's1', tier: 0, costEur: 0, enabled: true, run: () => ({ value: 'a@b.it', confidence: 0.9, source: 'body', costEur: 0 }) };
    let secondRan = false;
    const second: EnrichmentStep = { id: 's2', tier: 0, costEur: 0, enabled: true, run: () => { secondRan = true; return { value: 'c@d.it', confidence: 1, source: 'x', costEur: 0 }; } };
    const d: EnrichmentFieldDescriptor = { field: 'email', target: 'email_inferred', cascade: [strong, second], ceilingEur: 0, stopConfidence: 0.75 };
    runFieldDescriptor(lead({}), d, {});
    expect(secondRan).toBe(false);
  });
});

describe('registry shape', () => {
  it('free tiers are advertised for body-parse fields, not for revenue/employees', () => {
    expect(fieldHasFreeTier('email')).toBe(true);
    expect(fieldHasFreeTier('instagram')).toBe(true);
    expect(fieldHasFreeTier('vat')).toBe(true);
    expect(fieldHasFreeTier('revenue')).toBe(false); // registry-only, disabled this pass
    expect(fieldHasFreeTier('employees')).toBe(false);
  });
});
