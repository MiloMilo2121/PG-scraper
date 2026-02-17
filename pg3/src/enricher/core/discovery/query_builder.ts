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
    // Social media
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'twitter.com',
    'youtube.com',
    'tiktok.com',
    // Italian directories & aggregators
    'paginegialle.it',
    'paginebianche.it',
    'virgilio.it',
    'yelp.it',
    'yelp.com',
    'tripadvisor.it',
    'kompass.com',
    'europages.com',
    'prontopro.it',
    'misterimprese.it',
    'registroimprese.it',
    'reteimprese.it',
    'informazione-aziende.it',
    'guidatitolari.it',
    // Job boards
    'infojobs.it',
    'indeed.com',
    'subito.it',
    'glassdoor.it',
    // Maps & marketplaces
    'amazon.it',
    'ebay.it',
    'groupon.it',
    'wikipedia.org',
    'trustpilot.com',
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

        // 8. Sector-based query (Italian SMEs often indexed by sector)
        const category = company.category || '';
        if (category && category.length > 2) {
            queries.push({
                query: `"${name}" "${category}" ${city} sito`,
                type: 'standard',
                expectedPrecision: 0.62,
            });
        }

        // 9. Province-level search (broader geographic reach)
        const province = company.province || '';
        if (province && province.length >= 2 && province !== city) {
            queries.push({
                query: `"${name}" "${province}" sito ufficiale`,
                type: 'standard',
                expectedPrecision: 0.58,
            });
        }

        // 10. Standard fallback
        queries.push({
            query: `"${name}" ${city} sito ufficiale`,
            type: 'standard',
            expectedPrecision: 0.55,
        });

        // 11. Reverse email domain search (if email available)
        const email = (company as any).email || '';
        if (email && email.includes('@')) {
            const domain = email.split('@')[1];
            if (domain && !domain.includes('gmail') && !domain.includes('yahoo') && !domain.includes('hotmail') && !domain.includes('pec.it')) {
                queries.push({
                    query: `site:${domain}`,
                    type: 'domain_probe',
                    expectedPrecision: 0.88,
                });
            }
        }

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
        // Top 7 exclusions for Serper (keep query short to avoid truncation)
        const exclusions = '-site:facebook.com -site:paginegialle.it -site:linkedin.com -site:instagram.com -site:prontopro.it -site:yelp.it -site:europages.com';
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
