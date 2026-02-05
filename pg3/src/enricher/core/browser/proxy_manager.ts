/**
 * 🌐 TIERED PROXY MANAGER
 * Task 16: Intelligent proxy rotation based on target difficulty
 * 
 * Tiers:
 * - RESIDENTIAL: Expensive, high quality. For Google, PagineGialle, LinkedIn
 * - DATACENTER: Cheap, lower quality. For company websites
 * - DIRECT: No proxy. For low-risk or testing
 */

import { Logger } from '../../utils/logger';
import { config } from '../../config';

// Extract proxy config with fallbacks
const PROXY_RESIDENTIAL_URL = process.env.PROXY_RESIDENTIAL_URL;
const PROXY_DATACENTER_URL = process.env.PROXY_DATACENTER_URL;

export enum ProxyTier {
    RESIDENTIAL = 'RESIDENTIAL',
    DATACENTER = 'DATACENTER',
    DIRECT = 'DIRECT',
}

export interface ProxyConfig {
    server?: string;
    username?: string;
    password?: string;
}

// Hard targets that need residential proxies
const HARD_TARGETS = [
    'google.com',
    'google.it',
    'bing.com',
    'paginegialle.it',
    'linkedin.com',
    'facebook.com',
    'instagram.com',
    'reportaziende.it',
    'ufficiocamerale.it',
];

export class ProxyManager {
    private static instance: ProxyManager;
    private residentialProxy: string | undefined;
    private datacenterProxy: string | undefined;
    private rotationIndex = 0;
    private failedProxies: Set<string> = new Set();

    private constructor() {
        this.residentialProxy = PROXY_RESIDENTIAL_URL;
        this.datacenterProxy = PROXY_DATACENTER_URL;

        if (this.residentialProxy) {
            Logger.info('🏠 Residential proxy configured');
        }
        if (this.datacenterProxy) {
            Logger.info('🏢 Datacenter proxy configured');
        }
        if (!this.residentialProxy && !this.datacenterProxy) {
            Logger.warn('⚠️ No proxies configured - using DIRECT connections');
        }
    }

    public static getInstance(): ProxyManager {
        if (!ProxyManager.instance) {
            ProxyManager.instance = new ProxyManager();
        }
        return ProxyManager.instance;
    }

    /**
     * 🎯 Get appropriate proxy tier for a URL
     */
    public getTierForUrl(url: string): ProxyTier {
        try {
            const hostname = new URL(url).hostname.toLowerCase();

            // Check if it's a hard target
            for (const target of HARD_TARGETS) {
                if (hostname.includes(target)) {
                    return ProxyTier.RESIDENTIAL;
                }
            }

            // Everything else uses datacenter or direct
            return this.datacenterProxy ? ProxyTier.DATACENTER : ProxyTier.DIRECT;
        } catch {
            return ProxyTier.DATACENTER;
        }
    }

    /**
     * 🔄 Get proxy configuration for a URL
     */
    public getProxyForUrl(url: string): ProxyConfig {
        const tier = this.getTierForUrl(url);
        return this.getProxyForTier(tier);
    }

    /**
     * 🔌 Get proxy for specific tier
     */
    public getProxyForTier(tier: ProxyTier): ProxyConfig {
        let proxyUrl: string | undefined;

        switch (tier) {
            case ProxyTier.RESIDENTIAL:
                proxyUrl = this.residentialProxy || this.datacenterProxy;
                break;
            case ProxyTier.DATACENTER:
                proxyUrl = this.datacenterProxy || this.residentialProxy;
                break;
            case ProxyTier.DIRECT:
                return {}; // No proxy
        }

        if (!proxyUrl) return {};

        return this.parseProxyUrl(proxyUrl);
    }

    /**
     * 📊 Parse proxy URL into components
     */
    private parseProxyUrl(proxyUrl: string): ProxyConfig {
        try {
            const url = new URL(proxyUrl);
            return {
                server: `${url.protocol}//${url.host}`,
                username: url.username || undefined,
                password: url.password || undefined,
            };
        } catch {
            // Try simple format: host:port:user:pass
            const parts = proxyUrl.split(':');
            if (parts.length >= 2) {
                return {
                    server: `http://${parts[0]}:${parts[1]}`,
                    username: parts[2],
                    password: parts[3],
                };
            }
            return { server: proxyUrl };
        }
    }

    /**
     * ❌ Mark proxy as failed for temporary exclusion
     */
    public markFailed(proxyUrl: string): void {
        this.failedProxies.add(proxyUrl);
        Logger.warn(`🚫 Proxy marked as failed: ${proxyUrl}`);

        // Auto-clear after 5 minutes
        setTimeout(() => {
            this.failedProxies.delete(proxyUrl);
        }, 5 * 60 * 1000);
    }

    /**
     * 📃 Get Puppeteer launch args for proxy
     */
    public getLaunchArgsForUrl(url: string): string[] {
        const proxy = this.getProxyForUrl(url);
        if (!proxy.server) return [];

        return [`--proxy-server=${proxy.server}`];
    }

    /**
     * 🔐 Get auth credentials for page
     */
    public async authenticateProxy(page: any, url: string): Promise<void> {
        const proxy = this.getProxyForUrl(url);
        if (proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password,
            });
        }
    }
}

export const proxyManager = ProxyManager.getInstance();
