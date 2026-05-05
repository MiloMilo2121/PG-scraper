import type { Lead } from '../types/lead';

/**
 * Lead deduplicator. Merges duplicates by signature: phone OR
 * (normalized name + city) OR pg_url OR maps_url OR website host.
 *
 * Used by the scraper (raw output) to collapse multi-source results.
 */
export class Deduplicator {
  private byPhone = new Map<string, Lead>();
  private byNameCity = new Map<string, Lead>();
  private byPgUrl = new Map<string, Lead>();
  private byMapsUrl = new Map<string, Lead>();
  private byHost = new Map<string, Lead>();

  /** Returns the existing record if a duplicate, else undefined. */
  find(item: Lead): Lead | undefined {
    const phone = this.phoneKey(item);
    if (phone && this.byPhone.has(phone)) return this.byPhone.get(phone);
    const nc = this.nameCityKey(item);
    if (nc && this.byNameCity.has(nc)) return this.byNameCity.get(nc);
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
    if (item.pg_url) this.byPgUrl.set(item.pg_url, item);
    if (item.maps_url) this.byMapsUrl.set(item.maps_url, item);
    const host = this.hostKey(item.website);
    if (host) this.byHost.set(host, item);
  }

  /** Merge `incoming` non-empty fields onto `existing` (existing wins on conflict). */
  merge(existing: Lead, incoming: Lead): void {
    for (const [k, v] of Object.entries(incoming)) {
      if (v === undefined || v === null || v === '') continue;
      if (existing[k] === undefined || existing[k] === null || existing[k] === '') {
        (existing as Record<string, unknown>)[k] = v;
      }
    }
  }

  size(): number {
    return this.byNameCity.size;
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
    const n = item.company_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const c = (item.city ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return n.length >= 3 ? `${n}|${c}` : undefined;
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
