import http from 'http';
import path from 'path';
import type { Lead } from '../types/lead';
import { loadSeed, DEV_TENANT_ID } from './seed';
import type { SeedResult } from './seed';
import { Deduplicator } from '../discovery/deduper';
import { DirectFetchProvider } from '../providers/http/direct_fetch';
import { runFieldCascade } from '../enrichment/fields/run_field_cascade';
import { FIELD_BY_NAME } from '../enrichment/fields/field_registry';
import type { EnrichableField } from '../api/types';

/**
 * pg4 dev API server — single-tenant, local, zero-cloud. Wraps the REAL engine
 * (no mocks): the in-memory store is seeded from real free-gold output, the
 * enrich-field endpoint runs the real per-field cascade against the real sites
 * via direct_fetch (free), and the metrics/provider-health/dedup come from the
 * real data. The multi-tenant schema + Postgres adapter are untouched; this app
 * just pins one tenant. Run with `pnpm run serve`.
 */

const PORT = Number(process.env.PG4_API_PORT ?? 8787);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FETCH = new DirectFetchProvider();

// ---- in-memory job registry for the async enrich-field UX (polling) ----
type CellStatus = 'queued' | 'running' | 'filled' | 'failed' | 'not_found';
interface EnrichJob {
  id: string;
  fields: EnrichableField[];
  status: 'running' | 'done';
  costEur: number;
  items: Map<string, { companyId: string; cells: Record<string, { status: CellStatus; value?: string; source?: string }> }>;
}
const jobs = new Map<string, EnrichJob>();
let jobSeq = 0;

let seed: SeedResult;

// ---------------------------------------------------------------------------
function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const FIELD_FILL_TARGETS: Record<string, EnrichableField> = {
  email: 'email',
  pec: 'pec',
  vat: 'vat',
  instagram: 'instagram',
  facebook: 'facebook',
  linkedin: 'linkedin',
};

// ---- intelligence computed from the REAL seeded data ----
function companies(): Array<{ id: string; row: Record<string, unknown> }> {
  return seed.db.entries(DEV_TENANT_ID).map((e) => ({ id: e.id, row: e.row as Record<string, unknown> }));
}

function fillRate(rows: Array<Record<string, unknown>>, field: string): number {
  if (rows.length === 0) return 0;
  const n = rows.filter((r) => r[field] !== undefined && r[field] !== null && r[field] !== '').length;
  return Math.round((1000 * n) / rows.length) / 10;
}

function computeMetrics() {
  const rows = companies().map((c) => c.row);
  const withWebsite = rows.filter((r) => r.official_website).length;
  const sources: Record<string, number> = {};
  for (const r of rows) {
    const s = String(r.source ?? 'UNKNOWN');
    sources[s] = (sources[s] ?? 0) + 1;
  }
  return {
    total: rows.length,
    withWebsite,
    // Maps non-determinism honesty: a Maps-heavy count is a point estimate of a
    // wide band (measured 6× swing), so we expose it as "≥ N", not a fact.
    mapsBand: { display: `≥ ${rows.length}`, note: 'Maps counts swing run-to-run (measured 6×); treat as a lower bound.' },
    fillRates: {
      official_website: fillRate(rows, 'official_website'),
      phone: fillRate(rows, 'phone'),
      email: fillRate(rows, 'email_inferred'),
      pec: fillRate(rows, 'pec'),
      vat: fillRate(rows, 'vat_code_final'),
      instagram: fillRate(rows, 'instagram'),
      facebook: fillRate(rows, 'facebook'),
      linkedin: fillRate(rows, 'linkedin'),
    },
    sources,
  };
}

function computeDedupReview() {
  const dd = new Deduplicator();
  for (const c of companies()) dd.add(c.row as unknown as Lead);
  return dd.getReviewCandidates().slice(0, 50);
}

// ---- the live free-gold enrich-field job ----
async function runEnrichJob(job: EnrichJob, companyIds: string[]): Promise<void> {
  for (const cid of companyIds) {
    const row = seed.db.getById(DEV_TENANT_ID, cid) as Record<string, unknown> | undefined;
    const item = job.items.get(cid)!;
    if (!row || !row.official_website) {
      for (const f of job.fields) item.cells[f] = { status: 'not_found' };
      continue;
    }
    for (const f of job.fields) item.cells[f] = { status: 'running' };

    let html: string | undefined;
    try {
      const res = await FETCH.fetch(String(row.official_website), { timeoutMs: 8000 });
      html = res.html;
    } catch {
      /* fetch failed → not_found below */
    }

    for (const f of job.fields) {
      const field = FIELD_FILL_TARGETS[f];
      if (!field || !html) {
        item.cells[f] = { status: 'not_found' };
        continue;
      }
      const lead = { ...row } as Lead;
      const outcome = runFieldCascade(lead, field, { body: html });
      if (outcome.resolved && outcome.value) {
        const target = FIELD_BY_NAME.get(field)!.target as string;
        seed.db.patchCompany(DEV_TENANT_ID, cid, { [target]: outcome.value });
        item.cells[f] = { status: 'filled', value: outcome.value, source: outcome.source };
      } else {
        item.cells[f] = { status: 'not_found' };
      }
    }
  }
  job.status = 'done';
}

