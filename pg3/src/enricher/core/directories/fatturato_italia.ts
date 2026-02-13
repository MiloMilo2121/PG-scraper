/**
 * 📊 FATTURATO ITALIA HARVESTER
 * Resolves company name → fatturatoitalia.it page URL
 * and extracts financial data (revenue, employees).
 *
 * Strategy:
 *   1. If P.IVA is known → build candidate URLs directly (multiple slug formats)
 *   2. Fallback → search via DDG/Google with site:fatturatoitalia.it
 *   3. Parse the found page for revenue/employees data
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { FinancialPatterns } from '../financial/patterns';

export interface FatturatoItaliaResult {
  url: string;
  revenue?: string;
  revenueYear?: string;
  employees?: string;
  companyName?: string;
  vat?: string;
}

// Italian legal suffixes to KEEP in the slug (unlike domain generation)
const LEGAL_SUFFIXES: Record<string, string> = {
  's.r.l.': 'srl',
  's.r.l': 'srl',
  'srl': 'srl',
  'srls': 'srls',
  's.r.l.s.': 'srls',
  's.p.a.': 'spa',
  's.p.a': 'spa',
  'spa': 'spa',
  's.n.c.': 'snc',
  's.n.c': 'snc',
  'snc': 'snc',
  's.a.s.': 'sas',
  's.a.s': 'sas',
  'sas': 'sas',
  's.s.': 'ss',
  'ss': 'ss',
  'soc. coop.': 'soc-coop',
  'societa cooperativa': 'societa-cooperativa',
};

const LEGAL_SUFFIX_PATTERN = new RegExp(
  `\\b(${Object.keys(LEGAL_SUFFIXES)
    .map((s) => s.replace(/\./g, '\\.'))
    .sort((a, b) => b.length - a.length)
    .join('|')})\\b`,
  'gi',
);

function normalizeForSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')   // non-alphanumeric → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts the legal suffix from the company name and returns
 * the cleaned name + normalized suffix separately.
 */
function extractLegalSuffix(companyName: string): { coreName: string; suffix: string } {
  const lower = companyName.toLowerCase().trim();

  // Try to match known legal suffixes
  for (const [pattern, normalized] of Object.entries(LEGAL_SUFFIXES)) {
    // Match at word boundaries, case insensitive
    const escaped = pattern.replace(/\./g, '\\.');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      const coreName = lower.replace(regex, '').trim();
      return { coreName, suffix: normalized };
    }
  }

  return { coreName: lower, suffix: '' };
}

/**
 * Builds candidate URLs for a company on fatturatoitalia.it.
 * The URL pattern is: /{slugified-name-with-suffix}-{partita-iva}
 * But the exact format varies, so we generate multiple candidates.
 */
function buildCandidateUrls(companyName: string, vat: string): string[] {
  const { coreName, suffix } = extractLegalSuffix(companyName);
  const cleanCore = normalizeForSlug(coreName);
  const candidates: string[] = [];
  const base = 'https://www.fatturatoitalia.it';

  // Words from the core name
  const words = cleanCore.split(' ').filter((w) => w.length > 0);

  // With suffix
  const partsWithSuffix = suffix ? [...words, suffix] : words;
  const partsNoSuffix = words;

  // Variant 1: hyphens throughout (e.g., 2dm-service-srl-04373870239)
  candidates.push(`${base}/${partsWithSuffix.join('-')}-${vat}`);

  // Variant 2: underscores for name, hyphen before PIva (e.g., automatica_srl-03809081213)
  candidates.push(`${base}/${partsWithSuffix.join('_')}-${vat}`);

  // Variant 3: underscores throughout (e.g., find_srl_08281400963)
  candidates.push(`${base}/${partsWithSuffix.join('_')}_${vat}`);

  // Variant 4: no suffix, hyphens (e.g., 2dm-service-04373870239)
  if (suffix) {
    candidates.push(`${base}/${partsNoSuffix.join('-')}-${vat}`);
    candidates.push(`${base}/${partsNoSuffix.join('_')}-${vat}`);
  }

  // Variant 5: compact (no separators in name) + hyphen before PIva
  const compact = words.join('');
  if (suffix) {
    candidates.push(`${base}/${compact}${suffix}-${vat}`);
    candidates.push(`${base}/${compact}_${suffix}-${vat}`);
  }
  candidates.push(`${base}/${compact}-${vat}`);

  // Deduplicate
  return [...new Set(candidates)];
}

