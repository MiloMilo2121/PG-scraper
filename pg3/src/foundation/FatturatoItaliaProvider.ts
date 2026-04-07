/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   FatturatoItaliaProvider — OMEGA V9 Financial Intelligence Layer   ║
 * ║   Scrapes fatturatoitalia.it for official bilancio data.            ║
 * ║   INPUT:  P.IVA (preferred) or company name                        ║
 * ║   OUTPUT: fatturato, utile, dipendenti (5-year history available)   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * STRATEGY:
 *   1. If P.IVA is known → POST to /cerca/risultato-di-ricerca?partita-iva=XXXX
 *      This is a direct, deterministic lookup. The site redirects immediately
 *      to the company page if found.
 *   2. If only name is known → POST to /cerca/risultato-di-ricerca?denominazione=NAME
 *      Parse the results table, pick the best fuzzy match by city/province,
 *      then follow the link to the company detail page.
 *   3. On the company detail page, extract:
 *      a. JS vars `datiChartFatturato`, `datiChartUtile`, `labelChart` for the
 *         clean 5-year time series (most reliable).
 *      b. Fallback: parse the label-value grid (col-xs-5 / col-xs-7) for the
 *         latest year only.
 *
 * RATE LIMIT: The site tracks daily page views per IP inside a <pre> block.
 *   We apply a 1–3 second random delay between requests (Law 305, Law 604).
 *
 * LAW 103: This class is stateless. All heavy dependencies are injected.
 * LAW 503: Caller is responsible for caching — do not call for the same
 *          P.IVA twice within the same run.
 */

import { fetch, Agent } from 'undici';
import * as cheerio from 'cheerio';
import { Logger } from '../enricher/utils/logger';

// ─── Data Shapes ─────────────────────────────────────────────────────────────

export interface FIFinancialYear {
    year: number;
    fatturato?: number;   // Revenue in EUR
    utile?: number;       // Net profit in EUR
}

export interface FICompanyResult {
    /** Ragione sociale as shown on fatturatoitalia.it */
    ragione_sociale?: string;
    vat_code?: string;
    city?: string;
    address?: string;
    /** Most recent fatturato (EUR) */
    fatturato_current?: number;
    /** Most recent utile (EUR) */
    utile_current?: number;
    /** Year of the most recent bilancio */
    bilancio_year?: number;
    /** Number of employees */
    dipendenti?: number;
    /** Full 5-year history from the JS chart data */
    history?: FIFinancialYear[];
    /** Source URL on fatturatoitalia.it */
    source_url: string;
    /** Confidence that this result matches the queried company (0–1) */
    confidence: number;
}

// ─── Internal HTTP Agent ──────────────────────────────────────────────────────

const httpAgent = new Agent({
    connect: { rejectUnauthorized: false },
    keepAliveTimeout: 10_000,
    connections: 10,
});

const BASE_URL = 'https://www.fatturatoitalia.it';

const STEALTH_HEADERS: Record<string, string> = {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection':      'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
};

/**
 * Session manager: stores a PHPSESSID cookie by doing a GET to the homepage first.
 * fatturatoitalia.it requires a valid PHP session cookie before it serves POST results.
 * We use a module-level cache so we reuse the session within a process lifetime.
 */
