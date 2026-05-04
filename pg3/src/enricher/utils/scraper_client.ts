import { fetch, Agent, ProxyAgent } from 'undici';
import { config } from '../config';
import { Logger } from './logger';
import { BlockClassifier, BlockType } from '../core/security/block_classifier';
import { shouldRelaxTlsForUrl } from '../../shared-runtime/browser/tls_policy';

// Connection pooling - reuse TCP connections for massive speedup
const dispatcherOptions = {
  keepAliveTimeout: 15000,
  keepAliveMaxTimeout: 30000,
  connections: 50,
};
const strictDispatcher = new Agent(dispatcherOptions);
let relaxedDispatcher: Agent | null = null;

export type ScraperClientMode = 'auto' | 'direct' | 'brightdata' | 'oracle';

export interface ScraperClientOptions {
  mode?: ScraperClientMode;
  render?: boolean;
  super?: boolean;
  geoCode?: string;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  allowOracleFallback?: boolean;
}

export interface ScraperClientResponse {
  via: 'direct' | 'brightdata' | 'oracle';
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

function getDispatcherForUrl(url: string): Agent {
  if (!shouldRelaxTlsForUrl(url)) {
    return strictDispatcher;
  }

  if (!relaxedDispatcher) {
    relaxedDispatcher = new Agent({
      ...dispatcherOptions,
      connect: { rejectUnauthorized: false },
    } as any);
  }

  return relaxedDispatcher;
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
  public static isBrightDataEnabled(): boolean {
    const hasProxyUrl = !!(config.brightData?.webUnlockerUrl && config.brightData.webUnlockerUrl.trim().length > 0);
    const hasApiToken = !!(config.brightData?.apiToken && config.brightData.apiToken.trim().length > 0);
    return hasProxyUrl || hasApiToken;
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
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      dispatcher: getDispatcherForUrl(url),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const dataObj = await response.text();
    return {
      via: 'direct',
      status: response.status,
      finalUrl: response.url || url,
      headers: Object.fromEntries(response.headers.entries()),
      data: dataObj,
    };
  }

  private static async brightDataGet(targetUrl: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    if (!this.isBrightDataEnabled()) {
      throw new Error('BrightData Web Unlocker configuration missing');
    }

    const timeoutMs = options.timeoutMs ?? 30000;

    // Use API Token approach if configured
    if (config.brightData?.apiToken) {
      const zone = config.brightData.webUnlockerZone || 'web_unlocker1';
      const response = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.brightData.apiToken}`,
        },
        body: JSON.stringify({
          zone: zone,
          url: targetUrl,
          format: 'raw',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const dataObj = await response.text();
      return {
        via: 'brightdata',
        status: response.status,
        finalUrl: targetUrl,
        headers: Object.fromEntries(response.headers.entries()),
        data: dataObj,
      };
    }

    // Fallback to Proxy URL approach
    const proxyUrl = config.brightData.webUnlockerUrl!;
    const proxyAgentOptions: Record<string, unknown> = {
      uri: proxyUrl,
      keepAliveTimeout: 10000,
      keepAliveMaxTimeout: 15000,
    };
    if (shouldRelaxTlsForUrl(proxyUrl)) {
      proxyAgentOptions.connect = { rejectUnauthorized: false };
    }
    const proxyAgent = new ProxyAgent(proxyAgentOptions as any);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { ...this.defaultHeaders(), ...(options.headers || {}) },
      dispatcher: proxyAgent,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const dataObj = await response.text();
    return {
      via: 'brightdata',
      status: response.status,
      finalUrl: response.url || targetUrl,
      headers: Object.fromEntries(response.headers.entries()),
      data: dataObj,
    };
  }



  private static async oracleGet(targetUrl: string, options: ScraperClientOptions): Promise<ScraperClientResponse> {
    const timeoutMs = options.timeoutMs ?? 60000;
    const { OracleClient } = await import('./oracle_client');
    const result = await OracleClient.fetchHtmlStealth(targetUrl, timeoutMs);

    return {
      via: 'oracle',
      status: result.success ? 200 : 503,
      finalUrl: targetUrl,
      headers: {},
      data: result.html || '',
    };
  }

  private static async runAuto(targetUrl: string, options: ScraperClientOptions, retries: number): Promise<ScraperClientResponse> {
    const allowOracleFallback = options.allowOracleFallback ?? true;
    const steps: Array<{ label: string; run: () => Promise<ScraperClientResponse> }> = [
      {
        label: 'direct',
        run: () => this.directGet(targetUrl, options),
      },
    ];

    if (allowOracleFallback) {
      steps.push({
        label: 'oracle',
        run: () => this.oracleGet(targetUrl, options),
      });
    }

    if (this.isBrightDataEnabled()) {
      steps.push({
        label: 'brightdata_unlocker',
        run: () => this.brightDataGet(targetUrl, options),
      });
    }

    let lastError: Error | null = null;
    let lastResponse: ScraperClientResponse | null = null;

    for (const step of steps) {
      try {
        const response = await withRetry(() => step.run(), retries);
        lastResponse = response;

        if (!looksBlocked(response.status, response.data, targetUrl)) {
          return response;
        }

        Logger.warn('[ScraperClient] Step looks blocked; escalating', {
          host: safeHost(targetUrl),
          via: response.via,
          step: step.label,
          status: response.status,
        });
      } catch (error) {
        lastError = error as Error;
        Logger.warn('[ScraperClient] Step failed; escalating', {
          host: safeHost(targetUrl),
          step: step.label,
          error: error as Error,
        });
      }
    }

    if (lastResponse) {
      return lastResponse;
    }

    throw lastError || new Error(`AUTO_FETCH_FAILED: ${targetUrl}`);
  }

  public static async fetchHtml(targetUrl: string, options: ScraperClientOptions = {}): Promise<ScraperClientResponse> {
    const mode: ScraperClientMode = options.mode || 'auto';
    const retries = options.maxRetries ?? 1;

    if (mode === 'direct') {
      return await withRetry(() => this.directGet(targetUrl, options), retries);
    }



    if (mode === 'brightdata') {
      return await withRetry(() => this.brightDataGet(targetUrl, options), retries);
    }

    if (mode === 'oracle') {
      return await withRetry(() => this.oracleGet(targetUrl, options), retries);
    }

    return await this.runAuto(targetUrl, options, retries);
  }

  public static async fetchText(targetUrl: string, options: ScraperClientOptions = {}): Promise<string> {
    const res = await this.fetchHtml(targetUrl, options);
    return res.data;
  }
}