async function fetchWithTimeout(url: string, timeoutMs: number = 12000): Promise<{ status: number; data: string }> {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: 'text',
  });

  return {
    status: resp.status,
    data: typeof resp.data === 'string' ? resp.data : String(resp.data),
  };
}

function isValidCompanyPage(html: string): boolean {
  const lower = html.toLowerCase();
  // A valid fatturatoitalia.it company page should contain financial terms
  return (
    lower.includes('fatturato') &&
    (lower.includes('partita iva') || lower.includes('p.iva') || lower.includes('codice fiscale'))
  );
}

function parseFinancialData(html: string): Omit<FatturatoItaliaResult, 'url'> {
  const $ = cheerio.load(html);
  const text = $('body').text();
  const result: Omit<FatturatoItaliaResult, 'url'> = {};

  // Extract revenue
  for (const pattern of FinancialPatterns.REVENUE) {
    const match = text.match(pattern);
    if (match) {
      result.revenue = `€ ${match[1].trim()}`;
      break;
    }
  }

  // Try to extract revenue year from nearby text
  const yearMatch = text.match(/fatturato\s*(?:\(\s*(\d{4})\s*\)|\s+(\d{4}))/i);
  if (yearMatch) {
    result.revenueYear = yearMatch[1] || yearMatch[2];
  }

  // Extract employees
  for (const pattern of FinancialPatterns.EMPLOYEES) {
    const match = text.match(pattern);
    if (match) {
      result.employees = match[1].trim();
      break;
    }
  }

  // Extract VAT from page
  const vatMatch = text.match(FinancialPatterns.VAT.LABELED);
  if (vatMatch) {
    const digits = vatMatch[0].replace(/\D/g, '').slice(-11);
    if (/^\d{11}$/.test(digits)) {
      result.vat = digits;
    }
  }

  // Extract company name (usually in <h1>)
  const h1 = $('h1').first().text().trim();
  if (h1) result.companyName = h1;

  return result;
}

export class FatturatoItaliaHarvester {
  private static cache = new Map<string, { result: FatturatoItaliaResult | null; cachedAt: number }>();
  private static readonly cacheTtlMs = 30 * 60 * 1000; // 30 min

