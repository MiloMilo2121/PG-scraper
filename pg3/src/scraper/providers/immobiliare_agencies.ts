import { Browser, Page } from 'playwright';
import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';
import {
    buildImmobiliareDirectoryUrl,
    extractImmobiliareAgencyCandidates,
    extractImmobiliareAgencyDetails,
    extractImmobiliareNextPageUrl,
    isImmobiliareChallengeHtml,
    slugifyImmobiliareLocation,
} from './immobiliare_agencies_selectors';

const DEFAULT_MAX_PAGES = 80;
const NAVIGATION_DELAY_MS = 1500;

export interface ImmobiliareScrapeOptions {
    category?: string;
    location: string;
    province?: string;
    maxPages?: number;
    includeDetails?: boolean;
}

function normalizeAddressMatch(addressLine?: string): Pick<CompanyInput, 'address' | 'zip_code' | 'city'> {
    if (!addressLine) {
        return {};
    }

    const trimmed = addressLine.replace(/\s+/g, ' ').trim();
    const match = trimmed.match(/^(.*?)\s+(\d{5})\s*-\s*(.+)$/);
    if (!match) {
        return { address: trimmed };
    }

    return {
        address: match[1].trim(),
        zip_code: match[2].trim(),
        city: match[3].trim(),
    };
}

export class ImmobiliareAgenciesProvider {
    public static async scrapeAll(page: Page, options: ImmobiliareScrapeOptions): Promise<CompanyInput[]> {
        const category = options.category || 'Agenzie immobiliari';
        const maxPages = Math.max(1, Math.min(options.maxPages || DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES));
        const results: CompanyInput[] = [];
        const seenUrls = new Set<string>();
        let currentUrl: string | undefined = buildImmobiliareDirectoryUrl(options.location, 1);
        let pageCount = 0;

        Logger.info(`[Immobiliare] Starting directory scrape for "${options.location}" (slug=${slugifyImmobiliareLocation(options.location)})`);

        while (currentUrl && pageCount < maxPages) {
            pageCount++;
            try {
                await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(NAVIGATION_DELAY_MS);

                const title = await page.title().catch(() => '');
                const bodyText = await page.locator('body').innerText().catch(() => '');
                const html = await page.content().catch(() => '');

                if (isImmobiliareChallengeHtml(html, title, currentUrl) || (!bodyText.trim() && title === 'immobiliare.it')) {
                    Logger.warn(`[Immobiliare] Challenge detected at ${currentUrl}. Stopping this lane.`);
                    break;
                }

                const candidates = extractImmobiliareAgencyCandidates(html, currentUrl);
                if (candidates.length === 0) {
                    Logger.info(`[Immobiliare] No agency cards found on page ${pageCount} for ${options.location}.`);
                    break;
                }

                for (const candidate of candidates) {
                    if (seenUrls.has(candidate.url)) {
                        continue;
                    }

                    seenUrls.add(candidate.url);
                    const normalizedAddress = normalizeAddressMatch(candidate.addressLine);
                    let record: CompanyInput = {
                        company_name: candidate.name,
                        address: normalizedAddress.address,
                        zip_code: normalizedAddress.zip_code,
                        city: normalizedAddress.city || options.location,
                        province: options.province,
                        category,
                        source: 'Immobiliare',
                        immobiliare_url: candidate.url,
                        portal_association: candidate.associationBadge,
                        portal_years_on_immobiliare: candidate.yearsOnPortal,
                        portal_quality_score: candidate.qualityScore,
                        portal_announcements: candidate.announcements,
                        portal_description: candidate.description,
                    };

                    if (options.includeDetails) {
                        try {
                            await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.waitForTimeout(800);
                            const detailHtml = await page.content().catch(() => '');
                            const detailTitle = await page.title().catch(() => '');
                            if (!isImmobiliareChallengeHtml(detailHtml, detailTitle, candidate.url)) {
                                record = extractImmobiliareAgencyDetails(detailHtml, candidate.url, record);
                            }
                        } catch (error) {
                            Logger.warn(`[Immobiliare] Detail fetch failed for ${candidate.url}: ${(error as Error).message}`);
                        }
                    }

                    results.push(record);
                }

                Logger.info(`[Immobiliare] Page ${pageCount} -> ${candidates.length} cards, ${results.length} total`);
                currentUrl = extractImmobiliareNextPageUrl(html, currentUrl);
            } catch (error) {
                Logger.warn(`[Immobiliare] Failed at ${currentUrl}: ${(error as Error).message}`);
                break;
            }
        }

        Logger.info(`[Immobiliare] Completed for "${options.location}" -> ${results.length} agencies`);
        return results;
    }
}

export class ImmobiliareAgencyProvider {
    public static async scrapeProvince(
        browser: Browser,
        provinceName: string,
        provinceCode: string,
        options: Pick<ImmobiliareScrapeOptions, 'maxPages' | 'includeDetails'> = {}
    ): Promise<CompanyInput[]> {
        const page = await browser.newPage();
        try {
            return await ImmobiliareAgenciesProvider.scrapeAll(page, {
                location: provinceName,
                province: provinceCode,
                maxPages: options.maxPages,
                includeDetails: options.includeDetails,
            });
        } finally {
            await page.close().catch(() => undefined);
        }
    }
}

export {
    buildImmobiliareDirectoryUrl,
    slugifyImmobiliareLocation,
};
