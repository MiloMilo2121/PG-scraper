export interface ProviderAdapter {
    execute<T>(payload: any, options?: any): Promise<T>;
    costPerRequest: number;
    tier: number;
}
