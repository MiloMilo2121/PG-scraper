import type { NormalizedLead } from '../../types/discovery';
import { ItalianNerParser } from './hyper_guesser/italian_ner_parser';

/**
 * Pure semantic-evidence helpers used by `PreVerifyGate` (Phase D).
 *
 * The audit (`pg4/docs/free_enrichment_audit.md`) showed the looser
 * Phase 4.2 gate accepted ~50% wrong matches. The helpers here
 * surface the deterministic signals the gate now requires:
 *
 *   - distinctive token extraction (post descriptor strip, ≥4 chars)
 *   - common bare-stem denylist (audit-observed Italian common words)
 *   - business-city / sector / tiny-or-parked classifiers
 *   - composite `evaluateSemanticEvidence` snapshot used by the gate
 *
 * No network. No browser. No LLM. Reuses `ItalianNerParser` for the
 * descriptor strip pass so the rules stay aligned with HyperGuesser.
 */

/**
 * Italian descriptors / legal-form / generic suffixes stripped before
 * computing distinctive brand tokens. Articles included so that
 * "La Mia Casa" → ["mia"] (then dropped by ≥4 filter), not ["la","mia","casa"].
 *
 * ItalianNerParser already strips a similar set; this list is broader
 * to catch what the audit revealed (see Phase D recommendations §D-2).
 */
const DESCRIPTORS = new Set<string>([
  // legal forms
  'srl', 'sas', 'snc', 'spa', 'srls', 'scarl', 'sapa', 'ss', 'soc',
  // sector descriptors common in Italian SMB names
  'agenzia', 'agenzie', 'immobiliare', 'immobiliari', 'agente', 'agenti',
  'studio', 'studi', 'gruppo', 'group', 'properties', 'casa', 'case',
  'ditta', 'impresa', 'societa', 'cooperativa', 'consorzio',
  // articles + connectors
  'di', 'del', 'della', 'delle', 'dei', 'degli', 'dello', 'da', 'al', 'allo',
  'le', 'la', 'il', 'lo', 'i', 'gli', 'un', 'uno', 'una',
  'e', '&', 'and', 'with', 'in', 'su',
  // legal abbreviations
  'c', 'co', 'p',
]);

/**
 * Bare-stem common words that must NEVER be accepted as a brand
 * identity match without external corroboration (RDAP / PIVA / phone).
 * Each entry was observed during the Phase C audit producing a
 * false positive. Keep this list small — too aggressive a denylist
 * also rejects legit short-brand TPs.
 */
const COMMON_BARE_STEMS = new Set<string>([
  'bloom',       // audit #15: Pieve di Cadore "Bloom" → bloom.it (org consulting blog)
  'ufficio',     // audit #26: Cortina "Ufficio" → ufficio.com (cartoleria)
  'area',        // audit #03: Belluno "Area Immobiliare" → areaimmobiliare.com (Bergamo)
  'progetto',    // audit #10: "Progetto 50" → progetto50.it (different "Progetto 5.0")
  'iniziative',  // audit #14: "Iniziative S.p.a." → iniziative.org (For Sale page)
  'appia',       // audit #24: "Immobiliare Appia" → immobiliareappia.it (Roma)
  'torri',       // audit #02: "Le Torri" → agenzialetorri.com (Modena)
  'mia',         // audit #08: "La Mia Casa" → agenzialamiacasa.it (Cuneo)
  // generic single-token Italian brand-noise:
  'futuro', 'ambiente', 'qualita', 'prestigio', 'centro', 'punto',
]);

/**
 * Italian sector keywords for category=`agenzie immobiliari`. Aligned
 * keywords confirm the page is real estate. Conflict keywords confirm
 * it's a different sector (the audit found 3 wrong-sector FPs:
 * dallariva.it carpentry, savim.it industrial paint, ufficio.com
 * stationery).
 */
const SECTOR_ALIGNED_REAL_ESTATE: ReadonlyArray<string> = [
  'immobiliare', 'agenzia immobiliare', 'agente immobiliare', 'real estate',
  'compravendita', 'locazione', 'affitto', 'vendita case', 'immobili',
  'monolocale', 'bilocale', 'trilocale', 'appartamento', 'villa in vendita',
];
const SECTOR_CONFLICT: ReadonlyArray<string> = [
  'cartoleria', 'cancelleria', 'toner', 'cartucce',
  'falegnameria', 'carpenteria', 'fresatura', 'alesatura', 'tornitura',
  'meccanica', 'verniciatura industriale',
  'ristorante', 'pizzeria', 'osteria', 'trattoria',
  'farmacia', 'parafarmacia', 'autosalone', 'concessionaria auto',
  'lavanderia industriale',
];

/**
 * Distinctive brand tokens for `companyName`, post descriptor strip,
 * length ≥ 4. Lowercased, accent-stripped, punctuation removed.
 */
