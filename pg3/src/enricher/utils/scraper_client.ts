import axios, { AxiosResponse } from 'axios';

import { config } from '../config';
import { Logger } from './logger';

export type ScraperClientMode = 'auto' | 'direct' | 'scrape_do';

export interface ScraperClientOptions {
  mode?: ScraperClientMode;
  render?: boolean;
  super?: boolean;
  geoCode?: string;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface ScraperClientResponse {
  via: 'direct' | 'scrape_do';
  status: number;
  finalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  data: string;
}

function toBoolParam(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? 'true' : 'false';
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'invalid-url';
  }
}

function looksBlocked(status: number, body: string): boolean {
  if ([401, 403, 407, 429, 451, 503].includes(status)) return true;
  const lower = body.toLowerCase();
  const patterns = [
    'accesso bloccato',
    'access denied',
    'request blocked',
    'unusual traffic',
    'traffico insolito',
    'captcha',
    'are you a robot',
    'verifica che tu sia un essere umano',
    'ddos-guard',
    'cloudflare',
  ];
  return patterns.some((p) => lower.includes(p));
}

function isHardTarget(url: string): boolean {
  const host = safeHost(url);
  const hard = [
    'google.',
    'duckduckgo.com',
    'bing.com',
    'reportaziende.it',
    'ufficiocamerale.it',
    'registroimprese.it',
    'informazione-aziende.it',
  ];
  return hard.some((h) => host.includes(h));
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      const delayMs = 400 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class ScraperClient {
  public static isScrapeDoEnabled(): boolean {
    return !!(config.scrapeDo?.token && config.scrapeDo.token.trim().length > 0);
  }

  private static defaultHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  private static async directGet(url: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const resp = await axios.get(url, {
      timeout: timeoutMs,
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      maxRedirects: 5,
      // Always capture status/body: we need to detect anti-bot pages and fallback.
      validateStatus: () => true,
      responseType: 'text',
      decompress: true,
    });

    const body = typeof resp.data === 'string' ? resp.data : String(resp.data);
    const finalUrl = (resp.request?.res?.responseUrl as string | undefined) || url;
    return {
      via: 'direct',
      status: resp.status,
      finalUrl,
      headers: resp.headers as any,
      data: body,
    };
  }

  private static async scrapeDoGet(targetUrl: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    if (!this.isScrapeDoEnabled()) {
      throw new Error('SCRAPE_DO_TOKEN missing');
    }

    const timeoutMs = options.timeoutMs ?? config.scrapeDo.timeoutMs;
    const geoCode = (options.geoCode || config.scrapeDo.geoCode || 'it').toLowerCase();
    const render = options.render ?? config.scrapeDo.renderDefault ?? false;
    const superMode = options.super ?? config.scrapeDo.super ?? false;

    // NOTE: Scrape.do recommends URL-encoding; axios params handles this safely.
    const resp = await axios.get(config.scrapeDo.apiUrl, {
      timeout: timeoutMs,
      params: {
        token: config.scrapeDo.token,
        url: targetUrl,
        render: toBoolParam(render),
        super: toBoolParam(superMode),
        geoCode,
      },
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      decompress: true,
    });

    const body = typeof resp.data === 'string' ? resp.data : String(resp.data);

    // Scrape.do returns the target HTML. The status is of the Scrape.do API call,
    // not necessarily the target status.
    return {
      via: 'scrape_do',
      status: resp.status,
      finalUrl: targetUrl,
      headers: resp.headers as any,
      data: body,
    };
  }

  public static async fetchHtml(targetUrl: string, options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    const mode: ScraperClientMode = options.mode || 'auto';
    const retries = options.maxRetries ?? 1;

    if (mode === 'direct') {
      return await withRetry(() => this.directGet(targetUrl, options), retries);
    }

    if (mode === 'scrape_do') {
      return await withRetry(() => this.scrapeDoGet(targetUrl, options), retries);
    }

    // AUTO MODE:
    // - for hard targets, go Scrape.do first (if configured)
    // - otherwise try direct, then fallback to Scrape.do if blocked
    const preferScrapeDoFirst = this.isScrapeDoEnabled() && isHardTarget(targetUrl);

    if (preferScrapeDoFirst) {
      try {
        return await withRetry(() => this.scrapeDoGet(targetUrl, options), retries);
      } catch (e) {
        Logger.warn('[ScraperClient] Scrape.do failed, falling back to direct', {
          host: safeHost(targetUrl),
          error: e as Error,
        });
        return await withRetry(() => this.directGet(targetUrl, options), retries);
      }
    }

    const direct = await withRetry(() => this.directGet(targetUrl, options), retries);
    if (!looksBlocked(direct.status, direct.data)) {
      return direct;
    }

    if (!this.isScrapeDoEnabled()) {
      return direct;
    }

    Logger.info('[ScraperClient] Direct request looks blocked; retrying via Scrape.do', { host: safeHost(targetUrl) });
    return await withRetry(() => this.scrapeDoGet(targetUrl, options), retries);
  }

  public static async fetchText(targetUrl: string, options: ScraperClientOptions = {}): Promise<string> {
    const res = await this.fetchHtml(targetUrl, options);
    return res.data;
  }
}

