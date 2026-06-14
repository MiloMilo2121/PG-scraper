import type { EnrichmentFieldDescriptor, EnrichmentStep, StepResult, FieldStepContext } from './field_types';
import { registrableDomain } from '../extract/extract_from_body';
import { normalizeVatCode, validateItalianVatChecksum } from '../financial/vat';
import { checkVatViaVies } from '../financial/vies';
import { fetchFatturatoItalia } from '../financial/fatturato_italia_fetch';
import { normalizeCompanyNameForKey } from '../../discovery/deduper';

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

/**
 * Fuzzy company-name match (token overlap after legal-form normalization).
 * Legal-form tokens (srl/spa/snc/…) are EXCLUDED — every company has one, so a
 * shared "srl" must not inflate the match ("Immobiliare Rossi SRL" vs "Studio
 * Rossi SRL" share only the form + "rossi", not the same firm).
 *
 * MATCH RULE — containment OR Jaccard ≥ 0.5 (NOT min-overlap):
 *  - CONTAINMENT: one firm's distinctive tokens fully appear in the other's name.
 *    Accepts the legit owner-suffix pattern ("Immobiliare Giglio" vs the registry's
 *    "Immobiliare Giglio di Cecchinato Ornella") — common for Italian family firms.
 *  - JACCARD (inter/union): guards the FRANCHISE-COLLISION class the validation audit
 *    caught (2026-06-14): a local "Agenzia Immobiliare Tecnocasa Impresa Albignasego"
 *    cites the FRANCHISOR's footer VAT, whose registry name is "Tecnocasa Franchising
 *    S.p.A." — they share only the brand token "tecnocasa". The OLD min-overlap rule
 *    scored that 1/2 = 0.5 and FALSE-CONFIRMED the franchisor's VAT @0.95, attaching
 *    its €58M revenue to the local agency. Jaccard drops it to ~0.17 → refused. The
 *    same fix covers any chain (Gabetti/Re-Max/Toscano/Grimaldi…): a single shared
 *    brand token across two distinct legal entities no longer confirms.
 */
const NAME_LEGAL_FORMS = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'ss', 'sc', 'scarl', 'scrl', 'soc', 'coop']);
function nameTokens(s: string): Set<string> {
  return new Set(normalizeCompanyNameForKey(s).split(' ').filter((t) => t.length > 2 && !NAME_LEGAL_FORMS.has(t)));
}
export function companyNameMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  if (inter === 0) return false;
  const contained = inter === ta.size || inter === tb.size; // one name's tokens ⊆ the other
  const jaccard = inter / (ta.size + tb.size - inter);
  return contained || jaccard >= 0.5;
}

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

/**
 * The VAT a field step keys on, WITH its provenance. A VAT scraped from the
 * firm's OWN page (vat_code_final / footer) is trustworthy; a VAT from the
 * INPUT scrape (lead.vat_code) is unverified — a mis-scraped-but-checksum-valid
 * input VAT would fetch the WRONG company's firmographics silently (the A.1
 * risk). Callers must VIES-gate an 'input' VAT before trusting it.
 */
export type ResolvedVat = { vat: string; provenance: 'site' | 'input' };
function checksumOk(raw: string | undefined): string | undefined {
  const v = normalizeVatCode(raw);
  return /^\d{11}$/.test(v) && validateItalianVatChecksum(v) ? v : undefined;
}
export function resolveVat(ctx: FieldStepContext): ResolvedVat | undefined {
  const site = checksumOk((ctx.lead.vat_code_final as string | undefined) ?? ctx.extraction?.vat_candidates?.[0]);
  if (site) return { vat: site, provenance: 'site' };
  const input = checksumOk(ctx.lead.vat_code as string | undefined);
  if (input) return { vat: input, provenance: 'input' };
  return undefined;
}

