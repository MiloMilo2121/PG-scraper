import * as os from 'os';

export enum PhaseType {
    BROWSER = 'BROWSER',
    NETWORK = 'NETWORK',
    CPU = 'CPU'
}

export class ResourceManager {
    private static instance: ResourceManager;

    private constructor() { }

    public static getInstance(): ResourceManager {
        if (!ResourceManager.instance) {
            ResourceManager.instance = new ResourceManager();
        }
        return ResourceManager.instance;
    }

    /**
     * Dynamic concurrency based on actual OS resources.
     * Uses available memory and CPU count to recommend safe parallelism.
     */
    public getRecommendedConcurrency(phase: PhaseType): number {
        const cpuCount = (os as any).availableParallelism?.() || os.cpus().length;
        const freeMemMb = os.freemem() / (1024 * 1024);
        const totalMemMb = os.totalmem() / (1024 * 1024);
        const memoryPressure = freeMemMb / totalMemMb; // 0-1, higher = more free

        switch (phase) {
            case PhaseType.BROWSER: {
                // Each browser tab ~150-300MB. Be conservative.
                const memBasedLimit = Math.floor(freeMemMb / 300);
                const cpuBasedLimit = Math.max(2, cpuCount - 1);
                const limit = Math.min(memBasedLimit, cpuBasedLimit);
                // Clamp to reasonable range
                return Math.max(2, Math.min(limit, 12));
            }
            case PhaseType.NETWORK: {
                // Network I/O is not CPU/memory bound, but too many sockets can fail
                const base = memoryPressure > 0.3 ? 25 : 15;
                return Math.max(5, Math.min(base, cpuCount * 4));
            }
            case PhaseType.CPU: {
                return Math.max(2, cpuCount - 1);
            }
            default:
                return 5;
        }
    }
}