  /**
   * Main entry point: resolves a company to its fatturatoitalia.it page
   * and extracts financial data.
   *
   * Strategy:
   *   1. If P.IVA known → try direct URL construction (multiple slug variants)
   *   2. Fallback → DDG search with site:fatturatoitalia.it
   */
  public static async harvest(company: CompanyInput): Promise<FatturatoItaliaResult | null> {
    const name = company.company_name?.trim();
    if (!name) return null;

    const vat = (company.vat_code || company.piva || company.vat || '').replace(/\D/g, '');
    const cacheKey = `fi:${name.toLowerCase()}:${vat}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.result;
    }

    try {
      let result: FatturatoItaliaResult | null = null;

      // Strategy 1: Direct URL construction (if we have VAT)
      if (vat && /^\d{11}$/.test(vat)) {
        result = await this.tryDirectUrls(name, vat);
      }

      // Strategy 2: Search fallback
      if (!result) {
        result = await this.searchForCompany(name, vat);
      }

      this.cache.set(cacheKey, { result, cachedAt: Date.now() });
      return result;
    } catch (e) {
      Logger.warn('[FatturatoItalia] Harvest failed', {
        error: e as Error,
        company_name: name,
      });
      return null;
    }
  }

  /**
   * Strategy 1: Try constructing the URL directly from name + VAT.
   * Tests multiple slug variants since fatturatoitalia.it is inconsistent.
   */
  private static async tryDirectUrls(companyName: string, vat: string): Promise<FatturatoItaliaResult | null> {
    const candidateUrls = buildCandidateUrls(companyName, vat);

    Logger.info(`[FatturatoItalia] 🎯 Trying ${candidateUrls.length} direct URL variants for "${companyName}" (VAT: ${vat})`);

    for (const url of candidateUrls) {
      try {
        const { status, data } = await fetchWithTimeout(url, 10000);

        if (status === 200 && isValidCompanyPage(data)) {
          Logger.info(`[FatturatoItalia] ✅ Direct hit: ${url}`);
          const parsed = parseFinancialData(data);
          return { url, ...parsed };
        }
      } catch {
        // Timeout or network error — skip to next variant
      }
    }

    Logger.info(`[FatturatoItalia] ❌ No direct URL match for "${companyName}"`);
    return null;
  }

  /**
   * Strategy 2: Search via DDG for the company on fatturatoitalia.it.
   * Uses the existing DDGSearchProvider if available, otherwise falls back
   * to a simple DuckDuckGo HTML search.
   */
  private static async searchForCompany(companyName: string, vat?: string): Promise<FatturatoItaliaResult | null> {
    const query = vat
      ? `site:fatturatoitalia.it ${vat}`
      : `site:fatturatoitalia.it "${companyName}"`;

    Logger.info(`[FatturatoItalia] 🔍 Searching: ${query}`);

    try {
      // Try using DDGSearchProvider (Tor-enabled)
      const { DDGSearchProvider } = await import('../discovery/search_provider');
      const ddg = new DDGSearchProvider();
      const results = await ddg.search(query);

      if (results && results.length > 0) {
        const fiResult = results.find((r: { url: string }) =>
          r.url.includes('fatturatoitalia.it/') &&
          !r.url.endsWith('fatturatoitalia.it/') &&
          !r.url.includes('/comune/') &&
          !r.url.includes('/come-funziona'),
        );

        if (fiResult) {
          Logger.info(`[FatturatoItalia] 🔗 Search found: ${fiResult.url}`);
          return await this.fetchAndParse(fiResult.url);
        }
      }
    } catch (e) {
      Logger.warn(`[FatturatoItalia] DDG search failed, trying Jina fallback`, { error: e as Error });
    }

    // Jina Search fallback
    try {
      const { ScraperClient } = await import('../../utils/scraper_client');
      if (ScraperClient.isJinaEnabled()) {
        const jinaResp = await ScraperClient.fetchJinaSearch(query);
        const parsed = ScraperClient.parseJinaSearchResults(jinaResp.data);

        const fiResult = parsed.find(
          (r) =>
            r.url.includes('fatturatoitalia.it/') &&
            !r.url.endsWith('fatturatoitalia.it/') &&
            !r.url.includes('/comune/') &&
            !r.url.includes('/come-funziona'),
        );

        if (fiResult) {
          Logger.info(`[FatturatoItalia] 🔗 Jina search found: ${fiResult.url}`);
          return await this.fetchAndParse(fiResult.url);
        }
      }
    } catch (e) {
      Logger.warn(`[FatturatoItalia] Jina search also failed`, { error: e as Error });
    }

    Logger.info(`[FatturatoItalia] ❌ No search results for "${companyName}"`);
    return null;
  }

  /**
   * Fetches a fatturatoitalia.it page and parses financial data from it.
   */
  private static async fetchAndParse(url: string): Promise<FatturatoItaliaResult | null> {
    try {
      const { status, data } = await fetchWithTimeout(url);

      if (status !== 200 || !isValidCompanyPage(data)) {
        Logger.warn(`[FatturatoItalia] Page fetch failed or invalid: ${url} (status=${status})`);
        return null;
      }

      const parsed = parseFinancialData(data);
      return { url, ...parsed };
    } catch (e) {
      Logger.warn(`[FatturatoItalia] Fetch failed for ${url}`, { error: e as Error });
      return null;
    }
  }

  /**
   * Utility: Build the most likely URL for a company.
   * Useful for external callers that just need the URL.
   */
  public static buildUrl(companyName: string, vat: string): string {
    const candidates = buildCandidateUrls(companyName, vat);
    return candidates[0]; // Most common format: hyphens
  }
}
