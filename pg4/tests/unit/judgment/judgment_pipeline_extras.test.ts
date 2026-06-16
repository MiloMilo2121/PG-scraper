import { describe, expect, it } from 'vitest';
import type { Lead } from '../../../src/types/lead';
import { InMemoryEnrichmentCache } from '../../../src/persistence/enrichment_cache';
import { InMemoryTenantDb } from '../../../src/persistence/in_memory_tenant_db';
import { ControlPlane } from '../../../src/api/control_plane';
import type { TenantContext } from '../../../src/api/types';
import { getActiveJudgmentConfig } from '../../../src/judgment/config';
import { harvestSource, emptyBundle } from '../../../src/judgment/harvest/source_harvest';
import type { HarvestContext, PageFetcher } from '../../../src/judgment/harvest/source_harvest';
import { WebsiteSourceAdapter } from '../../../src/judgment/harvest/adapters/website_adapter';
import { computeCategoryProfile } from '../../../src/judgment/benchmark';
import { evaluate, type GoldenItem } from '../../../src/judgment/eval';
import type { JudgmentRecord } from '../../../src/types/judgment';

const config = getActiveJudgmentConfig();
const lead = (o: Partial<Lead>): Lead => ({ company_name: 'Acme Srl', ...o });
const HTML = '<html lang="it"><h1>Acme</h1><footer>© 2025</footer></html>';

describe('SourceHarvest is cache-first (cost principle §0)', () => {
  it('fetches a source ONCE, then serves the cache (cross-button reuse)', async () => {
    let fetches = 0;
    const fetcher: PageFetcher = async () => {
      fetches += 1;
      return HTML;
    };
    const cache = new InMemoryEnrichmentCache();
    // ctx.now aligns with the cache's internal clock (Date.now in prod), so the
    // fresh entry isn't read as TTL-expired.
    const ctx: HarvestContext = { tenantId: 't', cache, fetcher, paidEnabled: false, now: () => Date.now() };
    const l = lead({ official_website: 'https://acme.it' });
    const r1 = await harvestSource(new WebsiteSourceAdapter(), l, emptyBundle(), ctx);
    const r2 = await harvestSource(new WebsiteSourceAdapter(), l, emptyBundle(), ctx);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(fetches).toBe(1); // second call hit the cache
  });
});

describe('category benchmark two-pass (§17 ⟂ §1.4)', () => {
  it('computes presence rates and flags a thin cohort provisional', () => {
    const items = [
      { segnali_B: [{ axis: 'B' as const, key: '3.1', state: 'confirmed_present' as const, value: ['x'], evidence: [] }] },
      { segnali_B: [{ axis: 'B' as const, key: '3.1', state: 'unknown_not_found' as const, evidence: [] }] },
    ];
    const prof = computeCategoryProfile(items, 'macchinari', config, '2026');
    expect(prof.sampleSize).toBe(2);
    expect(prof.provisional).toBe(true); // < benchmarkMinSample
    expect(prof.benchmarks['3.1'].presenceRate).toBe(0.5);
  });
});

describe('eval harness (§15) — precision/recall + separate A/B agreement', () => {
  it('scores the target verdict and per-axis agreement', () => {
    const golden: GoldenItem[] = [
      { id: 'a', expectedTarget: 'yes', expectedALevel: 'high', expectedBLevel: 'low' },
      { id: 'b', expectedTarget: 'no', expectedALevel: 'low' },
    ];
    const preds = new Map<string, JudgmentRecord>([
      ['a', { valutazione_A: { axis: 'A', score: 0.8, level: 'high', rationale: '', signalsConsidered: 1, signalsPresent: 1, signalsUnknown: 0, basedOn: [] }, valutazione_B: { axis: 'B', score: 0.1, level: 'low', rationale: '', signalsConsidered: 1, signalsPresent: 0, signalsUnknown: 0, basedOn: [] }, verdetto_gap: { businessModel: 'B2B_manufacturing', quadrant: 'A+B-', scoreA: 0.8, scoreB: 0.1, gap: 0.7, gapWidth: 'wide', trajectory: 'unknown', cause: 'omission', disqualifiers: [], target: 'yes', motivation: '', confidence: 0.7 } }],
      ['b', { valutazione_A: { axis: 'A', score: 0.2, level: 'low', rationale: '', signalsConsidered: 1, signalsPresent: 0, signalsUnknown: 0, basedOn: [] }, verdetto_gap: { businessModel: 'unknown', quadrant: 'A-B-', scoreA: 0.2, scoreB: 0.2, gap: 0, gapWidth: 'narrow', trajectory: 'unknown', cause: 'unknown', disqualifiers: [], target: 'no', motivation: '', confidence: 0.5 } }],
    ]);
    const report = evaluate(golden, preds);
    expect(report.target.precision).toBe(1);
    expect(report.target.recall).toBe(1);
    expect(report.aAgreement).toBe(1);
  });
});

describe('judgment job creation is tenant-scoped (control plane)', () => {
  const TA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const TB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const ctx = (t: string, role: TenantContext['role'] = 'admin'): TenantContext => ({ tenantId: t, userId: `u_${t.slice(0, 4)}`, role });

  it('creates a discovery job for own companies and 404s on cross-tenant ids', async () => {
    const cp = new ControlPlane(new InMemoryTenantDb());
    const imp = await cp.importCompanies(ctx(TA), { rows: [lead({ company_name: 'Rossi', city: 'Padova', phone: '0491234567' })] });
    const id = imp.companyIds[0];
    const job = await cp.createDiscoveryJob(ctx(TA), { companyIds: [id] });
    expect(job.itemCount).toBe(1);
    await expect(cp.createJudgeJob(ctx(TB), { companyIds: [id] })).rejects.toMatchObject({ status: 404 });
  });

  it('viewer role cannot create a judge job (403)', async () => {
    const cp = new ControlPlane(new InMemoryTenantDb());
    await expect(cp.createJudgeJob(ctx(TA, 'viewer'), { companyIds: ['x'] })).rejects.toMatchObject({ status: 403 });
  });
});
