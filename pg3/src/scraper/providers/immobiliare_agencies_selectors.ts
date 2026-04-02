import * as cheerio from 'cheerio';
import { CompanyInput } from '../types';

export const IMMOBILIARE_BASE_HOST = 'immobiliare.it';
const IMMOBILIARE_BASE_URL = `https://www.${IMMOBILIARE_BASE_HOST}`;

export interface ImmobiliareAgencyCandidate {
    name: string;
    url: string;
    teaser?: string;
}

function compactText(value?: string | null): string {
    return (value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '');
}

function isImmobiliareHost(hostname: string): boolean {
    return normalizeHostname(hostname) === IMMOBILIARE_BASE_HOST;
}

function normalizeAbsoluteUrl(rawHref: string, baseUrl: string): string | null {
    try {
        const absolute = new URL(rawHref, baseUrl);
        absolute.hash = '';
        absolute.searchParams.delete('utm_source');
        absolute.searchParams.delete('utm_medium');
        absolute.searchParams.delete('utm_campaign');
        absolute.searchParams.delete('utm_term');
        absolute.searchParams.delete('utm_content');
        return absolute.toString();
    } catch {
        return null;
    }
}

function extractText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
    for (const selector of selectors) {
        const raw = compactText($(selector).first().text());
        if (raw) return raw;
    }
    return undefined;
}

function parseJsonLdBlocks($: cheerio.CheerioAPI): any[] {
    const blocks: any[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = compactText($(el).text());
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                blocks.push(...parsed);
            } else {
                blocks.push(parsed);
            }
        } catch {
            // ignore malformed JSON-LD
        }
    });
    return blocks;
}

function flattenJsonLdEntities(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.flatMap(flattenJsonLdEntities);
    }
    if (typeof value !== 'object') return [];

    const nested = [] as any[];
    if (value['@graph']) nested.push(...flattenJsonLdEntities(value['@graph']));
    if (value.mainEntity) nested.push(...flattenJsonLdEntities(value.mainEntity));
    if (value.itemListElement) nested.push(...flattenJsonLdEntities(value.itemListElement));
    return [value, ...nested];
}

function findBestJsonLdEntity(entities: any[]): any | null {
    const priorityTypes = new Set([
        'realestateagent',
        'localbusiness',
        'organization',
        'realestateagency',
    ]);

    for (const entity of entities) {
        const rawType = entity?.['@type'];
        const types = Array.isArray(rawType) ? rawType : [rawType];
        if (types.some((type) => priorityTypes.has(String(type || '').toLowerCase()))) {
            return entity;
        }
    }

    return entities.find((entity) => entity?.name || entity?.telephone || entity?.address) || null;
}

function isExternalWebsiteUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const host = normalizeHostname(parsed.hostname);

        if (host === IMMOBILIARE_BASE_HOST) return false;
        if (host.endsWith('facebook.com')) return false;
        if (host.endsWith('instagram.com')) return false;
        if (host.endsWith('linkedin.com')) return false;
        if (host.endsWith('youtube.com')) return false;
        if (host.endsWith('wa.me')) return false;
        if (host.endsWith('whatsapp.com')) return false;
        if (host.endsWith('google.com')) return false;
        if (host.endsWith('goo.gl')) return false;

        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function extractWebsiteFromAnchors($: cheerio.CheerioAPI): string | undefined {
    const preferredLabels = [
        'sito web',
        'website',
        'visita il sito',
        'vai al sito',
        'sito ufficiale',
        'home page',
    ];

    const anchors = $('a[href^="http"], a[href^="https"]');
    for (const el of anchors.toArray()) {
        const href = compactText($(el).attr('href'));
        if (!href || !isExternalWebsiteUrl(href)) continue;

        const label = compactText($(el).text() || $(el).attr('aria-label') || $(el).attr('title'));
        if (label && preferredLabels.some((token) => label.toLowerCase().includes(token))) {
            return href;
        }
    }

    for (const el of anchors.toArray()) {
        const href = compactText($(el).attr('href'));
        if (href && isExternalWebsiteUrl(href)) return href;
    }

    return undefined;
}

