import type { LeadStatus, ReasonCode, DiscoveryMethod, StageOutcome, LeadError } from './output';

/**
 * The single canonical Lead shape. Raw fields populated by the scraper;
 * enriched fields populated by the enricher. Every enriched field is optional.
 *
 * No parallel `RawLead` vs `EnrichedLead` types — there is one Lead type and
 * its fullness is a function of which stages have run.
 */
export interface Lead {
  // ---- Identity (raw) ----
  company_name: string;
  category?: string;

  // ---- Address (raw) ----
  city?: string;
  province?: string; // 2-letter code (MI, RM, ...)
  region?: string;
  zip_code?: string;
  address?: string;

  // ---- Contact (raw, may be enriched) ----
  phone?: string;
  email?: string;
  website?: string;
  vat_code?: string; // P.IVA (11 digits)

  // ---- Source provenance (raw) ----
  source?: string; // 'PG' | 'MAPS' | 'INPUT_CSV' | 'IMMOBILIARE' (primary)
  /**
   * All sources that contributed to this record. Phase 3.7 audit found
   * pg3 collapsed multi-source records into a single delimited string
   * (e.g. `"PG + Maps"`); pg4 keeps the structured array and joins on
   * CSV serialization.
   */
  sources?: string[];
  source_url?: string;
  pg_url?: string;
  maps_url?: string;
  confidence?: number; // 0..1 — raw discovery confidence (scraper)
  discovery_notes?: string;
  /**
   * The query under which this record was scraped (e.g. comune used in
   * the PG search URL). pg3 confused this with `city` — many records
   * carried the query comune even when the parsed business city was
   * different, leading to under-deduplication across queries. pg4 keeps
   * the two distinct.
   */
  query_location?: string;
  /**
   * Optional business-city alias when the parser is confident the
   * card's address is in a city different from the query location.
   */
  business_city?: string;
  /**
   * Maps-specific: signals the feed query likely hit the ~120 result
   * cap and may be incomplete. The orchestrator should split the query
   * into smaller geo grids when this is true.
   */
  cap_likely?: boolean;
  /**
   * Whether the Maps card type-string matches the requested category.
   *  - 'confirmed' → the card's category-tag span matches an expected token
   *  - 'unknown'   → no category-tag span present
   *  - 'mismatch'  → card present, but its tag does NOT match the requested
   *                  category (kept, not silently dropped, but flagged)
   */
  category_match?: 'confirmed' | 'unknown' | 'mismatch';

  // ---- Enrichment fields (all optional) ----
  status?: LeadStatus;
  reason_code?: ReasonCode;

  official_website?: string;
  website_confidence?: number; // 0..1
  website_discovery_method?: DiscoveryMethod;

  vat_code_final?: string;

  pec?: string;
  email_inferred?: string;
  email_type?: 'pec' | 'business' | 'public' | 'unknown';

  revenue?: string;
  revenue_year?: string;
  employees?: string;
  employees_is_estimated?: boolean;

  decision_maker_name?: string;
  decision_maker_role?: string;
  decision_maker_linkedin?: string;

  lead_score?: number; // 0..1 final composite score

  // ---- Run metadata ----
  cost_eur?: number;
  duration_ms?: number;
  providers_used?: string[];
  errors?: LeadError[];
  stage_outcomes?: Record<string, StageOutcome>;

  // ---- Catch-all for raw CSV columns we don't enumerate ----
  [extra: string]: unknown;
}

/**
 * Stable column order for the RAW CSV emitted by the scraper.
 * Phase 3.7 extended with `query_location`, `business_city`, and
 * `category_match` for cross-query dedupe and off-category flagging.
 */
export const RAW_CSV_COLUMNS = [
  'company_name',
  'category',
  'city',
  'province',
  'region',
  'address',
  'phone',
  'website',
  'source',
  'source_url',
  'pg_url',
  'maps_url',
  'vat_code',
  'confidence',
  'discovery_notes',
  'query_location',
  'business_city',
  'category_match',
] as const;

/**
 * Stable column order for the ENRICHED CSV emitted by the enricher.
 * Includes all RAW columns plus enriched fields.
 * Locked from Phase 1.
 */
export const ENRICHED_CSV_COLUMNS = [
  ...RAW_CSV_COLUMNS,
  'status',
  'reason_code',
  'official_website',
  'website_confidence',
  'website_discovery_method',
  'vat_code_final',
  'pec',
  'email_inferred',
  'email_type',
  'revenue',
  'revenue_year',
  'employees',
  'employees_is_estimated',
  'decision_maker_name',
  'decision_maker_role',
  'decision_maker_linkedin',
  'lead_score',
  'cost_eur',
  'duration_ms',
  'providers_used',
  'errors',
] as const;

export type RawCsvColumn = (typeof RAW_CSV_COLUMNS)[number];
export type EnrichedCsvColumn = (typeof ENRICHED_CSV_COLUMNS)[number];
