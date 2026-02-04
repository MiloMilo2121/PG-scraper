import { ClusterManager } from './cluster';
export { ClusterManager };

export class PuppeteerWrapper {
    public static async fetch(url: string): Promise<{ content: string; status: number; finalUrl: string }> {
        return ClusterManager.fetch(url);
    }

    public static async close() {
        return ClusterManager.close();
    }
}