export function extractDistinctiveTokens(companyName: string): string[] {
  if (!companyName) return [];
  // Use ItalianNerParser to get the same brand decomposition HyperGuesser uses.
  const ner = ItalianNerParser.parse(companyName);
  const candidates = ner.brandTokens && ner.brandTokens.length > 0
    ? ner.brandTokens
    : ner.normalized
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of candidates) {
    const cleaned = tok.toLowerCase();
    if (cleaned.length < 4) continue;
    if (DESCRIPTORS.has(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/** Compact stripped brand name (NER brandTokens joined, no spaces). */
export function compactStrippedBrand(companyName: string): string {
  const ner = ItalianNerParser.parse(companyName);
  if (ner.brandTokens && ner.brandTokens.length > 0) {
    return ner.brandTokens.join('').toLowerCase();
  }
  return ner.normalized.replace(/[^a-z0-9]/g, '').toLowerCase();
}

/**
 * Compact full company name (legal-form stripped only, descriptors KEPT).
 * Used by Layer A of the gate where the literal full brand string is the
 * specificity anchor (e.g. `agenziaimmobiliareestimopierobon`).
 */
export function compactFullName(companyName: string): string {
  const ner = ItalianNerParser.parse(companyName);
  return ner.normalized.replace(/[^a-z0-9]/g, '').toLowerCase();
}

/** True when the (already-lowercased) stem is in the audit denylist. */
export function isCommonBareStem(stem: string): boolean {
  return COMMON_BARE_STEMS.has(stem.toLowerCase());
}

/** Lower the host to its registrable-stem (no `www.`, no TLD). */
export function shortHost(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return h.split('.')[0];
  } catch {
    return '';
  }
}

/** True when `body` mentions any of the lead's locality tokens (lower-case). */
export function hasBusinessCityEvidence(html: string, normalized: NormalizedLead): boolean {
  if (!html) return false;
  const candidates = [normalized.city ?? '', normalized.address ?? '']
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 3);
  if (candidates.length === 0) return false;
  const lower = html.toLowerCase();
  return candidates.some((c) => lower.includes(c));
}

/** Per-category sector evidence; today only `agenzie immobiliari`. */
export function hasSectorEvidence(html: string, category?: string): {
  aligned: boolean;
  conflicting: boolean;
  alignedHits: string[];
  conflictHits: string[];
} {
  if (!html) return { aligned: false, conflicting: false, alignedHits: [], conflictHits: [] };
  const lower = html.toLowerCase();
  const cat = (category ?? '').toLowerCase();
  // For now only one supported category surface. Extend per category as we go.
  const isRealEstate = !category || cat.includes('immobil') || cat.includes('agenzie');
  const aligned = isRealEstate ? SECTOR_ALIGNED_REAL_ESTATE.filter((kw) => lower.includes(kw)) : [];
  const conflict = SECTOR_CONFLICT.filter((kw) => lower.includes(kw));
  return {
    aligned: aligned.length > 0,
    conflicting: conflict.length > 0,
    alignedHits: aligned,
    conflictHits: conflict,
  };
}

/**
 * Tiny-or-parked detection. Triggers if:
 *   - HTML body is shorter than 800 useful bytes (Phase D §9), OR
 *   - title contains parking markers ("for sale", "domain parked",
 *     "this premium domain"), OR
 *   - body contains explicit parking/auction strings.
 *
 * Does NOT trigger on the substring "for sale" elsewhere in body — Italian
 * real-estate pages legitimately advertise "case in vendita / for sale".
 */
export function isTinyOrParked(html: string): boolean {
  if (!html) return true;
  // "Useful bytes" — strip <script>/<style> blocks before measuring.
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  if (stripped.length < 800) return true;
  const lower = stripped.toLowerCase();
  const titleMatch = lower.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1] : '';
  const titleParkingMarkers = [
    'domain for sale', 'this premium', '- for sale', '— for sale', 'parked',
    'this domain is for sale', 'buy this domain', 'questo dominio',
  ];
  if (title && titleParkingMarkers.some((m) => title.includes(m))) return true;
  const bodyParkingMarkers = [
    'this domain is for sale', 'buy this domain', 'parked free',
    'is available for purchase', 'domain parked', 'sedo.com', 'dan.com',
    'huge domains', 'godaddy auctions', 'questo dominio è in vendita',
    'acquista questo dominio',
  ];
  return bodyParkingMarkers.some((m) => lower.includes(m));
}

/** Composite evidence object the gate uses to decide accept/reject + reason. */
export interface SemanticEvidence {
  /** Brand tokens of length ≥ 4 left after descriptor strip. */
  distinctiveTokens: string[];
  /** Stripped compact brand (e.g. `dmclegno`). */
  compactStripped: string;
  /** Full compact name with descriptors (e.g. `agenziaimmobiliareestimopierobon`). */
  compactFull: string;
  /** Lower-cased domain stem of the candidate URL (e.g. `agenziaimmobiliare`). */
  domainStem: string;
  /** True when the only distinctive brand token is in COMMON_BARE_STEMS. */
  hasCommonBareStem: boolean;
  /**
   * True when the lead has at least one non-generic identity anchor:
   *   - a distinctive token (≥4 chars, not descriptor) NOT in COMMON_BARE_STEMS, OR
   *   - a short brand token (2-3 chars, not descriptor, not common stem) — e.g. "SG"
   * Required by Layer A and Layer B; without it the candidate has no
   * brand identity to anchor on (e.g. "Agenzia Immobiliare" generic portal,
   * "La Mia Casa" descriptor-only).
   */
  hasNonGenericBrand: boolean;
  /** Layer A — full compact (descriptors kept) ≥ 14 chars AND in domain (or vice versa). */
  layerAFullName: boolean;
  /** Layer B — stripped compact ≥ 6 chars AND in domain (or vice versa) AND not common-stem. */
  layerBStrippedBrand: boolean;
  /** Multi-token semantic ratio: how many of `distinctiveTokens` appear in body lowercase. */
  multiTokenHits: number;
  /** True when body mentions one of normalized.{business_city, city, query_location}. */
  hasCity: boolean;
  /** Sector signal. */
  sectorAligned: boolean;
  sectorConflicting: boolean;
  alignedHits: string[];
  conflictHits: string[];
  /** True for placeholder / parked / very small responses. */
  tinyOrParked: boolean;
}

