
/**
 * 🔄 PROXY MANAGER 🔄
 * Task 4 & 5: Auto-rotate proxies on 403 Forbidden.
 */
import { PipelineConfig } from '../config/pipeline_config';

export class ProxyManager {
    private static instance: ProxyManager;
    private proxies: string[] = [];
    private currentIndex: number = 0;
    private banList: Set<string> = new Set();
    private failureCount: Map<string, number> = new Map();

    private constructor() {
        // Load proxies from config
        this.proxies = PipelineConfig.PROXIES || [];
        console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies.`);
    }

    public static getInstance(): ProxyManager {
        if (!ProxyManager.instance) {
            ProxyManager.instance = new ProxyManager();
        }
        return ProxyManager.instance;
    }

    get currentProxy(): string | undefined {
        if (this.proxies.length === 0) return undefined;
        // Find first non-banned proxy
        let attempts = 0;
        while (attempts < this.proxies.length) {
            const proxy = this.proxies[this.currentIndex];
            if (!this.banList.has(proxy)) {
                return proxy;
            }
            this.rotate();
            attempts++;
        }
        console.warn('[ProxyManager] All proxies are banned! Using direct connection.');
        return undefined;
    }

    rotate() {
        if (this.proxies.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        // console.log(`🔄 Proxy Rotated. New Proxy Index: ${this.currentIndex}`);
    }

    public reportFailure(proxy: string) {
        if (!proxy) return;
        const count = (this.failureCount.get(proxy) || 0) + 1;
        this.failureCount.set(proxy, count);

        // Task 4: Proxy Burn Alert
        if (count > 5) {
            console.warn(`[ProxyManager] 🔥 BURN ALERT: Proxy ${proxy} has failed 5 times. Blacklisting.`);
            this.banList.add(proxy);
            this.rotate();
        }
    }

    public reportSuccess(proxy: string) {
        if (!proxy) return;
        this.failureCount.set(proxy, 0);
    }
}
