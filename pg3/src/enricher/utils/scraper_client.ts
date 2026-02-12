import axios, { AxiosResponse } from 'axios';
import * as http from 'http';
import * as https from 'https';

import { config } from '../config';
import { Logger } from './logger';

// Connection pooling - reuse TCP connections for massive speedup
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 25, maxFreeSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25, maxFreeSockets: 10, rejectUnauthorized: false });

export type ScraperClientMode = 'auto' | 'direct' | 'scrape_do' | 'jina_reader' | 'jina_search';

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
  via: 'direct' | 'scrape_do' | 'jina_reader' | 'jina_search';
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

  public static isJinaEnabled(): boolean {
    return !!(config.jina?.enabled && config.jina.apiKey && config.jina.apiKey.trim().length > 0);
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
      validateStatus: () => true,
      responseType: 'text',
      decompress: true,
      httpAgent,
      httpsAgent,
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
      httpAgent,
      httpsAgent,
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

  // =========================================================================
  // 🧠 JINA AI INTEGRATION
  // =========================================================================

  /**
   * 📖 Jina Reader: Converts any URL to clean Markdown.
   * Uses r.jina.ai — no browser, no proxy needed.
   * Returns trimmed content up to maxContentLength.
   */
  public static async fetchJinaReader(targetUrl: string, options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    if (!this.isJinaEnabled()) {
      throw new Error('JINA_API_KEY missing or JINA_ENABLED is not true');
    }

    const timeoutMs = options.timeoutMs ?? config.jina.timeoutMs;
    const maxLen = config.jina.maxContentLength;
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.jina.apiKey}`,
      'X-Return-Format': 'markdown',
      'Accept': 'text/plain',
    };

    Logger.info('[JinaReader] Fetching', { host: safeHost(targetUrl) });

    const resp = await withRetry(async () => {
      const r = await axios.get(jinaUrl, {
        timeout: timeoutMs,
        headers,
        validateStatus: () => true,
        responseType: 'text',
        decompress: true,
      });
      return r;
    }, options.maxRetries ?? 1);

    let body = typeof resp.data === 'string' ? resp.data : String(resp.data);
    // Trim to save tokens downstream
    if (body.length > maxLen) {
      body = body.slice(0, maxLen);
    }

    return {
      via: 'jina_reader',
      status: resp.status,
      finalUrl: targetUrl,
      headers: resp.headers as any,
      data: body,
    };
  }

  /**
   * 🔍 Jina Search: Executes a search query and returns results as Markdown.
   * Uses s.jina.ai — replaces Google/Bing/DDG scraping entirely.
   * Returns structured search results without any browser.
   */
  public static async fetchJinaSearch(query: string, options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    if (!this.isJinaEnabled()) {
      throw new Error('JINA_API_KEY missing or JINA_ENABLED is not true');
    }

    const timeoutMs = options.timeoutMs ?? config.jina.timeoutMs;
    const encodedQuery = encodeURIComponent(query);
    const jinaUrl = `https://s.jina.ai/${encodedQuery}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.jina.apiKey}`,
      'Accept': 'application/json',
    };

    Logger.info('[JinaSearch] Searching', { query: query.slice(0, 80) });

    const resp = await withRetry(async () => {
      const r = await axios.get(jinaUrl, {
        timeout: timeoutMs,
        headers,
        validateStatus: () => true,
        responseType: 'text',
        decompress: true,
      });
      return r;
    }, options.maxRetries ?? 1);

    const body = typeof resp.data === 'string' ? resp.data : String(resp.data);

    return {
      via: 'jina_search',
      status: resp.status,
      finalUrl: jinaUrl,
      headers: resp.headers as any,
      data: body,
    };
  }

  /**
   * 🧠 Extract URLs from Jina Search results (JSON response).
   * Returns an array of {title, url, description}.
   */
  public static parseJinaSearchResults(rawData: string): Array<{ title: string; url: string; description: string }> {
    try {
      const parsed = JSON.parse(rawData);
      const results: Array<{ title: string; url: string; description: string }> = [];

      // Jina returns { data: [ { title, url, description, content }, ... ] }
      const items = parsed?.data || parsed?.results || (Array.isArray(parsed) ? parsed : []);
      for (const item of items) {
        if (item.url && typeof item.url === 'string') {
          results.push({
            title: item.title || '',
            url: item.url,
            description: item.description || item.content || '',
          });
        }
      }
      return results;
    } catch {
      // Fallback: try extracting URLs from markdown text
      const urlRegex = /https?:\/\/[^\s)"'<>]+/g;
      const matches = rawData.match(urlRegex) || [];
      return matches.map((url) => ({ title: '', url, description: '' }));
    }
  }
}
