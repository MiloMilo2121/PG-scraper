
import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { ScraperClient } from '../../utils/scraper_client';
import * as cheerio from 'cheerio';
import { ContentFilter } from './content_filter';

export interface FinancialData {
    revenue?: string;
    employees?: string;
    profit?: string;
    year?: string;
}

export interface IdentityResult {
    legal_name: string;
    vat_number: string;
    fiscal_code?: string;
    activity_code?: string; // ATECO
    city?: string;
    address?: string;
    financials?: FinancialData;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    source_url: string;
}

export class IdentityResolver {

    /**
     * 🕵️ ZERO-COST IDENTITY RESOLUTION
     * Step 0: Find the "Official Identity" via fatturatoitalia.it (or equiv)
     * Queries Bing/DDG to find the specific profile page, then scrapes it.
     */
    public async resolveIdentity(company: CompanyInput): Promise<IdentityResult | null> {
        Logger.info(`[IdentityResolver] 🕵️ Resolving identity for: ${company.company_name}`);

        // 1. Generate Identity Queries
        // Strategy: Use site:fatturatoitalia.it to find the official record
        const queries = [
            `site:fatturatoitalia.it "${company.company_name}" "${company.city || ''}"`,
            `site:fatturatoitalia.it "${company.company_name}" "${company.province || ''}"`,
        ];

        // Add ATECO/Sector hint if Name is generic
        if (company.company_name.split(' ').length < 2 && company.category) {
            queries.push(`site:fatturatoitalia.it "${company.company_name}" "${company.category}" "${company.city || ''}"`);
        }

        // 2. Execute Queries (Waterfall)
        for (const query of queries) {
            const profileUrl = await this.findProfileUrl(query);
            if (profileUrl) {
                Logger.info(`[IdentityResolver] 🎯 Profile found: ${profileUrl}`);
                const identity = await this.scrapeProfile(profileUrl, company);
                if (identity) {
                    return identity;
                }
            }
        }

        Logger.warn(`[IdentityResolver] ⚠️ Identity resolution failed for ${company.company_name}`);
        return null; // Fallback to Broad Search
    }

    private async findProfileUrl(query: string): Promise<string | null> {
        try {
            // Use existing Search Providers (Bing via ScraperClient/Puppeteer)
            // We reuse ScraperClient.fetchText with a "smart" approach or just basic Google/Bing search
            // For zero-cost, we prefer Bing/DDG. 
            // HERE: We simulate a search by using a "SearchProvider" logic or direct scraping?
            // To keep it clean, let's use ScraperClient to fetch Bing SERP.
            // But we actually have proper SearchProviders in unified_discovery_service. 
            // Ideally this class should use them, but to avoid circular deps, we can use ScraperClient direct.

            // NOTE: For now, assuming ScraperClient has a specific method or we construct a Bing URL.
            // Using ScraperClient.fetchBingSearch (hypothetical) or just parsing.
            // Let's use a simple Jina/Bing fetch if available, or fall back to standard extraction.

            // Implementation: Simple "site:" search via current available ScraperClient methods
            // Since we don't have a direct "searchBing" static method exposed easily, 
            // we will use a dedicated helper or just return null for now to be filled by the integration step.

            // ACTUAL IMPLEMENTATION: 
            // We will use `ScraperClient.fetchText` on a Bing URL.
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
            const html = await ScraperClient.fetchText(bingUrl, { mode: 'scrape_do', render: true });

            const $ = cheerio.load(html);
            // Extract first organic result matching fatturatoitalia.it
            let matchedUrl: string | null = null;

            $('li.b_algo h2 a').each((i, el) => {
                if (matchedUrl) return;
                const url = $(el).attr('href');
                if (url && url.includes('fatturatoitalia.it')) {
                    matchedUrl = url;
                }
            });

            return matchedUrl;

        } catch (e) {
            Logger.warn(`[IdentityResolver] Search query failed: ${query}`);
            return null;
        }
    }

