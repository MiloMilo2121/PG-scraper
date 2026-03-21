export type ProviderTaskFamily = 'SERP' | 'PROXY_FETCH' | 'LLM';
export type ProviderOrderByFamily = Partial<Record<ProviderTaskFamily, readonly string[]>>;

export interface ProviderAdapter {
    family: ProviderTaskFamily;
    execute<T>(payload: any, options?: any): Promise<T>;
    costPerRequest: number;
    tier: number;
}
