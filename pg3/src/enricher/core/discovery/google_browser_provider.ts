import { SearchProvider } from './search_provider';
import { SerpResult, GoogleSerpAnalyzer } from './serp_analyzer';
import { BrowserFactory } from '../browser/factory_v2';
import { MemoryRateLimiter } from '../rate_limiter';
import { BlockClassifier, BlockType } from '../security/block_classifier';
import { Logger } from '../../utils/logger';
import { config } from '../../config';

/**
 * 🕵️‍♂️ GOOGLE BROWSER SEARCH PROVIDER (OMEGA 6.2-U)
 * Uses full stealth Puppeteer to scrape Google.
 * Highly restricted by Anti-Captcha policy (Law 606 & 607).
 */
export class GoogleBrowserProvider implements SearchProvider {
    // Shared rate limiter across all instances of this provider
    private static limiter: MemoryRateLimiter | null = null;
    private static consecutiveCaptchas = 0;
    private static forceDisabled = false;

    constructor() {
        if (!GoogleBrowserProvider.limiter) {
            const minDelay = Math.floor(1000 / config.browserEngineLimits.maxQueriesPerSec);
            // Default maxQueriesPerSec is 0.15 => 6666ms min delay between queries
            GoogleBrowserProvider.limiter = new MemoryRateLimiter(minDelay, 30000);
            Logger.info(`[GoogleBrowser] Stealth pacing activated. Min delay: ${minDelay}ms`);
        }
    }

    async search(query: string): Promise<SerpResult[]> {
        if (!config.features.googleBrowserEnabled || GoogleBrowserProvider.forceDisabled) {
            Logger.warn(`[GoogleBrowser] Skipped: Engine is currently DISABLED by feature flag or circuit breaker.`);
            return [];
        }

        const domain = 'google.com';

        // 1. Check Circuit Breaker
        if (BlockClassifier.isDomainHot(domain, 3)) {
            Logger.warn(`[GoogleBrowser] 🚨 Google domain is HOT. Skipping search for "${query}"`);
            return [];
        }

        // 2. Wait for stealth pacing slot
        await GoogleBrowserProvider.limiter!.waitForSlot(domain);

        const factory = BrowserFactory.getInstance();
        let page;

        try {
            Logger.info(`[GoogleBrowser] 🕵️‍♂️ Executing search: "${query}"`);
            page = await factory.newPage();

            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=it&gl=IT`;

            const response = await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            const status = response?.status() || 0;
            const content = await page.content();

            // 3. Classify potential blocks
            const blockSig = BlockClassifier.classify(status, content, searchUrl, 'google_browser');

            if (blockSig.type !== BlockType.NONE) {
                BlockClassifier.recordBlock(blockSig);
                GoogleBrowserProvider.limiter!.reportFailure(domain);

                if (blockSig.type === BlockType.CAPTCHA) {
                    GoogleBrowserProvider.consecutiveCaptchas++;
                    Logger.error(`[GoogleBrowser] 🛑 CAPTCHA HIT on: "${query}"`);

                    // Auto-disable circuit breaker if hit rate exceeds critical limit
                    // Since we process low volume, 2 consecutive captchas is enough to trip it
                    if (GoogleBrowserProvider.consecutiveCaptchas >= 2) {
                        Logger.fatal(`[GoogleBrowser] ☢️ CRITICAL CAPTCHA THRESHOLD EXCEEDED. Disabling engine globally.`);
                        GoogleBrowserProvider.forceDisabled = true;
                    }
                }

                throw new Error(`GoogleBrowser Blocked: ${blockSig.type}`);
            }

            // Success
            GoogleBrowserProvider.limiter!.reportSuccess(domain);
            GoogleBrowserProvider.consecutiveCaptchas = 0; // Reset captcha counter on success

            // 4. Parse SERP HTML
            const results = await GoogleSerpAnalyzer.parseSerp(content);
            Logger.info(`[GoogleBrowser] Found ${results.length} results for "${query}"`);

            return results;

        } catch (e: any) {
            // Classify structural/network errors
            if (!e.message.includes('GoogleBrowser Blocked')) {
                const errSig = BlockClassifier.classifyError(e, 'https://www.google.com', 'google_browser');
                BlockClassifier.recordBlock(errSig);
                Logger.warn(`[GoogleBrowser] Exception on search: ${e.message}`);
                GoogleBrowserProvider.limiter!.reportFailure(domain);
            }
            return [];
        } finally {
            if (page) {
                await page.close().catch(() => { });
            }
        }
    }
}
