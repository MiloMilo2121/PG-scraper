import type { Lead } from '../types/lead';

/**
 * API control-plane types. These are the request/response contracts the
 * frontend speaks; a Next.js route handler is a thin adapter that parses the
 * HTTP request into these shapes, resolves the TenantContext from the session,
 * and calls the matching handler in control_plane.ts. Keeping the logic
 * framework-agnostic means it is unit-testable with zero server/DB.
 */

/** Resolved from the authenticated session. EVERY handler requires one. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  /** owner | admin | member | viewer — gates write vs read. */
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

export class ApiError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The enrichable fields a per-field job can target (see Phase D registry). */
export type EnrichableField =
  | 'official_website'
  | 'email'
  | 'pec'
  | 'vat'
  | 'revenue'
  | 'employees'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'decision_maker';

// ---- requests ----

export interface ImportCompaniesRequest {
  rows: Lead[];
}
export interface ImportCompaniesResponse {
  imported: number;
  merged: number;
  rejected: number; // un-dedupable rows
  companyIds: string[];
}

export interface CreateScrapeJobRequest {
  category: string;
  province?: string;
  comuni?: string[];
  sources: Array<'pg' | 'maps' | 'registry'>;
  paidEnabled: boolean;
  perItemCostCeilingEur?: number;
  runCostCeilingEur?: number;
}

export interface CreateEnrichJobRequest {
  /** Company ids to enrich (must belong to the tenant). */
  companyIds: string[];
  fields: EnrichableField[];
  paidEnabled: boolean;
  perItemCostCeilingEur?: number;
  runCostCeilingEur?: number;
}

export interface JobAccepted {
  jobId: string;
  status: JobStatus;
  itemCount: number;
  estimatedCostEur: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type JobItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'cost_capped';

export interface JobItemView {
  id: string;
  companyId?: string;
  fields: EnrichableField[];
  status: JobItemStatus;
  costEur: number;
}

export interface JobStatusView {
  jobId: string;
  kind: 'scrape_run' | 'enrich_fields';
  status: JobStatus;
  totalCostEur: number;
  items: JobItemView[];
  /** Live fill-rate per field across the job's companies. */
  fillRates?: Partial<Record<EnrichableField, number>>;
}

export interface CostView {
  totalCostEur: number;
  ceilingEur?: number;
  ceilingHit: boolean;
  byProvider: Record<string, { calls: number; costEur: number; successRate: number }>;
  /** Gate-0 — providers flagged dead this job (0% success ≥N calls). */
  providerDead: string[];
}

export interface AddSuppressionRequest {
  phone?: string;
  vat?: string;
  email?: string;
  reason: 'operator' | 'art21_objection' | 'art14' | 'rpo';
}