// VAT precision step (A.2 finding: the footer VAT[0] is the company's own only
// ~62% of the verifiable time — the rest cite the accountant's/partner's VAT).
// Resolve the COMPANY'S VAT: VIES each candidate, and pick the one whose official
// name matches the company. Confirmed → 0.95. VIES privacy (no name disclosed,
// common for IT) → footer VAT at LOW confidence, flagged unconfirmed. VIES names
// only OTHER companies → the footer VAT is foreign → REFUSE it (the precision fix
// that stops a wrong VAT from poisoning fatturato/dipendenti/PEC downstream).
const vatResolve: EnrichmentStep = {
  id: 'vat.vies_confirmed',
  tier: 1,
  costEur: 0,
  enabled: true, // always resolves; the VIES confirmation inside is flag-gated
  run: async (ctx): Promise<StepResult> => {
    const cands: string[] = [];
    for (const c of ctx.extraction?.vat_candidates ?? []) {
      const v = checksumOk(c);
      if (v && !cands.includes(v)) cands.push(v);
    }
    const inp = checksumOk(ctx.lead.vat_code as string | undefined);
    if (inp && !cands.includes(inp)) cands.push(inp);
    if (cands.length === 0) return { confidence: 0, source: 'vat', costEur: 0, skippedReason: 'no_input' };

    // VIES off (tests / pinned-off deployment) → footer VAT, unconfirmed, offline.
    if (!flagOn('OFFICIAL_DATA_VIES_ENABLED')) {
      return { value: cands[0], confidence: 0.6, source: 'vat:footer_unconfirmed', costEur: 0 };
    }

    // IMPORTANT: VIES only covers VATs registered for INTRA-EU trade. Most
    // domestic-only Italian SMBs are NOT in VIES (isValid:false / no name) even
    // though their VAT is perfectly valid. So VIES can only CONFIRM (name match)
    // or REJECT (it names a DIFFERENT company) — a VIES miss is NOT a rejection.
    const company = ctx.lead.company_name as string | undefined;
    let firstUnconfirmed: string | undefined;
    for (const c of cands.slice(0, 3)) {
      const v = await checkVatViaVies({ vatNumber: c, countryCode: 'IT' });
      const name = v.isValid && v.name && !/^[-\s]*$/.test(v.name) ? v.name : undefined;
      if (name && companyNameMatches(name, company)) {
        return { value: c, confidence: 0.95, source: 'vat:vies_confirmed', costEur: 0 };
      }
      if (name && !companyNameMatches(name, company)) continue; // VIES names ANOTHER company → foreign, skip
      if (firstUnconfirmed === undefined) firstUnconfirmed = c; // not-in-VIES / privacy → keep, can't confirm
    }
    if (firstUnconfirmed) return { value: firstUnconfirmed, confidence: 0.6, source: 'vat:footer_unconfirmed', costEur: 0 };
    // every candidate was POSITIVELY attributed by VIES to a different company.
    return { confidence: 0, source: 'vat:foreign_only', costEur: 0, skippedReason: 'vat_unverified' };
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
    const rv = resolveVat(ctx);
    if (!rv) return { confidence: 0, source: 'fatturatoitalia', costEur: 0, skippedReason: 'no_input' };

    // A.1 — an UNVERIFIED input VAT must be VIES-checked before we trust it to
    // fetch a company's firmographics; otherwise a mis-scraped (but checksum-
    // valid) VAT silently returns the WRONG company's revenue.
    // B.2 — CONFIDENCE INHERITANCE: a downstream firmographic is only as trustworthy
    // as the VAT KEY that fetched it (a wrong key = the wrong company's revenue). So
    // `confCap` carries the key's trust into the value's confidence:
    //   own-page VAT (site) → 0.9 · VIES-confirmed input → 0.95 · VIES-down input → 0.5.
    let tag: string = rv.provenance; // 'site' = the firm's own page (trusted, not independently VIES-confirmed here)
    let confCap = 0.9;
    if (rv.provenance === 'input') {
      const v = await checkVatViaVies({ vatNumber: rv.vat, countryCode: 'IT' });
      if (v.isValid && v.checked) { tag = 'input+vies'; confCap = 0.95; } // VIES confirmed → trust
      else if (v.isValid && !v.checked) { tag = 'input?vies-down'; confCap = 0.5; } // VIES unreachable → low confidence, flagged
      else return { confidence: 0, source: 'fatturatoitalia(input)', costEur: 0, skippedReason: 'vat_unverified' }; // VIES says invalid → refuse
    }

    const fi = await fetchFatturatoItalia(rv.vat);
    if (!fi) return { confidence: 0, source: `fatturatoitalia(${tag})`, costEur: 0, skippedReason: 'no_value' };

    // ENTITY VERIFICATION (validation audit 2026-06-14, the franchise-collision bug):
    // a footer/input VAT can belong to a DIFFERENT legal entity than the lead — a
    // FRANCHISOR (a local "...Tecnocasa... Albignasego" agency cited the franchisor's
    // VAT → €58M attached) or an accountant. fatturatoitalia returns the VAT's
    // REGISTERED name; if it doesn't match the company, this is someone else's
    // firmographics. Refuse it — regardless of provenance. This is the field-level
    // guard; the VAT-field confirmation (vatResolve) is the other half. Both needed:
    // resolveVat here trusts a 'site' VAT directly, so without this check the wrong
    // revenue still attaches even when the VAT field correctly refused the same VAT.
    const company = ctx.lead.company_name as string | undefined;
    if (fi.company_name && company && !companyNameMatches(fi.company_name, company)) {
      return { confidence: 0, source: `fatturatoitalia(${tag}:entity_mismatch)`, costEur: 0, skippedReason: 'vat_unverified' };
    }

    const value = fi[field];
    if (!value) return { confidence: 0, source: `fatturatoitalia(${tag})`, costEur: 0, skippedReason: 'no_value' };
    return { value: String(value), confidence: Math.min(confCap, Math.max(confFloor, fi.confidence)), source: `fatturatoitalia(${tag})`, costEur: 0 };
  },
});

export const FIELD_REGISTRY: EnrichmentFieldDescriptor[] = [
  {
    field: 'vat',
    target: 'vat_code_final',
    // Single VIES-confirming resolver (see vatResolve): confirmed company VAT
    // 0.95, footer-unconfirmed 0.6, proven-foreign refused. stop=0.6 so an
    // unconfirmed (but probably-right) footer VAT still fills, at honest low
    // confidence — fill-rate roughly preserved, precision raised.
    cascade: [vatResolve],
    ceilingEur: 0,
    stopConfidence: 0.6,
  },
  {
    field: 'email',
    // B.1: emailFromBody now reads a DEEPENED extraction (homepage + contact/about
    // pages, merged by deep_pages.ts) — same-domain precision preserved, fill-rate
    // lifted for the ~half of IT SMB sites that hide the email off the homepage.
    // The pattern-guess tier (info@domain) is wired-but-DISABLED on purpose: with
    // dns_mx removed (0%-useful) an unverified guess is a precision risk on the
    // verified base — exactly what Phase A fought. Activate only with a real
    // verifier (SMTP/finder API), and tag it as a distinct low-confidence source.
    target: 'email_inferred',
    cascade: [
      emailFromBody,
      disabled('email.pattern_guess', 1, 0, 'email:pattern_guess'),
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
