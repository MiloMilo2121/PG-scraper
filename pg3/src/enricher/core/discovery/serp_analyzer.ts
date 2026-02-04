import * as cheerio from 'cheerio';
import { SelectorRegistry } from '../resilience/selector_registry';
import { SelectorHealer } from '../resilience/selector_healer';
import { Logger } from '../../utils/logger';

export interface SerpResult {
    url: string;
    title: string;
}

export class GoogleSerpAnalyzer {
    static async parseSerp(html: string): Promise<SerpResult[]> {
        const $ = cheerio.load(html);
        const results: { url: string; title: string }[] = [];
        const registry = SelectorRegistry.getInstance();

        // 1. Get dynamic selector
        let selector = registry.get('google', 'result_link', '.yuRUbf a, .kCrYT a');
        let containers = $(selector);

        // 2. Self-Healing Trigger
        if (containers.length === 0) {
            Logger.warn('[GoogleSerp] ⚠️ 0 results found. Selectors might be broken. Engaging Healer...');

            // Only send body to save tokens
            const bodyHtml = $('body').html() || html;

            const newSelector = await SelectorHealer.getInstance().heal(bodyHtml, "The main anchor tag (<a>) of each search result link");

            if (newSelector) {
                // Verify immediate fix
                containers = $(newSelector);
                if (containers.length > 0) {
                    // It worked! Save it.
                    registry.update('google', 'result_link', newSelector);
                }
            }
        }

        containers.each((i: number, el: any) => {
            let url = $(el).attr('href');

            // Clean Google redirects (/url?q=...)
            if (url && url.startsWith('/url?q=')) {
                url = url.split('/url?q=')[1].split('&')[0];
                url = decodeURIComponent(url);
            }

            const title = $(el).find('h3').text().trim() || $(el).text().trim();

            if (url && url.startsWith('http')) {
                results.push({ url, title });
            }
        });

        return results.slice(0, 10);
    }
}
