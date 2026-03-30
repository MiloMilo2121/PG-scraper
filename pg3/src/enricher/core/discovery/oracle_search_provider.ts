import { SearchProvider } from './search_provider';
import { SerpResult, GoogleSerpAnalyzer } from './serp_analyzer';
import { Logger } from '../../utils/logger';
import { OracleClient } from '../../utils/oracle_client';
import { Retry } from '../../../utils/decorators';

/**
 * 🐍 OMEGA ORACLE SEARCH PROVIDER (Crawl4AI V9 Bypass)
 * Uses the Python Oracle sidecar with Crawl4AI (magic=True) 
 * to bypass Datadome/Cloudflare and extract 100% of Google Search results.
 * 
 * Cost: 0 (Local compute / Hetzner Proxies)
 */
export class OracleSearchProvider implements SearchProvider {
    
    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string): Promise<SerpResult[]> {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=it&gl=IT`;
        Logger.info(`[OracleSerp] 🕵️‍♂️ Delegating query to Python Oracle: "${query}"`);

        try {
            // The Oracle (with magic=True) naturally handles the Google popup in most cases.
            // We no longer rely on 'div.g' because Google's DOM has shifted to '.yuRUbf', etc.
            const response = await OracleClient.fetchHtmlStealth(searchUrl, 60000);
            
            if (!response.success || !response.html) {
                Logger.warn(`[OracleSerp] 🚨 Oracle extraction failed or returned empty HTML for: "${query}"`);
                throw new Error('ORACLE_EXTRACTION_FAILED');
            }

            // The Oracle bypassed the blocks successfully. Now we parse the raw HTML.
            const results = await GoogleSerpAnalyzer.parseSerp(response.html);
            
            Logger.info(`[OracleSerp] ✅ Success: Extracted ${results.length} valid results via Crawl4AI.`);
            
            return results;
            
        } catch (error: any) {
            Logger.error(`[OracleSerp] ❌ Oracle Search Error: ${error.message}`);
            throw error;
        }
    }
}
