import * as dns from 'dns';
import { SearchProvider } from './search_provider';
import { SerpResult } from './serp_analyzer';
import { Logger } from '../../utils/logger';

export class MxDiscoveryProvider implements SearchProvider {
    id = 'DNS-MX-MINING-0';
    tier = 0; // Absolute priority: runs before any network scraper
    costPerRequest = 0;

    async search(query: string, maxResults: number = 3): Promise<SerpResult[]> {
        // Query format for MX miner expects an email address or a raw domain
        let domainToProbe = query;

        if (query.includes('@')) {
            domainToProbe = query.split('@').pop() || query;
        } else {
            // Se la query non è un'email, estraiamo i token e proviamo a comporre un possibile dominio base
            const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
            if (tokens.length > 0) {
                domainToProbe = `${tokens[0]}.it`; // Simplified heuristic for probing
            }
        }

        domainToProbe = domainToProbe.trim().toLowerCase();

        try {
            Logger.info(`[MxDiscoveryProvider] Peforming MX lookup on ${domainToProbe}`);
            const mxRecords = await dns.promises.resolveMx(domainToProbe);

            if (!mxRecords || mxRecords.length === 0) {
                return [];
            }

            // Find best priority Exchange
            mxRecords.sort((a, b) => a.priority - b.priority);
            const bestExchange = mxRecords[0].exchange.toLowerCase();

            // Costruire SerpResult sintetico
            const results: SerpResult[] = [];
            const isGoogleOrMicrosoft = bestExchange.includes('google') || bestExchange.includes('outlook') || bestExchange.includes('protection.app');

            // A prescindere da chi è l'host mail, se il dominio base risponde all'MX, è un dominio vitale in possesso di un'azienda.
            results.push({
                url: `https://www.${domainToProbe}`,
                title: `${domainToProbe} (MX Extracted)`,
                source: 'dns_mx',
                metadata: {
                    isEnterpriseMail: isGoogleOrMicrosoft,
                    mxHost: bestExchange
                }
            } as any);

            Logger.info(`[MxDiscoveryProvider] Extracted valid domain from MX: https://www.${domainToProbe}`);
            return results;

        } catch (e) {
            // ECONNREFUSED or ENOTFOUND is expected if domain doesn't exist
            return [];
        }
    }

    async getCredits(): Promise<number> {
        return Infinity;
    }
}
