import * as cheerio from 'cheerio';

/**
 * 🧹 HTML CLEANER — Intelligent HTML Preprocessing for LLMs
 *
 * Extracts meaningful content from HTML while minimizing token usage.
 * Uses Cheerio for semantic parsing (not regex black magic).
 *
 * **Law 501: Cost Awareness** — Send only what the LLM needs to see.
 */

export interface CleanedHTML {
    title: string;
    metaDescription: string;
    headings: string[];
    bodyText: string;
    contactSection: string;
    structuredData: Record<string, any> | null;
    charCount: number;
}

export class HTMLCleaner {

    /**
     * Extract clean, semantic text from HTML.
     * Returns structured data optimized for LLM consumption.
     *
     * @param html          - Raw HTML string
     * @param maxChars      - Maximum characters to return (token budget * 4)
     * @param prioritizeContacts - If true, extract contact section first
     */
    public static extract(
        html: string,
        maxChars: number = 3000,
        prioritizeContacts: boolean = true
    ): CleanedHTML {
        const $ = cheerio.load(html);

        // Remove bloat
        $('script, style, noscript, iframe, svg, canvas, video, audio').remove();
        $('nav, header, footer, .cookie-banner, .advertisement, #cookie-consent').remove();
        $('[class*="cookie"], [class*="gdpr"], [id*="cookie"]').remove();

        // Extract metadata
        const title = $('title').text().trim() || $('h1').first().text().trim();
        const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

        // Extract headings (structural signals)
        const headings: string[] = [];
        $('h1, h2, h3').each((_, el) => {
            const text = $(el).text().trim();
            if (text && text.length < 100) headings.push(text);
        });

        // Extract structured data (JSON-LD)
        let structuredData: Record<string, any> | null = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const parsed = JSON.parse($(el).html() || '{}');
                if (parsed['@type'] === 'Organization' || parsed['@type'] === 'LocalBusiness') {
                    structuredData = parsed;
                    return false; // break
                }
            } catch {
                // Ignore malformed JSON-LD
            }
        });

        // Extract contact section (prioritize VAT, phone, email)
        let contactSection = '';
        if (prioritizeContacts) {
            const contactKeywords = ['contatti', 'contact', 'chi siamo', 'about', 'legal', 'p.iva', 'partita iva'];
            const contactSections = $('section, div, footer').filter((_, el) => {
                const text = $(el).text().toLowerCase();
                const hasContactKeyword = contactKeywords.some(kw => text.includes(kw));
                const hasVAT = /\bp\.?\s?iva\b|\bpartita\s+iva\b/i.test(text);
                const hasPhone = /\+39|tel:|telefono/i.test(text);
                return hasContactKeyword || hasVAT || hasPhone;
            });

            contactSections.each((_, el) => {
                const sectionText = $(el).text()
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 500); // Cap per section
                if (sectionText.length > 50) {
                    contactSection += sectionText + '\n';
                }
            });
        }

        // Extract main body text (paragraphs, lists, table cells)
        const bodyParts: string[] = [];
        $('p, li, td, th, dt, dd').each((_, el) => {
            const text = $(el).text().trim();
            if (text.length > 20 && text.length < 500) {
                bodyParts.push(text);
            }
        });

        let bodyText = bodyParts.join('\n').slice(0, maxChars - contactSection.length - 500);

        // Assemble final output (contact section first if prioritized)
        const parts: string[] = [];
        if (title) parts.push(`TITLE: ${title}`);
        if (metaDescription) parts.push(`META: ${metaDescription}`);
        if (headings.length > 0) parts.push(`HEADINGS: ${headings.slice(0, 10).join(' | ')}`);
        if (contactSection) parts.push(`CONTACTS:\n${contactSection.slice(0, 800)}`);
        if (bodyText) parts.push(`CONTENT:\n${bodyText}`);

        const combined = parts.join('\n\n');
        const truncated = combined.slice(0, maxChars);

        return {
            title,
            metaDescription,
            headings,
            bodyText,
            contactSection,
            structuredData,
            charCount: truncated.length,
        };
    }

    /**
     * Convert CleanedHTML to a compact string for LLM prompts.
     */
    public static toString(cleaned: CleanedHTML): string {
        const parts: string[] = [];
        if (cleaned.title) parts.push(`TITLE: ${cleaned.title}`);
        if (cleaned.metaDescription) parts.push(`META: ${cleaned.metaDescription}`);
        if (cleaned.headings.length > 0) parts.push(`HEADINGS: ${cleaned.headings.slice(0, 10).join(' | ')}`);
        if (cleaned.contactSection) parts.push(`CONTACTS:\n${cleaned.contactSection.slice(0, 800)}`);
        if (cleaned.bodyText) parts.push(`CONTENT:\n${cleaned.bodyText.slice(0, 1500)}`);
        return parts.join('\n\n');
    }

    /**
     * Extract only contact-relevant information (VAT, phone, email, PEC).
     * Useful for contact extraction tasks.
     */
    public static extractContactInfo(html: string): string {
        const $ = cheerio.load(html);
        $('script, style, noscript, iframe, svg').remove();

        const text = $('body').text();
        const lines = text.split('\n')
            .map(l => l.trim())
            .filter(l => {
                const lower = l.toLowerCase();
                return (
                    /p\.?\s?iva|partita\s+iva|vat|codice\s+fiscale/i.test(l) ||
                    /pec|@pec|@legalmail|@arubapec/i.test(l) ||
                    /tel|telefono|phone|\+39|cellulare|mobile/i.test(l) ||
                    /@[a-z0-9.-]+\.[a-z]{2,}/i.test(l)
                );
            });

        return lines.join('\n').slice(0, 2000);
    }

    /**
     * Legacy minification (deprecated — use extract() instead).
     * Kept for backward compatibility during migration.
     */
    public static minify(html: string): string {
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\s+/g, ' ')
            .replace(/<(?:meta|link|noscript)[^>]*>/gi, '')
            .substring(0, 8000);
    }
}
