import { CompanyInput } from '../../types';
import { Logger } from '../../utils/logger';
import { SerperSearchProvider } from './search_provider';
import { ScraperClient } from '../../utils/scraper_client';
import { MemoryRateLimiter } from '../rate_limiter';

/**
 * 🪪 IDENTITY RESOLVER — Step 0 of the Discovery Pipeline
 *
 * Resolves company identity (P.IVA, legal name, address, ATECO, financials)
 * via FatturatoItalia.it BEFORE attempting website discovery.
 *
 * Flow:
 *  1. SERP query `"<company_name>" "<city>" site:fatturatoitalia.it`
 *  2. Fetch the FatturatoItalia profile page (HTTP only, no browser)
 *  3. Extract structured data via regex
 *  4. Disambiguate homonyms by comparing city/province with input
 *
 * Architecture:
 *  - NO browser needed (Serper API + ScraperClient HTTP)
 *  - Dedicated rate limiter (max 1 req/1.5s to FatturatoItalia)
 *  - Graceful fallback: returns empty identity on failure, never blocks pipeline
 */

export interface CompanyIdentity {
    legal_name?: string;
    vat_number?: string;
    fiscal_code?: string;
    address?: string;
    city?: string;
    province?: string;
    ateco?: string;
    legal_form?: string;
    founded_year?: number;
    activity_status?: string;
    revenue?: string;
    employees?: string;
    fi_profile_url?: string;
    identity_confidence: number;
    identity_uncertain: boolean;
}

const EMPTY_IDENTITY: CompanyIdentity = {
    identity_confidence: 0,
    identity_uncertain: true,
};

const rateLimiter = new MemoryRateLimiter();

export class IdentityResolver {

    /**
     * Resolve company identity from FatturatoItalia.it
     * Returns EMPTY_IDENTITY on any failure — never throws.
     */
    public static async resolve(company: CompanyInput): Promise<CompanyIdentity> {
        // Skip if we already have a VAT code
        if (company.vat_code || company.piva || company.vat) {
            const existingVat = (company.vat_code || company.piva || company.vat || '').replace(/\D/g, '');
            if (existingVat.length === 11) {
                Logger.info(`[IdentityResolver] Company "${company.company_name}" already has VAT: ${existingVat}`);
                return {
                    vat_number: existingVat,
                    identity_confidence: 0.95,
                    identity_uncertain: false,
                };
            }
        }

        try {
            // Step 1: Find FatturatoItalia profile via SERP
            const profileUrl = await this.findProfileUrl(company);
            if (!profileUrl) {
                Logger.info(`[IdentityResolver] No FatturatoItalia profile found for "${company.company_name}"`);
                return EMPTY_IDENTITY;
            }

            // Step 2: Fetch profile page content (HTTP only)
            await rateLimiter.waitForSlot('fatturatoitalia');
            const pageContent = await this.fetchProfile(profileUrl);
            rateLimiter.reportSuccess('fatturatoitalia');

            if (!pageContent) {
                return EMPTY_IDENTITY;
            }

            // Step 3: Extract structured data
            const identity = this.parseProfile(pageContent, profileUrl);

            // Step 4: Disambiguate — verify the profile matches our input company
            const isMatch = this.disambiguate(company, identity);
            if (!isMatch) {
                Logger.warn(`[IdentityResolver] Homonym mismatch for "${company.company_name}" — profile city: ${identity.city}, input city: ${company.city}`);
                return { ...identity, identity_confidence: 0.2, identity_uncertain: true };
            }

            Logger.info(`[IdentityResolver] Resolved "${company.company_name}" -> VAT: ${identity.vat_number || 'N/A'}, Confidence: ${identity.identity_confidence}`);
            return identity;

        } catch (error) {
            rateLimiter.reportFailure('fatturatoitalia');
            Logger.warn('[IdentityResolver] Resolution failed, continuing without identity', {
                error: error as Error,
                company_name: company.company_name,
            });
            return EMPTY_IDENTITY;
        }
    }

    /**
     * Step 1: SERP search to find the FatturatoItalia profile URL.
     * Uses Serper.dev (Google results without browser).
     */
    private static async findProfileUrl(company: CompanyInput): Promise<string | null> {
        const serper = new SerperSearchProvider();
        const city = company.city || company.province || '';
        const query = `"${company.company_name}" "${city}" site:fatturatoitalia.it`;

        const results = await serper.search(query);
        if (results.length === 0) {
            return null;
        }

        // Pick the first result that is a FatturatoItalia company page
        for (const result of results) {
            if (result.url && result.url.includes('fatturatoitalia.it')) {
                return result.url;
            }
        }

        return null;
    }

    /**
     * Step 2: Fetch the profile page via HTTP (ScraperClient or Jina).
     * No browser needed — FatturatoItalia profiles are mostly static HTML.
     */
    private static async fetchProfile(url: string): Promise<string | null> {
        try {
            // Try Jina first (clean markdown, no JS needed)
            if (ScraperClient.isJinaEnabled()) {
                const jinaResp = await ScraperClient.fetchJinaReader(url, { timeoutMs: 12000, maxRetries: 1 });
                if (jinaResp.status === 200 && jinaResp.data && jinaResp.data.length > 200) {
                    return jinaResp.data;
                }
            }

            // Fallback: direct HTTP via ScraperClient
            const resp = await ScraperClient.fetchHtml(url, { mode: 'auto', timeoutMs: 12000, maxRetries: 1, render: false });
            if (typeof resp.data === 'string' && resp.data.length > 200) {
                return resp.data;
            }

            return null;
        } catch (e) {
            Logger.warn('[IdentityResolver] Profile fetch failed', { error: e as Error, url });
            return null;
        }
    }

