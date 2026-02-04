import * as cheerio from 'cheerio';
import { URL } from 'url';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface ExtractedContent {
    text: string;
    html: string;
    meta: {
        title: string;
        description: string;
        generator: string;
    };
    json_ld: any[];
    links: {
        internal: string[];
        external: string[];
        contact: string[]; // specific internal links to contact pages
        privacy: string[];
    };
    emails: string[];
    phones: string[];
    vats: string[];
    h1Headers: string[]; // H1 headers for name matching
}

export class ContentExtractor {

    static extract(html: string, baseUrl: string): ExtractedContent {
        const $ = cheerio.load(html);

        // Remove scripts and styles for text extraction (still useful for backup)
        $('script, style, meta, link, noscript').remove();

        let text = '';
        try {
            const dom = new JSDOM(html, { url: baseUrl });
            const reader = new Readability(dom.window.document);
            const article = reader.parse();
            if (article && article.textContent) {
                text = article.textContent.replace(/\s+/g, ' ').trim();
            }
        } catch (e) {
            // Readability failed, fallback
        }

        if (!text) {
            text = $('body').text().replace(/\s+/g, ' ').trim();
        }

        // Reload for other extraction
        const $full = cheerio.load(html);

        const meta = {
            title: $full('title').text().trim() || $full('meta[property="og:title"]').attr('content') || '',
            description: $full('meta[name="description"]').attr('content') || $full('meta[property="og:description"]').attr('content') || '',
            generator: $full('meta[name="generator"]').attr('content') || ''
        };

        const json_ld: any[] = [];
        $full('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($full(el).html() || '{}');
                json_ld.push(json);
            } catch (e) {
                // ignore invalid json
            }
        });

        const links = {
            internal: [] as string[],
            external: [] as string[],
            contact: [] as string[],
            privacy: [] as string[]
        };

        $full('a').each((_, el) => {
            const href = $full(el).attr('href');
            if (!href) return;

            try {
                const absolute = new URL(href, baseUrl).href;
                const urlObj = new URL(absolute);

                // Check if internal or external
                if (urlObj.hostname === new URL(baseUrl).hostname || urlObj.hostname.endsWith('.' + new URL(baseUrl).hostname)) {
                    links.internal.push(absolute);

                    const lowerPath = urlObj.pathname.toLowerCase();
                    if (lowerPath.includes('contat') || lowerPath.includes('contact') || lowerPath.includes('chi-siam')) {
                        links.contact.push(absolute);
                    }
                    if (lowerPath.includes('privacy') || lowerPath.includes('cookie') || lowerPath.includes('legal')) {
                        links.privacy.push(absolute);
                    }
                } else {
                    links.external.push(absolute);
                }
            } catch (e) {
                // invalid URL
            }
        });

        // Regex extraction (basic, SignalExtractor will do advanced)
        const emails = (html.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g) || []);

        // Extract H1 headers for name matching
        const h1Headers: string[] = [];
        $full('h1').each((_, el) => {
            const text = $full(el).text().trim();
            if (text && text.length < 200) h1Headers.push(text);
        });

        // Advanced P.IVA extraction with Luhn check
        // Candidate: 11 digits. 
        // We look for context: "P.IVA", "VAT", "Partita IVA" near the number preferably, but extraction here is general.
        // We just grab all valid 11-digit sequences that pass Luhn.
        const potentialVats = (html.match(/\b\d{11}\b/g) || []);
        const vats = potentialVats.filter(v => ContentExtractor.checkLuhn(v));

        return {
            text,
            html, // or partial
            meta,
            json_ld,
            links: {
                internal: [...new Set(links.internal)],
                external: [...new Set(links.external)],
                contact: [...new Set(links.contact)],
                privacy: [...new Set(links.privacy)]
            },
            emails: [...new Set(emails)],
            phones: [], // left for SignalExtractor
            vats: [...new Set(vats)],
            h1Headers: h1Headers.slice(0, 5) // Max 5 H1s
        };
    }

    private static checkLuhn(vat: string): boolean {
        // Basic Length Check
        if (vat.length !== 11) return false;

        // Luhn Algorithm for Italian P.IVA
        let s = 0;
        for (let i = 0; i <= 9; i += 2) {
            s += parseInt(vat.charAt(i), 10);
        }
        for (let i = 1; i <= 9; i += 2) {
            let c = 2 * parseInt(vat.charAt(i), 10);
            if (c > 9) c = c - 9;
            s += c;
        }

        let control = (10 - (s % 10)) % 10;
        return control === parseInt(vat.charAt(10), 10);
    }
}
