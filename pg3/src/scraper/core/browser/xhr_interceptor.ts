/**
 * 📡 OMEGA V9: XHR/FETCH PAYLOAD INTERCEPTOR
 *
 * Extracts raw JSON from SPA backend calls and annotates GraphQL envelopes when present.
 */

import { Page, Response } from 'playwright';
import { Logger } from '../../utils/logger';

export interface GraphQLMetadata {
    operationName?: string;
    variables?: Record<string, unknown>;
    hasPersistedQuery: boolean;
    hasErrors: boolean;
}

export interface CapturedPayload {
    url: string;
    method: string;
    status: number;
    contentType: string;
    body: any; // Parsed JSON or raw text
    requestBody?: unknown;
    graphql?: GraphQLMetadata;
    timestamp: number;
}

interface XHRInterceptorOptions {
    capturePatterns: RegExp[];
    maxPayloads?: number;
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

                if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

                const matches = options.capturePatterns.some((pattern) => pattern.test(url));
                if (!matches) return;

                const status = response.status();
                const contentType = response.headers()['content-type'] || '';
                const isJson = contentType.includes('application/json');
                if (!isJson && !captureText) return;

                let body: unknown;
                try {
                    const text = await response.text();
                    body = isJson ? JSON.parse(text) : text;
                } catch {
                    return;
                }

                const requestBody = XHRInterceptor.parseRequestBody(request.postData());
                const graphql = XHRInterceptor.detectGraphQLPayload(url, requestBody, body);

                if (payloads.length >= maxPayloads) {
                    payloads.shift();
                }

                payloads.push({
                    url,
                    method: request.method(),
                    status,
                    contentType,
                    body,
                    requestBody,
                    graphql,
                    timestamp: Date.now(),
                });

                Logger.debug(`📡 [XHRInterceptor] Captured ${request.method()} ${url} (${status})`);
            } catch {
                // Non-blocking interception
            }
        });
    }

    static getPayloads(page: Page): CapturedPayload[] {
        return pagePayloads.get(page) ?? [];
    }

    static findPayloads(page: Page, pattern: RegExp): CapturedPayload[] {
        return XHRInterceptor.getPayloads(page).filter((payload) => pattern.test(payload.url));
    }

    static findGraphQLPayloads(page: Page, operationPattern?: RegExp): CapturedPayload[] {
        return XHRInterceptor.getPayloads(page).filter((payload) => {
            if (!payload.graphql) return false;
            if (!operationPattern) return true;
            return operationPattern.test(payload.graphql.operationName || '');
        });
    }

    static clearPayloads(page: Page): void {
        const payloads = pagePayloads.get(page);
        if (payloads) payloads.length = 0;
    }

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
                // Ignore malformed payloads
            }
        }

        return results;
    }

    static detectGraphQLPayload(url: string, requestBody?: unknown, responseBody?: unknown): GraphQLMetadata | undefined {
        const requestEnvelope = XHRInterceptor.asGraphQLEnvelope(requestBody);
        const responseEnvelope = XHRInterceptor.asGraphQLEnvelope(responseBody);
        const looksGraphQL = /graphql/i.test(url) || !!requestEnvelope || !!responseEnvelope;

        if (!looksGraphQL) return undefined;

        const requestRecord = requestEnvelope || {};
        const responseRecord = responseEnvelope || {};
        const extensions = (requestRecord.extensions && typeof requestRecord.extensions === 'object')
            ? requestRecord.extensions as Record<string, unknown>
            : {};

        return {
            operationName: typeof requestRecord.operationName === 'string'
                ? requestRecord.operationName
                : typeof responseRecord.operationName === 'string'
                    ? responseRecord.operationName
                    : undefined,
            variables: typeof requestRecord.variables === 'object'
                ? requestRecord.variables as Record<string, unknown>
                : undefined,
            hasPersistedQuery: !!(extensions.persistedQuery),
            hasErrors: Array.isArray(responseRecord.errors) && responseRecord.errors.length > 0,
        };
    }

    private static parseRequestBody(postData: string | null): unknown {
        if (!postData) return undefined;
        try {
            return JSON.parse(postData);
        } catch {
            return postData;
        }
    }

    private static asGraphQLEnvelope(value: unknown): Record<string, unknown> | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const record = value as Record<string, unknown>;
        if ('query' in record || 'operationName' in record || 'data' in record || 'errors' in record) {
            return record;
        }

        return undefined;
    }
}
