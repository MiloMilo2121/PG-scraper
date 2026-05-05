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
  source?: string; // 'PG' | 'MAPS' | 'INPUT_CSV' | 'IMMOBILIARE'
  source_url?: string;
  pg_url?: string;
  maps_url?: string;
  confidence?: number; // 0..1 — raw discovery confidence (scraper)
  discovery_notes?: string;

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
 * Locked from Phase 1.
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