    /**
     * Step 3: Parse the FatturatoItalia page content to extract structured data.
     * Uses regex patterns since the page has a predictable layout.
     */
    private static parseProfile(content: string, profileUrl: string): CompanyIdentity {
        const identity: CompanyIdentity = {
            fi_profile_url: profileUrl,
            identity_confidence: 0,
            identity_uncertain: false,
        };

        // P.IVA / Partita IVA (11 digits)
        const vatMatch = content.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*IVA)[:\s]*(?:IT)?[\s]?(\d{11})/i);
        if (vatMatch) {
            identity.vat_number = vatMatch[1];
            identity.identity_confidence = 0.85; // Strong signal
        }

        // Codice Fiscale (can be same as P.IVA or different for individuals)
        const cfMatch = content.match(/(?:Codice\s*Fiscale|C\.?\s*F\.?)[:\s]*([A-Z0-9]{11,16})/i);
        if (cfMatch) {
            identity.fiscal_code = cfMatch[1].toUpperCase();
        }

        // Ragione Sociale / Legal Name
        const legalNameMatch = content.match(/(?:Ragione\s*Sociale|Denominazione)[:\s]*([^\n\r|]{3,80})/i);
        if (legalNameMatch) {
            identity.legal_name = legalNameMatch[1].trim();
        }

        // Forma Giuridica (SRL, SPA, etc.)
        const legalFormMatch = content.match(/(?:Forma\s*Giuridica|Natura\s*Giuridica)[:\s]*([^\n\r|]{2,40})/i);
        if (legalFormMatch) {
            identity.legal_form = legalFormMatch[1].trim();
        }

        // Indirizzo / Address
        const addressMatch = content.match(/(?:Indirizzo|Sede\s*Legale|Sede)[:\s]*([^\n\r|]{5,100})/i);
        if (addressMatch) {
            identity.address = addressMatch[1].trim();
        }

        // City
        const cityMatch = content.match(/(?:Comune|Citt[aà])[:\s]*([^\n\r|,]{2,40})/i);
        if (cityMatch) {
            identity.city = cityMatch[1].trim();
        }

        // Province
        const provinceMatch = content.match(/(?:Provincia)[:\s]*([A-Z]{2})/i);
        if (provinceMatch) {
            identity.province = provinceMatch[1].toUpperCase();
        }

        // ATECO
        const atecoMatch = content.match(/(?:ATECO|Codice\s*ATECO|Attivit[aà])[:\s]*(\d{2}[\d.]*(?:\s*-\s*[^\n\r|]{3,60})?)/i);
        if (atecoMatch) {
            identity.ateco = atecoMatch[1].trim();
        }

        // Anno di fondazione
        const foundedMatch = content.match(/(?:Anno\s*(?:di\s*)?(?:Fondazione|Costituzione)|Fondata\s*nel)[:\s]*(\d{4})/i);
        if (foundedMatch) {
            identity.founded_year = parseInt(foundedMatch[1], 10);
        }

        // Stato attività
        const statusMatch = content.match(/(?:Stato|Status)[:\s]*(ATTIVA|CESSATA|INATTIVA|IN LIQUIDAZIONE)/i);
        if (statusMatch) {
            identity.activity_status = statusMatch[1].toUpperCase();
        }

        // Fatturato / Revenue
        const revenueMatch = content.match(/(?:Fatturato|Ricavi|Revenue)[:\s]*[€]?\s*([\d.,]+(?:\s*(?:mln|milioni|mila|k|M|€))?)/i);
        if (revenueMatch) {
            identity.revenue = revenueMatch[1].trim();
        }

        // Dipendenti / Employees
        const employeesMatch = content.match(/(?:Dipendenti|Addetti|Employees)[:\s]*(\d[\d.,]*)/i);
        if (employeesMatch) {
            identity.employees = employeesMatch[1].replace(/[.,]/g, '');
        }

        // Confidence scoring based on how much data we extracted
        if (!identity.vat_number) {
            // Without VAT, check if we got other strong signals
            const signals = [identity.legal_name, identity.address, identity.city, identity.ateco].filter(Boolean).length;
            identity.identity_confidence = Math.min(0.5, signals * 0.12);
        }

        return identity;
    }

    /**
     * Step 4: Disambiguate homonyms by comparing extracted city/province with input data.
     * Returns true if the profile matches the input company.
     */
    private static disambiguate(company: CompanyInput, identity: CompanyIdentity): boolean {
        // If we have no city/province to compare, accept the match but mark as uncertain
        if (!company.city && !company.province) {
            identity.identity_uncertain = true;
            return true;
        }

        // If the profile has no city/province, accept but mark uncertain
        if (!identity.city && !identity.province) {
            identity.identity_uncertain = true;
            return true;
        }

        const normalize = (s?: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        // Province match (strongest signal — 2 chars)
        if (company.province && identity.province) {
            if (normalize(company.province) === normalize(identity.province)) {
                return true;
            }
        }

        // City match (substring to handle "Milano" vs "MILANO (MI)")
        if (company.city && identity.city) {
            const inputCity = normalize(company.city);
            const profileCity = normalize(identity.city);
            if (inputCity === profileCity || profileCity.includes(inputCity) || inputCity.includes(profileCity)) {
                return true;
            }
        }

        // Address partial match (check if key address tokens overlap)
        if (company.address && identity.address) {
            const inputTokens = normalize(company.address).split(/\s+/).filter(t => t.length >= 3);
            const profileAddr = normalize(identity.address);
            const matchCount = inputTokens.filter(t => profileAddr.includes(t)).length;
            if (matchCount >= 2) {
                return true;
            }
        }

        return false;
    }
}
