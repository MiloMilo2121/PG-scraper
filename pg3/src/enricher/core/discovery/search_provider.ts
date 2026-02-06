
import { Page } from 'puppeteer';
import { BrowserFactory } from '../browser/factory_v2';
import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';

export interface SearchProvider {
    search(query: string): Promise<SerpResult[]>;
}

async function acceptGoogleConsentIfPresent(page: Page): Promise<void> {
    const clicked = await page.evaluate(() => {
        const buttons = Array.from(
            document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
        ) as Array<HTMLElement | HTMLInputElement>;

        const consentRegex = /(accetta tutto|accetta|accept all|i agree|agree)/i;
        for (const button of buttons) {
            const text = button.textContent?.trim() || (button as HTMLInputElement).value?.trim() || '';
            if (text && consentRegex.test(text)) {
                button.click();
                return true;
            }
        }

        return false;
    });

    if (!clicked) {
        return;
    }

    await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 }).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]);
}

export class GoogleSearchProvider implements SearchProvider {
    private browserFactory: BrowserFactory;

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
    }

    async search(query: string): Promise<SerpResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;

            // Randomize timeout to look human
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

            await acceptGoogleConsentIfPresent(page);

            const html = await page.content();
            const results = await GoogleSerpAnalyzer.parseSerp(html);
            return results;
        } catch (e: any) {
            Logger.warn(`[GoogleProvider] Search failed for "${query}": ${e.message}`);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}

export class DDGSearchProvider implements SearchProvider {
    private browserFactory: BrowserFactory;

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
    }

    async search(query: string): Promise<SerpResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            // DDG HTML version is easier to scrape and lighter
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

            const html = await page.content();
            const results = DuckDuckGoSerpAnalyzer.parseSerp(html);
            return results;
        } catch (e: any) {
            Logger.warn(`[DDGProvider] Search failed for "${query}": ${e.message}`);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}

/**
 * 📍 REVERSE ADDRESS SEARCH PROVIDER
 * Task 04: Find companies by exact address match
 * Query: "{address}" {city} sito web
 */
export class ReverseAddressSearchProvider implements SearchProvider {
    private browserFactory: BrowserFactory;

    constructor() {
        this.browserFactory = BrowserFactory.getInstance();
    }

    /**
     * reverseAddressSearch - Find website by exact address match
     * @param address - Full street address (e.g., "Via Roma 123")
     * @param city - City name
     */
    async reverseAddressSearch(address: string, city: string): Promise<SerpResult[]> {
        // Use exact match with quotes for address
        const query = `"${address}" ${city} sito web`;
        return this.search(query);
    }

    async search(query: string): Promise<SerpResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it&gl=it`;

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

            await acceptGoogleConsentIfPresent(page);

            const html = await page.content();
            const results = await GoogleSerpAnalyzer.parseSerp(html);

            Logger.info(`[ReverseAddress] Found ${results.length} results for "${query}"`);
            return results;
        } catch (e: any) {
            Logger.warn(`[ReverseAddress] Search failed: ${e.message}`);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}