let _sessionCookies: string | null = null;
async function getSessionCookies(): Promise<string> {
    if (_sessionCookies) return _sessionCookies;

    try {
        const res = await fetch(BASE_URL + '/', {
            method: 'GET',
            dispatcher: httpAgent,
            redirect: 'follow',
            signal: AbortSignal.timeout(10_000),
            headers: STEALTH_HEADERS,
        });

        // Extract Set-Cookie headers
        const setCookieHeader = res.headers.getSetCookie?.() ?? [];
        if (setCookieHeader.length) {
            // Parse cookie name=value pairs, join them
            const cookies = setCookieHeader
                .map((c) => c.split(';')[0].trim())
                .join('; ');
            _sessionCookies = cookies;
            Logger.info(`[FatturatoItalia] Session cookies acquired: ${cookies.substring(0, 60)}...`);
        } else {
            // Fallback: extract from raw header string
            const rawCookie = res.headers.get('set-cookie') || '';
            _sessionCookies = rawCookie.split(';')[0].trim() || 'modal_call=1';
        }
    } catch (e: any) {
        Logger.warn(`[FatturatoItalia] Could not acquire session cookie: ${e.message}`);
        _sessionCookies = 'modal_call=1';
    }

    return _sessionCookies!;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function randomDelay(minMs = 800, maxMs = 2500): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * POST form-encoded payload with session cookie.
 * fatturatoitalia.it requires a valid PHPSESSID cookie — without it,
 * the response contains only the page shell with an empty results tbody.
 */
async function postForm(path: string, body: Record<string, string>): Promise<{ html: string; finalUrl: string } | null> {
    const url = `${BASE_URL}${path}`;
    const formData = new URLSearchParams(body).toString();
    const sessionCookies = await getSessionCookies();

    try {
        const res = await fetch(url, {
            method: 'POST',
            dispatcher: httpAgent,
            redirect: 'follow',
            signal: AbortSignal.timeout(12_000),
            headers: {
                ...STEALTH_HEADERS,
                'Content-Type':   'application/x-www-form-urlencoded',
                'Origin':         BASE_URL,
                'Referer':        `${BASE_URL}/`,
                'Cookie':         sessionCookies,
            },
            body: formData,
        });

        if (res.status >= 400) {
            Logger.warn(`[FatturatoItalia] POST ${path} returned ${res.status}`);
            return null;
        }

        const html = await res.text();
        return { html, finalUrl: res.url };
    } catch (e: any) {
        Logger.warn(`[FatturatoItalia] fetch error on POST ${path}: ${e.message}`);
        return null;
    }
}

/**
 * GET a company detail page by its slug URL.
 */
async function getPage(pageUrl: string): Promise<{ html: string; finalUrl: string } | null> {
    try {
        const res = await fetch(pageUrl, {
            method: 'GET',
            dispatcher: httpAgent,
            redirect: 'follow',
            signal: AbortSignal.timeout(12_000),
            headers: {
                ...STEALTH_HEADERS,
                'Referer': `${BASE_URL}/`,
            },
        });

        if (res.status >= 400) {
            Logger.warn(`[FatturatoItalia] GET ${pageUrl} returned ${res.status}`);
            return null;
        }

        const html = await res.text();
        return { html, finalUrl: res.url };
    } catch (e: any) {
        Logger.warn(`[FatturatoItalia] fetch error on GET ${pageUrl}: ${e.message}`);
        return null;
    }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parses a EUR amount string like "€ 1.234.567" or "1.234.567,89" or "1,2 Mld" into a number.
 */
function parseEurAmount(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const cleaned = raw.replace(/€|\s/g, '').trim();

    // Handle "Mld" (miliardi) suffix
    const mldMatch = cleaned.match(/^([\d.,]+)\s*(?:Mld|mld)/i);
    if (mldMatch) {
        return Math.round(parseFloat(mldMatch[1].replace('.', '').replace(',', '.')) * 1_000_000_000);
    }

    // Handle "Mln" / "Milioni" suffix
    const mlnMatch = cleaned.match(/^([\d.,]+)\s*(?:Mln|mln|Milioni?)/i);
    if (mlnMatch) {
        return Math.round(parseFloat(mlnMatch[1].replace('.', '').replace(',', '.')) * 1_000_000);
    }

    // Italian number format: 1.234.567,00
    if (cleaned.match(/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/)) {
        return Math.round(parseFloat(cleaned.replace(/\./g, '').replace(',', '.')));
    }

    // English/plain format
    const plain = parseFloat(cleaned.replace(',', ''));
    return isFinite(plain) && plain >= 0 ? Math.round(plain) : undefined;
}

/**
 * Extracts 5-year financial history from the embedded JS variables on the company page.
 * This is the cleanest extraction path — chart data is always machine-readable.
 *
 * Variables look like:
 *   var datiChartFatturato = [40503424402, 39245672100, ...];
 *   var datiChartUtile     = [1234567, ...];
 *   var labelChart         = ["2023", "2022", "2021", ...];
 */
function extractChartData(html: string): FIFinancialYear[] {
    const years: FIFinancialYear[] = [];

    const labelsMatch = html.match(/var\s+labelChart\s*=\s*\[([^\]]+)\]/);
    const fatturatoMatch = html.match(/var\s+datiChartFatturato\s*=\s*\[([^\]]+)\]/);
    const utileMatch = html.match(/var\s+datiChartUtile\s*=\s*\[([^\]]+)\]/);

    if (!labelsMatch || !fatturatoMatch) return years;

    const labels = labelsMatch[1].match(/\d{4}/g) || [];
    const fatturatoValues = fatturatoMatch[1].split(',').map((v) => parseInt(v.trim(), 10));
    const utileValues = utileMatch
        ? utileMatch[1].split(',').map((v) => parseInt(v.trim(), 10))
        : [];

    for (let i = 0; i < labels.length; i++) {
        const year = parseInt(labels[i], 10);
        if (!isFinite(year)) continue;

        years.push({
            year,
            fatturato: isFinite(fatturatoValues[i]) && fatturatoValues[i] > 0 ? fatturatoValues[i] : undefined,
            utile: isFinite(utileValues[i]) && utileValues[i] !== 0 ? utileValues[i] : undefined,
        });
    }

    return years;
}

