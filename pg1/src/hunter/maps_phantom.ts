/**
 * 🗺️ MAPS PHANTOM
 * Google Maps scraper with human exploration simulation
 * 
 * Features:
 * - Ghost cursor for map dragging (not JS injection)
 * - Infinite scroll simulation
 * - Business data extraction
 * 
 * PG1: SHADOW HUNTER - Pure Scraping
 */

import { Page } from 'puppeteer';
import { BrowserFactory } from '../browser/factory_v2';
import { HumanBehavior } from '../browser/human_behavior';
import { GeneticFingerprinter } from '../browser/genetic_fingerprinter';

export interface MapsResult {
    name: string;
    city?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
    rating?: number;
    reviewCount?: number;
}

export class MapsPhantom {
    private factory: BrowserFactory;
    private fingerprinter: GeneticFingerprinter;

    constructor() {
        this.factory = BrowserFactory.getInstance();
        this.fingerprinter = GeneticFingerprinter.getInstance();
    }

    /**
     * initiateShadowProtocol - Scrape Google Maps for a given location + keyword
     */
    public async initiateShadowProtocol(
        keyword: string,
        city: string,
        maxResults: number = 100
    ): Promise<MapsResult[]> {
        const page = await this.factory.newPage();
        const results: MapsResult[] = [];
        const geneId = (page as any).__geneId;

        try {
            // Use US Google to avoid cookie consent
            const searchQuery = encodeURIComponent(`${keyword} ${city}`);
            const url = `https://www.google.com/maps/search/${searchQuery}`;

            console.log(`🗺️ Maps Phantom: Searching "${keyword}" in "${city}"`);

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for results to load
            await page.waitForSelector('[role="feed"]', { timeout: 15000 }).catch(() => null);

            // Simulate human behavior
            await HumanBehavior.randomPause(page, 2000, 4000);
            await HumanBehavior.simulateReading(page);

            // Scroll and extract results
            let previousCount = 0;
            let noNewResultsCount = 0;

            while (results.length < maxResults && noNewResultsCount < 5) {
                // Human-like scroll
                await this.humanScroll(page);
                await HumanBehavior.randomPause(page, 1500, 3000);

                // Extract visible results
                const newResults = await this.extractResults(page);

                // Deduplicate
                for (const result of newResults) {
                    if (!results.some(r => r.name === result.name && r.address === result.address)) {
                        results.push(result);
                    }
                }

                console.log(`🗺️ Found ${results.length} results so far...`);

                if (results.length === previousCount) {
                    noNewResultsCount++;
                } else {
                    noNewResultsCount = 0;
                }
                previousCount = results.length;

                // Random mouse movement
                await HumanBehavior.randomMouseMove(page);
            }

            // Report success to genetic algorithm
            this.fingerprinter.reportSuccess(geneId);
            console.log(`🗺️ Maps Phantom: Extracted ${results.length} results for "${keyword}" in "${city}"`);

            return results.slice(0, maxResults);

        } catch (error) {
            console.error(`❌ Maps Phantom error:`, error);
            this.fingerprinter.reportFailure(geneId);
            return results;
        } finally {
            await this.factory.closePage(page);
        }
    }

    /**
     * Human-like scroll simulation
     */
    private async humanScroll(page: Page): Promise<void> {
        await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            if (feed) {
                const scrollAmount = 300 + Math.random() * 200;
                feed.scrollBy({
                    top: scrollAmount,
                    behavior: 'smooth'
                });
            }
        });
    }

    /**
     * Extract business data from visible results
     */
    private async extractResults(page: Page): Promise<MapsResult[]> {
        return await page.evaluate(() => {
            const results: MapsResult[] = [];

            // Find all result cards
            const cards = document.querySelectorAll('[data-result-index], .Nv2PK');

            cards.forEach((card) => {
                try {
                    // Name
                    const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall');
                    const name = nameEl?.textContent?.trim();
                    if (!name) return;

                    // Address
                    const addressEl = card.querySelector('.W4Efsd:nth-child(2), [data-item-id*="address"]');
                    const address = addressEl?.textContent?.trim();

                    // Phone - often in the address line
                    let phone: string | undefined;
                    const phoneMatch = card.textContent?.match(/(\+?[\d\s\-()]{10,})/);
                    if (phoneMatch) {
                        phone = phoneMatch[1].replace(/\s+/g, ' ').trim();
                    }

                    // Category
                    const categoryEl = card.querySelector('.W4Efsd:first-child .W4Efsd span:nth-child(1)');
                    const category = categoryEl?.textContent?.trim();

                    // Rating
                    const ratingEl = card.querySelector('.MW4etd');
                    const rating = ratingEl?.textContent ? parseFloat(ratingEl.textContent) : undefined;

                    // Review count
                    const reviewEl = card.querySelector('.UY7F9');
                    const reviewCount = reviewEl?.textContent
                        ? parseInt(reviewEl.textContent.replace(/[^0-9]/g, ''))
                        : undefined;

                    // Website (will be fetched separately)
                    const website = undefined;

                    results.push({
                        name,
                        address,
                        phone,
                        category,
                        rating,
                        reviewCount,
                        website
                    });
                } catch (e) {
                    // Skip malformed cards
                }
            });

            return results;
        });
    }

    /**
     * Get detailed info for a specific place (including website & phone)
     */
    public async getPlaceDetails(page: Page, placeIndex: number): Promise<Partial<MapsResult>> {
        try {
            // Click on the place card
            const cards = await page.$$('[data-result-index], .Nv2PK');
            if (cards[placeIndex]) {
                await cards[placeIndex].click();
                await HumanBehavior.randomPause(page, 2000, 4000);

                // Extract details from the side panel
                return await page.evaluate(() => {
                    const panel = document.querySelector('[role="main"]');
                    if (!panel) return {};

                    // Website
                    const websiteLink = panel.querySelector('a[data-item-id*="authority"], a[href*="http"]');
                    const website = websiteLink?.getAttribute('href') || undefined;

                    // Phone
                    const phoneEl = panel.querySelector('[data-item-id*="phone"]');
                    const phone = phoneEl?.textContent?.trim();

                    return { website, phone };
                });
            }
            return {};
        } catch (e) {
            return {};
        }
    }
}

// Singleton export
export const mapsPhantom = new MapsPhantom();
