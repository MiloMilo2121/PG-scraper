import { CompanyInput } from '../../../company_types';

export interface SearchResult {
    url: string;
    source: string;
    metadata?: any;
}

export interface AnalysisResult {
    isValid: boolean;
    confidence: number;
    url: string;
    details: {
        method: string;
        reason?: string;
        scraped_piva?: string;
        [key: string]: any;
    };
}

export interface ISearchProvider {
    name: string;
    search(query: string, limit?: number): Promise<SearchResult[]>;
}

export interface IAnalysisProvider {
    name: string;
    analyze(url: string, company: CompanyInput): Promise<AnalysisResult>;
}

export interface IPersistenceLayer {
    saveResult(company: CompanyInput, result: AnalysisResult): Promise<void>;
    loadPending(): Promise<CompanyInput[]>;
    markAsProcessed(companyId: string): Promise<void>;
}

export interface IDiscoveryStrategy {
    execute(company: CompanyInput): Promise<AnalysisResult>;
}
