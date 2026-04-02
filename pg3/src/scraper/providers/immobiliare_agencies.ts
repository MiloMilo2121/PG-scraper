import { Browser, Page } from 'playwright';
import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';

const IMMOBILIARE_BASE_URL = 'https://www.immobiliare.it';
const DEFAULT_MAX_PAGES = 80;
const NAVIGATION_DELAY_MS = 1500;

export interface ImmobiliareScrapeOptions {
    category?: string;
    location: string;
    province?: string;
    maxPages?: number;
    includeDetails?: boolean;
}

interface AgencyCardSnapshot {
    company_name: string;
    address?: string;
    city?: string;
    zip_code?: string;
    description?: string;
    immobiliare_url: string;
    years_on_portal?: string;
    association_badge?: string;
    listing_quality?: string;
    listings_in_area?: string;
}

export function slugifyImmobiliareLocation(value: string): string {
    const cleaned = (value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function buildImmobiliareDirectoryUrl(location: string, pageNum = 1): string {
    const slug = slugifyImmobiliareLocation(location);
    const url = `${IMMOBILIARE_BASE_URL}/agenzie-immobiliari/${slug}/`;
    return pageNum > 1 ? `${url}?pag=${pageNum}` : url;
}

export function detectImmobiliareChallenge(title: string, bodyText: string, html: string): boolean {
    const haystack = `${title}\n${bodyText}\n${html}`.toLowerCase();
    return haystack.includes('please enable js and disable any ad blocker')
        || haystack.includes('captcha-delivery')
        || haystack.includes('geo.captcha-delivery.com');
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
        let stopAfterPage = maxPages;

        Logger.info(`[Immobiliare] Starting directory scrape for "${options.location}" (maxPages=${maxPages})`);

        for (let pageNum = 1; pageNum <= stopAfterPage; pageNum++) {
            const url = buildImmobiliareDirectoryUrl(options.location, pageNum);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(NAVIGATION_DELAY_MS);

                const title = await page.title().catch(() => '');
                const bodyText = await page.locator('body').innerText().catch(() => '');
                const html = await page.content().catch(() => '');

                if (detectImmobiliareChallenge(title, bodyText, html)) {
                    Logger.warn(`[Immobiliare] Challenge detected at ${url}. Stopping this lane.`);
                    break;
                }

                const extracted = await this.extractCards(page, options.location);
                if (extracted.length === 0) {
                    Logger.info(`[Immobiliare] No agency cards found on page ${pageNum} for ${options.location}.`);
                    break;
                }

                for (const item of extracted) {
                    if (!item.company_name || seenUrls.has(item.immobiliare_url)) {
                        continue;
                    }

                    seenUrls.add(item.immobiliare_url);
                    const normalizedAddress = normalizeAddressMatch(item.address);
                    results.push({
                        company_name: item.company_name,
                        address: normalizedAddress.address,
                        zip_code: normalizedAddress.zip_code,
                        city: normalizedAddress.city || item.city || options.location,
                        province: options.province,
                        category,
                        source: 'Immobiliare',
                        website: undefined,
                        immobiliare_url: item.immobiliare_url,
                        description: item.description,
                        years_on_portal: item.years_on_portal,
                        association_badge: item.association_badge,
                        listing_quality: item.listing_quality,
                        listings_in_area: item.listings_in_area,
                    });
                }

                const totalPages = await this.extractTotalPages(page);
                if (typeof totalPages === 'number' && Number.isFinite(totalPages) && totalPages > 0) {
                    stopAfterPage = Math.min(stopAfterPage, totalPages);
                }

                Logger.info(`[Immobiliare] Page ${pageNum}/${stopAfterPage} -> ${extracted.length} cards, ${results.length} total`);
            } catch (error) {
                Logger.warn(`[Immobiliare] Failed at ${url}: ${(error as Error).message}`);
                break;
            }
        }

        Logger.info(`[Immobiliare] Completed for "${options.location}" -> ${results.length} agencies`);
        return results;
    }

    private static async extractCards(page: Page, fallbackCity: string): Promise<AgencyCardSnapshot[]> {
        return page.evaluate(({ baseUrl, cityFallback }) => {
            const normalize = (value?: string | null): string | undefined => {
                const cleaned = (value || '').replace(/\s+/g, ' ').trim();
                return cleaned.length > 0 ? cleaned : undefined;
            };

            const agencyHrefPattern = /\/agenzie-immobiliari\/\d+\//;
            const anchors = Array.from(document.querySelectorAll('a[href]'))
                .filter((anchor) => {
                    const href = (anchor as HTMLAnchorElement).href || '';
                    return agencyHrefPattern.test(href);
                });

            const seen = new Set<string>();
            const items: AgencyCardSnapshot[] = [];

            for (const anchor of anchors) {
                const href = new URL((anchor as HTMLAnchorElement).href, baseUrl).toString().split('#')[0];
                if (seen.has(href)) continue;

                const name = normalize(anchor.textContent);
                if (!name) continue;

                let container: HTMLElement | null = anchor as HTMLElement;
                let candidate: HTMLElement | null = null;
                while (container && container !== document.body) {
                    const text = normalize(container.innerText);
                    if (text && text.includes(name) && text.length >= name.length && text.length <= 4000) {
                        candidate = container;
                    }
                    if (text && text.length > 4000) break;
                    container = container.parentElement;
                }

                const blockText = normalize(candidate?.innerText) || name;
                const lines = blockText.split('\n').map((line) => normalize(line)).filter(Boolean) as string[];
                const addressLine = lines.find((line) => /\d{5}\s*-\s*/.test(line));
                const associationLine = lines.find((line) => /^Associato /i.test(line));
                const yearsLine = lines.find((line) => /^Su Immobiliare\.it da /i.test(line));
                const qualityLine = lines.find((line) => /Qualit[aà] annunci pubblicati/i.test(line));
                const listingsLine = lines.find((line) => /Annunci in zona/i.test(line));

                const descriptionLines = lines.filter((line) => (
                    line !== name
                    && line !== addressLine
                    && line !== associationLine
                    && line !== yearsLine
                    && line !== qualityLine
                    && line !== listingsLine
                    && !/^Telefono$/i.test(line)
                    && !/^messaggio$/i.test(line)
                    && !/^(Gold|Premium|Top|Nuovo)$/i.test(line)
                ));

                items.push({
                    company_name: name,
                    address: addressLine,
                    city: cityFallback,
                    description: descriptionLines.slice(0, 4).join(' ') || undefined,
                    immobiliare_url: href,
                    years_on_portal: yearsLine,
                    association_badge: associationLine,
                    listing_quality: qualityLine,
                    listings_in_area: listingsLine,
                });

                seen.add(href);
            }

            return items;
        }, { baseUrl: IMMOBILIARE_BASE_URL, cityFallback: fallbackCity });
    }

    private static async extractTotalPages(page: Page): Promise<number | null> {
        return page.evaluate(() => {
            const numbers = Array.from(document.querySelectorAll('a[href*="?pag="], span, button'))
                .map((node) => (node.textContent || '').trim())
                .filter((value) => /^\d+$/.test(value))
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => Number.isFinite(value) && value > 0);

            if (numbers.length === 0) {
                return null;
            }
            return Math.max(...numbers);
        });
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
