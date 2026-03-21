import { ProviderAdapter } from '../../shared-runtime/routing/provider_adapter';
import { buildHttpProviderEntries } from './providers/http_provider_registry';
import { buildLlmProviderEntries } from './providers/llm_provider_registry';
import { buildSerpProviderEntries } from './providers/serp_provider_registry';

export function buildProviderMap(): Map<string, ProviderAdapter> {
    return new Map([
        ...buildSerpProviderEntries(),
        ...buildHttpProviderEntries(),
        ...buildLlmProviderEntries(),
    ]);
}
