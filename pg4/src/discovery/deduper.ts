import type { Lead } from '../types/lead';

/**
 * Raw-lead deduplicator used by the scraper to collapse results from
 * multiple sources (PG + Maps + …). Uses a multi-key index — a record is
 * a duplicate if ANY of these match:
 *   - normalized phone
 *   - normalized (name + city)
 *   - normalized (name + first 3 address tokens)
 *   - pg_url (canonical)
 *   - maps_url (canonical)
 *   - website registrable host
 *
 * Merge policy is conservative: incoming fields fill in only what the
 * existing record is missing. Existing values always win on conflict —
 * the FIRST source wins. To bias toward a richer source, push that source
 * first (e.g. PG before Maps for Italian SMBs, since PG addresses are more
 * structured).
 */
export class Deduplicator {
  private byPhone = new Map<string, Lead>();
  private byNameCity = new Map<string, Lead>();
  private byNameAddr = new Map<string, Lead>();
  private byPgUrl = new Map<string, Lead>();
  private byMapsUrl = new Map<string, Lead>();
  private byHost = new Map<string, Lead>();

  find(item: Lead): Lead | undefined {
    const phone = this.phoneKey(item);
    if (phone && this.byPhone.has(phone)) return this.byPhone.get(phone);
    const nc = this.nameCityKey(item);
    if (nc && this.byNameCity.has(nc)) return this.byNameCity.get(nc);
    const na = this.nameAddrKey(item);
    if (na && this.byNameAddr.has(na)) return this.byNameAddr.get(na);
    if (item.pg_url && this.byPgUrl.has(item.pg_url)) return this.byPgUrl.get(item.pg_url);
    if (item.maps_url && this.byMapsUrl.has(item.maps_url)) return this.byMapsUrl.get(item.maps_url);
    const host = this.hostKey(item.website);
    if (host && this.byHost.has(host)) return this.byHost.get(host);
    return undefined;
  }

  add(item: Lead): void {
    const phone = this.phoneKey(item);
    if (phone) this.byPhone.set(phone, item);
    const nc = this.nameCityKey(item);
    if (nc) this.byNameCity.set(nc, item);
    const na = this.nameAddrKey(item);
    if (na) this.byNameAddr.set(na, item);
    if (item.pg_url) this.byPgUrl.set(item.pg_url, item);
    if (item.maps_url) this.byMapsUrl.set(item.maps_url, item);
    const host = this.hostKey(item.website);
    if (host) this.byHost.set(host, item);
  }

  /**
   * Conservative merge: only fill in fields that `existing` is missing.
   * Existing values are NEVER overwritten on scalar fields — caller
   * chooses authority by order of `add()` calls.
   *
   * EXCEPTION: `sources[]` is treated as a UNION (Phase 3.7) — pg3 used
   * a delimited string and lost provenance. pg4 keeps every contributing
   * source visible.
   */
  merge(existing: Lead, incoming: Lead): void {
    for (const [k, v] of Object.entries(incoming)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'sources' && Array.isArray(v)) {
        const cur = Array.isArray(existing.sources) ? existing.sources : existing.source ? [existing.source] : [];
        const set = new Set([...cur, ...(v as string[])]);
        existing.sources = Array.from(set);
        continue;
      }
      if (existing[k] === undefined || existing[k] === null || existing[k] === '') {
        (existing as Record<string, unknown>)[k] = v;
      }
    }
    // Update lookup tables in case the merged record has new keys we should index.
    this.add(existing);
  }

  size(): number {
    return this.byNameCity.size || this.byNameAddr.size;
  }

  private phoneKey(item: Lead): string | undefined {
    if (!item.phone) return undefined;
    let digits = item.phone.replace(/\D/g, '');
    // Strip leading 0039 / 39 country prefix to match domestic vs international writings.
    if (digits.startsWith('0039')) digits = digits.slice(4);
    else if (digits.length >= 11 && digits.startsWith('39')) digits = digits.slice(2);
    return digits.length >= 8 ? digits : undefined;
  }

  private nameCityKey(item: Lead): string | undefined {
    if (!item.company_name) return undefined;
    const n = normalizeForKey(item.company_name);
    const c = normalizeForKey(item.city ?? '');
    return n.length >= 3 ? `${n}|${c}` : undefined;
  }

  /**
   * Fallback key for cards without a city tag. Concatenates the normalized
   * company name with the first 3 tokens of the address (numbers stripped),
   * which is enough to disambiguate two agencies on the same street.
   */
  private nameAddrKey(item: Lead): string | undefined {
    if (!item.company_name || !item.address) return undefined;
    const n = normalizeForKey(item.company_name);
    if (n.length < 3) return undefined;
    const addrTokens = normalizeForKey(item.address)
      .split(' ')
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
      .slice(0, 3)
      .join(' ');
    return addrTokens ? `${n}|addr:${addrTokens}` : undefined;
  }

  private hostKey(website: string | undefined): string | undefined {
    if (!website) return undefined;
    try {
      return new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return undefined;
    }
  }
}

function normalizeForKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Pure functional dedupe: returns a new array with duplicates merged in
 * order of appearance. Convenient for tests and small batches.
 */
export function dedupeLeads(items: Lead[]): Lead[] {
  const dd = new Deduplicator();
  const out: Lead[] = [];
  for (const item of items) {
    const existing = dd.find(item);
    if (existing) {
      dd.merge(existing, item);
    } else {
      dd.add(item);
      out.push(item);
    }
  }
  return out;
}