function extractEmailFromHtml($: cheerio.CheerioAPI): string | undefined {
    const mailto = $('a[href^="mailto:"]').first().attr('href');
    if (mailto) {
        const email = compactText(mailto.replace(/^mailto:/i, ''));
        if (email) return email;
    }

    const html = compactText($.html());
    const match = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0];
}

function extractPhoneFromHtml($: cheerio.CheerioAPI): string | undefined {
    const tel = $('a[href^="tel:"]').first().attr('href');
    if (tel) {
        const phone = compactText(tel.replace(/^tel:/i, ''));
        if (phone) return phone;
    }

    const bodyText = compactText($('body').text());
    const phoneMatch = bodyText.match(/(\+39\s?)?(0\d[\d\s./-]{5,}\d)/);
    return phoneMatch?.[0];
}

function extractAddressFromJsonLd(entity: any): string | undefined {
    const address = entity?.address;
    if (!address) return undefined;

    if (typeof address === 'string') return compactText(address);

    const street = compactText(address.streetAddress);
    const locality = compactText(address.addressLocality);
    const region = compactText(address.addressRegion);
    const postal = compactText(address.postalCode);

    return [street, locality, region, postal].filter(Boolean).join(', ') || undefined;
}

function extractAddressFromHtml($: cheerio.CheerioAPI): string | undefined {
    const labels = [
        'indirizzo',
        'address',
        'sede',
        'office',
        'studio',
    ];

    const bodyText = compactText($('body').text());
    for (const label of labels) {
        const re = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n\\r]+)`, 'i');
        const match = bodyText.match(re);
        if (match?.[1]) return compactText(match[1]);
    }

    const line = bodyText.split(' ').find((token) => /^(via|viale|corso|piazza|largo|strada|vicolo)/i.test(token));
    return line ? compactText(line) : undefined;
}

function extractCityProvince($: cheerio.CheerioAPI, entity: any): { city?: string; province?: string } {
    const address = entity?.address;
    if (address && typeof address === 'object') {
        const city = compactText(address.addressLocality);
        const province = compactText(address.addressRegion);
        return {
            city: city || undefined,
            province: province || undefined,
        };
    }

    const bodyText = compactText($('body').text());
    const cityMatch = bodyText.match(/\b([A-Z][a-zà-ù' -]{2,})\s*\(([A-Z]{2})\)/);
    if (cityMatch) {
        return { city: compactText(cityMatch[1]), province: cityMatch[2] };
    }

    return {};
}

function extractCompanyName($: cheerio.CheerioAPI, entity: any, fallbackName?: string): string | undefined {
    const name =
        compactText(entity?.name) ||
        extractText($, [
            'h1',
            'meta[property="og:title"]',
            'title',
            'meta[name="title"]',
        ]) ||
        fallbackName;

    if (!name) return undefined;
    return name.replace(/\s*\|\s*immobiliare\.it\s*$/i, '').trim();
}

function collectJsonLdEntity($: cheerio.CheerioAPI): any | null {
    const blocks = parseJsonLdBlocks($);
    const entities = blocks.flatMap(flattenJsonLdEntities);
    return findBestJsonLdEntity(entities);
}

export function slugifyImmobiliareLocation(value: string): string {
    return compactText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function buildImmobiliareDirectoryUrl(location: string, pageNumber = 1): string {
    const slug = slugifyImmobiliareLocation(location);
    const base = new URL(`/agenzie-immobiliari/${slug}/`, IMMOBILIARE_BASE_URL);
    if (pageNumber > 1) {
        base.searchParams.set('pag', String(pageNumber));
    }
    return base.toString();
}

export function isImmobiliareChallengeHtml(html: string, title = '', url = ''): boolean {
    const haystack = `${title}\n${url}\n${html}`.toLowerCase();
    return (
        haystack.includes('captcha-delivery.com') ||
        haystack.includes('geo.captcha-delivery.com') ||
        haystack.includes('please enable js') ||
        haystack.includes('disable any ad blocker') ||
        haystack.includes('just a moment') ||
        haystack.includes('verify you are human') ||
        haystack.includes('access denied') ||
        haystack.includes('cloudflare')
    );
}

export function extractImmobiliareAgencyCandidates(
    html: string,
    baseUrl: string
): ImmobiliareAgencyCandidate[] {
    const $ = cheerio.load(html);
    const seenUrls = new Set<string>();
    const candidates: ImmobiliareAgencyCandidate[] = [];

    const cardSelectors = [
        'article',
        'li',
        'section',
        'div[class*="card"]',
        'div[class*="agency"]',
        'div[class*="agenz"]',
        'div[class*="result"]',
    ];

    const cardNodes = new Set<any>();
    for (const selector of cardSelectors) {
        $(selector).each((_, el) => {
            cardNodes.add(el);
        });
    }

    const processAnchor = (anchor: any, containerText: string) => {
        const rawHref = compactText(anchor.attr('href'));
        if (!rawHref) return;
        const url = normalizeAbsoluteUrl(rawHref, baseUrl);
        if (!url) return;

        const parsed = new URL(url);
        if (!isImmobiliareHost(parsed.hostname)) return;
        if (!parsed.pathname.startsWith('/agenzie-immobiliari/')) return;
        if (new URL(baseUrl).pathname.replace(/\/+$/, '/') === parsed.pathname.replace(/\/+$/, '/')) return;
        if (seenUrls.has(url)) return;

        const name = compactText(
            anchor.text() ||
            anchor.attr('aria-label') ||
            anchor.attr('title') ||
            anchor.closest('a').text()
        );
        if (!name) return;

        const teaser = compactText(containerText).slice(0, 240) || undefined;
        candidates.push({ name, url, teaser });
        seenUrls.add(url);
    };

    for (const node of cardNodes) {
        const $node = $(node);
        const containerText = compactText($node.text());
        if (!containerText) continue;

        const hasAgencySignals = /(\bvia\b|\bindirizzo\b|\btelefono\b|\bsito\b|\bimmobiliare\b)/i.test(containerText);
        if (!hasAgencySignals && containerText.length < 25) continue;

        const anchors = $node.find('a[href*="/agenzie-immobiliari/"]');
        anchors.each((_, anchorEl) => processAnchor($(anchorEl), containerText));
    }

    if (candidates.length === 0) {
        $('a[href*="/agenzie-immobiliari/"]').each((_, anchorEl) => {
            processAnchor($(anchorEl), compactText($(anchorEl).parent().text()));
        });
    }

    return candidates;
}

export function extractImmobiliareNextPageUrl(html: string, currentUrl: string): string | undefined {
    const $ = cheerio.load(html);
    const anchors = $('a[href]');

    for (const el of anchors.toArray()) {
        const anchor = $(el);
        const href = compactText(anchor.attr('href'));
        if (!href) continue;

        const label = compactText(anchor.attr('rel')) + ' ' + compactText(anchor.attr('aria-label')) + ' ' + compactText(anchor.text());
        const candidateUrl = normalizeAbsoluteUrl(href, currentUrl);
        if (!candidateUrl) continue;

        const parsed = new URL(candidateUrl);
        if (!isImmobiliareHost(parsed.hostname)) continue;

        const looksLikeNext =
            /(^|\s)(next|avanti|successiva|pagina successiva)(\s|$)/i.test(label) ||
            parsed.searchParams.has('pag') ||
            parsed.searchParams.has('page');

        if (looksLikeNext && candidateUrl !== currentUrl) {
            return candidateUrl;
        }
    }

    return undefined;
}

export function extractImmobiliareAgencyDetails(
    html: string,
    currentUrl: string,
    fallback: Partial<CompanyInput> = {}
): Partial<CompanyInput> {
    const $ = cheerio.load(html);
    const entity = collectJsonLdEntity($);

    const name = extractCompanyName($, entity, fallback.company_name);
    const website = extractWebsiteFromAnchors($);
    const email = extractEmailFromHtml($);
    const phone = compactText(entity?.telephone) || extractPhoneFromHtml($);
    const address = extractAddressFromJsonLd(entity) || extractAddressFromHtml($);
    const cityProvince = extractCityProvince($, entity);

    return {
        company_name: name || fallback.company_name || '',
        website: website || fallback.website,
        email: email || fallback.email,
        phone: phone || fallback.phone,
        address: address || fallback.address,
        city: cityProvince.city || fallback.city,
        province: cityProvince.province || fallback.province,
        category: fallback.category || 'Agenzie immobiliari',
        source: 'Immobiliare',
        source_page_url: fallback.source_page_url || currentUrl,
        source_detail_url: currentUrl,
    };
}
