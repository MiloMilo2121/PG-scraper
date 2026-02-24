import dns from 'dns';
import { promisify } from 'util';
import { Logger } from '../../../utils/logger';

const resolve4 = promisify(dns.resolve4);

export interface DnsResolutionResult {
    domain: string;
    alive: boolean;
    ip?: string;
}

export class HyperGuesserVXResolver {

    /**
     * Pings a list of domains across the network leveraging local DNS.
     * Max concurrency is enforced to avoid EMFILE or network flooding.
     */
    static async resolveBatch(domains: string[], maxConcurrency = 50): Promise<DnsResolutionResult[]> {
        const results: DnsResolutionResult[] = [];
        const chunks = this.chunkArray(domains, maxConcurrency);

        Logger.info(`[HyperGuesserVX] Starting DNS sweep on ${domains.length} candidates in ${chunks.length} batches...`);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(domain => this.checkDomain(domain));
            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        const aliveCount = results.filter(r => r.alive).length;
        Logger.info(`[HyperGuesserVX] DNS sweep complete. Found ${aliveCount} alive domains out of ${domains.length}.`);

        return results.filter(r => r.alive);
    }

    private static async checkDomain(domain: string): Promise<DnsResolutionResult> {
        try {
            // DNS resolution is extremely fast using local UDP queries
            const addresses = await resolve4(domain);
            if (addresses && addresses.length > 0) {
                // If it resolves, it's alive (it could still be a parked domain, handled later)
                return { domain, alive: true, ip: addresses[0] };
            }
            return { domain, alive: false };
        } catch (e: any) {
            // ENOTFOUND or similar means the domain is dead/unregistered
            return { domain, alive: false };
        }
    }

    private static chunkArray<T>(array: T[], size: number): T[][] {
        const chunked = [];
        for (let i = 0; i < array.length; i += size) {
            chunked.push(array.slice(i, i + size));
        }
        return chunked;
    }
}
