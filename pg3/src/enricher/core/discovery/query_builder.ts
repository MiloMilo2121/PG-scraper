/**
 * QUERY BUILDER — Golden Query Engineering
 *
 * Generates high-precision search queries that force Google to return official sites.
 * Three query types:
 * 1. Exclusionary: Strip directory pollution
 * 2. Contact Vector: Target pages with "Contatti" in the title
 * 3. VAT Anchor: Use the unique P.IVA fingerprint
 */

import { CompanyInput } from '../../types';

// Sites that pollute SERP results for Italian SME searches
const EXCLUSION_SITES = [
    'facebook.com',
    'instagram.com',
    'paginegialle.it',
    'linkedin.com',
    'twitter.com',
    'paginebianche.it',
    'yelp.it',
    'kompass.com',
    'europages.com',
    'tripadvisor.it',
    'subito.it',
    'infojobs.it',
    'indeed.com',
    'virgilio.it',
];

export interface GoldenQuery {
    query: string;
    type: 'exclusionary' | 'contact_vector' | 'vat_anchor' | 'domain_probe' | 'standard';
    expectedPrecision: number; // 0-1, higher = more targeted
}

export class QueryBuilder {
    /**
     * Generate a ranked list of "Golden Queries" for a company.
     * More precise queries come first.
     */
    static buildGoldenQueries(company: CompanyInput): GoldenQuery[] {
        const queries: GoldenQuery[] = [];
        const name = company.company_name;
        const city = company.city || '';
        const vat = company.vat_code || company.vat || company.piva || '';
        const phone = company.phone || '';
        const address = company.address || '';

        // 1. VAT Anchor (Highest precision if VAT is available)
        if (vat && vat.length >= 5) {
            const cleanVat = vat.replace(/\D/g, '');
            if (cleanVat.length === 11) {
                queries.push({
                    query: `"P.IVA ${cleanVat}"`,
                    type: 'vat_anchor',
                    expectedPrecision: 0.95,
                });
                queries.push({
                    query: `"${cleanVat}" site:.it`,
                    type: 'vat_anchor',
                    expectedPrecision: 0.90,
                });
            }
        }

        // 2. Exclusionary Query (Force official site to top)
        const exclusions = EXCLUSION_SITES.map(s => `-site:${s}`).join(' ');
        queries.push({
            query: `"${name}" "${city}" ${exclusions}`,
            type: 'exclusionary',
            expectedPrecision: 0.80,
        });

        // 3. Contact Vector (intitle + contatti)
        queries.push({
            query: `intitle:"${name}" "contatti" "${city}"`,
            type: 'contact_vector',
            expectedPrecision: 0.78,
        });

        // 4. Privacy/Legal footer vector
        queries.push({
            query: `"${name}" "${city}" "privacy policy" OR "note legali"`,
            type: 'contact_vector',
            expectedPrecision: 0.72,
        });

        // 5. Phone anchor
        if (phone && phone.length >= 7) {
            queries.push({
                query: `"${phone}" "${name}"`,
                type: 'contact_vector',
                expectedPrecision: 0.82,
            });
        }

        // 6. Address anchor
        if (address && address.length > 5) {
            queries.push({
                query: `"${address}" "${city}" "${name}"`,
                type: 'contact_vector',
                expectedPrecision: 0.75,
            });
        }

        // 7. Domain probe (force .it TLD)
        queries.push({
            query: `site:.it "${name}" "${city}"`,
            type: 'domain_probe',
            expectedPrecision: 0.65,
        });

        // 8. Standard fallback
        queries.push({
            query: `"${name}" ${city} sito ufficiale`,
            type: 'standard',
            expectedPrecision: 0.55,
        });

        // Sort by precision (highest first)
        queries.sort((a, b) => b.expectedPrecision - a.expectedPrecision);

        return queries;
    }

    /**
     * Build a single best-effort exclusionary query for the SerperSearchProvider.
     * This replaces the naive "name + city + sito ufficiale" pattern.
     */
    static buildSerperQuery(company: CompanyInput): string {
        const name = company.company_name;
        const city = company.city || '';
        // Top 5 exclusions for Serper (keep query short to avoid truncation)
        const exclusions = '-site:facebook.com -site:paginegialle.it -site:linkedin.com -site:instagram.com -site:yelp.it';
        return `"${name}" "${city}" ${exclusions}`;
    }

    /**
     * Build a Google Dorking query for "chi siamo" / "about us" targeting.
     */
    static buildContactQuery(company: CompanyInput): string {
        const name = company.company_name;
        const city = company.city || '';
        return `"${name}" "${city}" ("chi siamo" OR "contatti" OR "about us")`;
    }
}
