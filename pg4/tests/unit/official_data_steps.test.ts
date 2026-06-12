import { describe, expect, it } from 'vitest';
import type { Lead } from '../../src/types/lead';
import { fetchFatturatoItalia } from '../../src/enrichment/financial/fatturato_italia_fetch';
import { runFieldCascade } from '../../src/enrichment/fields/run_field_cascade';

/**
 * Phase 3 official-data steps (VIES + fatturatoitalia) — wiring + SAFETY.
 * These tests make NO network call: they exercise the checksum/no-input gates
 * that must short-circuit BEFORE any fetch. (The live behaviour is proven by
 * the e2e browser run + the measurement-evidence probe, not in unit tests.)
 */

const lead = (o: Partial<Lead>): Lead => ({ company_name: 'X', ...o });

describe('fetchFatturatoItalia — checksum gate (no network on bad VAT)', () => {
  it('returns undefined for a non-VAT / bad-checksum input without fetching', async () => {
    expect(await fetchFatturatoItalia('not-a-vat')).toBeUndefined();
    expect(await fetchFatturatoItalia('01234567890')).toBeUndefined(); // 11 digits, bad checksum
    expect(await fetchFatturatoItalia(undefined)).toBeUndefined();
  });
});

describe('official-data steps — gate on missing VAT (no network)', () => {
  it('revenue step short-circuits to no_input when no VAT is resolvable', async () => {
    const out = await runFieldCascade(lead({ company_name: 'NoVat' }), 'revenue', {});
    expect(out.resolved).toBe(false);
    const step = out.steps.find((s) => s.id === 'revenue.fatturatoitalia_by_vat')!;
    expect(step.ran).toBe(true);
    expect(step.reason).toBe('no_input');
  });

  it('VAT cascade: body checksum step + VIES fallback are both wired (no body, no input → unresolved, no network)', async () => {
    const out = await runFieldCascade(lead({ company_name: 'NoVat' }), 'vat', {});
    expect(out.resolved).toBe(false);
    expect(out.steps.map((s) => s.id)).toEqual(['vat.body_checksum', 'vat.vies_harden']);
    // VIES ran but found no VAT to validate → no_input (it never hit the network)
    expect(out.steps.find((s) => s.id === 'vat.vies_harden')!.reason).toBe('no_input');
  });

  it('official-data steps are tier-1 FREE (not paid) and enabled by default', async () => {
    // a revenue enrich with paidEnabled=false still runs the fatturatoitalia step
    const out = await runFieldCascade(lead({ company_name: 'NoVat' }), 'employees', { paidEnabled: false });
    const step = out.steps.find((s) => s.id === 'employees.fatturatoitalia_by_vat')!;
    expect(step.ran).toBe(true); // not paid-gated
    expect(step.tier).toBe(1);
  });
});
