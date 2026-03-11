/**
 * 🌐 OMEGA V9: THE WATERFALL PROXY MANAGER
 * Task 16/V9: Intelligent cascading proxy routing based on threat level and history.
 * 
 * Tiers:
 * - TIER 1 (DATACENTER/ISP): Volume brute-force. Cheap, IPv6 capable. (ex: Datacenter pool)
 * - TIER 2 (RESIDENTIAL): Evasion standard. High quality, masks as clean user. (ex: Decodo)
 * - TIER 3 (MOBILE 5G): Extreme evasion & Geo-locking. (ex: ProxyEmpire 5G / IPRoyal Padova)
 * - DIRECT: No proxy. Testing only.
 */

import { Logger } from '../../utils/logger';
import { config } from '../../config';

// V9 Configuration Injection (Must match .env laws)
const PROXY_DATACENTER_URL = process.env.PROXY_DATACENTER_URL;
const PROXY_RESIDENTIAL_URL = process.env.PROXY_RESIDENTIAL_URL;
const PROXY_MOBILE_URL = process.env.PROXY_MOBILE_URL; // V9 Addition

export enum ProxyTier {
    DATACENTER = 'DATACENTER', // Tier 1
    RESIDENTIAL = 'RESIDENTIAL', // Tier 2
    MOBILE = 'MOBILE',         // Tier 3
    DIRECT = 'DIRECT',
}

export interface ProxyConfig {
    server?: string;
    username?: string;
    password?: string;
}

// Target Threat Matrix
const THREAT_MATRIX = {
    EXTREME: [
        'instagram.com',
        'facebook.com',
        'tiktok.com',
        'kasada.io', // Test target
    ],
    HIGH: [
        'google.com',
        'google.it',
        'bing.com',
        'paginegialle.it',
        'linkedin.com',
        'reportaziende.it',
        'ufficiocamerale.it',
    ]
};

export class ProxyManagerV9 {
    private static instance: ProxyManagerV9;

    // Core Pools
    private datacenterPool: string[] = [];
    private residentialPool: string[] = [];
    private mobilePool: string[] = [];
    private nextProxyIndex: Map<ProxyTier, number> = new Map();

    // Telemetry & State
    private failedProxies: Set<string> = new Set();
    private failedProxyTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly failureCooldownMs: number;

    private constructor() {
        const disabled = process.env.DISABLE_PROXY === 'true';
        this.failureCooldownMs = config.proxy.failureCooldownMs || 60000;

        if (disabled) {
            Logger.info('🛡️ OMEGA V9: DISABLE_PROXY=true - Waterfall routing suspended.');
            return;
        }

        // Initialize Pools
        this.datacenterPool = this.parseProxyPool(PROXY_DATACENTER_URL);
        this.residentialPool = this.parseProxyPool(PROXY_RESIDENTIAL_URL);
        this.mobilePool = this.parseProxyPool(PROXY_MOBILE_URL);

        Logger.info('🌊 OMEGA V9 Proxy Manager Initialized');
        if (this.datacenterPool.length > 0) Logger.info(` ├─ Tier 1: Datacenter Active (${this.datacenterPool.length} nodes)`);
        if (this.residentialPool.length > 0) Logger.info(` ├─ Tier 2: Residential Active (${this.residentialPool.length} nodes)`);
        if (this.mobilePool.length > 0) Logger.info(` └─ Tier 3: Mobile 5G Active (${this.mobilePool.length} nodes)`);

        if (this.datacenterPool.length === 0 && this.residentialPool.length === 0 && this.mobilePool.length === 0) {
            Logger.warn('⚠️ CRITICAL: No proxy pools configured. OMEGA V9 operating bare-metal (DIRECT).');
        }
    }

    public static getInstance(): ProxyManagerV9 {
        if (!ProxyManagerV9.instance) {
            ProxyManagerV9.instance = new ProxyManagerV9();
        }
        return ProxyManagerV9.instance;
    }

    /**
     * 🎯 WATERFALL ROUTING LOGIC (The Brain)
     * Determines the optimal tier based on target difficulty and current state.
     */
    public getOptimalTier(url: string, requiresFallback: boolean = false): ProxyTier {
        if (process.env.DISABLE_PROXY === 'true') {
            return ProxyTier.DIRECT;
        }

        try {
            const hostname = new URL(url).hostname.toLowerCase();

            // 1. Extreme Threat ➔ Force Tier 3 (Mobile)
            if (THREAT_MATRIX.EXTREME.some(t => hostname.includes(t))) {
                return this.mobilePool.length > 0 ? ProxyTier.MOBILE : ProxyTier.RESIDENTIAL;
            }

            // 2. High Threat ➔ Force Tier 2 (Residential)
            if (THREAT_MATRIX.HIGH.some(t => hostname.includes(t))) {
                // If standard residential fails on a high threat, escalate to Mobile
                if (requiresFallback) {
                    Logger.info(`⚡ OMEGA V9 Escalation: High target fallback requested. Routing to MOBILE.`);
                    return this.mobilePool.length > 0 ? ProxyTier.MOBILE : ProxyTier.RESIDENTIAL;
                }
                return this.residentialPool.length > 0 ? ProxyTier.RESIDENTIAL : ProxyTier.DATACENTER;
            }

            // 3. Normal Threat (Datacenter default, unless fallback requested)
            if (requiresFallback) {
                Logger.info(`⚡ OMEGA V9 Fallback: Standard target rejected. Routing to RESIDENTIAL.`);
                return this.residentialPool.length > 0 ? ProxyTier.RESIDENTIAL : ProxyTier.DATACENTER;
            }

            return this.datacenterPool.length > 0 ? ProxyTier.DATACENTER : ProxyTier.DIRECT;

        } catch {
            return ProxyTier.DATACENTER; // Default safe fallback for malformed URLs
        }
    }

