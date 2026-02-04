
import { CompanyInput } from '../company_types';

export interface DiscoveryResult {
    url?: string;
    confidence: number;
    source: string;
    metadata?: any;
}

export interface IDiscoveryStrategy {
    name: string;
    execute(company: CompanyInput): Promise<DiscoveryResult[]>;
}
