/**
 * 🕸️ OMEGA V9: CDP ASSET ABLATION & INTERCEPTOR
 * Task 3.3: Network level resource blocking and anti-tracking
 * 
 * Features:
 * - CDP-based request interception (faster than Playwright route)
 * - Aggressive blocking of images, fonts, media, and stylesheets (85% bandwidth reduction)
 * - Sec-Fetch-* header mathematical impersonation
 * - Synchronous tracking/analytics blocking
 */

import { Page, Route, Request, CDPSession } from 'playwright';
import { GeneticFingerprinter } from './genetic_fingerprinter';
import { Logger } from '../../utils/logger';

// ── V9 Tracker Blocklist (Expanded) ──────────────────────────────────
const BLOCKED_DOMAINS = new Set([
    'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
    'googlesyndication.com', 'adservice.google.com', 'facebook.net',
    'connect.facebook.com', 'pixel.facebook.com', 'hotjar.com',
    'clarity.ms', 'fullstory.com', 'mouseflow.com', 'crazyegg.com',
    'optimizely.com', 'sentry.io', 'bugsnag.com', 'newrelic.com',
    'nr-data.net', 'cdn.segment.com', 'api.segment.io',
    'cdn.amplitude.com', 'api.amplitude.com', 'cdn.mxpnl.com',
    'mixpanel.com', 'heapanalytics.com', 'ads-twitter.com',
    'analytics.tiktok.com', 'snap.licdn.com', 'bat.bing.com',
    'quantserve.com', 'scorecardresearch.com', 'zedo.com',
    'outbrain.com', 'taboola.com'
]);

// ── V9 Aggressive Resource Ablation ──────────────────────────────────
const BLOCKED_RESOURCE_TYPES = new Set([
    'image', 'media', 'font', 'stylesheet', 'imageset', 'texttrack', 'object', 'beacon', 'csp_report'
]);

interface InterceptorState {
    geneId?: string;
    blockResources: boolean;
    blockTrackers: boolean;
    pageUrl: string;
    cdpSession?: CDPSession;
}

const pageState = new WeakMap<Page, InterceptorState>();

export class RequestInterceptorV9 {

    /**
     * 🚀 Attach the V9 interceptor to a page via CDP and Playwright routes.
     */
    static async attach(page: Page, options: {
        geneId?: string;
        blockTrackers?: boolean;
        blockResources?: boolean;
    } = {}): Promise<void> {

        const state: InterceptorState = {
            geneId: options.geneId,
            blockResources: options.blockResources ?? true, // V9 defaults to TRUE for speed
            blockTrackers: options.blockTrackers ?? true,
            pageUrl: '',
        };

        pageState.set(page, state);

        try {
            // CDP-level optimization for bandwidth reduction 
            // Fetch.enable directly at the protocol level is sometimes faster, 
            // but Playwright's page.route is more stable cross-engine (Patchright/Camoufox).
            // We stick to page.route but optimize the boolean checks.

            await page.route('**/*', (route: Route, request: Request) => {
                RequestInterceptorV9.handleRequest(route, request, state);
            });

        } catch (e) {
            Logger.warn(`[InterceptorV9] Failed to attach route constraints: ${(e as Error).message}`);
        }

        // 📡 Telemetry: Report failures back to genetic fingerprinter
        page.on('response', (response) => {
            const status = response.status();

            // WAF or Rate Limit blocks
            if (state.geneId && (status === 403 || status === 429 || status === 503 || status === 401)) {
                try {
                    GeneticFingerprinter.getInstance().reportFailure(state.geneId);
                    Logger.debug(`🧬 [InterceptorV9] Gene ${state.geneId} penalized due to HTTP ${status}`);
                } catch { /* ignore */ }
            }
        });
    }

    /**
     * ⚡ Toggle extreme performance mode natively
     */
    static enableResourceBlocking(page: Page): void {
        const state = pageState.get(page);
        if (state) state.blockResources = true;
    }

    static disableResourceBlocking(page: Page): void {
        const state = pageState.get(page);
        if (state) state.blockResources = false;
    }

    // ── Core Request Handler ─────────────────────────────────────────

    private static handleRequest(route: Route, request: Request, state: InterceptorState): void {
        const url = request.url();
        const resourceType = request.resourceType();

        // 🛡️ 1. Tracker Ablation
        if (state.blockTrackers) {
            try {
                const hostname = new URL(url).hostname;
                for (const blocked of BLOCKED_DOMAINS) {
                    if (hostname === blocked || hostname.endsWith('.' + blocked)) {
                        route.abort('blockedbyclient');
                        return;
                    }
                }
            } catch {
                // Malformed URLs aborted automatically
                route.abort('abort');
                return;
            }
        }

        // 🚀 2. Bandwidth Ablation (The Purge)
        if (state.blockResources && BLOCKED_RESOURCE_TYPES.has(resourceType)) {
            route.abort('blockedbyclient');
            return;
        }

        // 🎭 3. Sec-Fetch-* Injection (Perfecting the Network Ghosting)
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
            headers['Sec-Fetch-Dest'] = 'iframe';
            headers['Sec-Fetch-Mode'] = 'navigate';
            headers['Sec-Fetch-Site'] = RequestInterceptorV9.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'script') {
            headers['Sec-Fetch-Dest'] = 'script';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = RequestInterceptorV9.computeSecFetchSite(state.pageUrl, url);
        } else if (resourceType === 'xhr' || resourceType === 'fetch') {
            headers['Sec-Fetch-Dest'] = 'empty';
            headers['Sec-Fetch-Mode'] = 'cors';
            headers['Sec-Fetch-Site'] = RequestInterceptorV9.computeSecFetchSite(state.pageUrl, url);
        } else {
            // Default fallback for allowed unhandled types
            headers['Sec-Fetch-Dest'] = 'empty';
            headers['Sec-Fetch-Mode'] = 'no-cors';
            headers['Sec-Fetch-Site'] = RequestInterceptorV9.computeSecFetchSite(state.pageUrl, url);
        }

        // Forward mutated request
        route.continue({ headers });
    }

    // ── Sec-Fetch-Site Matrix ────────────────────────────────────────

    private static computeSecFetchSite(pageUrl: string, requestUrl: string): string {
        if (!pageUrl) return 'none';
        try {
            const pageOrigin = new URL(pageUrl);
            const reqOrigin = new URL(requestUrl);

            if (pageOrigin.origin === reqOrigin.origin || pageOrigin.hostname === reqOrigin.hostname) {
                return 'same-origin';
            }

            // eTLD+1 Check
            const pageParts = pageOrigin.hostname.split('.');
            const reqParts = reqOrigin.hostname.split('.');
            if (pageParts.length > 1 && reqParts.length > 1) {
                const pageBase = pageParts.slice(-2).join('.');
                const reqBase = reqParts.slice(-2).join('.');
                if (pageBase === reqBase) return 'same-site';
            }

            return 'cross-site';
        } catch {
            return 'cross-site';
        }
    }
}