export function evaluateSemanticEvidence(
  url: string,
  html: string,
  normalized: NormalizedLead
): SemanticEvidence {
  const distinctiveTokens = extractDistinctiveTokens(normalized.company_name);
  const compactStripped = compactStrippedBrand(normalized.company_name);
  const compactFull = compactFullName(normalized.company_name);
  const domainStem = shortHost(url);

  // hasCommonBareStem: only-distinctive-token is in the audit denylist (e.g. "torri").
  // Also flag the case where the only distinctive token IS the lead's city
  // — that pattern (e.g. "Studio Belluno SRL" → belluno.eu) is almost
  // always a generic city portal, not the firm's site. Belluno-run found
  // 5 such FPs (belluno.eu, feltre.com, vittorio.com, valdobbiadene.com,
  // tambre.org) — Phase D follow-up to the audit.
  const leadCityCompact = (normalized.city ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  // Reject when (a) the only brand token equals the lead city AND (b) the
  // domain itself is just the city (or the first word of a multi-word
  // city, e.g. "vittorio" for "Vittorio Veneto"). Cortina Properties
  // (domain "cortinaproperties") is NOT caught because the domain has
  // brand additions beyond the city.
  const onlyTokenIsCity =
    distinctiveTokens.length === 1 &&
    leadCityCompact.length >= 4 &&
    distinctiveTokens[0].length >= 4 &&
    leadCityCompact.includes(distinctiveTokens[0]) &&
    domainStem.length >= 4 &&
    leadCityCompact.includes(domainStem);
  const hasCommonBareStem =
    (distinctiveTokens.length === 1 && isCommonBareStem(distinctiveTokens[0])) ||
    onlyTokenIsCity;

  const ner = ItalianNerParser.parse(normalized.company_name);

  // Short brand acronyms (2-3 chars not in DESCRIPTORS not in COMMON_BARE_STEMS).
  // Catches the SG case ("Agenzia Immobiliare SG" → distinctiveTokens=[] but
  // "sg" is a real 2-char brand acronym, not a generic descriptor).
  const shortBrandAcronyms = ner.brandTokens.filter(
    (t) =>
      t.length >= 2 &&
      t.length <= 3 &&
      !DESCRIPTORS.has(t) &&
      !COMMON_BARE_STEMS.has(t)
  );

  const distinctiveNonGeneric = distinctiveTokens.filter((t) => !COMMON_BARE_STEMS.has(t));
  const hasNonGenericBrand = distinctiveNonGeneric.length >= 1 || shortBrandAcronyms.length >= 1;

  // Domain-stem floor: 6 chars. Without this, 2-3 char acronym domains
  // (am.com, ca.com, az.com) coincidentally substring-match into long
  // company-name compacts and pass the layer. Audit Phase D follow-up.
  const domainStemLongEnough = domainStem.length >= 6;

  const layerAFullName =
    compactFull.length >= 14 &&
    ner.brandTokens.length >= 1 &&
    hasNonGenericBrand &&
    !hasCommonBareStem &&
    domainStemLongEnough &&
    (domainStem.includes(compactFull) || compactFull.includes(domainStem));

  const layerBStrippedBrand =
    compactStripped.length >= 6 &&
    !hasCommonBareStem &&
    hasNonGenericBrand &&
    domainStemLongEnough &&
    (domainStem.includes(compactStripped) || compactStripped.includes(domainStem));

  const lower = (html ?? '').toLowerCase();
  const multiTokenHits = distinctiveTokens.filter((t) => lower.includes(t)).length;
  const hasCity = hasBusinessCityEvidence(html, normalized);
  const sector = hasSectorEvidence(html, normalized.raw?.category as string | undefined);
  const tinyOrParked = isTinyOrParked(html);

  return {
    distinctiveTokens,
    compactStripped,
    compactFull,
    domainStem,
    hasCommonBareStem,
    hasNonGenericBrand,
    layerAFullName,
    layerBStrippedBrand,
    multiTokenHits,
    hasCity,
    sectorAligned: sector.aligned,
    sectorConflicting: sector.conflicting,
    alignedHits: sector.alignedHits,
    conflictHits: sector.conflictHits,
    tinyOrParked,
  };
}
