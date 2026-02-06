/**
 * 🥷 YELLOW NINJA
 * PagineGialle scraper with anti-detection
 * 
 * Features:
 * - User-Agent rotation
 * - 10-min hibernation on detection
 * - Residential proxy escalation
 * 
 * PG1: SHADOW HUNTER - Pure Scraping
 */

import { Page } from 'puppeteer';
import { BrowserFactory } from '../modules/browser/factory_v2';
import { HumanBehavior } from '../modules/browser/human_behavior';
import { GeneticFingerprinter } from '../modules/browser/genetic_fingerprinter';
import { ProxyManager, ProxyTier } from '../modules/browser/proxy_manager';

export interface YellowResult {
    name: string;
    city?: string;
    province?: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
}

// Detection state
let isHibernating = false;
let hibernateUntil = 0;

export class YellowNinja {
    private factory: BrowserFactory;
    private fingerprinter: GeneticFingerprinter;
    private proxyManager: ProxyManager;

    constructor() {
        this.factory = BrowserFactory.getInstance();
        this.fingerprinter = GeneticFingerprinter.getInstance();
        this.proxyManager = ProxyManager.getInstance();
    }

    /**
     * initiateShadowProtocol - Scrape PagineGialle for a category + location
     */
    public async initiateShadowProtocol(
        category: string,
        location: string,
        maxPages: number = 5
    ): Promise<YellowResult[]> {
        // Check hibernation
        if (await this.checkHibernation()) {
            console.log('💤 Yellow Ninja: Still hibernating...');
            return [];
        }

        const results: YellowResult[] = [];
        const page = await this.factory.newPage();
        const geneId = (page as any).__geneId;

        try {
            // Build search URL
            const categorySlug = this.slugify(category);
            const locationSlug = this.slugify(location);
            const baseUrl = `https://www.paginegialle.it/ricerca/${categorySlug}/${locationSlug}`;

            console.log(`🥷 Yellow Ninja: Hunting "${category}" in "${location}"`);

            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                const url = pageNum === 1 ? baseUrl : `${baseUrl}/p-${pageNum}`;

                // Navigate with human-like behavior
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
                } catch (e) {
                    console.warn(`⚠️ Navigation timeout on page ${pageNum}`);
                    break;
                }

                // Check for blocks
                const isBlocked = await this.detectBlock(page);
                if (isBlocked) {
                    console.warn('🚫 Yellow Ninja: Block detected! Starting hibernation...');
                    await this.startHibernation();
                    this.fingerprinter.reportFailure(geneId);
                    return results;
                }

                // Human behavior
                await HumanBehavior.randomPause(page, 1500, 3000);
                await HumanBehavior.simulateReading(page);

                // Extract results
                const pageResults = await this.extractResults(page, location);
                results.push(...pageResults);

                console.log(`🥷 Page ${pageNum}: Found ${pageResults.length} results (Total: ${results.length})`);

                // Check if there are more pages
                const hasNextPage = await page.evaluate(() => {
                    const nextBtn = document.querySelector('.pagination .next, a[rel="next"]');
                    return !!nextBtn && !nextBtn.classList.contains('disabled');
                });

                if (!hasNextPage) {
                    console.log('🥷 No more pages.');
                    break;
                }

                // Random delay between pages
                await HumanBehavior.randomPause(page, 3000, 6000);
            }

            this.fingerprinter.reportSuccess(geneId);
            console.log(`🥷 Yellow Ninja: Extracted ${results.length} results for "${category}" in "${location}"`);

            return results;

        } catch (error) {
            console.error(`❌ Yellow Ninja error:`, error);
            this.fingerprinter.reportFailure(geneId);
            return results;
        } finally {
            await this.factory.closePage(page);
        }
    }

    /**
     * Extract business data from the page
     */
    private async extractResults(page: Page, defaultLocation: string): Promise<YellowResult[]> {
        return await page.evaluate((location: string) => {
            const results: YellowResult[] = [];

            // PagineGialle business cards
            const cards = document.querySelectorAll('.vcard, .result-item, [itemtype*="LocalBusiness"]');

            cards.forEach((card) => {
                try {
                    // Name
                    const nameEl = card.querySelector('.org, .business-name, [itemprop="name"]');
                    const name = nameEl?.textContent?.trim();
                    if (!name) return;

                    // Address
                    const addressEl = card.querySelector('.street-address, .addr, [itemprop="address"]');
                    const address = addressEl?.textContent?.trim();

                    // Phone
                    const phoneEl = card.querySelector('.tel, [itemprop="telephone"], a[href^="tel:"]');
                    let phone = phoneEl?.textContent?.trim();
                    if (!phone) {
                        const phoneLink = card.querySelector('a[href^="tel:"]');
                        phone = phoneLink?.getAttribute('href')?.replace('tel:', '');
                    }

                    // Website
                    const websiteEl = card.querySelector('a[itemprop="url"], a.website');
                    const website = websiteEl?.getAttribute('href') || undefined;

                    // Category
                    const categoryEl = card.querySelector('.category, [itemprop="category"]');
                    const category = categoryEl?.textContent?.trim();

                    // City/Province parsing from address
                    let city: string | undefined = location;
                    let province: string | undefined;

                    if (address) {
                        // Try to parse city from address (often last part)
                        const parts = address.split(/[,\-]/);
                        if (parts.length >= 2) {
                            const lastPart = parts[parts.length - 1].trim();
                            // Check for province code (2 letter uppercase)
                            const provinceMatch = lastPart.match(/\(([A-Z]{2})\)/);
                            if (provinceMatch) {
                                province = provinceMatch[1];
                            }
                        }
                    }

                    results.push({
                        name,
                        city,
                        province,
                        address,
                        phone: phone?.replace(/\s+/g, ' ').trim(),
                        website,
                        category
                    });
                } catch (e) {
                    // Skip malformed cards
                }
            });

            return results;
        }, defaultLocation);
    }

    /**
     * Detect if we've been blocked
     */
    private async detectBlock(page: Page): Promise<boolean> {
        return await page.evaluate(() => {
            const body = document.body?.textContent?.toLowerCase() || '';
            const blockedIndicators = [
                'accesso negato',
                'access denied',
                'too many requests',
                'robot',
                'captcha',
                'verifica che non sei un robot',
                'security check'
            ];
            return blockedIndicators.some(indicator => body.includes(indicator));
        });
    }

    /**
     * Start hibernation (10 minutes)
     */
    private async startHibernation(): Promise<void> {
        const hibernationMs = 10 * 60 * 1000; // 10 minutes
        hibernateUntil = Date.now() + hibernationMs;
        isHibernating = true;
        console.log(`💤 Yellow Ninja: Hibernating for 10 minutes (until ${new Date(hibernateUntil).toLocaleTimeString()})`);
    }

    /**
     * Check hibernation status
     */
    private async checkHibernation(): Promise<boolean> {
        if (!isHibernating) return false;

        if (Date.now() >= hibernateUntil) {
            isHibernating = false;
            hibernateUntil = 0;
            console.log('🌅 Yellow Ninja: Waking up from hibernation!');
            return false;
        }

        return true;
    }

    /**
     * Slugify for URL building
     */
    private slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/[àáâãäå]/g, 'a')
            .replace(/[èéêë]/g, 'e')
            .replace(/[ìíîï]/g, 'i')
            .replace(/[òóôõö]/g, 'o')
            .replace(/[ùúûü]/g, 'u')
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .replace(/\-+/g, '-')
            .trim();
    }
}

// Singleton export
export const yellowNinja = new YellowNinja();
