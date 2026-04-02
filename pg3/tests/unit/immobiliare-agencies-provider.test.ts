import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { Page } from 'playwright';
import {
    buildImmobiliareDirectoryUrl,
    extractImmobiliareAgencyCandidates,
    extractImmobiliareAgencyDetails,
    extractImmobiliareNextPageUrl,
    isImmobiliareChallengeHtml,
} from '../../src/scraper/providers/immobiliare_agencies_selectors';
import { ImmobiliareAgenciesProvider } from '../../src/scraper/providers/immobiliare_agencies';

function createFakePage(routes: Record<string, string>, startUrl: string): Page {
    let currentUrl = startUrl;
    let currentHtml = routes[startUrl] || '';

    const createDocumentShim = (html: string, baseUrl: string) => {
        const $ = cheerio.load(html);
        const wrap = (el: any): any => {
            if (!el) return null;
            const $el = $(el);
            const wrapper: any = {};

            Object.defineProperty(wrapper, 'textContent', {
                get: () => $el.text(),
            });
            Object.defineProperty(wrapper, 'innerText', {
                get: () => $el.text(),
            });
            Object.defineProperty(wrapper, 'href', {
                get: () => {
                    const raw = $el.attr('href');
                    if (!raw) return '';
                    return new URL(raw, baseUrl).toString();
                },
            });
            Object.defineProperty(wrapper, 'parentElement', {
                get: () => wrap(el.parent),
            });
            wrapper.getAttribute = (name: string) => $el.attr(name) || null;
            wrapper.querySelectorAll = (selector: string) => $el.find(selector).toArray().map((child) => wrap(child));
            wrapper.querySelector = (selector: string) => wrap($el.find(selector).first().get(0));
            return wrapper;
        };

        return {
            body: wrap($('body').get(0) || $('html').get(0)),
            querySelectorAll: (selector: string) => $(selector).toArray().map((el) => wrap(el)),
            querySelector: (selector: string) => wrap($(selector).first().get(0)),
        };
    };

    return {
        goto: async (url: string) => {
            currentUrl = url;
            currentHtml = routes[url] || routes[new URL(url).toString()] || '';
            return null as any;
        },
        content: async () => currentHtml,
        title: async () => currentHtml.match(/<title>(.*?)<\/title>/i)?.[1] || '',
        url: () => currentUrl,
        locator: () => ({
            innerText: async () => currentHtml
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
        }),
        waitForTimeout: async () => undefined,
        evaluate: async (fn: any, arg?: any) => {
            const previousDocument = (globalThis as any).document;
            const previousWindow = (globalThis as any).window;
            const documentShim = createDocumentShim(currentHtml, currentUrl);

            (globalThis as any).document = documentShim;
            (globalThis as any).window = { document: documentShim };
            try {
                return await fn(arg);
            } finally {
                (globalThis as any).document = previousDocument;
                (globalThis as any).window = previousWindow;
            }
        },
    } as unknown as Page;
}

describe('immobiliare agencies provider', () => {
    it('builds a directory URL for a location', () => {
        expect(buildImmobiliareDirectoryUrl('Milano')).toBe('https://www.immobiliare.it/agenzie-immobiliari/milano/');
        expect(buildImmobiliareDirectoryUrl('Milano', 2)).toBe('https://www.immobiliare.it/agenzie-immobiliari/milano/?pag=2');
    });

    it('detects challenge pages', () => {
        const html = '<html><body>Please enable JS and disable any ad blocker<script src="https://ct.captcha-delivery.com/i.js"></script></body></html>';
        expect(isImmobiliareChallengeHtml(html, 'immobiliare.it', 'https://www.immobiliare.it/agenzie-immobiliari/milano/')).toBe(true);
    });

    it('extracts candidates and detail data from immobiliare pages', () => {
        const listingHtml = `
            <html>
              <body>
                <article>
                  <h2><a href="/agenzie-immobiliari/12345/studio-test/">Studio Test</a></h2>
                  <div>Via Roma 1 - Milano - Sito web</div>
                </article>
                <a rel="next" href="/agenzie-immobiliari/milano/?pag=2">Next</a>
              </body>
            </html>
        `;
        const candidates = extractImmobiliareAgencyCandidates(listingHtml, 'https://www.immobiliare.it/agenzie-immobiliari/milano/');
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.name).toBe('Studio Test');
        expect(candidates[0]?.url).toBe('https://www.immobiliare.it/agenzie-immobiliari/12345/studio-test/');
        expect(extractImmobiliareNextPageUrl(listingHtml, 'https://www.immobiliare.it/agenzie-immobiliari/milano/')).toBe('https://www.immobiliare.it/agenzie-immobiliari/milano/?pag=2');

        const detailHtml = `
            <html>
              <head>
                <title>Studio Test | immobiliare.it</title>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "RealEstateAgent",
                    "name": "Studio Test",
                    "telephone": "+39 02 1234567",
                    "address": {
                      "@type": "PostalAddress",
                      "streetAddress": "Via Roma 1",
                      "addressLocality": "Milano",
                      "addressRegion": "MI",
                      "postalCode": "20100"
                    }
                  }
                </script>
              </head>
              <body>
                <h1>Studio Test</h1>
                <a href="https://www.studiotest.it/">Sito web</a>
                <a href="mailto:info@studiotest.it">info@studiotest.it</a>
                <a href="tel:+39 02 1234567">Chiama</a>
              </body>
            </html>
        `;
        const details = extractImmobiliareAgencyDetails(detailHtml, 'https://www.immobiliare.it/agenzie-immobiliari/12345/studio-test/', {
            company_name: 'Studio Test',
            city: 'Milano',
            category: 'Agenzie immobiliari',
        });

        expect(details.company_name).toBe('Studio Test');
        expect(details.website).toBe('https://www.studiotest.it/');
        expect(details.email).toBe('info@studiotest.it');
        expect(details.phone).toBe('+39 02 1234567');
        expect(details.address).toContain('Via Roma 1');
        expect(details.city).toBe('Milano');
        expect(details.province).toBe('MI');
    });

    it('scrapes agencies through a browser-first flow', async () => {
        const listingUrl = 'https://www.immobiliare.it/agenzie-immobiliari/milano/';
        const detailUrl = 'https://www.immobiliare.it/agenzie-immobiliari/12345/studio-test/';
        const listingHtml = `
            <html>
              <body>
                <article>
                  <h2><a href="/agenzie-immobiliari/12345/studio-test/">Studio Test</a></h2>
                  <div>Via Roma 1 - Milano</div>
                </article>
              </body>
            </html>
        `;
        const detailHtml = `
            <html>
              <body>
                <h1>Studio Test</h1>
                <a href="https://www.studiotest.it/">Sito web</a>
                <a href="mailto:info@studiotest.it">info@studiotest.it</a>
              </body>
            </html>
        `;
        const page = createFakePage({
            [listingUrl]: listingHtml,
            [detailUrl]: detailHtml,
        }, listingUrl);

        const results = await ImmobiliareAgenciesProvider.scrapeAll(page, {
            location: 'Milano',
            maxPages: 1,
            includeDetails: true,
        });
        expect(results).toHaveLength(1);
        expect(results[0]?.company_name).toBe('Studio Test');
        expect(results[0]?.website).toBe('https://www.studiotest.it/');
        expect(results[0]?.email).toBe('info@studiotest.it');
        expect(results[0]?.source).toBe('Immobiliare');
    });
});
