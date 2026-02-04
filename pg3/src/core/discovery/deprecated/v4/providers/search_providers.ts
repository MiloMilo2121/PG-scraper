import { ISearchProvider, SearchResult } from '../interfaces/types';
import { BrowserFactory } from '../../../browser/factory_v2';
import { GoogleSerpAnalyzer } from '../../serp_analyzer';
import { DuckDuckGoSerpAnalyzer } from '../../ddg_analyzer';

export class GoogleSearchProvider implements ISearchProvider {
    name = 'Google';
    private browserFactory: BrowserFactory;

    constructor(browserFactory?: BrowserFactory) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
    }

    async search(query: string, limit: number = 5): Promise<SearchResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            // Force Italian locale
            const url = `https://www.google.it/search?q=${encodeURIComponent(query)}&hl=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const html = await page.content();
            const rawResults = GoogleSerpAnalyzer.parseSerp(html);

            return rawResults.slice(0, limit).map((r: any) => ({
                url: r.url,
                source: 'Google',
                metadata: { title: r.title, description: r.description }
            }));
        } catch (e) {
            console.error('[GoogleProvider] Error:', e);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}

export class DDGSearchProvider implements ISearchProvider {
    name = 'DuckDuckGo';
    private browserFactory: BrowserFactory;

    constructor(browserFactory?: BrowserFactory) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
    }

    async search(query: string, limit: number = 5): Promise<SearchResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://html.duckduckgo.com/html?q=${encodeURIComponent(query)}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const html = await page.content();
            const rawResults = DuckDuckGoSerpAnalyzer.parseSerp(html);

            return rawResults.slice(0, limit).map((r: any) => ({
                url: r.url,
                source: 'DuckDuckGo',
                metadata: { title: r.title }
            }));
        } catch (e) {
            console.error('[DDGProvider] Error:', e);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}

export class BingSearchProvider implements ISearchProvider {
    name = 'Bing';
    private browserFactory: BrowserFactory;

    constructor(browserFactory?: BrowserFactory) {
        this.browserFactory = browserFactory || BrowserFactory.getInstance();
    }

    async search(query: string, limit: number = 5): Promise<SearchResult[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it&cc=it`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.b_algo h2 a'));
                return items.map((a: any) => ({
                    url: (a as HTMLAnchorElement).href,
                    title: a.innerText
                }));
            });

            return results.slice(0, limit).map((r: any) => ({
                url: r.url,
                source: 'Bing',
                metadata: { title: r.title }
            }));
        } catch (e) {
            console.error('[BingProvider] Error:', e);
            return [];
        } finally {
            if (page) await this.browserFactory.closePage(page);
        }
    }
}