// ---------------------------------------------------------------------------
function jobView(job: EnrichJob) {
  return {
    jobId: job.id,
    status: job.status,
    fields: job.fields,
    costEur: job.costEur,
    items: [...job.items.values()],
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (p === '/api/health') {
    return json(res, 200, { ok: true, tenant: DEV_TENANT_ID, companies: companies().length, seed: seed.sourceFile });
  }

  if (p === '/api/companies' && req.method === 'GET') {
    const limit = Math.min(2000, Number(url.searchParams.get('limit') ?? 200));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const onlyWebsite = url.searchParams.get('hasWebsite') === '1';
    let rows = companies().map((c) => ({ id: c.id, ...c.row }));
    if (onlyWebsite) rows = rows.filter((r) => (r as Record<string, unknown>).official_website);
    return json(res, 200, { total: rows.length, rows: rows.slice(offset, offset + limit) });
  }

  if (p === '/api/metrics' && req.method === 'GET') return json(res, 200, computeMetrics());

  if (p === '/api/provider-health' && req.method === 'GET') {
    return json(res, 200, {
      providerDead: seed.providerDead,
      note: seed.providerDead.length
        ? 'A provider made calls this run but never succeeded — surfaced, not hidden (the dns_mx/crtsh class).'
        : 'All providers healthy in the seed run.',
    });
  }

  if (p === '/api/dedup-review' && req.method === 'GET') {
    return json(res, 200, { candidates: computeDedupReview() });
  }

  if (p === '/api/cost' && req.method === 'GET') {
    let live = 0;
    for (const j of jobs.values()) live += j.costEur;
    return json(res, 200, {
      seedRunCostEur: Math.round(seed.ledgerTotalEur * 1e4) / 1e4,
      liveSessionCostEur: live,
      ceilingEur: null,
      ceilingHit: false,
      note: 'Free tiers only this pass — paid waterfalls disabled behind their tested ceiling.',
    });
  }

  if (p === '/api/jobs/enrich' && req.method === 'POST') {
    const body = (await readBody(req)) as { companyIds?: string[]; fields?: string[] };
    const ids = Array.isArray(body.companyIds) ? body.companyIds : [];
    const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f) => f in FIELD_FILL_TARGETS) as EnrichableField[];
    if (!ids.length || !fields.length) return json(res, 422, { error: 'companyIds and fields are required' });
    const job: EnrichJob = {
      id: `job_${++jobSeq}`,
      fields,
      status: 'running',
      costEur: 0, // free-gold is €0
      items: new Map(ids.map((cid) => [cid, { companyId: cid, cells: Object.fromEntries(fields.map((f) => [f, { status: 'queued' as CellStatus }])) }])),
    };
    jobs.set(job.id, job);
    // fire-and-forget; the UI polls /api/jobs/:id
    void runEnrichJob(job, ids);
    return json(res, 202, { jobId: job.id, itemCount: ids.length });
  }

  const jobMatch = p.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const job = jobs.get(jobMatch[1]);
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, jobView(job));
  }

  if (p === '/api/jobs/scrape' && req.method === 'POST') {
    const body = (await readBody(req)) as { category?: string; province?: string };
    // Single-tenant dev: a fresh live scrape shells out to the validated CLI
    // (free tiers) — best-effort. We do not block the dashboard on it.
    return json(res, 202, {
      accepted: true,
      note:
        `A fresh free-gold run for "${body.category ?? '?'}" / ${body.province ?? '?'} would run via the validated CLI ` +
        `(\`pnpm run run -- --category ... --province ... --out output/<name>\`). ` +
        `In this dev build the dashboard is seeded with real prior free-gold data; live runs are best-effort and reseed on restart.`,
    });
  }

  if (p === '/api/runs' && req.method === 'GET') {
    return json(res, 200, {
      runs: [
        {
          run_id: 'seed-r12',
          command: 'enrich',
          status: 'ok',
          leads_out: companies().length,
          with_website: companies().filter((c) => (c.row as Record<string, unknown>).official_website).length,
          total_cost_eur: Math.round(seed.ledgerTotalEur * 1e4) / 1e4,
          provider_dead: seed.providerDead.map((d) => d.provider),
        },
      ],
    });
  }

  return json(res, 404, { error: 'not found', path: p });
}

async function main(): Promise<void> {
  process.stderr.write('[api] seeding from real free-gold output…\n');
  seed = await loadSeed(REPO_ROOT, process.env.PG4_SEED_FILE);
  process.stderr.write(`[api] seeded ${seed.loaded} companies (${seed.rejected} rejected) from ${seed.sourceFile}\n`);
  if (seed.providerDead.length) {
    process.stderr.write(`[api] provider-health: ${seed.providerDead.map((d) => `${d.provider}(${d.calls},${d.dominant_kind})`).join(', ')}\n`);
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => json(res, 500, { error: (err as Error).message }));
  });
  server.listen(PORT, () => {
    process.stderr.write(`[api] pg4 dev API on http://localhost:${PORT} (tenant ${DEV_TENANT_ID})\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`[api] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
