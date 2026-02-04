
import { Browser, Page } from 'puppeteer';
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../company_types';
import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';
import { getRandomUserAgent } from './ua_db';
// Task 15-18: Content Filter
import { ContentFilter } from './content_filter';
// Task 26-30: Circuit Breaker
import { RateLimiter } from '../../utils/rate_limit';
import { CacheManager } from '../../utils/cache_manager';
// Task 21-25: Deep Scanner
import { DeepScanner } from './deep_scanner';
// Local piva logic
import { validatePiva } from '../../utils/piva_validator';
import * as fs from 'fs';

export class SearchService {
    private browserFactory: BrowserFactory;

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
    }

    public async findWebsite(company: CompanyInput): Promise<{ url: string | null; verification?: any }> {
        const queries = this.buildQueries(company);
        Logger.info(`[Search] Starting search for "${company.company_name}" (${queries.length} queries)`);

        for (const query of queries) {
            // 1. TRY GOOGLE (Primary)
            if (!RateLimiter.isBlocked('google')) {
                try {
                    Logger.info(`[Search] Trying Google: "${query}"`);
                    const results = await this.scrapeGoogleDIY(query);
                    if (results && results.length > 0) {
                        RateLimiter.reportSuccess('google');
                        for (const res of results) {
                            const verification = await this.deepVerify(res.link, company);
                            if (verification) return { url: res.link, verification };
                        }
                    } else {
                        RateLimiter.reportFailure('google');
                    }
                } catch (e) {
                    Logger.warn(`[Search] Google failed: ${(e as Error).message}`);
                    RateLimiter.reportFailure('google');
                }
            }

            // 2. TRY DUCKDUCKGO (Secondary)
            if (!RateLimiter.isBlocked('duckduckgo')) {
                try {
                    Logger.info(`[Search] Trying DDG: "${query}"`);
                    const results = await this.scrapeDDGDIY(query);
                    if (results && results.length > 0) {
                        RateLimiter.reportSuccess('duckduckgo');
                        for (const res of results) {
                            const verification = await this.deepVerify(res.link, company);
                            if (verification) return { url: res.link, verification };
                        }
                    } else {
                        RateLimiter.reportFailure('duckduckgo');
                    }
                } catch (e) {
                    Logger.warn(`[Search] DDG failed: ${(e as Error).message}`);
                    RateLimiter.reportFailure('duckduckgo');
                }
            }

            // 3. TRY BING (Fallback)
            if (!RateLimiter.isBlocked('bing')) {
                try {
                    Logger.info(`[Search] Trying Bing: "${query}"`);
                    const results = await this.scrapeBingDIY(query);
                    if (results && results.length > 0) {
                        RateLimiter.reportSuccess('bing');
                        for (const res of results) {
                            const verification = await this.deepVerify(res.link, company);
                            if (verification) return { url: res.link, verification };
                        }
                    } else {
                        RateLimiter.reportFailure('bing');
                    }
                } catch (e) {
                    Logger.warn(`[Search] Bing failed: ${(e as Error).message}`);
                    RateLimiter.reportFailure('bing');
                }
            }
        }

        return { url: null };
    }

    private buildQueries(company: any): string[] {
        const q = [];
        const name = company.company_name;
        if (name) q.push(`${name} ${company.city || ''} sito ufficiale`);
        const piva = (company as any).piva || (company as any).vat;
        if (piva) q.push(`Partita IVA ${piva}`);
        return q;
    }

    public async close(): Promise<void> { }

    private async scrapeGoogleDIY(query: string): Promise<any[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const encoded = encodeURIComponent(query);
            const url = `https://www.google.it/search?q=${encoded}&hl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const html = await page.content();
            const results = GoogleSerpAnalyzer.parseSerp(html);
            return results.map(r => ({ link: r.url, title: r.title }));
        } catch (e) {
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async scrapeDDGDIY(query: string): Promise<any[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const encoded = encodeURIComponent(query);
            const url = `https://html.duckduckgo.com/html?q=${encoded}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const html = await page.content();
            const results = DuckDuckGoSerpAnalyzer.parseSerp(html);
            return results.map(r => ({ link: r.url, title: r.title }));
        } catch (e) {
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async scrapeBingDIY(query: string): Promise<any[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const encoded = encodeURIComponent(query);
            const url = `https://www.bing.com/search?q=${encoded}&setlang=it&cc=it`;

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 2000));

            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.b_algo h2 a'));
                return items.map(a => ({ link: (a as HTMLAnchorElement).href, title: (a as HTMLElement).innerText }));
            });

            if (results.length === 0) {
                Logger.warn(`[Search] Bing returned 0 results for "${query}"`);
            }
            return results;
        } catch (e) {
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }

    private async deepVerify(url: string, company: CompanyInput): Promise<any | null> {
        if (ContentFilter.isDirectoryOrSocial(url)) return null;

        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

            const text = await page.evaluate(() => document.body.innerText);

            // Basic validity
            if (!ContentFilter.isValidContent(text).valid) return null;
            if (!ContentFilter.isItalianLanguage(text)) return null;

            // Simple PIVA extraction for validation
            const pivas: string[] = text.match(/\d{11}/g) || [];
            const targetPiva = (company as any).piva || (company as any).vat;
            const matches = targetPiva && pivas.includes(targetPiva);

            return {
                scraped_piva: pivas[0] || '',
                confidence: matches ? 0.9 : 0.4,
                level: matches ? 'High' : 'Low'
            };
        } catch (e) {
            return null;
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}
