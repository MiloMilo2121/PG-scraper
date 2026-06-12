import type { EnrichmentFieldDescriptor, EnrichmentStep, StepResult, FieldStepContext } from './field_types';
import { registrableDomain } from '../extract/extract_from_body';
import { normalizeVatCode, validateItalianVatChecksum } from '../financial/vat';
import { checkVatViaVies } from '../financial/vies';
import { fetchFatturatoItalia } from '../financial/fatturato_italia_fetch';

/**
 * THE per-field cascade registry. Each field declares its ordered free→paid
 * steps. The free (tier-0) steps read the already-fetched website body via the
 * Phase-1 extractor — €0 marginal cost, the measured free-gold (email 54%,
 * social 60%, VAT 67%). Paid (tier-2) and free-network (tier-1 registry) steps
 * are WIRED BUT DISABLED (`enabled: false`) until the official-data spine and
 * the paid providers are activated — see the PRODUCTION ACTIVATION CHECKLIST.
 *
 * Honesty (per the blueprint): instagram/facebook/linkedin are free WHEN a
 * website exists and structurally hard otherwise — there is no cheap T2 here,
 * so none is declared. decision_maker is honestly paid; its T0 is a minority
 * catch.
 */

// ---- free tier-0 steps: read the already-fetched body (€0) ----

const emailFromBody: EnrichmentStep = {
  id: 'email.body_same_domain',
  tier: 0,
  costEur: 0,
  enabled: true,
  run: (ctx: FieldStepContext): StepResult =>
    valueOr(ctx.extraction?.email, 'website_body', 0.8),
};

const pecFromBody: EnrichmentStep = {
  id: 'pec.body',
  tier: 0,
  costEur: 0,
  enabled: true,
  run: (ctx): StepResult => valueOr(ctx.extraction?.pec, 'website_body', 0.85),
};

const vatFromBody: EnrichmentStep = {
  id: 'vat.body_checksum',
  tier: 0,
  costEur: 0,
  enabled: true,
  run: (ctx): StepResult => valueOr(ctx.extraction?.vat_candidates?.[0], 'website_body', 0.9),
};

const socialStep = (key: 'instagram' | 'facebook' | 'linkedin'): EnrichmentStep => ({
  id: `${key}.body_footer`,
  tier: 0,
  costEur: 0,
  enabled: true,
  run: (ctx): StepResult => valueOr(ctx.extraction?.[key], 'website_body', 0.8),
});

const decisionMakerFromBody: EnrichmentStep = {
  id: 'decision_maker.body_chisiamo',
  tier: 0,
  costEur: 0,
  enabled: true,
  // T0 catches only the minority that print a "Legale Rappresentante" /
  // "Titolare" line on the site. Low confidence by design.
  run: (): StepResult => ({ confidence: 0, source: 'website_body', costEur: 0, skippedReason: 'no_value' }),
};

// ---- wired-but-disabled steps (tier 1 registry / tier 2 paid) ----
// Each is a real placeholder: it declares its tier + cost + source, but
// `enabled: false` so the runner skips it. Activation = flip enabled + provide
// the provider (Phase 3 official-data spine / paid catalog).

const disabled = (id: string, tier: 0 | 1 | 2, costEur: number, source: string): EnrichmentStep => ({
  id,
  tier,
  costEur,
  enabled: false,
  run: (): StepResult => ({ confidence: 0, source, costEur, skippedReason: 'disabled' }),
});

// ---- official-data steps (Phase 3 — FREE, network; the VAT-as-master-key spine) ----
// Enabled by default (VIES + fatturatoitalia are free public sources); each is
// toggleable via an env flag so a deployment can pin them off.

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === undefined || v === '' || v === '1' || v.toLowerCase() === 'true';
}

/** The VAT a field step keys on: a resolved final VAT, a body-extracted one, or the input. */
function resolveVat(ctx: FieldStepContext): string | undefined {
  const raw =
    (ctx.lead.vat_code_final as string | undefined) ??
    ctx.extraction?.vat_candidates?.[0] ??
    (ctx.lead.vat_code as string | undefined);
  const v = normalizeVatCode(raw);
  return /^\d{11}$/.test(v) && validateItalianVatChecksum(v) ? v : undefined;
}

