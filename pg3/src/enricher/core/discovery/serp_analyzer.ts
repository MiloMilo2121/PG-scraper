import * as cheerio from 'cheerio';
import { SelectorRegistry } from '../resilience/selector_registry';
import { SelectorHealer } from '../resilience/selector_healer';
import { Logger } from '../../utils/logger';

export interface SerpResult {
    url: string;
    title: string;
    snippet?: string;
    source?: string;
}

/** Deduplicate results by URL. */
function dedup(results: { url: string; title: string }[]): SerpResult[] {
    const seen = new Set<string>();
    const out: SerpResult[] = [];
    for (const r of results) {
        if (!seen.has(r.url)) {
            seen.add(r.url);
            out.push(r);
        }
    }
    return out;
}

export class GoogleSerpAnalyzer {
    // Multiple selector strategies to handle Google DOM changes.
    // ORDER MATTERS: Playwright-rendered Google (via Crawl4AI) uses jsname="UWckNb" with direct hrefs.
    // Classic scrapers use /url?q= redirects. Both paths are covered below.
    private static readonly FALLBACK_SELECTORS = [
        'a[jsname="UWckNb"]',  // ✅ Playwright/Crawl4AI rendered — direct href, most reliable
        '.yuRUbf a',           // Classic desktop (raw HTML scrape)
        '.kCrYT a',            // Mobile / lite
        '.tF2Cxc a',           // 2023+ layout
        '.g .LC20lb',          // Title-based (parent has link)
        'div[data-snf] a',     // Structured results
        'a[data-ved]',         // Any result link with tracking
        '#search a h3',        // h3 inside link (walk up to <a>)
    ];

    static async parseSerp(html: string): Promise<SerpResult[]> {
        const $ = cheerio.load(html);
        const results: { url: string; title: string }[] = [];
        const registry = SelectorRegistry.getInstance();

        // 1. FAST PATH: jsname="UWckNb" — dominant in Playwright/Crawl4AI rendered Google pages.
        // These anchors have direct https:// hrefs (no /url?q= redirect).
        const jsNameContainers = $('a[jsname="UWckNb"]');
        if (jsNameContainers.length >= 3) {
            Logger.info(`[GoogleSerp] ✅ Fast path: jsname="UWckNb" matched ${jsNameContainers.length} results.`);
            registry.update('google', 'result_link', 'a[jsname="UWckNb"]');
            jsNameContainers.each((_, el) => {
                const url = $(el).attr('href') || '';
                const title = $(el).find('h3').text().trim() || $(el).text().trim();
                if (url.startsWith('http') &&
                    !url.includes('google.com') &&
                    !url.includes('accounts.google') &&
                    !url.includes('support.google') &&
                    !url.includes('policies.google')) {
                    results.push({ url, title });
                }
            });
            if (results.length > 0) {
                const unique = dedup(results);
                Logger.info(`[GoogleSerp] Fast path extracted ${unique.length} unique results.`);
                return unique.slice(0, 10);
            }
        }

        // 2. Get dynamic selector from registry (may have been updated by a previous run)
        let selector = registry.get('google', 'result_link', '.yuRUbf a, .kCrYT a');
        let containers = $(selector);

        // 3. Try hardcoded fallback selectors before resorting to LLM healer
        if (containers.length < 3) {
            for (const fallback of this.FALLBACK_SELECTORS) {
                const testContainers = $(fallback);
                if (testContainers.length > containers.length) {
                    Logger.info(`[GoogleSerp] Fallback selector worked better: ${fallback} (${testContainers.length} results)`);
                    containers = testContainers;
                    registry.update('google', 'result_link', fallback);
                }
            }
        }

        // 4. Extract links from /url?q= redirect pattern (classic raw-HTML Google)
        if (containers.length === 0) {
            $('a[href*="/url?q="]').each((_, el) => {
                let href = $(el).attr('href') || '';
                if (href.startsWith('/url?q=')) {
                    href = href.split('/url?q=')[1].split('&')[0];
                    try { href = decodeURIComponent(href); } catch { /* ignore */ }
                }
                if (href.startsWith('http') && !href.includes('google.') && !href.includes('accounts.google')) {
                    const title = $(el).find('h3').text().trim() || $(el).text().trim();
                    results.push({ url: href, title });
                }
            });
            if (results.length > 0) {
                return dedup(results).slice(0, 10);
            }
        }

        // 5. Self-Healing via LLM (last resort)
        if (containers.length === 0) {
            Logger.warn('[GoogleSerp] All fallback selectors failed. Engaging LLM Healer...');
            const bodyHtml = $('body').html() || html;
            const newSelector = await SelectorHealer.getInstance().heal(bodyHtml, "The main anchor tag (<a>) of each search result link");

            if (newSelector) {
                containers = $(newSelector);
                if (containers.length > 0) {
                    registry.update('google', 'result_link', newSelector);
                }
            }
        }

        containers.each((i: number, el: any) => {
            let url = $(el).attr('href');

            // For h3 elements, walk up to the parent <a>
            if (!url) {
                const parentA = $(el).closest('a');
                url = parentA.attr('href');
            }

            // Clean Google redirects (/url?q=...)
            if (url && url.startsWith('/url?q=')) {
                url = url.split('/url?q=')[1].split('&')[0];
                try { url = decodeURIComponent(url); } catch { /* ignore */ }
            }

            const title = $(el).find('h3').text().trim() || $(el).text().trim();

            if (url && url.startsWith('http') && 
                !url.includes('google.com/search') && 
                !url.includes('support.google.com') && 
                !url.includes('policies.google.com') &&
                !url.includes('accounts.google.com')) {
                results.push({ url, title });
            }
        });

        return dedup(results).slice(0, 10);
    }
}

export class BingSerpAnalyzer {
    static async parseSerp(html: string): Promise<SerpResult[]> {
        const $ = cheerio.load(html);
        const results: SerpResult[] = [];

        const extractUrl = (el: any): string | undefined => {
            let url = $(el).attr('href');
            if (!url) return undefined;
            if (url.includes('/ck/a?!') && url.includes('u=')) {
                try {
                    const match = url.match(/u=([a-zA-Z0-9_-]+)/);
                    if (match && match[1].length > 2) {
                        const b64 = match[1].substring(2);
                        url = Buffer.from(b64, 'base64').toString('utf8');
                    }
                } catch { /* ignore */ }
            }
            return url;
        };

        // Bing standard results: <li class="b_algo"><h2><a href="...">...</a></h2>
        $('.b_algo h2 a').each((_, el) => {
            const url = extractUrl(el);
            const title = $(el).text().trim();
            if (url && url.startsWith('http') && !url.includes('microsoft.com') && !url.includes('bing.com')) {
                results.push({ url, title });
            }
        });

        // Bing "b_m" (mobile?) or other variations
        $('.b_m .b_header a').each((_, el) => {
            const url = extractUrl(el);
            const title = $(el).text().trim();
            if (url && url.startsWith('http') && !url.includes('microsoft.com') && !url.includes('bing.com')) results.push({ url, title });
        });

        // Deduplicate
        const unique = results.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

        return unique.slice(0, 10);
    }
}