    private async scrapeProfile(url: string, originalCompany: CompanyInput): Promise<IdentityResult | null> {
        try {
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do', render: false });
            const $ = cheerio.load(html);
            const bodyText = $('body').text(); // Fallback for text-based regex

            // 1. Extract Legal Name (Usually H1 or specific label)
            let legalName = $('h1').first().text().trim();
            if (!legalName) {
                legalName = this.extractByLabel($, 'Ragione sociale') || '';
            }

            // 2. Extract VAT (P.IVA)
            let vat: string | undefined | null = this.extractByLabel($, 'Partita IVA');
            if (!vat) {
                const vatMatch = bodyText.match(/Partita IVA:?\s*(\d{11})/i);
                vat = vatMatch ? vatMatch[1] : undefined;
            }

            if (!legalName || !vat) return null;

            // 3. Extract Financials
            // Labels: "Fatturato 2024", "Utile 2024", "N. Dipendenti", "Attività prevalente"
            const revenue = this.extractByLabel($, 'Fatturato'); // Matches "Fatturato 202X" via partial match logic if needed
            const employees = this.extractByLabel($, 'N. Dipendenti') || this.extractByLabel($, 'Dipendenti');
            const profit = this.extractByLabel($, 'Utile');

            // 4. Extract Category/Activity
            const activity = this.extractByLabel($, 'Attività prevalente') || this.extractByLabel($, 'ATECO');

            // 5. Confidence Logic
            // If the found city matches the input city (geo check) OR matched via very specific name
            let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
            const pageTextLower = bodyText.toLowerCase();

            if (originalCompany.city && pageTextLower.includes(originalCompany.city.toLowerCase())) {
                confidence = 'HIGH';
            }
            if (originalCompany.vat_number && vat.includes(originalCompany.vat_number)) {
                confidence = 'HIGH'; // Manual override if we already had VAT
            }

            return {
                legal_name: legalName,
                vat_number: vat,
                activity_code: activity,
                financials: {
                    revenue: this.cleanCurrency(revenue),
                    employees: this.cleanEmployees(employees),
                    profit: this.cleanCurrency(profit)
                },
                confidence,
                source_url: url
            };

        } catch (e) {
            Logger.warn('[IdentityResolver] Profile scraping failed', { url, error: (e as Error).message });
            return null;
        }
    }

    /**
     * Extracts text following a label (e.g., "Fatturato: € 100").
     * Tries multiple strategies: Sibling element, Table cell, or Text proximity.
     */
    private extractByLabel($: cheerio.CheerioAPI, labelPattern: string): string | undefined {
        // Strategy 1: Definition lists or divs (Label -> Value)
        // Look for element containing label, then take the next element or text node
        try {
            // Find all elements containing the label
            const labelEls = $(`*:contains('${labelPattern}')`).filter((i, el) => {
                // Filter to ensure it's the deepest element containing the text (leaf node)
                return $(el).children().length === 0 || $(el).text().trim().startsWith(labelPattern);
            });

            if (labelEls.length > 0) {
                const finalEl = labelEls.last(); // Usually the most specific

                // Option A: Value is in the NEXT sibling
                let val = finalEl.next().text().trim();
                if (val) return val;

                // Option B: Value is in the SAME parent's text (e.g. <div>Label: Value</div>)
                const parentText = finalEl.parent().text().trim();
                if (parentText.length > labelPattern.length + 2) {
                    return parentText.replace(labelPattern, '').replace(/^[:\s]+/, '').trim();
                }

                // Option C: Table structure (TD -> next TD)
                const td = finalEl.closest('td');
                if (td.length > 0) {
                    return td.next('td').text().trim();
                }
            }
            return undefined;
        } catch (e) {
            return undefined;
        }
    }

    private cleanCurrency(value?: string): string | undefined {
        if (!value) return undefined;
        // Handle "€ 186.975.036" -> "186975036" (or keep formatting if preferred)
        // User request shows format "€ -2.299.451". Let's keep the standard numeric representation.
        // Actually, keeping the raw string is often safer for display, but for DB we might want numbers.
        // Let's return just numbers and minus sign.
        return value.replace(/[^0-9,-]/g, '').trim();
    }

    private cleanEmployees(value?: string): string | undefined {
        if (!value) return undefined;
        // Handle "oltre 1000" -> "1000+" or keep text
        return value.replace(/\n/g, '').trim();
    }
}
