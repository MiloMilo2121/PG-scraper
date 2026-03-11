import * as cheerio from 'cheerio';

/**
 * 🧹 HTML CLEANER — Intelligent HTML Preprocessing for LLMs
 *
 * Extracts meaningful content from HTML while minimizing token usage.
 * Uses semantic parsing first, then deterministic candidate extraction for contacts.
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

export interface ContactCandidate {
    kind: 'vat' | 'email' | 'pec' | 'phone';
    value: string;
    source: 'jsonld' | 'mailto' | 'tel' | 'html_text';
    confidence: number;
}

type CandidateKey = `${ContactCandidate['kind']}:${string}`;

export class HTMLCleaner {

    /**
     * Extract clean, semantic text from HTML.
     */
    public static extract(
        html: string,
        maxChars: number = 3000,
        prioritizeContacts: boolean = true
    ): CleanedHTML {
        const $ = cheerio.load(html);

        HTMLCleaner.stripBloat($, { preserveFooter: prioritizeContacts });

        const title = $('title').text().trim() || $('h1').first().text().trim();
        const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

        const headings: string[] = [];
        $('h1, h2, h3').each((_, el) => {
            const text = $(el).text().trim();
            if (text && text.length < 100) headings.push(text);
        });

        const structuredData = HTMLCleaner.extractStructuredData($);
        const contactSection = prioritizeContacts
            ? HTMLCleaner.buildContactSection($, html)
            : '';

        const mainContentRoot = $('main, article, [role="main"], .content, #content').first();
        const textRoot = mainContentRoot.length > 0 ? mainContentRoot : $('body');
        const bodyParts: string[] = [];

        textRoot.find('p, li, td, th, dt, dd').each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            if (text.length > 20 && text.length < 500) {
                bodyParts.push(text);
            }
        });

        let bodyText = bodyParts.join('\n');
        if (!bodyText) {
            bodyText = textRoot.text().replace(/\s+/g, ' ').trim();
        }

        bodyText = bodyText.slice(0, Math.max(0, maxChars - contactSection.length - 500));

        return {
            title,
            metaDescription,
            headings,
            bodyText,
            contactSection,
            structuredData,
            charCount: [title, metaDescription, headings.join(' '), contactSection, bodyText].join(' ').length,
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
        if (cleaned.contactSection) parts.push(`CONTACTS:\n${cleaned.contactSection.slice(0, 1200)}`);
        if (cleaned.bodyText) parts.push(`CONTENT:\n${cleaned.bodyText.slice(0, 1500)}`);
        return parts.join('\n\n');
    }

    /**
     * Deterministic contact extraction. This becomes the candidate layer before LLM disambiguation.
     */
    public static extractContactCandidates(html: string): ContactCandidate[] {
        const $ = cheerio.load(html);
        HTMLCleaner.stripBloat($, { preserveFooter: true });

        const candidates = new Map<CandidateKey, ContactCandidate>();
        const pushCandidate = (candidate: ContactCandidate) => {
            const value = HTMLCleaner.normalizeCandidateValue(candidate.kind, candidate.value);
            if (!value) return;
            const normalizedCandidate = { ...candidate, value };
            const key = `${normalizedCandidate.kind}:${normalizedCandidate.value}` as CandidateKey;
            const current = candidates.get(key);
            if (!current || current.confidence < normalizedCandidate.confidence) {
                candidates.set(key, normalizedCandidate);
            }
        };

        // JSON-LD signals
        const structured = HTMLCleaner.extractStructuredData($);
        for (const entry of HTMLCleaner.walkStructuredData(structured)) {
            if (typeof entry.email === 'string') {
                pushCandidate({ kind: HTMLCleaner.isPec(entry.email) ? 'pec' : 'email', value: entry.email, source: 'jsonld', confidence: 0.95 });
            }
            if (typeof entry.telephone === 'string') {
                pushCandidate({ kind: 'phone', value: entry.telephone, source: 'jsonld', confidence: 0.95 });
            }
            if (typeof entry.vatID === 'string') {
                pushCandidate({ kind: 'vat', value: entry.vatID, source: 'jsonld', confidence: 0.98 });
            }
            if (typeof entry.taxID === 'string') {
                pushCandidate({ kind: 'vat', value: entry.taxID, source: 'jsonld', confidence: 0.9 });
            }
        }

        // mailto / tel links
        $('a[href^="mailto:"]').each((_, el) => {
            const href = ($(el).attr('href') || '').replace(/^mailto:/i, '');
            pushCandidate({ kind: HTMLCleaner.isPec(href) ? 'pec' : 'email', value: href, source: 'mailto', confidence: 0.9 });
        });

        $('a[href^="tel:"]').each((_, el) => {
            const href = ($(el).attr('href') || '').replace(/^tel:/i, '');
            pushCandidate({ kind: 'phone', value: href, source: 'tel', confidence: 0.9 });
        });

        // text-level fallback
        const text = $('body').text();
        for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) {
            pushCandidate({ kind: HTMLCleaner.isPec(email) ? 'pec' : 'email', value: email, source: 'html_text', confidence: 0.75 });
        }

        for (const match of text.match(/\b(?:IT\s*)?\d{11}\b/gi) || []) {
            pushCandidate({ kind: 'vat', value: match, source: 'html_text', confidence: 0.72 });
        }

        for (const match of text.match(/(?:\+39|0039)?[\s./-]*(?:0\d{1,4}|\d{2,4})[\s./-]*\d{5,8}/g) || []) {
            pushCandidate({ kind: 'phone', value: match, source: 'html_text', confidence: 0.68 });
        }

        return [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Compact text summary for prompts or logs.
     */
    public static summarizeContactCandidates(candidates: ContactCandidate[]): string {
        if (candidates.length === 0) return 'No deterministic contact candidates found.';
        return candidates
            .slice(0, 12)
            .map((candidate) => `${candidate.kind.toUpperCase()} [${candidate.source}] ${candidate.value} (conf ${candidate.confidence.toFixed(2)})`)
            .join('\n');
    }

    /**
     * Select the top candidate per contact type for hybrid extraction fallbacks.
     */
    public static selectBestContactCandidates(candidates: ContactCandidate[]): {
        vat?: string;
        email?: string;
        phone?: string;
        pec?: string;
    } {
        const pick = (kind: ContactCandidate['kind']) => candidates.find((candidate) => candidate.kind === kind)?.value;
        return {
            vat: pick('vat'),
            email: pick('email'),
            phone: pick('phone'),
            pec: pick('pec'),
        };
    }

    /**
     * Extract only contact-relevant information for prompts.
     */
    public static extractContactInfo(html: string): string {
        const candidates = HTMLCleaner.extractContactCandidates(html);
        if (candidates.length > 0) {
            return HTMLCleaner.summarizeContactCandidates(candidates).slice(0, 2000);
        }

        const $ = cheerio.load(html);
        HTMLCleaner.stripBloat($, { preserveFooter: true });
        return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);
    }

    /**
     * Legacy minification (deprecated).
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

    private static stripBloat($: cheerio.CheerioAPI, options?: { preserveFooter?: boolean }): void {
        $('script:not([type="application/ld+json"]), style, noscript, iframe, svg, canvas, video, audio').remove();
        const selectors = ['nav', 'header', '.cookie-banner', '.advertisement', '#cookie-consent'];
        if (!options?.preserveFooter) {
            selectors.push('footer');
        }
        $(selectors.join(', ')).remove();
        $('[class*="cookie"], [class*="gdpr"], [id*="cookie"]').remove();
    }

    private static extractStructuredData($: cheerio.CheerioAPI): Record<string, any> | null {
        let structuredData: Record<string, any> | null = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const raw = JSON.parse($(el).html() || '{}');
                const candidates = Array.isArray(raw) ? raw : [raw];
                const match = candidates.find((item) => {
                    const type = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
                    return type.includes('Organization') || type.includes('LocalBusiness');
                });
                if (match) {
                    structuredData = match;
                    return false;
                }
            } catch {
                // Ignore malformed JSON-LD
            }
            return;
        });
        return structuredData;
    }

    private static buildContactSection($: cheerio.CheerioAPI, html: string): string {
        const sections: string[] = [];
        const contactKeywords = ['contatti', 'contact', 'chi siamo', 'about', 'legal', 'p.iva', 'partita iva', 'pec'];
        const contactSections = $('section, div, footer').filter((_, el) => {
            const text = $(el).text().toLowerCase();
            return contactKeywords.some((keyword) => text.includes(keyword));
        });

        contactSections.each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            if (text.length > 30) {
                sections.push(text.slice(0, 500));
            }
        });

        const candidates = HTMLCleaner.extractContactCandidates(html);
        if (candidates.length > 0) {
            const candidateSummary = HTMLCleaner.summarizeContactCandidates(candidates);
            sections.unshift(candidateSummary);
        }

        return sections.join('\n').slice(0, 1200);
    }

    private static walkStructuredData(value: unknown): Record<string, unknown>[] {
        if (!value || typeof value !== 'object') return [];

        const stack: Record<string, unknown>[] = [];
        const visit = (node: unknown) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }

            const record = node as Record<string, unknown>;
            stack.push(record);
            for (const child of Object.values(record)) {
                visit(child);
            }
        };

        visit(value);
        return stack;
    }

    private static normalizeCandidateValue(kind: ContactCandidate['kind'], value: string): string {
        const normalized = value.trim();
        if (!normalized) return '';

        if (kind === 'vat') {
            const cleanVat = normalized.replace(/^IT/i, '').replace(/\D/g, '');
            return cleanVat.length === 11 ? cleanVat : '';
        }

        if (kind === 'email' || kind === 'pec') {
            const cleanEmail = normalized.toLowerCase();
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ? cleanEmail : '';
        }

        return normalized.replace(/\s+/g, ' ');
    }

    private static isPec(value: string): boolean {
        return /(?:pec\.it|legalmail\.it|arubapec\.it|postecert\.it|pec\.)/i.test(value);
    }
}
