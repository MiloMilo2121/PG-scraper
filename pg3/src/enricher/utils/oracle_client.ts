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
    private static baseUrl = 'http://127.0.0.1:8000/api/v1';

    /**
     * Executes a stealth crawl via the Python Oracle.
     * @param url The target URL blocked by Cloudflare/DataDome
     * @param timeoutMs Timeout in milliseconds (default: 60000)
     */
    static async fetchHtmlStealth(url: string, timeoutMs: number = 60000): Promise<OracleCrawlResponse> {
        try {
            Logger.info(`[OracleClient] Passing ${url} to Python Oracle for stealth extraction...`);

            const response = await axios.post(`${this.baseUrl}/extract`, {
                url: url,
                bypass_cache: true
            }, {
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
                Logger.error('[OracleClient] CRITICAL: Python Oracle server is not running on port 8000!');
                throw new Error('PYTHON_ORACLE_OFFLINE');
            }
            throw error;
        }
    }
}
