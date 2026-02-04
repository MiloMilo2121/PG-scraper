import {
    ISearchProvider,
    IAnalysisProvider,
    IDiscoveryStrategy,
    AnalysisResult
} from './interfaces/types';
import { CompanyInput } from '../../company_types';
import { Logger } from '../../../utils/logger';
import { RateLimiter } from '../../../utils/rate_limit';
import { HyperGuesser } from '../hyper_guesser_v2';
import { ItalianRegistrySearch } from '../italian_registry';

export enum DiscoveryModeV4 {
    FAST_RUN1 = 'FAST',
    DEEP_RUN2 = 'DEEP',
    AGGRESSIVE_RUN3 = 'AGGRESSIVE',
    NUCLEAR_RUN4 = 'NUCLEAR'
}

export class UnifiedDiscoveryServiceV4 {
    private searchProviders: Map<string, ISearchProvider> = new Map();
    private analyzer: IAnalysisProvider;

    constructor(
        searchProviders: ISearchProvider[],
        analyzer: IAnalysisProvider
    ) {
        searchProviders.forEach(p => this.searchProviders.set(p.name, p));
        this.analyzer = analyzer;
    }

    public async discover(company: CompanyInput, mode: DiscoveryModeV4): Promise<AnalysisResult> {
        Logger.info(`[UnifiedV4] Analyzing "${company.company_name}" (Mode: ${mode})`);

        try {
            switch (mode) {
                case DiscoveryModeV4.FAST_RUN1:
                    return await this.executeFastRun(company);
                case DiscoveryModeV4.DEEP_RUN2:
                    return await this.executeDeepRun(company);
                // Implement others as needed
                default:
                    return this.createNotFound(company);
            }
        } catch (error) {
            Logger.error(`[UnifiedV4] Error processing ${company.company_name}`, error);
            return {
                isValid: false,
                confidence: 0,
                url: '',
                details: { method: 'EXCEPTION', error: (error as Error).message }
            };
        }
    }

    // ===================================
    // 🚀 RUN 1: FAST
    // ===================================
    private async executeFastRun(company: CompanyInput): Promise<AnalysisResult> {
        // 1. HyperGuesser
        const guesses = HyperGuesser.generate(company.company_name, company.city || '', company.province || '', company.category || '');
        const topGuesses = guesses.slice(0, 10);

        for (const url of topGuesses) {
            const res = await this.analyzer.analyze(url, company);
            if (res.isValid && res.confidence >= 0.9) return res;
        }

        // 2. Registries
        // (Keeping inline for now as it's specific)
        const regRes = await this.checkRegistries(company);
        if (regRes) return regRes;

        // 3. Search (Google -> DDG)
        const google = this.searchProviders.get('Google');
        if (google && !RateLimiter.isBlocked('google')) {
            const results = await google.search(`${company.company_name} ${company.city} sito ufficiale`, 3);
            if (results.length > 0) {
                RateLimiter.reportSuccess('google');
                const best = await this.validateResults(results, company, 0.8);
                if (best) return best;
            } else {
                RateLimiter.reportFailure('google');
            }
        }

        const ddg = this.searchProviders.get('DuckDuckGo');
        if (ddg && !RateLimiter.isBlocked('duckduckgo')) {
            const results = await ddg.search(`${company.company_name} ${company.city} sito ufficiale`, 3);
            if (results.length > 0) {
                const best = await this.validateResults(results, company, 0.8);
                if (best) return best;
            }
        }

        return this.createNotFound(company);
    }

    // ===================================
    // 🧠 RUN 2: DEEP
    // ===================================
    private async executeDeepRun(company: CompanyInput): Promise<AnalysisResult> {
        // Extended Guesses
        const guesses = HyperGuesser.generate(company.company_name, company.city || '', company.province || '', company.category || '');
        const remainingGuesses = guesses.slice(10);

        for (const url of remainingGuesses) {
            const res = await this.analyzer.analyze(url, company);
            if (res.isValid && res.confidence >= 0.85) return res;
        }

        // Deep Search (DDG + Bing)
        const engines = ['DuckDuckGo', 'Bing'];
        for (const name of engines) {
            const provider = this.searchProviders.get(name);
            if (provider) {
                const results = await provider.search(`${company.company_name} ${company.city} sito ufficiale`, 5);
                const best = await this.validateResults(results, company, 0.85);
                if (best) return best;
            }
        }

        return this.createNotFound(company);
    }

    private async checkRegistries(company: CompanyInput): Promise<AnalysisResult | null> {
        const registries = [
            `https://www.ufficiocamerale.it/search?q=${encodeURIComponent(company.company_name)}`,
            `https://www.informazione-aziende.it/search?q=${encodeURIComponent(company.company_name)}`
        ];

        for (const regUrl of registries) {
            try {
                const regRes = await ItalianRegistrySearch.extractFromRegistryPage(regUrl);
                if (regRes.website) {
                    const res = await this.analyzer.analyze(regRes.website, company);
                    if (res.isValid && res.confidence >= 0.8) return res;
                }
            } catch (e) { }
        }
        return null;
    }

    private async validateResults(results: any[], company: CompanyInput, threshold: number): Promise<AnalysisResult | null> {
        for (const r of results) {
            const res = await this.analyzer.analyze(r.url, company);
            if (res.isValid && res.confidence >= threshold) return res;
        }
        return null; // Return best invalid if needed?
    }

    private createNotFound(company: CompanyInput): AnalysisResult {
        return {
            isValid: false,
            confidence: 0,
            url: '',
            details: { method: 'NOT_FOUND' }
        };
    }
}
