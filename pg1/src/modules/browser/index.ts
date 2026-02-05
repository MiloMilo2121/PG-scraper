import { ClusterManager } from './cluster';

// Ninja Core Exports
export { ClusterManager };
export { BrowserFactory, browserFactory } from './factory_v2';
export { GeneticFingerprinter } from './genetic_fingerprinter';
export { HumanBehavior } from './human_behavior';
export { BrowserEvasion } from './evasion';
export { ProxyManager, ProxyTier } from './proxy_manager';

export class PuppeteerWrapper {
    public static async fetch(url: string): Promise<{ content: string; status: number; finalUrl: string }> {
        return ClusterManager.fetch(url);
    }

    public static async close() {
        return ClusterManager.close();
    }
}
