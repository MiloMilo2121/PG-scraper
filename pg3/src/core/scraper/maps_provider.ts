import { Page } from 'puppeteer';
import { Logger } from '../../utils/logger';
import { CompanyInput } from '../company_types';

export class GoogleMapsProvider {
    private static async delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

    public static async fetchDeepResults(page: Page, city: string, keyword: string): Promise<CompanyInput[]> {
        const results: CompanyInput[] = [];
        const queries = [
            `${keyword} ${city}`,
            `${keyword} Provincia di ${city}`
        ];

        for (const query of queries) {
            try {
                Logger.info(`[Maps] Searching: ${query}`);
                const mapsUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=lcl&hl=en&gl=us`;

                await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.smashCookies(page);

                const items = await page.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd, .C8TUKc');
                if (items.length === 0) continue;

                Logger.info(`[Maps] Found ${items.length} candidates for ${query}`);

                for (const item of items) {
                    try {
                        // Click to open side panel
                        await item.click();
                        await this.delay(1000);

                        const details = await page.evaluate(() => {
                            const side = document.querySelector('div[role="complementary"]');
                            if (!side) return null;

                            const title = side.querySelector('h2')?.textContent?.trim() || '';
                            const webBtn = Array.from(side.querySelectorAll('a')).find(a =>
                                a.textContent?.toLowerCase().includes('website') ||
                                a.getAttribute('aria-label')?.toLowerCase().includes('website')
                            );
                            const website = webBtn?.getAttribute('href') || '';

                            const phoneBtn = side.querySelector('button[data-item-id="phone"]');
                            const phone = phoneBtn?.getAttribute('aria-label')?.replace('Call ', '') || '';

                            const addrBtn = side.querySelector('button[data-item-id="address"]');
                            const address = addrBtn?.textContent?.trim() || '';

                            return { company_name: title, website, phone, address };
                        });

                        if (details && details.company_name) {
                            results.push({
                                ...details,
                                city: city,
                                category: keyword,
                                source: 'Maps'
                            });
                        }
                    } catch (e) {
                        Logger.error(`[Maps] Item Extraction Error`, (e as Error).message);
                    }
                }

                // If we found results, we can stop here or continue to provincial search for saturation
                if (results.length > 5) break;

            } catch (e) {
                Logger.error(`[Maps] Provider Error for ${query}`, (e as Error).message);
            }
        }

        return results;
    }

    private static async smashCookies(page: Page) {
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                const accept = buttons.find(b =>
                    /accetta tutto|accetta|accept all|agree|acconsento|consent/i.test((b as HTMLElement).innerText || '')
                );
                if (accept) (accept as HTMLElement).click();
            });
        } catch (e) { }
    }
}

