import { request, Agent, ProxyAgent } from 'undici';
import { config } from '../config';
import { Logger } from './logger';
import { BlockClassifier, BlockType } from '../core/security/block_classifier';

// Connection pooling - reuse TCP connections for massive speedup
const globalDispatcher = new Agent({
  keepAliveTimeout: 15000,
  keepAliveMaxTimeout: 30000,
  connections: 50,
  connect: {
    rejectUnauthorized: false
  }
});

export type ScraperClientMode = 'auto' | 'direct' | 'scrape_do' | 'brightdata' | 'jina_reader' | 'jina_search';

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
  via: 'direct' | 'scrape_do' | 'brightdata' | 'jina_reader' | 'jina_search';
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

function looksBlocked(status: number, body: string, url: string = ''): boolean {
  const sig = BlockClassifier.classify(status, body, url, 'scraper_client');
  if (sig.type !== BlockType.NONE) {
    BlockClassifier.recordBlock(sig);
    return true;
  }
  // Legacy fallback: keep original status-code checks for edge cases
  if ([401, 407, 451, 503].includes(status)) return true;
  return false;
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
    'fatturatoitalia.it',
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

  public static isBrightDataEnabled(): boolean {
    return !!(config.brightData?.webUnlockerUrl && config.brightData.webUnlockerUrl.trim().length > 0);
  }

  /** @deprecated Jina AI permanently removed — internal DomDistiller fallback is used instead */
  public static isJinaEnabled(): boolean {
    return false;
  }

  private static defaultHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  private static async directGet(url: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    const timeoutMs = options.timeoutMs ?? 15000;

    const { statusCode, headers, body } = await request(url, {
      method: 'GET',
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      dispatcher: globalDispatcher,
      // @ts-ignore
      maxRedirections: 5,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    const dataObj = await body.text();
    return {
      via: 'direct',
      status: statusCode,
      finalUrl: url,
      headers: headers as any,
      data: dataObj,
    };
  }

  private static async brightDataGet(targetUrl: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    if (!this.isBrightDataEnabled()) {
      throw new Error('BRIGHTDATA_WEB_UNLOCKER_URL missing');
    }

    const timeoutMs = options.timeoutMs ?? 30000;

    // Web Unlocker operates via proxy authentication
    const proxyAgent = new ProxyAgent({
      uri: config.brightData.webUnlockerUrl!,
      connect: { rejectUnauthorized: false },
      keepAliveTimeout: 10000,
      keepAliveMaxTimeout: 15000,
    });

    const { statusCode, headers, body } = await request(targetUrl, {
      method: 'GET',
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      dispatcher: proxyAgent,
      // @ts-ignore
      maxRedirections: 5,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    const dataObj = await body.text();
    return {
      via: 'brightdata',
      status: statusCode,
      finalUrl: targetUrl,
      headers: headers as any,
      data: dataObj,
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

    const urlParams = new URLSearchParams({
      token: config.scrapeDo.token!,
      url: targetUrl,
      geoCode
    });

    if (render) urlParams.append('render', 'true');
    if (superMode) urlParams.append('super', 'true');

    const scrapeDoUrl = `${config.scrapeDo.apiUrl}?${urlParams.toString()}`;

    const { statusCode, headers, body } = await request(scrapeDoUrl, {
      method: 'GET',
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      dispatcher: globalDispatcher,
      // @ts-ignore
      maxRedirections: 0,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    const dataObj = await body.text();

    return {
      via: 'scrape_do',
      status: statusCode,
      finalUrl: targetUrl,
      headers: headers as any,
      data: dataObj,
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

    if (mode === 'brightdata') {
      return await withRetry(() => this.brightDataGet(targetUrl, options), retries);
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
    if (!looksBlocked(direct.status, direct.data, targetUrl)) {
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

  /** @deprecated Jina AI permanently removed */
  public static async fetchJinaReader(_targetUrl: string, _options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    throw new Error('JINA_REMOVED: Jina AI has been permanently removed from OMEGA. Use DomDistiller fallback.');
  }

  /** @deprecated Jina AI permanently removed */
  public static async fetchJinaSearch(_query: string, _options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    throw new Error('JINA_REMOVED: Jina AI has been permanently removed from OMEGA. Use DomDistiller fallback.');
  }

  public static parseJinaSearchResults(rawData: string): Array<{ title: string; url: string; description: string }> {
    try {
      const parsed = JSON.parse(rawData);
      const results: Array<{ title: string; url: string; description: string }> = [];

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
      const urlRegex = /https?:\/\/[^\s)"'<>]+/g;
      const matches = rawData.match(urlRegex) || [];
      return matches.map((url) => ({ title: '', url, description: '' }));
    }
  }
}
