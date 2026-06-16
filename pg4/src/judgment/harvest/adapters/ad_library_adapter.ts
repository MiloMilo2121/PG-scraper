import type { Lead } from '../../../types/lead';
import type { Signal } from '../../../types/judgment';
import { getEnv } from '../../../config/env';
import type { SourceAdapter, HarvestContext, HarvestResult } from '../source_harvest';
import { SOURCE_TTL_DAYS } from '../routing';

/**
 * Ad-library SourceAdapter — Meta Ad Library / Google Ads Transparency presence
 * (§3.11). Axis B. Disabled by default (ADLIB_ENABLED).
 *
 * Special three-state nuance: the public ad libraries are AUTHORITATIVE, so a
 * successful query that returns NO active ads is a legitimate `confirmed_absent`
 * (and, for a strong-product company, a key "unmonetized potential" target
 * signal — §3.11.2). Unavailable/failed query → ok:false → `unknown`.
 *
 * SHAPE STATUS: endpoint/response PENDING live verification; parses defensively.
 */
export class AdLibrarySourceAdapter implements SourceAdapter {
  readonly kind = 'ad_library' as const;
  readonly id = 'ad_library';
  readonly tier = 1 as const;
  readonly costEur = 0;

  available(): boolean {
    const e = getEnv();
    return e.ADLIB_ENABLED === true && typeof e.ADLIB_API_KEY === 'string' && e.ADLIB_API_KEY.length > 0;
  }

  ttlDays(): number | null {
    return SOURCE_TTL_DAYS.ad_library;
  }

  locate(lead: Lead): string | undefined {
    return (lead.company_name as string | undefined) ?? undefined;
  }

  async harvest(locator: string, ctx: HarvestContext): Promise<HarvestResult> {
    const iso = new Date(ctx.now()).toISOString();
    const base: HarvestResult = { source: this.kind, sourceId: this.id, locator, fetchedAt: iso, ok: false, attributes: {}, signals: [] };
    const e = getEnv();
    // PENDING shape; built defensively. Parse failure → ok:false (unknown).
    const url = `https://graph.facebook.com/v18.0/ads_archive?search_terms=${encodeURIComponent(locator)}&ad_reached_countries=IT&access_token=${encodeURIComponent(e.ADLIB_API_KEY ?? '')}`;
    const body = await ctx.fetcher(url);
    if (body === undefined) return base;
    let count: number | undefined;
    try {
      const json = JSON.parse(body) as { data?: unknown[] };
      count = Array.isArray(json.data) ? json.data.length : undefined;
    } catch {
      return base;
    }
    if (count === undefined) return base;

    const signals: Signal[] = [];
    if (count > 0) {
      signals.push({ axis: 'B', key: '3.11', state: 'confirmed_present', value: count, evidence: [{ source: 'ad_library', url, excerpt: `${count} active ads in the public library`, observedAt: iso, confidence: 0.8 }] });
    } else {
      // authoritative library queried, nothing found → confirmed_absent (target signal)
      signals.push({ axis: 'B', key: '3.11', state: 'confirmed_absent', evidence: [{ source: 'ad_library', url, excerpt: 'no active ads in the public library', observedAt: iso, confidence: 0.7 }], notes: 'absence of advertising in a strong-product company = unmonetized potential (§3.11.2)' });
    }
    return { source: this.kind, sourceId: this.id, locator, fetchedAt: iso, ok: true, attributes: {}, signals };
  }
}
