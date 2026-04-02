import * as cheerio from 'cheerio';
import { CompanyInput } from '../types';

export interface ImmobiliareAgencyCandidate {
    name: string;
    url: string;
    addressLine?: string;
    associationBadge?: string;
    yearsOnPortal?: string;
    qualityScore?: string;
    announcements?: string;
    description?: string;
}

function normalizeText(value?: string | null): string | undefined {
    const cleaned = (value || '').replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned : undefined;
}

function resolveUrl(baseUrl: string, href?: string | null): string | undefined {
    const cleanedHref = normalizeText(href);
    if (!cleanedHref) return undefined;
    try {
        return new URL(cleanedHref, baseUrl).toString();
    } catch {
        return undefined;
    }
}

function looksLikeAgencyUrl(url?: string): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return /\/agenzie-immobiliari\/\d+\//.test(parsed.pathname);
    } catch {
        return false;
    }
}

function extractAddressLine(textBlock: string): string | undefined {
    return textBlock
        .split('\n')
        .map((line) => normalizeText(line))
        .find((line) => !!line && (/\d{5}\s*-\s*/.test(line) || /via |viale |corso |piazza |largo /i.test(line))) || undefined;
}

function parseJsonLdAddress(raw: any): Partial<CompanyInput> {
    if (!raw || typeof raw !== 'object') return {};

    const street = normalizeText(raw.streetAddress);
    const city = normalizeText(raw.addressLocality);
    const province = normalizeText(raw.addressRegion);
    const zip = normalizeText(raw.postalCode);
    const address = [street, zip && city ? `${zip} - ${city}` : undefined].filter(Boolean).join(' ');

    return {
        address: street || address || undefined,
        city,
        province,
        zip_code: zip,
    };
}

export function slugifyImmobiliareLocation(value: string): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function buildImmobiliareDirectoryUrl(location: string, pageNum = 1): string {
    const url = `https://www.immobiliare.it/agenzie-immobiliari/${slugifyImmobiliareLocation(location)}/`;
    return pageNum > 1 ? `${url}?pag=${pageNum}` : url;
}

export function isImmobiliareChallengeHtml(html: string, title = '', url = ''): boolean {
    const haystack = `${title}\n${url}\n${html}`.toLowerCase();
    return haystack.includes('please enable js and disable any ad blocker')
        || haystack.includes('captcha-delivery')
        || haystack.includes('geo.captcha-delivery.com');
}

export function extractImmobiliareAgencyCandidates(html: string, pageUrl: string): ImmobiliareAgencyCandidate[] {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const candidates: ImmobiliareAgencyCandidate[] = [];

    $('a[href]').each((_, element) => {
        const anchor = $(element);
        const url = resolveUrl(pageUrl, anchor.attr('href'));
        if (!looksLikeAgencyUrl(url) || !url || seen.has(url)) {
            return;
        }

        const name = normalizeText(anchor.text());
        if (!name) {
            return;
        }

        const container = anchor.closest('article, li, section, div');
        const textBlock = normalizeText(container.text()) || name;
        const lines = textBlock.split(/\n+/).map((line) => normalizeText(line)).filter(Boolean) as string[];

        const candidate: ImmobiliareAgencyCandidate = {
            name,
            url,
            addressLine: extractAddressLine(textBlock),
            associationBadge: lines.find((line) => /^Associato /i.test(line)),
            yearsOnPortal: lines.find((line) => /^Su Immobiliare\.it da /i.test(line)),
            qualityScore: lines.find((line) => /Qualit[aà] annunci pubblicati/i.test(line)),
            announcements: lines.find((line) => /Annunci in zona/i.test(line)),
            description: lines
                .filter((line) => line !== name
                    && line !== extractAddressLine(textBlock)
                    && !/^Associato /i.test(line)
                    && !/^Su Immobiliare\.it da /i.test(line)
                    && !/Qualit[aà] annunci pubblicati/i.test(line)
                    && !/Annunci in zona/i.test(line)
                    && !/^Telefono$/i.test(line)
                    && !/^messaggio$/i.test(line))
                .slice(0, 4)
                .join(' ') || undefined,
        };

        candidates.push(candidate);
        seen.add(url);
    });

    return candidates;
}

export function extractImmobiliareNextPageUrl(html: string, pageUrl: string): string | undefined {
    const $ = cheerio.load(html);
    const nextHref = $('a[rel="next"]').attr('href')
        || $('a').filter((_, element) => normalizeText($(element).text()) === 'Successiva').attr('href');
    return resolveUrl(pageUrl, nextHref);
}

export function extractImmobiliareAgencyDetails(
    html: string,
    detailUrl: string,
    baseRecord: Partial<CompanyInput>,
): CompanyInput {
    const $ = cheerio.load(html);
    const scripts = $('script[type="application/ld+json"]');
    let jsonLd: any = null;

    scripts.each((_, element) => {
        const raw = $(element).contents().text();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            const values = Array.isArray(parsed) ? parsed : [parsed];
            const match = values.find((entry) => entry && typeof entry === 'object' && (
                entry['@type'] === 'RealEstateAgent'
                || entry['@type'] === 'Organization'
            ));
            if (match && !jsonLd) {
                jsonLd = match;
            }
        } catch {
            // ignore malformed JSON-LD blocks
        }
    });

    const name = normalizeText($('h1').first().text())
        || normalizeText(jsonLd?.name)
        || baseRecord.company_name
        || 'Unknown agency';

    const website = resolveUrl(detailUrl, $('a[href]').filter((_, element) => {
        const href = $(element).attr('href') || '';
        const text = normalizeText($(element).text()) || '';
        return /sito web/i.test(text) || (/^https?:\/\//i.test(href) && !href.includes('immobiliare.it'));
    }).first().attr('href'));

    const emailHref = $('a[href^="mailto:"]').first().attr('href');
    const email = normalizeText(emailHref?.replace(/^mailto:/i, ''));

    const telHref = $('a[href^="tel:"]').first().attr('href');
    const phone = normalizeText(telHref?.replace(/^tel:/i, ''))
        || normalizeText(jsonLd?.telephone);

    const jsonLdAddress = parseJsonLdAddress(jsonLd?.address);
    const bodyText = normalizeText($.root().text()) || '';
    const addressLine = extractAddressLine(bodyText);

    return {
        company_name: name,
        category: baseRecord.category,
        source: baseRecord.source || 'Immobiliare',
        website: website || baseRecord.website,
        email: email || baseRecord.email,
        phone: phone || baseRecord.phone,
        address: jsonLdAddress.address || addressLine || baseRecord.address,
        city: jsonLdAddress.city || baseRecord.city,
        province: jsonLdAddress.province || baseRecord.province,
        zip_code: jsonLdAddress.zip_code || baseRecord.zip_code,
        immobiliare_url: detailUrl,
        portal_association: baseRecord.portal_association,
        portal_years_on_immobiliare: baseRecord.portal_years_on_immobiliare,
        portal_quality_score: baseRecord.portal_quality_score,
        portal_announcements: baseRecord.portal_announcements,
        portal_description: baseRecord.portal_description,
    };
}
