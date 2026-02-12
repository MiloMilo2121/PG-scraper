import * as cheerio from 'cheerio';
import { SelectorRegistry } from '../resilience/selector_registry';
import { SelectorHealer } from '../resilience/selector_healer';
import { Logger } from '../../utils/logger';

export interface SerpResult {
    url: string;
    title: string;
}

export class GoogleSerpAnalyzer {
    // Multiple selector strategies to handle Google DOM changes
    private static readonly FALLBACK_SELECTORS = [
        '.yuRUbf a',           // Classic desktop
        '.kCrYT a',            // Mobile / lite
        '.tF2Cxc a',           // 2023+ layout
        '.g .LC20lb',          // Title-based (parent has link)
        'div[data-snf] a',     // Structured results
        'a[jsname="UWckNb"]',  // Modern JS-rendered
        'a[data-ved]',         // Any result link with tracking
        '#search a h3',        // h3 inside link (walk up to <a>)
    ];

    static async parseSerp(html: string): Promise<SerpResult[]> {
        const $ = cheerio.load(html);
        const results: { url: string; title: string }[] = [];
        const registry = SelectorRegistry.getInstance();

        // 1. Get dynamic selector from registry
        let selector = registry.get('google', 'result_link', '.yuRUbf a, .kCrYT a');
        let containers = $(selector);

        // 2. Try hardcoded fallback selectors before resorting to LLM healer
        if (containers.length === 0) {
            for (const fallback of this.FALLBACK_SELECTORS) {
                containers = $(fallback);
                if (containers.length > 0) {
                    Logger.info(`[GoogleSerp] Fallback selector worked: ${fallback} (${containers.length} results)`);
                    registry.update('google', 'result_link', fallback);
                    break;
                }
            }
        }

        // 3. Extract links from /url?q= redirect pattern (common in Google HTML)
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
                return results.slice(0, 10);
            }
        }

        // 4. Self-Healing via LLM (last resort)
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

            if (url && url.startsWith('http') && !url.includes('google.com/search')) {
                results.push({ url, title });
            }
        });

        // Dedup results based on URL
        const seen = new Set<string>();
        const uniqueResults: SerpResult[] = [];
        for (const r of results) {
            if (!seen.has(r.url)) {
                seen.add(r.url);
                uniqueResults.push(r);
            }
        }

        return uniqueResults.slice(0, 10);
    }
}
