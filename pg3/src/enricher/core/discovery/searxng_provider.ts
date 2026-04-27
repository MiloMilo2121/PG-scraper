import * as cheerio from 'cheerio';
import { SearchProvider } from './search_provider';
import { SerpResult } from './serp_analyzer';
import { Logger } from '../../utils/logger';
import { Retry } from '../../../utils/decorators';
import { TorBrowser } from '../../../scraper/core/browser/tor_browser';
import { TorError } from '../../../utils/errors';
import { CaptchaSolver } from '../../../shared-runtime/security/CaptchaSolver';

export class SearXNGProvider implements SearchProvider {
    id = 'SEARXNG-NET-1';
    tier = 1; // High priority, reliable Google bridge
    costPerRequest = 0;

    // Pool of highly-rated, public SearXNG instances. 
    // We rotate them on every request to naturally distribute the load and evade IP bans.
    private defaultInstances: string[] = [
        'https://www.google.it/search'
    ];

    private currentIdx = 0;

    private getNextInstance(): string {
        // Here to keep signature compatibility, but we just use Google endpoint
        return this.defaultInstances[0];
    }

    @Retry({ attempts: 3, delay: 5000, backoff: 'exponential' })
    async search(query: string, maxResults: number = 20): Promise<SerpResult[]> {
        const torBrowser = TorBrowser.getInstance();
        const torReady = await torBrowser.isControlPortAvailable();
        if (!torReady) {
            throw new TorError('Tor ControlPort 9051 is not reachable. Direct Google search unavailable.', false);
        }

        const instance = this.getNextInstance();
        // Native Google IT Search string bypass
        const url = `${instance}?q=${encodeURIComponent(query)}&hl=it&num=${maxResults}`;

        let page;
        try {
            page = await torBrowser.getPage();
            Logger.info(`[SearXNGProvider] Querying node ${instance} via TorBrowser: ${query}`);

            // Force navigation with generous timeout to allow Cloudflare-like redirects
            const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });

            // Allow native JS interaction for consent pages and captchas
            try {
                // Aspetta l'effettivo HTML con i risultati
                await page.waitForSelector('#main, #search, .g', { timeout: 15000 });
                Logger.info(`[SearXNGProvider] Result container loaded natively from Google`);
            } catch (authTimeout) {
                Logger.info(`[SearXNGProvider] Timeout waiting for results container. Proceeding to evaluate.`);
            }

            // Reject Google Consent popup via JS if it obscures the page
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                const rejectBtn = buttons.find(b => b.textContent?.toLowerCase().includes('rifiuta'));
                if (rejectBtn) (rejectBtn as HTMLElement).click();
            }).catch(() => { });

            // Extract natively from Puppeteer JS Engine parsing the real browser DOM, ignoring SSR cheating
            const processedResults: SerpResult[] = await page.evaluate(() => {
                const results: SerpResult[] = [];
                const seen = new Set<string>();

                // Match the Google structural anchors (organic results)
                document.querySelectorAll('.g, .BNeawe').forEach((container) => {
                    const anchor = container.querySelector('a');
                    if (!anchor) return;

                    const rawUrl = anchor.href;
                    // Extract h3 title
                    const titleEl = anchor.querySelector('h3') || container.querySelector('.BNeawe');
                    const title = titleEl ? titleEl.textContent?.trim() : '';

                    if (!rawUrl || !title || rawUrl.startsWith('/')) return;

                    const cleanUrl = rawUrl.split('#')[0].split('?')[0].trim();
                    if (cleanUrl.startsWith('http') && !cleanUrl.includes('google.com/url') && !seen.has(cleanUrl)) {
                        seen.add(cleanUrl);
                        results.push({ url: cleanUrl, title: title, source: 'searxng' } as any);
                    }
                });
                return results;
            });

            if (processedResults.length === 0) {
                Logger.warn(`[SearXNGProvider] Google blocked us. Attempting 2Captcha bypass...`);
                const solved = await CaptchaSolver.neutralizeGatekeeper(page);
                
                if (solved) {
                    Logger.info(`[SearXNGProvider] Captcha solved! Re-evaluating results...`);
                    // Retry extracting natively
                    const retryResults: SerpResult[] = await page.evaluate(() => {
                        const results: any[] = [];
                        const seen = new Set<string>();
                        document.querySelectorAll('.g, .BNeawe').forEach((container) => {
                            const anchor = container.querySelector('a');
                            if (!anchor) return;
                            const rawUrl = anchor.href;
                            const titleEl = anchor.querySelector('h3') || container.querySelector('.BNeawe');
                            const title = titleEl ? titleEl.textContent?.trim() : '';
                            if (!rawUrl || !title || rawUrl.startsWith('/')) return;
                            const cleanUrl = rawUrl.split('#')[0].split('?')[0].trim();
                            if (cleanUrl.startsWith('http') && !cleanUrl.includes('google.com/url') && !seen.has(cleanUrl)) {
                                seen.add(cleanUrl);
                                results.push({ url: cleanUrl, title: title, source: 'searxng' });
                            }
                        });
                        return results;
                    });
                    
                    if (retryResults.length > 0) {
                        Logger.info(`[SearXNGProvider] Recovery successful: ${retryResults.length} organic outcomes.`);
                        return maxResults ? retryResults.slice(0, maxResults) : retryResults;
                    }
                }
                
                Logger.warn(`[SearXNGProvider] Bypass failed or 0 results still. Throwing to rotate Tor IP.`);
                throw new Error(`SEARXNG_BLOCK: Google CAPTCHA or blocked IP detected.`);
            }

            Logger.info(`[SearXNGProvider] Success natively extracted: ${processedResults.length} organic outcomes.`);
            return maxResults ? processedResults.slice(0, maxResults) : processedResults;

        } catch (e: unknown) {
            Logger.warn(`[SearXNGProvider] Search Error: ${(e as Error).message}`);
            // If it's a block, rotate IP to burn the bridge and try the next node
            if ((e as Error).message.includes('SEARXNG_BLOCK') || (e as Error).message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
                await torBrowser.rotateIP();
            }
            throw e;
        } finally {
            if (page) await page.close().catch(() => { });
        }
    }

    async getCredits(): Promise<number> {
        return Infinity;
    }
}
