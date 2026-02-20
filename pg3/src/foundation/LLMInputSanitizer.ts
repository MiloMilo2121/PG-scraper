import * as cheerio from 'cheerio';

export class LLMInputSanitizer {
    public sanitizeHTML(html: string): string {
        if (!html) return '';

        try {
            const $ = cheerio.load(html);

            // Remove useless tags that bloat tokens
            $('script, style, noscript, iframe, img, svg, video, audio, canvas, map, object, embed').remove();

            // Remove structural tags that don't add semantic value for an LLM reading text
            $('meta, link, head, header, footer, nav, aside').remove();

            // Extract just the text
            let text = $('body').text();

            // Normalize whitespace
            text = text.replace(/\s+/g, ' ').trim();

            // Truncate to save tokens (e.g. 8K tokens approx 32K chars)
            if (text.length > 30000) {
                text = text.substring(0, 30000) + '... [TRUNCATED]';
            }

            return text;

        } catch (e) {
            // Fallback if cheerio fails
            let text = html.replace(/<[^>]*>?/gm, ' ');
            text = text.replace(/\s+/g, ' ').trim();
            if (text.length > 30000) {
                text = text.substring(0, 30000);
            }
            return text;
        }
    }

    public extractContactsFromText(text: string): { emails: string[], phones: string[], pivas: string[] } {
        // Fast regex extraction to help the LLM or bypass it if found cleanly
        const emails = Array.from(text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)).map(m => m[0]);

        // Very basic Italian phone regex (often they are messy, so we just grab clusters of numbers)
        const phones = Array.from(text.matchAll(/(?:\+39)?\s*(?:0[1-9]{1,3}|3[1-9]{2})\s*[\d\s\-\.]{5,10}/g))
            .map(m => m[0].trim())
            .filter(p => p.replace(/\D/g, '').length >= 9);

        // P.IVA: 11 consecutive digits, often prefixed with "P.IVA" or "Partita IVA"
        // We look for 11 digits
        const pivaMatches = Array.from(text.matchAll(/\b[0-9]{11}\b/g)).map(m => m[0]);
        // Also look for IT12345678901
        const itPivaMatches = Array.from(text.matchAll(/IT[0-9]{11}\b/gi)).map(m => m[0].substring(2));

        const pivas = Array.from(new Set([...pivaMatches, ...itPivaMatches]));

        return {
            emails: Array.from(new Set(emails)),
            phones: Array.from(new Set(phones)),
            pivas
        };
    }
}