// VIES — validate the VAT against the official EU endpoint (free). Runs as the
// fallback after the body checksum step: when the firm's own page already
// yielded a checksum-valid VAT the cascade stops there; VIES confirms an INPUT
// VAT (or surfaces the official name) when the body had none.
const viesHarden: EnrichmentStep = {
  id: 'vat.vies_harden',
  tier: 1,
  costEur: 0,
  enabled: flagOn('OFFICIAL_DATA_VIES_ENABLED'),
  run: async (ctx): Promise<StepResult> => {
    const vat = resolveVat(ctx);
    if (!vat) return { confidence: 0, source: 'vies', costEur: 0, skippedReason: 'no_input' };
    const r = await checkVatViaVies({ vatNumber: vat, countryCode: 'IT' });
    if (!r.isValid) return { confidence: 0, source: 'vies', costEur: 0, skippedReason: 'no_value' };
    return { value: vat, confidence: r.checked ? 0.95 : 0.85, source: r.source, costEur: 0 };
  },
};

// fatturatoitalia.it — revenue + employees by P.IVA (free public page; the
// parser already existed, this wires the fetch). One lookup fills both fields
// (memoised in the fetcher), so enriching revenue then employees costs one fetch.
const fatturatoItaliaStep = (field: 'revenue' | 'employees', confFloor: number): EnrichmentStep => ({
  id: `${field}.fatturatoitalia_by_vat`,
  tier: 1,
  costEur: 0,
  enabled: flagOn('OFFICIAL_DATA_FATTURATOITALIA_ENABLED'),
  run: async (ctx): Promise<StepResult> => {
    const vat = resolveVat(ctx);
    if (!vat) return { confidence: 0, source: 'fatturatoitalia', costEur: 0, skippedReason: 'no_input' };
    const fi = await fetchFatturatoItalia(vat);
    const value = fi?.[field];
    if (!value) return { confidence: 0, source: 'fatturatoitalia', costEur: 0, skippedReason: 'no_value' };
    return { value: String(value), confidence: Math.max(confFloor, fi.confidence), source: 'fatturatoitalia', costEur: 0 };
  },
});

export const FIELD_REGISTRY: EnrichmentFieldDescriptor[] = [
  {
    field: 'vat',
    target: 'vat_code_final',
    cascade: [vatFromBody, viesHarden],
    ceilingEur: 0,
    stopConfidence: 0.85,
  },
  {
    field: 'email',
    target: 'email_inferred',
    cascade: [
      emailFromBody,
      disabled('email.mx_guess', 1, 0, 'dns_mx'),
      disabled('email.finder_api', 2, 0.02, 'email_finder'),
    ],
    ceilingEur: 0.05,
    stopConfidence: 0.75,
  },
  {
    field: 'pec',
    target: 'pec',
    cascade: [pecFromBody, disabled('pec.inipec_by_vat', 1, 0, 'inipec')],
    ceilingEur: 0,
    stopConfidence: 0.8,
  },
  {
    field: 'revenue',
    target: 'revenue',
    cascade: [fatturatoItaliaStep('revenue', 0.7)],
    ceilingEur: 0,
    stopConfidence: 0.7,
  },
  {
    field: 'employees',
    target: 'employees',
    cascade: [fatturatoItaliaStep('employees', 0.6)],
    ceilingEur: 0,
    stopConfidence: 0.6,
  },
  { field: 'instagram', target: 'instagram', cascade: [socialStep('instagram')], ceilingEur: 0, stopConfidence: 0.7 },
  { field: 'facebook', target: 'facebook', cascade: [socialStep('facebook')], ceilingEur: 0, stopConfidence: 0.7 },
  { field: 'linkedin', target: 'linkedin', cascade: [socialStep('linkedin')], ceilingEur: 0, stopConfidence: 0.7 },
  {
    field: 'decision_maker',
    target: 'decision_maker_name',
    cascade: [decisionMakerFromBody, disabled('decision_maker.people_finder', 2, 0.1, 'people_finder')],
    ceilingEur: 0.15,
    stopConfidence: 0.6,
  },
];

export const FIELD_BY_NAME = new Map(FIELD_REGISTRY.map((d) => [d.field, d]));

function valueOr(v: string | undefined, source: string, confidence: number): StepResult {
  if (v && v.length > 0) return { value: v, confidence, source, costEur: 0 };
  return { confidence: 0, source, costEur: 0, skippedReason: 'no_value' };
}

/** Whether a field's free tier can resolve from a same-domain website body. */
export function fieldHasFreeTier(field: string): boolean {
  const d = FIELD_BY_NAME.get(field as never);
  return !!d && d.cascade.some((s) => s.tier === 0 && s.enabled);
}

export { registrableDomain };
