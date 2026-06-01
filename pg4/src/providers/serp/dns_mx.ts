import * as dns from 'dns';
import type { SerpProvider, SerpResult } from '../../types/providers';
import { getEnv } from '../../config/env';

/**
 * Tier 0 SERP via DNS MX lookup. Given a query that contains a domain or
 * email, probes MX records and emits the domain as a synthetic SERP result.
 *
 * Trick: companies with valid MX records are essentially guaranteed to own
 * the domain. The signal is high precision but low recall (only useful when
 * the input already hints at a domain).
 *
 * Free, deterministic, no network beyond DNS.
 */
export class DnsMxProvider implements SerpProvider {
  readonly id = 'dns_mx';
  readonly family = 'serp' as const;
  readonly tier = 0;
  readonly costPerCallEur = 0;

  // Allow tests to inject a fake resolver.
  constructor(
    private readonly resolveMx: (host: string) => Promise<dns.MxRecord[]> = dns.promises.resolveMx
  ) {}

  available(): boolean {
    // R14 — off by default (near-zero yield for IT real-estate; see env.ts).
    return getEnv().SERP_DNS_MX_ENABLED === true;
  }

  async search(query: string): Promise<SerpResult[]> {
    const domain = this.deriveDomain(query);
    if (!domain) return [];
    try {
      const records = await this.resolveMx(domain);
      if (!records || records.length === 0) return [];
      records.sort((a, b) => a.priority - b.priority);
      const bestExchange = records[0].exchange.toLowerCase();
      const enterpriseMail =
        bestExchange.includes('google') ||
        bestExchange.includes('outlook') ||
        bestExchange.includes('protection.app') ||
        bestExchange.includes('aruba.it') ||
        bestExchange.includes('register.it');
      return [
        {
          title: `${domain} (MX verified)`,
          url: `https://${domain}`,
          snippet: enterpriseMail
            ? `Domain has business-grade email hosting (${bestExchange}).`
            : `Domain MX → ${bestExchange}.`,
          rank: 1,
          source_provider: this.id,
        },
      ];
    } catch {
      // ENOTFOUND / ESERVFAIL / etc. — domain doesn't exist or no MX
      return [];
    }
  }

  /**
   * Extract a domain to probe from the query. Accepts:
   *   - "user@example.it" → "example.it"
   *   - "example.it" → "example.it"
   *   - "Beauty Center Verona" → "beautycenterverona.it" (heuristic, low precision)
   * Returns undefined if no plausible domain.
   */
  private deriveDomain(query: string): string | undefined {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return undefined;
    if (trimmed.includes('@')) return trimmed.split('@').pop()?.trim();
    // direct domain literal
    if (/^[a-z0-9.-]+\.[a-z]{2,24}$/i.test(trimmed)) return trimmed;
    // heuristic: collapse tokens, append .it (Italian-default)
    const tokens = trimmed.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return undefined;
    return `${tokens.join('')}.it`;
  }
}
