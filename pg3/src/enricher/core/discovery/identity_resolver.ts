
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
            const html = await ScraperClient.fetchText(url, { mode: 'scrape_do', render: false }); // Fast fetch
            const $ = cheerio.load(html);

            // Extract data from FatturatoItalia schema (approximate - needs actual selectors)
            // Typically: H1 = Name, Specific fields for P.IVA

            const legalName = $('h1').first().text().trim();

            // P.IVA extraction (usually in text or specific span)
            const bodyText = $('body').text();
            const vatMatch = bodyText.match(/Partita IVA:?\s*(\d{11})/i);
            const vat = vatMatch ? vatMatch[1] : null;

            if (!legalName || !vat) return null;

            // Financials
            const revenue = this.extractFinancialMetric($, 'Fatturato');
            const employees = this.extractFinancialMetric($, 'Dipendenti');
            const profit = this.extractFinancialMetric($, 'Utile');

            // Address/City check
            const addressText = bodyText;
            const cityMatch = originalCompany.city ? addressText.toLowerCase().includes(originalCompany.city.toLowerCase()) : true;

            // Confidence check
            // If City matches or Name is very similar -> HIGH
            // Real logic: VAT checksum validity + City match

            return {
                legal_name: legalName,
                vat_number: vat,
                financials: {
                    revenue,
                    employees,
                    profit
                },
                confidence: cityMatch ? 'HIGH' : 'MEDIUM',
                source_url: url
            };

        } catch (e) {
            Logger.warn('[IdentityResolver] Profile scraping failed', { url, error: e });
            return null;
        }
    }

    private extractFinancialMetric($: cheerio.CheerioAPI, label: string): string | undefined {
        // Generic extractor looking for label and taking next number
        // This is a placeholder for the specific DOM structure of fatturatoitalia
        try {
            const element = $(`div:contains("${label}")`).last();
            const value = element.next().text().trim() || element.text().split(label)[1]?.trim();
            return value?.replace(/[^0-9.,€]/g, '').trim();
        } catch {
            return undefined;
        }
    }
}
