export type ProviderTaskFamily = 'SERP' | 'PROXY_FETCH' | 'LLM';

export interface ProviderAdapter {
    family: ProviderTaskFamily;
    execute<T>(payload: any, options?: any): Promise<T>;
    costPerRequest: number;
    tier: number;
}