/**
 * Fallback: parse the label/value grid on the company detail page.
 * Grid layout:
 *   <div class="col-xs-5">Fatturato 2023</div>
 *   <div class="col-xs-7">€ 40.503.424.402</div>
 */
function parseCompanyDetailPage(html: string, pageUrl: string): Omit<FICompanyResult, 'confidence'> {
    const $ = cheerio.load(html);

    // Extract label→value pairs
    const data: Record<string, string> = {};
    $('.col-xs-5, .col-sm-5').each((_, labelEl) => {
        const label = $(labelEl).text().trim().toLowerCase();
        const valueEl = $(labelEl).next('.col-xs-7, .col-sm-7');
        const value = valueEl.text().trim();
        if (label && value) data[label] = value;
    });

    // Find the most recent fatturato year
    let fatturato_current: number | undefined;
    let utile_current: number | undefined;
    let bilancio_year: number | undefined;

    for (const [label, value] of Object.entries(data)) {
        const yearMatch = label.match(/\b(20\d{2})\b/);
        if (!yearMatch) continue;
        const year = parseInt(yearMatch[1], 10);

        if (label.includes('fatturato')) {
            const amt = parseEurAmount(value);
            if (amt && (!bilancio_year || year > bilancio_year)) {
                fatturato_current = amt;
                bilancio_year = year;
            }
        }
        if (label.includes('utile')) {
            const amt = parseEurAmount(value);
            if (amt) utile_current = amt;
        }
    }

    // Dipendenti
    const dipendentiRaw = data['n. dipendenti'] || data['dipendenti'] || data['numero dipendenti'];
    const dipendenti = dipendentiRaw
        ? parseInt(dipendentiRaw.replace(/[^\d]/g, ''), 10)
        : undefined;

    // Ragione sociale
    const ragione_sociale =
        data['ragione sociale'] ||
        $('h1').first().text().trim() ||
        undefined;

    // P.IVA
    const vat_code =
        data['partita iva'] ||
        data['p.iva'] ||
        undefined;

    // Indirizzo
    const address = data['indirizzo'] || data['sede legale'] || undefined;

    // City from breadcrumb or structured data
    const city = data['comune'] || data['città'] || undefined;

    // Chart data takes precedence (Law 401: Source of Truth)
    const history = extractChartData(html);

    // Use chart data for the most recent year if grid parsing yielded nothing
    if (!fatturato_current && history.length > 0) {
        const latest = history[0];
        fatturato_current = latest.fatturato;
        utile_current = latest.utile;
        bilancio_year = latest.year;
    }

    return {
        ragione_sociale,
        vat_code,
        city,
        address,
        fatturato_current,
        utile_current,
        bilancio_year,
        dipendenti: isFinite(dipendenti!) && dipendenti! > 0 ? dipendenti : undefined,
        history,
        source_url: pageUrl,
    };
}

