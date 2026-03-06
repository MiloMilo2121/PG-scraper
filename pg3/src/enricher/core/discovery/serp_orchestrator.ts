/**
 * 🧠 OMEGA V9: THE SERP ORCHESTRATOR
 * Task 2.1: Abstracting Search Engine Results Pages (SERP) extraction.
 * 
 * WHY: Direct scraping of Google (via Playwright or simple HTTP) is obsolete, slow, 
 * and highly prone to CAPTCHA/Blocks. We now delegate to specialized SERP APIs.
 * 
 * Providers:
 * 1. Scrapingdog: Ultra-low latency (<2s). Used for time-critical lookups.
 * 2. Serper.dev: High reliability, low cost focused specifically on Google.
 * 3. Firecrawl: Deep semantic extraction (Markdown) ready for LLM/RAG pipelines.
 */

import { Logger } from '../../utils/logger';
import { config } from '../../config';
import axios from 'axios';

export interface ISerpResult {
    title: string;
    link: string;
    snippet?: string;
    position: number;
}

export enum SerpEngine {
    SCRAPINGDOG = 'SCRAPINGDOG',
    SERPER = 'SERPER',
    FIRECRAWL = 'FIRECRAWL' // Used for deep semantic extraction, not just URLs
}

export class SerpOrchestrator {
    private static instance: SerpOrchestrator;

    // API Keys mapped from environment
    private keys = {
        scrapingdog: process.env.SCRAPINGDOG_API_KEY,
        serper: process.env.SERPER_API_KEY,
        firecrawl: process.env.FIRECRAWL_API_KEY
    };

    private constructor() {
        Logger.info('🧠 OMEGA V9 SERP Orchestrator Initialized');
        if (!this.keys.scrapingdog && !this.keys.serper) {
            Logger.warn('⚠️ CRITICAL: No SERP API keys found. Discovery will fail.');
        }
    }

    public static getInstance(): SerpOrchestrator {
        if (!SerpOrchestrator.instance) {
            SerpOrchestrator.instance = new SerpOrchestrator();
        }
        return SerpOrchestrator.instance;
    }

    /**
     * Executes a search query using the optimal or requested engine.
     * Implements automatic failover if the primary engine fails.
     */
    public async search(query: string, enginePreference?: SerpEngine, limit: number = 10): Promise<ISerpResult[]> {
        let primaryEngine = enginePreference || this.getOptimalDefaultEngine();

        try {
            Logger.debug(`🔍 [SERP] Executing query: "${query}" via ${primaryEngine}`);
            return await this.executeSearch(query, primaryEngine, limit);
        } catch (error: any) {
            Logger.warn(`⚠️ [SERP] Engine ${primaryEngine} failed: ${error.message}. Attempting failover.`);

            // Failover logic
            const fallbackEngine = primaryEngine === SerpEngine.SCRAPINGDOG ? SerpEngine.SERPER : SerpEngine.SCRAPINGDOG;

            try {
                Logger.info(`🔄 [SERP] Failover to ${fallbackEngine}`);
                return await this.executeSearch(query, fallbackEngine, limit);
            } catch (fallbackError: any) {
                Logger.error(`❌ [SERP] All SERP engines failed for query: "${query}"`);
                throw new Error('SERP_EXHAUSTED');
            }
        }
    }

    private getOptimalDefaultEngine(): SerpEngine {
        // Prefer Serper for general Google queries due to stability and cost
        return this.keys.serper ? SerpEngine.SERPER : SerpEngine.SCRAPINGDOG;
    }

    private async executeSearch(query: string, engine: SerpEngine, limit: number): Promise<ISerpResult[]> {
        switch (engine) {
            case SerpEngine.SERPER:
                return this.searchSerper(query, limit);
            case SerpEngine.SCRAPINGDOG:
                return this.searchScrapingdog(query, limit);
            case SerpEngine.FIRECRAWL:
                return this.searchFirecrawl(query, limit);
            default:
                throw new Error(`Unsupported SERP Engine: ${engine}`);
        }
    }

    // --- Provider Implementations ---

    private async searchSerper(query: string, limit: number): Promise<ISerpResult[]> {
        if (!this.keys.serper) throw new Error('SERPER_KEY_MISSING');

        const response = await axios.post('https://google.serper.dev/search',
            { q: query, num: limit, gl: 'it', hl: 'it' }, // Hardcoded to Italy for OMEGA context
            { headers: { 'X-API-KEY': this.keys.serper, 'Content-Type': 'application/json' }, timeout: 5000 }
        );

        if (!response.data || !response.data.organic) return [];

        return response.data.organic.map((res: any, index: number) => ({
            title: res.title,
            link: res.link,
            snippet: res.snippet,
            position: index + 1
        })).slice(0, limit);
    }

    private async searchScrapingdog(query: string, limit: number): Promise<ISerpResult[]> {
        if (!this.keys.scrapingdog) throw new Error('SCRAPINGDOG_KEY_MISSING');

        const url = `https://api.scrapingdog.com/google?api_key=${this.keys.scrapingdog}&query=${encodeURIComponent(query)}&results=${limit}&country=it&language=it`;
        const response = await axios.get(url, { timeout: 6000 });

        if (!response.data || !response.data.organic_results) return [];

        return response.data.organic_results.map((res: any, index: number) => ({
            title: res.title,
            link: res.link,
            snippet: res.snippet,
            position: index + 1
        })).slice(0, limit);
    }

    private async searchFirecrawl(query: string, _limit: number): Promise<ISerpResult[]> {
        if (!this.keys.firecrawl) throw new Error('FIRECRAWL_KEY_MISSING');
        Logger.warn('FIRE CRAWL NOT YET FULLY IMPLEMENTED FOR RAW SEARCH. Returning empty.');
        // Firecrawl is typically used via SDK to convert an entire domain to markdown, not just SERP.
        // Implementation will follow based on specific LLM RAG agent needs.
        return [];
    }
}

export const serpOrchestrator = SerpOrchestrator.getInstance();
