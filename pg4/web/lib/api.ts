// Typed client for the pg4 dev API server (the REAL engine, single tenant).
// No mocks: every call hits http://localhost:8787 (NEXT_PUBLIC_API_BASE).

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787';

export interface Company {
  id: string;
  company_name?: string;
  category?: string;
  city?: string;
  province?: string;
  phone?: string;
  official_website?: string;
  email_inferred?: string;
  pec?: string;
  vat_code_final?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  source?: string;
  [k: string]: unknown;
}

export interface Metrics {
  total: number;
  withWebsite: number;
  mapsBand: { display: string; note: string };
  fillRates: Record<string, number>;
  sources: Record<string, number>;
}

export interface ProviderHealth {
  providerDead: Array<{ provider: string; calls: number; dominant_kind: string }>;
  note: string;
}

export interface CostView {
  seedRunCostEur: number;
  liveSessionCostEur: number;
  ceilingEur: number | null;
  ceilingHit: boolean;
  note: string;
}

export type CellStatus = 'queued' | 'running' | 'filled' | 'failed' | 'not_found';
export interface EnrichJob {
  jobId: string;
  status: 'running' | 'done';
  fields: string[];
  costEur: number;
  items: Array<{ companyId: string; cells: Record<string, { status: CellStatus; value?: string; source?: string }> }>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; companies: number; seed: string; tenant: string }>('/api/health'),
  companies: (limit = 500, offset = 0, hasWebsite = false) =>
    get<{ total: number; rows: Company[] }>(`/api/companies?limit=${limit}&offset=${offset}${hasWebsite ? '&hasWebsite=1' : ''}`),
  metrics: () => get<Metrics>('/api/metrics'),
  providerHealth: () => get<ProviderHealth>('/api/provider-health'),
  dedupReview: () => get<{ candidates: unknown[] }>('/api/dedup-review'),
  cost: () => get<CostView>('/api/cost'),
  runs: () => get<{ runs: Array<Record<string, unknown>> }>('/api/runs'),
  enrich: (companyIds: string[], fields: string[]) => post<{ jobId: string; itemCount: number }>('/api/jobs/enrich', { companyIds, fields }),
  job: (id: string) => get<EnrichJob>(`/api/jobs/${id}`),
  scrape: (body: Record<string, unknown>) => post<{ accepted: boolean; note: string }>('/api/jobs/scrape', body),
};

export const API_BASE = BASE;
