/**
 * 📡 OMEGA V9: XHR/FETCH PAYLOAD INTERCEPTOR
 * Task 4.2: Extracting raw JSON from SPA backend calls.
 *
 * Problem: Modern sites load data via XHR/Fetch after initial HTML render.
 *          Parsing HTML that is DOM-rendered client-side wastes bandwidth and CPU.
 * Solution: Intercept XHR/Fetch responses at the network level, extract raw JSON.
 *           This is strictly more efficient and more reliable than HTML parsing for SPAs.
 *
 * Law 002: O(1) JSON parse vs O(n) DOM traversal.
 * Law 603: Request Interception - only load what contains data.
 */

import { Page, Response } from 'playwright';
import { Logger } from '../../utils/logger';

export interface CapturedPayload {
    url: string;
    method: string;
    status: number;
    contentType: string;
    body: any; // Parsed JSON or raw text
    timestamp: number;
}

interface XHRInterceptorOptions {
    /** URL patterns to capture (regex). Only matching XHR/Fetch responses are stored. */
    capturePatterns: RegExp[];
    /** Maximum number of payloads to retain in memory per page. */
    maxPayloads?: number;
    /** If true, also captures non-JSON text responses. Default: false (JSON only). */
    captureText?: boolean;
}

const pagePayloads = new WeakMap<Page, CapturedPayload[]>();

export class XHRInterceptor {

    /**
     * 🚀 Attach the XHR interceptor to a page.
     * Must be called BEFORE navigation.
     */
    static async attach(page: Page, options: XHRInterceptorOptions): Promise<void> {
        const payloads: CapturedPayload[] = [];
        pagePayloads.set(page, payloads);

        const maxPayloads = options.maxPayloads ?? 50;
        const captureText = options.captureText ?? false;

        page.on('response', async (response: Response) => {
            try {
                const url = response.url();
                const request = response.request();
                const resourceType = request.resourceType();

                // Only intercept XHR and Fetch requests
                if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

                // Check if URL matches any capture pattern
                const matches = options.capturePatterns.some(pattern => pattern.test(url));
                if (!matches) return;

                const status = response.status();
                const contentType = response.headers()['content-type'] || '';
                const isJson = contentType.includes('application/json');

                if (!isJson && !captureText) return;

                // Extract body
                let body: any;
                try {
                    const text = await response.text();
                    body = isJson ? JSON.parse(text) : text;
                } catch {
                    return; // Body extraction failed (redirects, etc.)
                }

                // Store payload
                if (payloads.length >= maxPayloads) {
                    payloads.shift(); // FIFO eviction
                }

                payloads.push({
                    url,
                    method: request.method(),
                    status,
                    contentType,
                    body,
                    timestamp: Date.now(),
                });

                Logger.debug(`📡 [XHRInterceptor] Captured ${request.method()} ${url} (${status})`);
            } catch {
                // Silent — non-blocking interception
            }
        });
    }

    /**
     * 📦 Retrieve all captured payloads for a page.
     */
    static getPayloads(page: Page): CapturedPayload[] {
        return pagePayloads.get(page) ?? [];
    }

    /**
     * 🔍 Find payloads matching a URL pattern.
     */
    static findPayloads(page: Page, pattern: RegExp): CapturedPayload[] {
        return XHRInterceptor.getPayloads(page).filter(p => pattern.test(p.url));
    }

    /**
     * 🧹 Clear captured payloads (memory hygiene).
     */
    static clearPayloads(page: Page): void {
        const payloads = pagePayloads.get(page);
        if (payloads) payloads.length = 0;
    }

    /**
     * 📊 Extract specific fields from captured JSON payloads.
     * Useful for extracting company data from SPA API calls.
     */
    static extractFields<T>(page: Page, urlPattern: RegExp, fieldExtractor: (body: any) => T | null): T[] {
        const payloads = XHRInterceptor.findPayloads(page, urlPattern);
        const results: T[] = [];

        for (const payload of payloads) {
            try {
                const extracted = fieldExtractor(payload.body);
                if (extracted !== null) {
                    results.push(extracted);
                }
            } catch {
                // Extraction failed for this payload
            }
        }

        return results;
    }
}
