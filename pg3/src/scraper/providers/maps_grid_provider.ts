import { Page } from 'puppeteer';
import { Logger } from '../utils/logger';
import { CompanyInput } from '../types';

/**
 * 🗺️ GOOGLE MAPS GRID PROVIDER
 * 
 * Scrapes Google Maps directly (not tbm=lcl) by:
 * 1. Navigating to google.com/maps/search/{query}
 * 2. Scrolling the results panel to lazy-load ALL results
 * 3. Extracting business data from each result card
 * 
 * Maps shows max ~120 results per query. For dense areas,
 * callers should split by municipality to get full coverage.
 */

const SCROLL_PAUSE_MS = 1500;
const MAX_SCROLL_ATTEMPTS = 40; // ~120 results at 3 per scroll
const EXTRACTION_DELAY_MS = 500;

export class MapsGridProvider {

    /**
     * Scrape Google Maps for ALL results matching query + location.
     * Scrolls until "end of results" or max attempts reached.
     */
    public static async scrapeAll(
        page: Page,
        category: string,
        location: string
    ): Promise<CompanyInput[]> {
        const query = `${category} ${location}`;
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/@45.5,10.2,10z?hl=it`;

        Logger.info(`[MapsGrid] 🗺️ Navigating: ${query}`);

        try {
            await page.goto(mapsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.handleConsent(page);
            await this.delay(2000);

            // Check if we landed on results list or single place
            const hasResultsList = await page.$('div[role="feed"]');
            if (!hasResultsList) {
                Logger.warn(`[MapsGrid] No results feed found for "${query}". Possibly no results or single place.`);
                return [];
            }

            // SCROLL to load all results
            const totalLoaded = await this.scrollToEnd(page);
            Logger.info(`[MapsGrid] 📜 Scrolled to load ${totalLoaded} result cards`);

            // EXTRACT all visible results
            const results = await this.extractAllResults(page, category, location);
            Logger.info(`[MapsGrid] ✅ Extracted ${results.length} businesses for "${query}"`);

            return results;

        } catch (error) {
            Logger.error(`[MapsGrid] ❌ Failed for "${query}": ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Scroll the Maps results feed until "end of list" or max attempts.
     */
    private static async scrollToEnd(page: Page): Promise<number> {
        let previousCount = 0;
        let stallCount = 0;

        for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt++) {
            // Scroll the results panel
            const currentCount = await page.evaluate(() => {
                const feed = document.querySelector('div[role="feed"]');
                if (!feed) return 0;

                // Scroll the feed container
                feed.scrollTop = feed.scrollHeight;

                // Count result items
                return feed.querySelectorAll('div[jsaction*="mouseover"]').length;
            });

            // Check for "end of results" indicator
            const endReached = await page.evaluate(() => {
                const endEl = document.querySelector('.m6QErb span.HlvSq');
                const noResults = document.querySelector('.Q2vNVc');
                return !!(endEl || noResults);
            });

            if (endReached) {
                Logger.info(`[MapsGrid] 🏁 End of results reached at ${currentCount} items`);
                return currentCount;
            }

            // Stall detection
            if (currentCount === previousCount) {
                stallCount++;
                if (stallCount >= 3) {
                    Logger.info(`[MapsGrid] ⏸️ Scroll stalled at ${currentCount} items after 3 attempts`);
                    return currentCount;
                }
            } else {
                stallCount = 0;
            }

            previousCount = currentCount;
            await this.delay(SCROLL_PAUSE_MS);
        }

        return previousCount;
    }

