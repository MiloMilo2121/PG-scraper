import { request } from 'undici';
import type { SerpProvider, SerpResult } from '../../types/providers';
import { DEFAULTS } from '../../config/defaults';
import { getEnv } from '../../config/env';

interface CrtShEntry {
  common_name?: string;
  name_value?: string;
  issuer_name?: string;
}

/**
 * Tier 0 SERP via crt.sh (Certificate Transparency). Given a query that
 * contains a registrable domain, returns SAN domains found in TLS
 * certificates issued for it. Useful for discovering tenant subdomains and
 * sometimes the canonical apex when only a sub is known.
 *
 * Free, no API key, no rate limit (well-behaved).
 */
export class CrtshProvider implements SerpProvider {
  readonly id = 'crtsh';
  readonly family = 'serp' as const;
  readonly tier = 0;
  readonly costPerCallEur = 0;

  available(): boolean {
    // R14 — off by default (near-zero yield for IT real-estate; see env.ts).
    return getEnv().SERP_CRTSH_ENABLED === true;
  }

  async search(query: string, opts: { signal?: AbortSignal; limit?: number } = {}): Promise<SerpResult[]> {
    const target = this.deriveDomain(query);
    if (!target) return [];
    const url = `https://crt.sh/?q=${encodeURIComponent(target)}&output=json`;
    try {
      const res = await request(url, {
        method: 'GET',
        bodyTimeout: DEFAULTS.pipeline.requestTimeoutMs,
        headersTimeout: DEFAULTS.pipeline.requestTimeoutMs,
        signal: opts.signal,
        headers: { 'user-agent': DEFAULTS.http.userAgent, accept: 'application/json' },
      });
      if (res.statusCode !== 200) {
        await res.body.dump();
        return [];
      }
      const text = await res.body.text();
      let entries: CrtShEntry[];
      try {
        entries = JSON.parse(text) as CrtShEntry[];
      } catch {
        return [];
      }
      return this.parseEntries(entries, opts.limit ?? 25);
    } catch {
      return [];
    }
  }

  /** Pure parser — flatten CT entries to dedup'd domain SerpResults. */
  parseEntries(entries: CrtShEntry[], limit: number): SerpResult[] {
    const seen = new Set<string>();
    const out: SerpResult[] = [];
    for (const e of entries) {
      const candidates = [e.common_name, e.name_value]
        .filter((v): v is string => typeof v === 'string')
        .flatMap((v) => v.split(/\s+|\n/))
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v && !v.startsWith('*.') && /\./.test(v));
      for (const host of candidates) {
        if (seen.has(host)) continue;
        seen.add(host);
        out.push({
          title: host,
          url: `https://${host}`,
          snippet: `CT log: issued by ${e.issuer_name ?? 'unknown CA'}`,
          rank: out.length + 1,
          source_provider: this.id,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private deriveDomain(query: string): string | undefined {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return undefined;
    if (trimmed.includes('@')) return trimmed.split('@').pop()?.trim();
    if (/^[a-z0-9.-]+\.[a-z]{2,24}$/i.test(trimmed)) return trimmed;
    return undefined; // crt.sh only meaningful with a real domain
  }
}
