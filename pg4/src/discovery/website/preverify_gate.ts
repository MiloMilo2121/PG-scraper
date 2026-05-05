import type { GateResult, GateStatus, NormalizedLead } from '../../types/discovery';

/**
 * Lightweight verification gate: given an HTML body and a normalized lead,
 * decide whether the URL belongs to the lead.
 *
 * - VERIFIED: P.IVA digits found in body
 * - VERIFIED_SEMANTIC: enough name tokens match in body+title with ownership anchor
 * - REJECTED: no signals
 *
 * No browser, no network — pure function over (html, lead).
 */
export class PreVerifyGate {
  static check(url: string, html: string, normalized: NormalizedLead): GateResult {
    if (!html || html.length < 50) {
      return { status: 'REJECTED', url, detail: 'html_too_short' };
    }

    const piva = (normalized.vat_code ?? '').replace(/\D/g, '');
    if (piva && piva.length === 11) {
      const bodyDigits = html.replace(/[^0-9]/g, '');
      if (bodyDigits.includes(piva)) {
        return { status: 'VERIFIED', url, evidence: 'piva_match' };
      }
    }

    // Semantic name match
    const tokens = this.nameTokens(normalized.company_name);
    if (tokens.length === 0) return { status: 'REJECTED', url, detail: 'no_name_tokens' };

    const htmlLower = html.toLowerCase();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const titleLower = titleMatch ? titleMatch[1].toLowerCase() : '';

    const bodyHits = tokens.filter((t) => htmlLower.includes(t));
    const titleHits = tokens.filter((t) => titleLower.includes(t));
    const bodyRatio = bodyHits.length / tokens.length;
    const titleRatio = tokens.length === 0 ? 0 : titleHits.length / tokens.length;

    // Ownership anchor: domain similarity OR location signal
    const hostShort = this.shortHost(url);
    const compactName = tokens.join('').replace(/\s+/g, '');
    const domainMatch = compactName.length >= 4 && (hostShort.includes(compactName) || compactName.includes(hostShort));
    const locationMatch = !!(
      (normalized.city && htmlLower.includes(normalized.city.toLowerCase())) ||
      (normalized.province && htmlLower.includes(normalized.province.toLowerCase()))
    );
    const hasAnchor = domainMatch || locationMatch;

    // Tightened semantic match: require BOTH ratio AND a minimum count of
    // distinct matched tokens. Single-token matches are too noisy on parked
    // / unrelated pages with Italian boilerplate text.
    const minMatched = Math.min(2, tokens.length);
    const enoughBody = bodyHits.length >= minMatched && bodyRatio >= 0.5;
    const enoughTitle = titleHits.length >= minMatched && titleRatio >= 0.4 && bodyRatio >= 0.3;
    if (hasAnchor && (enoughBody || enoughTitle)) {
      return {
        status: 'VERIFIED_SEMANTIC' as GateStatus,
        url,
        evidence: 'name_semantic',
        detail: `body=${bodyRatio.toFixed(2)}(${bodyHits.length}/${tokens.length}) title=${titleRatio.toFixed(2)}(${titleHits.length}/${tokens.length})`,
      };
    }

    return {
      status: 'REJECTED',
      url,
      detail: `body=${bodyRatio.toFixed(2)}(${bodyHits.length}/${tokens.length}) title=${titleRatio.toFixed(2)}(${titleHits.length}/${tokens.length}) anchor=${hasAnchor}`,
    };
  }

  private static nameTokens(name: string): string[] {
    if (!name) return [];
    const stripped = name
      .toLowerCase()
      .replace(/s\.?r\.?l\.?(s)?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|scarl|srls|unipersonale|in liquidazione/gi, '')
      .trim();
    const all = stripped.split(/\s+/).filter((t) => t.length >= 2);
    return all.length <= 2 ? all.filter((t) => t.length >= 3) : all.filter((t) => t.length >= 4);
  }

  private static shortHost(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
    } catch {
      return '';
    }
  }
}