    /**
     * Extract business data from all visible result cards.
     */
    private static async extractAllResults(
        page: Page,
        category: string,
        location: string
    ): Promise<CompanyInput[]> {
        return await page.evaluate((cat, loc) => {
            const results: any[] = [];
            const feed = document.querySelector('div[role="feed"]');
            if (!feed) return results;

            // Each business card in the feed
            const cards = Array.from(feed.querySelectorAll('div.Nv2PK'));

            for (const card of cards) {
                try {
                    // Name
                    const nameEl = card.querySelector('.qBF1Pd') ||
                        card.querySelector('div.fontHeadlineSmall') ||
                        card.querySelector('a[aria-label]');
                    const name = nameEl?.textContent?.trim() ||
                        (nameEl as HTMLElement)?.getAttribute('aria-label')?.trim();

                    if (!name) continue;

                    // Address
                    const infoEls = Array.from(card.querySelectorAll('.W4Efsd span'));
                    let address = '';
                    let phone = '';

                    for (const el of infoEls) {
                        const text = (el as HTMLElement).textContent?.trim() || '';
                        // Italian addresses often contain "Via", "Viale", "Piazza", etc.
                        if (/^(Via|Viale|Piazza|Corso|Largo|Vicolo|Strada|Loc\.|C\.so|P\.za|V\.le)/i.test(text) ||
                            /^\d+,\s/.test(text) ||
                            /\d{5}/.test(text)) {
                            address = text;
                        }
                        // Phone detection
                        if (/^(\+39|0\d{1,4})\s?\d/.test(text) || /^\d{2,4}\s\d{4,8}$/.test(text)) {
                            phone = text;
                        }
                    }

                    // Website — look for the website button/link
                    const websiteBtn = card.querySelector('a[data-value="Sito web"]') ||
                        card.querySelector('a[aria-label*="sito web"]') ||
                        card.querySelector('a[aria-label*="Website"]');
                    const website = websiteBtn?.getAttribute('href') || '';

                    // Rating
                    const ratingEl = card.querySelector('.MW4etd');
                    const rating = ratingEl?.textContent?.trim();

                    results.push({
                        company_name: name,
                        address: address || undefined,
                        city: loc,
                        phone: phone || undefined,
                        website: website || undefined,
                        category: cat,
                        source: 'Maps',
                        rating: rating || undefined
                    });

                } catch (e) {
                    // Skip malformed cards
                }
            }

            return results;
        }, category, location) as CompanyInput[];
    }

    /**
     * Click each result to get detailed info (phone, website) from side panel.
     * Use when card-level extraction is insufficient.
     */
    public static async scrapeWithDetails(
        page: Page,
        category: string,
        location: string
    ): Promise<CompanyInput[]> {
        // First get all basic results via scrolling
        const basicResults = await this.scrapeAll(page, category, location);

        if (basicResults.length === 0) return [];

        Logger.info(`[MapsGrid] 🔍 Deep-extracting details for ${basicResults.length} businesses...`);

        const enrichedResults: CompanyInput[] = [];
        const cards = await page.$$('div.Nv2PK');

        for (let i = 0; i < Math.min(cards.length, basicResults.length); i++) {
            try {
                // Click the card to open detail panel
                await cards[i].click();
                await this.delay(EXTRACTION_DELAY_MS + 500);

                // Extract from detail panel
                const details = await page.evaluate(() => {
                    const panel = document.querySelector('div[role="main"]');
                    if (!panel) return null;

                    // Phone
                    const phoneBtn = panel.querySelector('button[data-item-id*="phone"]') ||
                        panel.querySelector('button[aria-label*="Telefono"]') ||
                        panel.querySelector('button[aria-label*="Phone"]');
                    const phone = phoneBtn?.getAttribute('aria-label')
                        ?.replace(/^(Telefono|Phone):?\s*/i, '')
                        ?.trim();

                    // Website
                    const webBtn = panel.querySelector('a[data-item-id="authority"]') ||
                        panel.querySelector('a[aria-label*="sito web"]') ||
                        panel.querySelector('a[aria-label*="Website"]');
                    const website = webBtn?.getAttribute('href');

                    // Address
                    const addrBtn = panel.querySelector('button[data-item-id="address"]') ||
                        panel.querySelector('button[aria-label*="Indirizzo"]') ||
                        panel.querySelector('button[aria-label*="Address"]');
                    const address = addrBtn?.getAttribute('aria-label')
                        ?.replace(/^(Indirizzo|Address):?\s*/i, '')
                        ?.trim();

                    return { phone, website, address };
                });

                const base = basicResults[i];
                enrichedResults.push({
                    ...base,
                    phone: details?.phone || base.phone,
                    website: details?.website || base.website,
                    address: details?.address || base.address,
                });

            } catch (e) {
                // If click fails, keep basic data
                enrichedResults.push(basicResults[i]);
            }
        }

        return enrichedResults;
    }

    private static async handleConsent(page: Page): Promise<void> {
        try {
            // Google consent dialog
            const consentBtn = await page.$('button[aria-label="Accetta tutto"]') ||
                await page.$('button[aria-label="Accept all"]') ||
                await page.$('form[action*="consent"] button');
            if (consentBtn) {
                await consentBtn.click();
                await this.delay(1000);
                Logger.info('[MapsGrid] 🍪 Consent handled');
            }
        } catch { }
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }
}
