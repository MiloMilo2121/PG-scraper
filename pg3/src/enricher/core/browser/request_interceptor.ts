/**
 * REQUEST INTERCEPTOR - "Invisible Crowd"
 * Centralized request-level anti-detection
 *
 * Features:
 * - Sec-Fetch-* header injection on every request
 * - Known tracker/analytics domain blocking
 * - Automatic response status reporting to genetic fingerprinter
 * - Resource blocking mode for fast page loads
 */

import { Page, HTTPRequest } from 'puppeteer';
import { GeneticFingerprinter } from './genetic_fingerprinter';
import { Logger } from '../../utils/logger';

// ── Tracker blocklist ────────────────────────────────────────────────

const BLOCKED_DOMAINS = new Set([
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
    'facebook.net',
    'connect.facebook.com',
    'pixel.facebook.com',
    'hotjar.com',
    'clarity.ms',
    'fullstory.com',
    'mouseflow.com',
    'crazyegg.com',
    'optimizely.com',
    'sentry.io',
    'bugsnag.com',
    'newrelic.com',
    'nr-data.net',
    'cdn.segment.com',
    'api.segment.io',
    'cdn.amplitude.com',
    'api.amplitude.com',
    'cdn.mxpnl.com',
    'mixpanel.com',
    'heapanalytics.com',
    'ads-twitter.com',
    'analytics.tiktok.com',
    'snap.licdn.com',
    'bat.bing.com',
]);

// ── Blocked resource types for fast mode ─────────────────────────────

const BLOCKED_RESOURCE_TYPES = new Set([
    'image', 'media', 'font', 'stylesheet',
]);

// ── Per-page state ───────────────────────────────────────────────────

const pageState = new WeakMap<Page, {
    geneId?: string;
    blockResources: boolean;
    blockTrackers: boolean;
    pageUrl: string;
}>();

// ── Main class ───────────────────────────────────────────────────────

export class RequestInterceptor {
    /**
     * Attach the interceptor to a page.
     * Must be called BEFORE any navigation.
     */
    static async attach(page: Page, options: {
        geneId?: string;
        blockTrackers?: boolean;
        blockResources?: boolean;
    } = {}): Promise<void> {
        const state = {
            geneId: options.geneId,
            blockResources: options.blockResources ?? false,
            blockTrackers: options.blockTrackers ?? true,
            pageUrl: '',
        };
        pageState.set(page, state);

        // Enable request interception if not already enabled
        try {
            await page.setRequestInterception(true);
        } catch {
            // Already enabled by another caller (e.g., unified_discovery_service)
        }

        page.on('request', (request: HTTPRequest) => {
            this.handleRequest(request, state);
        });

        // Response listener for auto-reporting blocks
        page.on('response', (response) => {
            const status = response.status();
            const url = response.url();

            if (state.geneId && (status === 403 || status === 429 || status === 503)) {
                try {
                    const domain = new URL(url).hostname.replace(/^www\./, '');
                    GeneticFingerprinter.getInstance().reportFailure(state.geneId);
                } catch {
                    // Invalid URL, skip
                }
            }
        });
    }

    /**
     * Enable resource blocking on an already-intercepted page.
     * Use for fast page loads where we only need HTML.
     */
    static enableResourceBlocking(page: Page): void {
        const state = pageState.get(page);
        if (state) {
            state.blockResources = true;
        }
    }

    /**
     * Disable resource blocking.
     */
    static disableResourceBlocking(page: Page): void {
        const state = pageState.get(page);
        if (state) {
            state.blockResources = false;
        }
    }

    // ── Request handler ──────────────────────────────────────────────

    private static handleRequest(request: HTTPRequest, state: {
        blockResources: boolean;
        blockTrackers: boolean;
        pageUrl: string;
    }): void {
        const url = request.url();
        const resourceType = request.resourceType();

        // Block tracked domains
        if (state.blockTrackers) {
            try {
                const hostname = new URL(url).hostname;
                for (const blocked of BLOCKED_DOMAINS) {
                    if (hostname === blocked || hostname.endsWith('.' + blocked)) {
                        request.abort('blockedbyclient');
                        return;
                    }
                }
            } catch {
                // Invalid URL, let it through
            }
        }

        // Block heavy resources in fast mode
        if (state.blockResources && BLOCKED_RESOURCE_TYPES.has(resourceType)) {
            request.abort('blockedbyclient');
            return;
        }

        // Inject Sec-Fetch-* headers
        const headers = { ...request.headers() };
        const isNavigation = resourceType === 'document';
        const isMainFrame = request.isNavigationRequest();

        if (isNavigation && isMainFrame) {
            headers['Sec-Fetch-Dest'] = 'document';
            headers['Sec-Fetch-Mode'] = 'navigate';
            headers['Sec-Fetch-Site'] = 'none';
            headers['Sec-Fetch-User'] = '?1';
            state.pageUrl = url;
        } else if (isNavigation) {
            // Iframe navigation
            headers['Sec-Fetch-Dest'] = 'iframe';
            headers['Sec-Fetch-Mode'] = 'navigate';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'script') {
            headers['Sec-Fetch-Dest'] = 'script';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'xhr' || resourceType === 'fetch') {
            headers['Sec-Fetch-Dest'] = 'empty';
            headers['Sec-Fetch-Mode'] = 'cors';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'stylesheet') {
            headers['Sec-Fetch-Dest'] = 'style';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'image') {
            headers['Sec-Fetch-Dest'] = 'image';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        } else {
            headers['Sec-Fetch-Dest'] = 'empty';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = this.computeSecFetchSite(state.pageUrl, url);
        }

        request.continue({ headers });
    }

    // ── Sec-Fetch-Site computation ───────────────────────────────────

    private static computeSecFetchSite(pageUrl: string, requestUrl: string): string {
        if (!pageUrl) return 'none';
        try {
            const pageOrigin = new URL(pageUrl);
            const reqOrigin = new URL(requestUrl);

            if (pageOrigin.origin === reqOrigin.origin) return 'same-origin';
            if (pageOrigin.hostname === reqOrigin.hostname) return 'same-origin';

            // Check same site (same registrable domain)
            const pageParts = pageOrigin.hostname.split('.');
            const reqParts = reqOrigin.hostname.split('.');
            const pageBase = pageParts.slice(-2).join('.');
            const reqBase = reqParts.slice(-2).join('.');
            if (pageBase === reqBase) return 'same-site';

            return 'cross-site';
        } catch {
            return 'cross-site';
        }
    }
}
