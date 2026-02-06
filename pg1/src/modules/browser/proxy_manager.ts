/**
 * 🌐 PROXY MANAGER
 * Tiered proxy rotation for stealth
 * 
 * Tiers:
 * - RESIDENTIAL: For Google, PagineGialle (expensive but safe)
 * - DATACENTER: For company websites (cheap and fast)
 * - DIRECT: No proxy (local IP)
 * 
 * NINJA CORE - Shared between PG1 and PG3
 */

export enum ProxyTier {
    RESIDENTIAL = 'RESIDENTIAL',
    DATACENTER = 'DATACENTER',
    DIRECT = 'DIRECT',
}

export interface ProxyConfig {
    url: string;
    tier: ProxyTier;
    failCount: number;
    successCount: number;
    lastUsed: number;
}

// Extract from environment
const PROXY_RESIDENTIAL_URL = process.env.PROXY_RESIDENTIAL_URL;
const PROXY_DATACENTER_URL = process.env.PROXY_DATACENTER_URL;

export class ProxyManager {
    private static instance: ProxyManager;
    private residentialProxy?: string;
    private datacenterProxy?: string;
    private failedProxies: Set<string> = new Set();

    private constructor() {
        this.residentialProxy = PROXY_RESIDENTIAL_URL;
        this.datacenterProxy = PROXY_DATACENTER_URL;

        if (this.residentialProxy) {
            console.log('🏠 Residential proxy configured');
        }
        if (this.datacenterProxy) {
            console.log('🏢 Datacenter proxy configured');
        }
    }

    public static getInstance(): ProxyManager {
        if (!ProxyManager.instance) {
            ProxyManager.instance = new ProxyManager();
        }
        return ProxyManager.instance;
    }

    /**
     * assessNetworkStealth - Get optimal proxy for target
     */
    public getProxy(targetUrl: string): string | undefined {
        const tier = this.determineRequiredTier(targetUrl);
        const residentialAvailable = this.residentialProxy && !this.failedProxies.has(this.residentialProxy);
        const datacenterAvailable = this.datacenterProxy && !this.failedProxies.has(this.datacenterProxy);

        switch (tier) {
            case ProxyTier.RESIDENTIAL:
                return residentialAvailable ? this.residentialProxy : (datacenterAvailable ? this.datacenterProxy : undefined);
            case ProxyTier.DATACENTER:
                return datacenterAvailable ? this.datacenterProxy : (residentialAvailable ? this.residentialProxy : undefined);
            case ProxyTier.DIRECT:
            default:
                return undefined;
        }
    }

    /**
     * Determine required tier based on target
     */
    private determineRequiredTier(url: string): ProxyTier {
        let hostname = '';
        try {
            hostname = new URL(url).hostname.toLowerCase();
        } catch {
            return ProxyTier.DIRECT;
        }

        // High-security targets = Residential only
        const highSecurity = [
            'google.com', 'google.it',
            'paginegialle.it',
            'maps.google.com',
            'ufficiocamerale.it',
            'reportaziende.it',
            'trovaziende.it',
        ];

        if (highSecurity.some(h => hostname.includes(h))) {
            return ProxyTier.RESIDENTIAL;
        }

        // Company websites = Datacenter is fine
        if (!hostname.includes('google') && !hostname.includes('paginegialle')) {
            return ProxyTier.DATACENTER;
        }

        return ProxyTier.DATACENTER;
    }

    /**
     * Report proxy failure for rotation
     */
    public reportFailure(proxyUrl: string): void {
        if (!proxyUrl) return;
        this.failedProxies.add(proxyUrl);
        console.warn(`⚠️ Proxy marked as failed: ${proxyUrl}`);
    }

    /**
     * Report proxy success and re-enable it if previously failed
     */
    public reportSuccess(proxyUrl: string): void {
        if (!proxyUrl) return;
        if (this.failedProxies.delete(proxyUrl)) {
            console.log(`✅ Proxy restored: ${proxyUrl}`);
        }
    }

    /**
     * Check if we have any proxies available
     */
    public hasProxies(): boolean {
        return !!(this.residentialProxy || this.datacenterProxy);
    }

    /**
     * Get Puppeteer proxy args
     */
    public getProxyArgs(targetUrl: string): string[] {
        const proxy = this.getProxy(targetUrl);
        if (proxy) {
            return [`--proxy-server=${proxy}`];
        }
        return [];
    }
}
