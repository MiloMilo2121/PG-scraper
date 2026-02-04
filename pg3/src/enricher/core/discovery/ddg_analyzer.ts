import * as cheerio from 'cheerio';

import { SerpResult } from './serp_analyzer';

export class DuckDuckGoSerpAnalyzer {
    static parseSerp(html: string): SerpResult[] {
        const $ = cheerio.load(html);
        const results: { url: string; title: string }[] = [];

        // Select results (adjust selector based on actual DDG HTML structure, usually .result__a or similar)
        // For HTML version (html.duckduckgo.com):
        $('.result__a').each((i, el) => {
            let link = $(el).attr('href');
            const title = $(el).text().trim();

            if (link) {
                // Decode y.js redirects
                // format: /y.js?ad_domain=...&uddg=http%3A%2F%2Fexample.com...
                if (link.includes('uddg=')) {
                    try {
                        const match = link.match(/uddg=([^&]+)/);
                        if (match && match[1]) {
                            link = decodeURIComponent(match[1]);
                        }
                    } catch (e) {
                        // Keep original if fail
                    }
                }

                if (link && !link.startsWith('/')) { // Filter internal relative links
                    results.push({ url: link, title });
                }
            }
        });

        // Backup for standard JS version selectors if HTML fails
        if (results.length === 0) {
            $('h2 a').each((i, el) => {
                const link = $(el).attr('href');
                const title = $(el).text().trim();
                if (link && !link.startsWith('/')) results.push({ url: link, title });
            });
        }

        return results.slice(0, 10);
    }
}
