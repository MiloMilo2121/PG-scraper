
import axios from 'axios';
import { Logger } from '../../utils/logger';

export class GhostHunter {
    private static instance: GhostHunter;
    private readonly WAYBACK_API = 'https://archive.org/wayback/available';

    private constructor() { }

    public static getInstance(): GhostHunter {
        if (!GhostHunter.instance) {
            GhostHunter.instance = new GhostHunter();
        }
        return GhostHunter.instance;
    }

    /**
     * Checks if a snapshot exists for the given URL.
     */
    public async checkSnapshot(url: string): Promise<string | null> {
        try {
            const response = await axios.get(this.WAYBACK_API, {
                params: { url: url }
            });

            if (response.data && response.data.archived_snapshots && response.data.archived_snapshots.closest) {
                const snapshotUrl = response.data.archived_snapshots.closest.url;
                Logger.info(`[GhostHunter] 👻 Found snapshot for ${url}: ${snapshotUrl}`);
                return snapshotUrl;
            }
        } catch (e: any) {
            Logger.warn(`[GhostHunter] Failed to check snapshot: ${e.message}`);
        }
        return null;
    }

    /**
     * Recovers content from the dead URL by fetching its ghost.
     */
    public async recover(url: string): Promise<string | null> {
        const snapshotUrl = await this.checkSnapshot(url);
        if (!snapshotUrl) return null;

        try {
            const response = await axios.get(snapshotUrl);
            return response.data; // HTML content
        } catch (e: any) {
            Logger.warn(`[GhostHunter] Failed to fetch ghost content: ${e.message}`);
            return null;
        }
    }
}
