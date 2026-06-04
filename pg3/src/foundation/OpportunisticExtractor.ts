import * as cheerio from 'cheerio';
import { FinancialData } from './BilancioHunter';

export interface OpportunisticExtractionResult {
    websiteUrl?: string;
    financialData?: Partial<FinancialData>;
    pec?: string;
    ateco?: string;
    dipendenti?: number;
}

export class OpportunisticExtractor {
    
    public static extract(html: string, sourceUrl: string): OpportunisticExtractionResult {
        const result: OpportunisticExtractionResult = {};
        const $ = cheerio.load(html);

        // 1. EXTRACT WEBSITE URL
        // We look for common patterns in registries like visura.pro, registroaziende.it
        let foundWebsite: string | undefined;

        // Pattern A: <a> tags with text containing "Sito", "Website", "Web"
        $('a').each((_, el) => {
            if (foundWebsite) return;
            const text = $(el).text().toLowerCase().trim();
            const href = $(el).attr('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                // Ignore self-links or directory links
                if (href.includes('registroaziende.it') || href.includes('visura.pro') || href.includes('wogha.com')) return;
                
                if (text.includes('sito web') || text.includes('visita il sito') || text.includes('website')) {
                    foundWebsite = href;
                }
            }
        });

        // Pattern B: Look for hrefs that just look like real websites in specific table cells
        if (!foundWebsite) {
            $('td, th, div, span').each((_, el) => {
                if (foundWebsite) return;
                const text = $(el).text().toLowerCase().trim();
                if (text === 'sito web' || text === 'sito internet' || text === 'web') {
                    const nextEl = $(el).next();
                    const aTag = nextEl.find('a').first();
                    if (aTag.length > 0) {
                        const href = aTag.attr('href');
                        if (href && !href.startsWith('/')) foundWebsite = href;
                    } else {
                        // Text might be the URL itself
                        const nextText = nextEl.text().trim();
                        if (nextText.startsWith('www.') || nextText.startsWith('http')) {
                            foundWebsite = nextText.startsWith('http') ? nextText : `https://${nextText}`;
                        }
                    }
                }
            });
        }

        if (foundWebsite) {
            result.websiteUrl = foundWebsite;
        }

        // 2. EXTRACT FINANCIALS (Fatturato, Utile, Dipendenti, Anno)
        const textContent = $('body').text().replace(/\s+/g, ' ');
        const financials: Partial<FinancialData> = {};

        // Extract Fatturato
        const fatturatoMatch = textContent.match(/fatturato[^€\d]{0,20}(?:€|eur)?\s*([\d.,]+)\s*(?:mln|milioni)?/i);
        if (fatturatoMatch && fatturatoMatch[1]) {
            const num = this.parseItalianNumber(fatturatoMatch[1]);
            if (num && num > 100) financials.fatturato_current = num;
        }

        // Extract Utile
        const utileMatch = textContent.match(/utile[^€\d]{0,20}(?:€|eur)?\s*([\d.,]+)\s*(?:mln|milioni)?/i);
        if (utileMatch && utileMatch[1]) {
            const num = this.parseItalianNumber(utileMatch[1]);
            if (num) financials.utile_netto = num; // Can be negative, but let's assume absolute for now or handle minus later
        }

        // Extract Year
        const yearMatch = textContent.match(/bilancio\s+(?:del\s+)?(20[1-3]\d)\b/i) || textContent.match(/fatturato\s+(?:del\s+)?(20[1-3]\d)\b/i);
        if (yearMatch && yearMatch[1]) {
            financials.year = parseInt(yearMatch[1], 10);
        }

        // Extract Dipendenti
        const dipendentiMatch = textContent.match(/dipendenti[^0-9]{0,20}(\d+)/i);
        if (dipendentiMatch && dipendentiMatch[1]) {
            result.dipendenti = parseInt(dipendentiMatch[1], 10);
        }

        // Extract PEC
        const pecMatch = textContent.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:pec|legalmail|telecompost|postacert|sicurezzapostale|pecimpresa)[a-zA-Z]{0,4})/i) || textContent.match(/([a-zA-Z0-9._%+-]+@pec\.[a-zA-Z0-9.-]+)/i);
        if (pecMatch && pecMatch[1]) {
            result.pec = pecMatch[1].toLowerCase();
        }

        // Extract ATECO
        const atecoMatch = textContent.match(/(?:ateco|codice ateco)[^\d]{0,10}(\d{2}\.\d{2}\.\d{2}|\d{6})/i);
        if (atecoMatch && atecoMatch[1]) {
            result.ateco = atecoMatch[1];
        }

        // If pec is obfuscated by cloudflare in HTML, it might show [email protected]. Let's try to extract from decoded if possible, but regex on raw HTML is best-effort.

        if (Object.keys(financials).length > 0) {
            financials.source_url = sourceUrl;
            financials.source_trust = 'high';
            financials.confidence = 0.95;
            result.financialData = financials;
        }

        return result;
    }

    private static parseItalianNumber(raw: string): number | undefined {
        const cleaned = raw.replace(/[^\d.,]/g, '');
        if (!cleaned) return undefined;
        
        // Handle millions
        if (raw.toLowerCase().includes('mln') || raw.toLowerCase().includes('milion')) {
            const val = parseFloat(cleaned.replace(',', '.'));
            return Math.round(val * 1000000);
        }

        const lastDot = cleaned.lastIndexOf('.');
        const lastComma = cleaned.lastIndexOf(',');
        const decimalIndex = Math.max(lastDot, lastComma);
        const hasDecimal = decimalIndex > -1 && cleaned.length - decimalIndex <= 3;
        
        const normalized = hasDecimal
            ? `${cleaned.slice(0, decimalIndex).replace(/[.,]/g, '')}.${cleaned.slice(decimalIndex + 1)}`
            : cleaned.replace(/[.,]/g, '');
            
        const value = Number.parseFloat(normalized);
        return Number.isFinite(value) ? Math.round(value) : undefined;
    }
}
