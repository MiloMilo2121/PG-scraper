import axios from 'axios';
import { SearchProvider } from './search_provider';
import { SerpResult } from './serp_analyzer';
import { Logger } from '../../utils/logger';
import { Retry } from '../../../utils/decorators';

export class CrtShProvider implements SearchProvider {
    id = 'CRTSH-API-1';
    tier = 1; // High priority, OSINT direct DB
    costPerRequest = 0;
    maxRetries = 2; // crt.sh can sometimes timeout on heavy wildcard queries

    @Retry({ attempts: 2, delay: 2000, backoff: 'exponential' })
    async search(query: string, maxResults?: number): Promise<SerpResult[]> {
        // crt.sh query format expects % wildcard, e.g. %company%name%.it
        // OMEGA builds the wildcard string via QuerySanitizer
        const url = `https://crt.sh/?q=${encodeURIComponent(query)}&output=json`;

        Logger.info(`[CrtShProvider] Querying Certificate Transparency logs: ${url}`);

        await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));

        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'OMEGA_V7_OSINT_PROBE (Research Purposes)',
                'Accept': 'application/json'
            }
        });

        if (!response.data || !Array.isArray(response.data)) {
            if (response.status === 200) return []; // Valid empty response
            throw new Error(`CRTSH_ERROR: DB returned non-array payload. Status: ${response.status}`);
        }

        const rawResults = response.data;
        const processedResults: SerpResult[] = [];
        const seenDomains = new Set<string>();

        // crt.sh format: { issuer_ca_id, issuer_name, common_name, name_value, id, entry_timestamp, not_before, not_after, serial_number }
        for (const entry of rawResults) {
            if (!entry.name_value) continue;

            // name_value can contain multiple domains separated by newlines (SANs)
            const domains = entry.name_value.split('\n').map((d: string) => d.trim().toLowerCase());

            for (let domain of domains) {
                // Ignore wildcard records themselves for exact DB matches, or strip wildcard
                if (domain.startsWith('*.')) {
                    domain = domain.substring(2);
                }

                // Extremely basic validation, avoid empty or single-word non-urls
                if (domain.length < 4 || !domain.includes('.')) continue;

                if (!seenDomains.has(domain)) {
                    seenDomains.add(domain);
                    processedResults.push({
                        url: `https://${domain}`,
                        title: `SSL Certificate Registered: ${domain}`,
                        source: 'crtsh'
                    } as any);
                }
            }
        }

        Logger.info(`[CrtShProvider] Success: Found ${processedResults.length} unique domains in CT Logs for query.`);
        return maxResults ? processedResults.slice(0, maxResults) : processedResults;
    }

    async getCredits(): Promise<number> {
        return Infinity;
    }
}
