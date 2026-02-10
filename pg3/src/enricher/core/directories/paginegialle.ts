import axios from 'axios';
import * as cheerio from 'cheerio';

import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { CompanyMatcher } from '../discovery/company_matcher';

export interface PagineGialleHarvest {
  pgUrl: string;
  officialWebsite?: string;
  vat?: string;
  phone?: string;
  email?: string;
  name?: string;
  address?: string;
  matchedBy: 'phone';
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractFirstVat(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return digits;
  return undefined;
}

function walkJson(value: unknown, fn: (k: string, v: unknown) => void): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, fn);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fn(k, v);
      walkJson(v, fn);
    }
  }
}

function isLikelyOfficialWebsiteUrl(raw: string): boolean {
  const href = raw.trim();
  if (!href) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
  if (!(href.startsWith('http://') || href.startsWith('https://'))) return false;
  try {
    const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    if (!host) return false;
    if (host.endsWith('paginegialle.it')) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 4,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  if (typeof resp.data !== 'string') {
    throw new Error('Unexpected non-HTML response');
  }
  return resp.data;
}

async function withRetry<T>(fn: () => Promise<T>, retries: number, baseDelayMs: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function scoreNameMatch(companyName: string, candidateName: string): number {
  const tokens = CompanyMatcher.tokenizeCompanyName(companyName);
  if (tokens.length === 0) return 0;
  const hay = ` ${normalizeText(candidateName)} `;
  let matched = 0;
  for (const t of tokens) {
    if (hay.includes(` ${t} `) || hay.startsWith(` ${t} `) || hay.endsWith(` ${t} `) || hay.includes(` ${t}`)) {
      matched += 1;
    }
  }
  return matched / tokens.length;
}

export class PagineGialleHarvester {
  private static cache = new Map<string, { harvest: PagineGialleHarvest | null; cachedAt: number }>();
  private static readonly cacheTtlMs = 30 * 60 * 1000;

  public static async harvestByPhone(company: CompanyInput): Promise<PagineGialleHarvest | null> {
    const directPgUrlRaw = (company as any).pg_url as string | undefined;
    if (directPgUrlRaw && typeof directPgUrlRaw === 'string') {
      const directPgUrl = directPgUrlRaw.trim();
      if (directPgUrl.startsWith('https://www.paginegialle.it/') && !directPgUrl.includes('/ricerca/')) {
        try {
          const html = await withRetry(() => fetchHtml(directPgUrl, 12000), 1, 750);
          const details = this.extractCompanyDetails(html);
          return {
            pgUrl: directPgUrl,
            officialWebsite: details.officialWebsite,
            vat: details.vat,
            phone: details.phone,
            email: details.email,
            name: details.name,
            address: details.address,
            matchedBy: 'phone',
          };
        } catch (e) {
          Logger.warn('[PagineGialleHarvester] Direct pg_url fetch failed', {
            error: e as Error,
            company_name: company.company_name,
            pg_url: directPgUrl,
          });
        }
      }
    }

    const normalizedPhone = CompanyMatcher.normalizePhone(company.phone);
    if (!normalizedPhone || normalizedPhone.length < 7) return null;

    const cacheKey = `phone:${normalizedPhone}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.harvest;
    }

    try {
      const variants = this.buildPhoneVariants(normalizedPhone);
      for (const phone of variants) {
        const searchUrl = `https://www.paginegialle.it/ricerca/${encodeURIComponent(phone)}`;

        const searchHtml = await withRetry(() => fetchHtml(searchUrl, 12000), 1, 750);
        const pgUrl = this.pickBestPgCompanyUrlFromSearch(searchHtml, company);
        if (!pgUrl) continue;

        const companyHtml = await withRetry(() => fetchHtml(pgUrl, 12000), 1, 750);
        const details = this.extractCompanyDetails(companyHtml);
        const harvest: PagineGialleHarvest = {
          pgUrl,
          officialWebsite: details.officialWebsite,
          vat: details.vat,
          phone: details.phone,
          email: details.email,
          name: details.name,
          address: details.address,
          matchedBy: 'phone',
        };

        this.cache.set(cacheKey, { harvest, cachedAt: Date.now() });
        return harvest;
      }

      this.cache.set(cacheKey, { harvest: null, cachedAt: Date.now() });
      return null;
    } catch (e) {
      Logger.warn('[PagineGialleHarvester] Harvest failed', {
        error: e as Error,
        company_name: company.company_name,
      });
      return null;
    }
  }

  private static buildPhoneVariants(normalizedPhone: string): string[] {
    const variants = new Set<string>();
    variants.add(normalizedPhone);

    if (normalizedPhone.startsWith('39') && normalizedPhone.length > 10) {
      const withoutPrefix = normalizedPhone.slice(2);
      variants.add(withoutPrefix);
      if (!withoutPrefix.startsWith('0')) {
        variants.add(`0${withoutPrefix}`);
      }
    }

    if (normalizedPhone.startsWith('0') && normalizedPhone.length >= 9) {
      variants.add(`39${normalizedPhone}`);
    }

    return [...variants].filter((p) => p.length >= 7).slice(0, 4);
  }

  private static pickBestPgCompanyUrlFromSearch(searchHtml: string, company: CompanyInput): string | null {
    const $ = cheerio.load(searchHtml);

    const candidates: Array<{ url: string; name: string; address: string; score: number }> = [];
    $('.search-itm').each((_, el) => {
      const item = $(el);
      const name = item.find('.search-itm__rag').first().text().trim();
      const address = item.find('.search-itm__adr').first().text().replace(/\s+/g, ' ').trim();

      const urlRaw =
        item.find('a.remove_blank_for_app').first().attr('href') ||
        item.find('.search-itm__rag a').first().attr('href') ||
        '';
      const url = (urlRaw || '').trim();
      if (!url.startsWith('https://www.paginegialle.it/') || url.includes('/ricerca/')) return;

      const score = scoreNameMatch(company.company_name, name);
      candidates.push({ url, name, address, score });
    });

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);

    // With phone search, we accept the top candidate even if the name is slightly off.
    // Still, if the name match is extremely weak, we return null to avoid bad extractions.
    const best = candidates[0];
    if (best.score < 0.15 && candidates.length > 1) {
      // If there are multiple results and we can't match by name, it's risky.
      return null;
    }

    return best.url;
  }

  private static extractCompanyDetails(companyHtml: string): {
    officialWebsite?: string;
    vat?: string;
    phone?: string;
    email?: string;
    name?: string;
    address?: string;
  } {
    const $ = cheerio.load(companyHtml);

    // 1) Official website button
    const rawWebsiteCandidates: string[] = [];
    const cta = $('a[data-tr="scheda_azienda__cta_sitoweb"]').first();
    const ctaHref = cta.attr('href');
    if (ctaHref) rawWebsiteCandidates.push(ctaHref);

    $('a').each((_, el) => {
      const a = $(el);
      const href = a.attr('href') || '';
      const dataTr = (a.attr('data-tr') || '').toLowerCase();
      const title = (a.attr('title') || '').toLowerCase();
      const text = a.text().toLowerCase();
      if (dataTr.includes('sitoweb') || title.includes('sito web') || text.includes('sito web')) {
        if (href) rawWebsiteCandidates.push(href);
      }
    });

    const officialWebsite = uniq(rawWebsiteCandidates)
      .map((u) => u.trim())
      .find((u) => isLikelyOfficialWebsiteUrl(u));

    // 2) JSON-LD extraction
    let vat: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;
    let name: string | undefined;
    let address: string | undefined;

    $('script[type="application/ld+json"]').each((_, el) => {
      const jsonRaw = $(el).text().trim();
      if (!jsonRaw) return;
      try {
        const parsed = JSON.parse(jsonRaw);
        walkJson(parsed, (k, v) => {
          const key = k.toLowerCase();
          if (!vat && (key === 'vatid' || key === 'taxid')) {
            const maybeVat = extractFirstVat(v);
            if (maybeVat) vat = maybeVat;
          }
          if (!phone && key === 'telephone' && typeof v === 'string') {
            phone = v.trim();
          }
          if (!email && key === 'email' && typeof v === 'string') {
            email = v.trim().toLowerCase();
          }
          if (!name && key === 'name' && typeof v === 'string') {
            name = v.trim();
          }
        });
      } catch {
        // ignore JSON parse errors
      }
    });

    // 3) Regex fallback for VAT/email/phone when JSON-LD is missing
    if (!vat) {
      const match = companyHtml.match(/\"vatID\"\\s*:\\s*\"(?:IT)?(\\d{11})\"/i);
      if (match?.[1]) vat = match[1];
    }
    if (!email) {
      const match = companyHtml.match(/\"email\"\\s*:\\s*\"([^\"]+)\"/i);
      if (match?.[1]) email = match[1].trim().toLowerCase();
    }
    if (!phone) {
      const match = companyHtml.match(/\"telephone\"\\s*:\\s*\"([^\"]+)\"/i);
      if (match?.[1]) phone = match[1].trim();
    }

    // 4) Visible text fallback for name/address
    if (!name) {
      const h1 = $('h1').first().text().trim();
      if (h1) name = h1;
    }
    if (!address) {
      const adr = $('.sede__indirizzo, .scheda-azienda__addr, .contact__address, .search-itm__adr').first().text();
      const clean = (adr || '').replace(/\s+/g, ' ').trim();
      if (clean && clean.length >= 8) address = clean;
    }

    return { officialWebsite, vat, phone, email, name, address };
  }
}
