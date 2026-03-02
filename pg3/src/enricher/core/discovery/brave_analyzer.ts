import * as cheerio from 'cheerio';
import { SerpResult } from './serp_analyzer';

export class BraveSerpAnalyzer {
    static parseSerp(html: string): SerpResult[] {
        const $ = cheerio.load(html);
        const results: { url: string; title: string }[] = [];

        // Brave search usually puts results in .snippet[data-type="web"] .result-header
        // or just looks for main result links

        // Strategy 1: Standard snippet format
        $('.snippet[data-type="web"]').each((_, el) => {
            const linkTag = $(el).find('a').first();
            const url = linkTag.attr('href');
            const title = linkTag.find('.title, .netloc').text().trim() || linkTag.text().trim();

            if (url && url.startsWith('http')) {
                results.push({ url, title });
            }
        });

        // Strategy 2: Fallback generically parsing all h2/h3 links (like DDG/Bing)
        if (results.length === 0) {
            $('a').each((_, el) => {
                const url = $(el).attr('href');
                const hasHeading = $(el).find('h2, h3').length > 0 || $(el).closest('h2, h3').length > 0;
                const title = $(el).text().trim();

                if (url && url.startsWith('http') && hasHeading && !url.includes('brave.com')) {
                    results.push({ url, title });
                }
            });
        }

        // Deduplicate based on URL
        const unique = results.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

        return unique.slice(0, 10);
    }
}
