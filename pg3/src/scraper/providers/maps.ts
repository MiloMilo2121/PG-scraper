import { Page } from 'puppeteer';
import { Logger } from '../utils/logger';
import { CompanyInput } from '../types';

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

                // Expanded selectors for List Items
                const items = await page.$$('div.VkpGBb, div[jscontroller="AtSb"], .dbg0pd, .C8TUKc, div[role="article"] a[href^="/maps/place"]');
                if (items.length === 0) continue;

                Logger.info(`[Maps] Found ${items.length} candidates for ${query}`);

                for (const item of items) {
                    try {
                        // Extract name from the list item itself (more reliable than side panel sometimes)
                        const listName = await item.evaluate((el) => {
                            return el.querySelector('div[role="heading"]')?.textContent ||
                                el.querySelector('.qBF1Pd')?.textContent ||
                                el.querySelector('.OSrXXb')?.textContent ||
                                el.getAttribute('aria-label') ||
                                (el as HTMLElement).innerText?.split('\n')[0];
                        });

                        // Click to open side panel
                        await item.click();
                        await this.delay(1000);

                        const details = await page.evaluate((suggestedName) => {
                            // Try multiple containers for side panel
                            const side = document.querySelector('div[role="complementary"]') ||
                                document.querySelector('#rhs') ||
                                document.querySelector('div.xpdopen');

                            // If no side panel, maybe we can just use the list info? 
                            // For now, require side panel for details like phone/website
                            if (!side) return { company_name: suggestedName || '', website: '', phone: '', address: '' };

                            // Robust Title Extraction
                            // Always prefer the name from the list item if available
                            let title = suggestedName || side.querySelector('h2')?.textContent?.trim();

                            // If title is generic or missing, try fallback
                            if (!title || /complementary result|people also search|results/i.test(title)) {
                                const altTitle = side.querySelector('div[data-attrid="title"]')?.textContent?.trim();
                                if (altTitle) title = altTitle;
                            }

                            // Ensure title is a string
                            title = title || '';

                            const webBtn = Array.from(side.querySelectorAll('a')).find(a =>
                                a.textContent?.toLowerCase().includes('website') ||
                                a.getAttribute('aria-label')?.toLowerCase().includes('website') ||
                                a.href.includes('google.com/url?') // Often website links are redirected
                            );
                            const website = webBtn?.getAttribute('href') || '';

                            // Phone usually has "Call" aria-label or specific icon
                            const phoneBtn = side.querySelector('button[data-item-id="phone"]') ||
                                Array.from(side.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.toLowerCase().includes('call'));
                            const phone = phoneBtn?.getAttribute('aria-label')?.replace('Call ', '').replace('Chiama ', '') || '';

                            const addrBtn = side.querySelector('button[data-item-id="address"]') ||
                                document.querySelector('.LrzXr'); // Address class often used
                            const address = addrBtn?.textContent?.trim() || side.textContent?.match(/Address: (.*)/)?.[1] || '';

                            return {
                                company_name: title,
                                website,
                                phone,
                                address
                            };
                        }, listName);

                        if (details && details.company_name && !/complementary result|people also search/i.test(details.company_name)) {
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
