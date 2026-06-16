import type { Lead } from '../../../types/lead';
import type { Signal, EvidenceRef } from '../../../types/judgment';
import { getEnv } from '../../../config/env';
import type { SourceAdapter, HarvestContext, HarvestResult } from '../source_harvest';
import { SOURCE_TTL_DAYS } from '../routing';

/**
 * Google Places SourceAdapter — the OFFICIAL source for Maps/GBP/reviews/hours
 * (plan §19: official API over Maps HTML scraping). HYBRID: review CONTENT/rating
 * → Axis A (§2.4); GBP completeness + review MANAGEMENT (responses/recency) →
 * Axis B (§3.3/§3.4). Disabled by default (GOOGLE_PLACES_ENABLED).
 *
 * Watch-item #2: review MANAGEMENT (responses) is only PARTIALLY observable via
 * the official API. When a B aspect is not observable, this adapter LEAVES IT
 * OUT (→ collector marks it `unknown`) rather than asserting `confirmed_absent`.
 *
 * SHAPE STATUS: the Places response field paths are PENDING live verification;
 * the harvest parses defensively and returns ok:false rather than fabricating.
 */
export class PlacesSourceAdapter implements SourceAdapter {
  readonly kind = 'maps_gbp' as const;
  readonly id = 'google_places';
  readonly tier = 2 as const;
  readonly costEur = 0.005;

  available(): boolean {
    const e = getEnv();
    return e.GOOGLE_PLACES_ENABLED === true && typeof e.GOOGLE_PLACES_API_KEY === 'string' && e.GOOGLE_PLACES_API_KEY.length > 0;
  }

  ttlDays(): number | null {
    return SOURCE_TTL_DAYS.maps_gbp;
  }

  locate(lead: Lead): string | undefined {
    const name = lead.company_name as string | undefined;
    if (!name) return undefined;
    const city = (lead.city as string | undefined) ?? (lead.province as string | undefined) ?? '';
    return `${name} ${city}`.trim();
  }

  async harvest(locator: string, ctx: HarvestContext): Promise<HarvestResult> {
    const iso = new Date(ctx.now()).toISOString();
    const base: HarvestResult = { source: this.kind, sourceId: this.id, locator, fetchedAt: iso, ok: false, attributes: {}, signals: [] };
    if (!ctx.paidEnabled) return base; // tier-2: respect the paid gate
    const e = getEnv();
    // PENDING shape: Places Text Search. Built defensively; parse failure → ok:false.
    const url =
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(locator)}` +
      `&region=it&language=it&key=${encodeURIComponent(e.GOOGLE_PLACES_API_KEY ?? '')}`;
    const body = await ctx.fetcher(url);
    if (!body) return base;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return base;
    }
    const top = pickTopResult(json);
    if (!top) return base;

    const ev = (excerpt: string, c = 0.8): EvidenceRef[] => [{ source: 'google_places', url, excerpt, observedAt: iso, confidence: c }];
    const signals: Signal[] = [];
    // A side — review CONTENT/rating (§2.4 perceived quality).
    if (typeof top.rating === 'number') signals.push({ axis: 'A', key: '2.4', state: 'confirmed_present', value: top.rating, evidence: ev(`rating ${top.rating} (${top.userRatingsTotal ?? '?'} reviews)`) });
    // B side — GBP presence/completeness (§3.3).
    signals.push({ axis: 'B', key: '3.3', state: 'confirmed_present', value: 'gbp_present', evidence: ev('GBP profile present') });
    // B side — review volume present (§3.4); MANAGEMENT/responses NOT exposed → left unknown.
    if (typeof top.userRatingsTotal === 'number') signals.push({ axis: 'B', key: '3.4', state: 'confirmed_present', value: top.userRatingsTotal, evidence: ev(`${top.userRatingsTotal} reviews on GBP`), notes: 'volume only; responses/recency not observable via API (watch-item #2)' });

    const attributes: Record<string, string> = {};
    if (top.formattedAddress) attributes.address = top.formattedAddress;
    return { source: this.kind, sourceId: this.id, locator, fetchedAt: iso, ok: true, attributes, signals, raw: json };
  }
}

interface PlaceTop {
  rating?: number;
  userRatingsTotal?: number;
  formattedAddress?: string;
}
function pickTopResult(json: unknown): PlaceTop | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const r = results[0] as Record<string, unknown>;
  return {
    rating: typeof r.rating === 'number' ? r.rating : undefined,
    userRatingsTotal: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
    formattedAddress: typeof r.formatted_address === 'string' ? r.formatted_address : undefined,
  };
}
