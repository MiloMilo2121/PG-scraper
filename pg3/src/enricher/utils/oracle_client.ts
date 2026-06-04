import axios from 'axios';
import { Logger } from './logger';

export interface OracleConfig {
    host?: string;
    port?: number;
    timeout?: number;
}

export interface OracleCrawlResponse {
    url: string;
    html: string;
    markdown: string;
    success: boolean;
    error: string | null;
}

/**
 * 🐍 OMEGA PYTHON ORACLE CLIENT (2026 AI Bypass)
 * Acts as a bridge between Node.js and the local Crawl4AI Python FastAPI server.
 * Used for extreme cases where Cloudflare Turnstile or DataDome blocks standard proxies.
 */
export class OracleClient {
    private static resolveBaseUrl(): string {
        const explicitBaseUrl = process.env.ORACLE_BASE_URL?.trim() || process.env.ORACLE_API_BASE_URL?.trim();
        if (explicitBaseUrl) {
            return explicitBaseUrl.replace(/\/+$/, '');
        }

        const host = (process.env.ORACLE_HOST || '127.0.0.1').trim();
        const port = Number(process.env.ORACLE_PORT || '8765');
        const protocol = (process.env.ORACLE_PROTOCOL || 'http').trim().replace(/:$/, '');

        return `${protocol}://${host}:${port}/api/v1`;
    }

    /**
     * Executes a stealth crawl via the Python Oracle.
     * @param url The target URL blocked by Cloudflare/DataDome
     * @param timeoutMs Timeout in milliseconds (default: 60000)
     */
    static async fetchHtmlStealth(url: string, timeoutMs: number = 60000, jsCode?: string | string[], waitFor?: string): Promise<OracleCrawlResponse> {
        // [OMEGA AUTO-HEAL] Oracle disabled by user request to save RAM and use Serper/BrightData
        throw new Error('ORACLE_DISABLED_BY_USER');

        try {
            Logger.info(`[OracleClient] Passing ${url} to Python Oracle for stealth extraction...`);

            const payload: any = { url, bypass_cache: true };
            if (jsCode) payload.js_code = jsCode;
            if (waitFor) payload.wait_for = waitFor;

            const response = await axios.post(`${baseUrl}/extract`, payload, {
                timeout: timeoutMs,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data && response.data.success) {
                Logger.info(`[OracleClient] Oracle successfully bypassed and extracted: ${url}`);
                return response.data;
            } else {
                Logger.warn(`[OracleClient] Oracle task failed for ${url}: ${response.data.error}`);
                throw new Error(`Oracle Python Error: ${response.data.error}`);
            }

        } catch (error: any) {
            Logger.error(`[OracleClient] Communication with Python Oracle failed: ${error.message}`);
            // Check if server is running
            if (error.code === 'ECONNREFUSED') {
                Logger.error(`[OracleClient] CRITICAL: Python Oracle server is not reachable at ${baseUrl}!`);
                throw new Error('PYTHON_ORACLE_OFFLINE');
            }
            throw error;
        }
    }
}