/**
 * Parses search results page (list of companies matching the query).
 * Returns array of { name, province, href } candidates.
 */
function parseSearchResults(html: string): Array<{ name: string; province: string; href: string }> {
    const $ = cheerio.load(html);
    const results: Array<{ name: string; province: string; href: string }> = [];

    // Result table rows: <tr><td><a href="...">NAME</a></td><td>PROVINCE</td></tr>
    // hrefs are absolute URLs like: https://www.fatturatoitalia.it/barilla_g_e_r...-01654010345
    $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 1) return;
        const anchor = $(cells[0]).find('a');
        const href = anchor.attr('href');
        const name = anchor.text().trim();
        const province = cells.length >= 2 ? $(cells[1]).find('a').text().trim() || $(cells[1]).text().trim() : '';
        if (href && name && !name.toLowerCase().includes('denominazione')) {
            const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            results.push({ name, province, href: fullHref });
        }
    });

    return results;
}

/**
 * Simple fuzzy matching score between candidate and company context.
 * Returns 0–1.
 */
function matchScore(candidate: { name: string; province: string }, context: { name: string; province: string; city: string }): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

    const cName = norm(candidate.name);
    const tName = norm(context.name);
    const cProv = norm(candidate.province);
    const tProv = norm(context.province);
    const tCity = norm(context.city);

    let score = 0;

    // Name token overlap
    const tTokens = tName.split(/\s+/).filter((t) => t.length >= 3);
    const cTokens = cName.split(/\s+/).filter((t) => t.length >= 3);
    const overlap = tTokens.filter((t) => cTokens.some((c) => c.includes(t) || t.includes(c))).length;
    score += tTokens.length > 0 ? (overlap / tTokens.length) * 0.6 : 0;

    // Location match
    if (cProv && (tProv === cProv || tCity.includes(cProv) || cProv.includes(tProv))) {
        score += 0.4;
    }

    return Math.min(1, score);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class FatturatoItaliaProvider {

    /**
     * Primary lookup by P.IVA. This is deterministic — if the company exists
     * on fatturatoitalia.it and has a valid bilancio, this will find it.
     * Returns null if the company is not indexed.
     */
    static async lookupByVat(vatCode: string): Promise<FICompanyResult | null> {
        // Sanitize: strip "IT" prefix and non-digits
        const cleanVat = vatCode.replace(/^IT/i, '').replace(/\D/g, '');
        if (cleanVat.length < 10) {
            Logger.warn(`[FatturatoItalia] Invalid VAT: ${vatCode}`);
            return null;
        }

        Logger.info(`[FatturatoItalia] 🔍 Lookup by VAT: ${cleanVat}`);

        // CRITICAL: The VAT form field on fatturatoitalia.it is named 'piva', NOT 'partita-iva'.
        // The form also requires a PHP session cookie — postForm() handles this transparently.
        const result = await postForm('/cerca/risultato-di-ricerca', {
            'piva': cleanVat,
        });

        if (!result) return null;
        await randomDelay(500, 1500);

        const { html, finalUrl } = result;

        // Parse the results table — for a VAT search the first result should be
        // an exact or very close match.
        const hits = parseSearchResults(html);
        if (hits.length === 0) {
            Logger.info(`[FatturatoItalia] No results for VAT: ${cleanVat}`);
            return null;
        }

        // If there's only one result, or the first result's URL contains the VAT, use it directly.
        const bestHit = hits[0];
        const confidence = hits.length === 1 || bestHit.href.includes(cleanVat) ? 0.97 : 0.85;
        Logger.info(`[FatturatoItalia] VAT match: "${bestHit.name}" (${bestHit.province}) — ${bestHit.href}`);
        return FatturatoItaliaProvider._fetchDetailPage(bestHit.href, confidence);
    }

    /**
     * Secondary lookup by company name + optional province/city.
     * Applies fuzzy scoring to pick the best match from the results list.
     * Less precise than VAT lookup — use only when P.IVA is unknown.
     */
    static async lookupByName(
        companyName: string,
        opts: { province?: string; city?: string } = {},
    ): Promise<FICompanyResult | null> {
        Logger.info(`[FatturatoItalia] 🔍 Lookup by Name: "${companyName}" (${opts.city || opts.province || ''})`);

        const result = await postForm('/cerca/risultato-di-ricerca', {
            'denominazione': companyName.substring(0, 60),
        });

        if (!result) return null;
        await randomDelay();

        const { html, finalUrl } = result;

        // If redirected directly to a company page:
        if (!finalUrl.includes('cerca') && finalUrl !== `${BASE_URL}/`) {
            return FatturatoItaliaProvider._parseAndReturn(html, finalUrl, 0.82);
        }

        const hits = parseSearchResults(html);
        if (hits.length === 0) {
            Logger.info(`[FatturatoItalia] No name results for: "${companyName}"`);
            return null;
        }

        // Score each candidate against the context
        const ctx = {
            name: companyName,
            province: (opts.province || '').toLowerCase(),
            city: (opts.city || '').toLowerCase(),
        };

        const ranked = hits
            .map((h) => ({ ...h, score: matchScore(h, ctx) }))
            .sort((a, b) => b.score - a.score);

        const best = ranked[0];
        if (best.score < 0.35) {
            Logger.info(`[FatturatoItalia] Low match confidence (${best.score.toFixed(2)}) — skipping.`);
            return null;
        }

        Logger.info(`[FatturatoItalia] Best candidate: "${best.name}" (${best.province}) — score: ${best.score.toFixed(2)}`);
        return FatturatoItaliaProvider._fetchDetailPage(best.href, best.score * 0.88);
    }

    /**
     * Convenience method: tries VAT lookup first, falls back to name lookup.
     * This is what MasterPipeline.ts should call in the enrichment stage.
     */
    static async lookup(opts: {
        vatCode?: string | null;
        companyName?: string | null;
        province?: string | null;
        city?: string | null;
    }): Promise<FICompanyResult | null> {
        if (opts.vatCode) {
            const res = await FatturatoItaliaProvider.lookupByVat(opts.vatCode);
            if (res) return res;
        }

        if (opts.companyName) {
            return FatturatoItaliaProvider.lookupByName(opts.companyName, {
                province: opts.province ?? undefined,
                city: opts.city ?? undefined,
            });
        }

        return null;
    }

    // ─── Private ───────────────────────────────────────────────────────────

    private static async _fetchDetailPage(href: string, confidence: number): Promise<FICompanyResult | null> {
        await randomDelay();
        const detail = await getPage(href);
        if (!detail) return null;
        return FatturatoItaliaProvider._parseAndReturn(detail.html, detail.finalUrl, confidence);
    }

    private static _parseAndReturn(html: string, pageUrl: string, confidence: number): FICompanyResult {
        const parsed = parseCompanyDetailPage(html, pageUrl);

        Logger.info(
            `[FatturatoItalia] ✅ Found: ${parsed.ragione_sociale || '?'} | Fatturato: ${parsed.fatturato_current?.toLocaleString('it-IT') ?? 'N/A'} | Year: ${parsed.bilancio_year ?? 'N/A'} | Conf: ${confidence.toFixed(2)}`
        );

        return { ...parsed, confidence };
    }
}
