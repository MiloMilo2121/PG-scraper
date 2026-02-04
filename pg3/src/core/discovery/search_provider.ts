
import { BrowserFactory } from '../browser/factory_v2';
import { Logger } from '../../utils/logger';
import { GoogleSerpAnalyzer, SerpResult } from './serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from './ddg_analyzer';

export interface SearchProvider {
    search(query: string): Promise<SerpResult[]>;
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

            // Consent Handling (Basic)
            try {
                const btn = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    // "Accetta tutto" or "Accept all"
                    return buttons.find(b => /accetta|accept/i.test(b.innerText))?.innerText;
                });
                if (btn) {
                    await page.click(`button ::-p-text(${btn})`);
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => { });
                }
            } catch (e) { }

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
