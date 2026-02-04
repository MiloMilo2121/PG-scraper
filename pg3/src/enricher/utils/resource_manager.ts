
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

    public getRecommendedConcurrency(phase: PhaseType): number {
        switch (phase) {
            case PhaseType.BROWSER:
                return 5; // Default safe value
            case PhaseType.NETWORK:
                return 20;
            case PhaseType.CPU:
                return 10;
            default:
                return 5;
        }
    }
}