    /**
     * 🔄 Get formulated proxy configuration for an engine (Playwright/Axios etc)
     */
    public getProxyConfig(url: string, requiresFallback: boolean = false): ProxyConfig {
        const tier = this.getOptimalTier(url, requiresFallback);
        return this.getProxyForTier(tier);
    }

    /**
     * 🔌 Extract raw string by tier
     */
    public getProxyForTier(tier: ProxyTier): ProxyConfig {
        const proxyUrl = this.selectProxyUrl(tier);

        if (!proxyUrl) return {};
        return this.parseProxyUrl(proxyUrl);
    }

    /**
     * 📊 Safe parsing of complex proxy strings (handles special chars in pass)
     */
    private parseProxyUrl(proxyUrl: string): ProxyConfig {
        try {
            const url = new URL(proxyUrl);
            return {
                server: `${url.protocol}//${url.host}`,
                username: url.username ? decodeURIComponent(url.username) : undefined,
                password: url.password ? decodeURIComponent(url.password) : '',
            };
        } catch {
            // Legacy/raw format handler: host:port:user:pass
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
     * ❌ Circuit Breaker: Temporarily mark a specific proxy node as dead
     */
    public markFailed(proxyUrl: string): void {
        this.failedProxies.add(proxyUrl);
        Logger.warn(`🚫 OMEGA V9 Circuit Breaker: Node marked as failed: ${this.redactProxy(proxyUrl)}`);

        // Reset existing timers
        const existingTimer = this.failedProxyTimers.get(proxyUrl);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Setup cooldown
        const timer = setTimeout(() => {
            this.failedProxies.delete(proxyUrl);
            this.failedProxyTimers.delete(proxyUrl);
            Logger.info(`♻️ Node restored to pool: ${this.redactProxy(proxyUrl)}`);
        }, this.failureCooldownMs);

        this.failedProxyTimers.set(proxyUrl, timer);
    }

    /**
     * 📃 Playwright adapter output
     */
    public getPlaywrightProxy(url: string, requiresFallback: boolean = false): { server: string; username?: string; password?: string } | undefined {
        const proxy = this.getProxyConfig(url, requiresFallback);
        if (!proxy.server) return undefined;

        const config: { server: string; username?: string; password?: string } = { server: proxy.server };
        if (proxy.username) {
            config.username = proxy.username;
            config.password = proxy.password || '';
        }
        return config;
    }

    /**
     * Memory safety
     */
    public dispose(): void {
        for (const timer of this.failedProxyTimers.values()) {
            clearTimeout(timer);
        }
        this.failedProxyTimers.clear();
        this.failedProxies.clear();
    }

    private parseProxyPool(proxyPool?: string): string[] {
        if (!proxyPool) {
            return [];
        }

        return proxyPool
            .split(/[\n,;]+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    private selectProxyUrl(tier: ProxyTier): string | undefined {
        if (tier === ProxyTier.DIRECT) {
            return undefined;
        }

        const tierCandidates = this.getTierCandidateOrder(tier);

        for (const candidateTier of tierCandidates) {
            const healthy = this.getHealthyPool(candidateTier);
            const selected = this.pickFromPool(candidateTier, healthy);
            if (selected) {
                return selected;
            }
        }

        // If every node is in cooldown, allow a last-resort selection to avoid total outage.
        for (const candidateTier of tierCandidates) {
            const selected = this.pickFromPool(candidateTier, this.getPool(candidateTier));
            if (selected) {
                return selected;
            }
        }

        return undefined;
    }

    private getTierCandidateOrder(tier: ProxyTier): ProxyTier[] {
        switch (tier) {
            case ProxyTier.MOBILE:
                return [ProxyTier.MOBILE, ProxyTier.RESIDENTIAL, ProxyTier.DATACENTER];
            case ProxyTier.RESIDENTIAL:
                return [ProxyTier.RESIDENTIAL, ProxyTier.DATACENTER];
            case ProxyTier.DATACENTER:
                return [ProxyTier.DATACENTER, ProxyTier.RESIDENTIAL];
            case ProxyTier.DIRECT:
                return [];
        }
    }

    private getPool(tier: ProxyTier): string[] {
        switch (tier) {
            case ProxyTier.MOBILE:
                return this.mobilePool;
            case ProxyTier.RESIDENTIAL:
                return this.residentialPool;
            case ProxyTier.DATACENTER:
                return this.datacenterPool;
            case ProxyTier.DIRECT:
                return [];
        }
    }

    private getHealthyPool(tier: ProxyTier): string[] {
        return this.getPool(tier).filter((proxyUrl) => !this.failedProxies.has(proxyUrl));
    }

    private pickFromPool(tier: ProxyTier, pool: string[]): string | undefined {
        if (pool.length === 0) {
            return undefined;
        }

        const currentIndex = this.nextProxyIndex.get(tier) || 0;
        const proxyUrl = pool[currentIndex % pool.length];
        this.nextProxyIndex.set(tier, (currentIndex + 1) % pool.length);
        return proxyUrl;
    }

    private redactProxy(proxyUrl: string): string {
        try {
            const parsed = new URL(proxyUrl);
            if (parsed.username) parsed.username = '***';
            if (parsed.password) parsed.password = '***';
            return parsed.toString();
        } catch {
            return proxyUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
        }
    }
}

// Export singleton instance as the new standard
export const proxyManagerV9 = ProxyManagerV9.getInstance();
