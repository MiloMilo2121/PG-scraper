import type { EnrichmentFieldDescriptor, EnrichmentStep, StepResult, FieldStepContext } from './field_types';
import { registrableDomain } from '../extract/extract_from_body';

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

export const FIELD_REGISTRY: EnrichmentFieldDescriptor[] = [
  {
    field: 'vat',
    target: 'vat_code_final',
    cascade: [vatFromBody, disabled('vat.vies_harden', 1, 0, 'vies')],
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
    cascade: [disabled('revenue.fatturatoitalia_by_vat', 1, 0, 'fatturatoitalia')],
    ceilingEur: 0,
    stopConfidence: 0.7,
  },
  {
    field: 'employees',
    target: 'employees',
    cascade: [disabled('employees.fatturatoitalia_by_vat', 1, 0, 'fatturatoitalia')],
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
