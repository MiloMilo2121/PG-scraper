/**
 * DOMAIN VALIDATOR
 * Tasks 36-37: DNS/Ping check, SSL analysis, and Parking detection.
 */

import * as dns from 'dns';
import * as https from 'https';
import axios from 'axios';
import { Logger } from './logger';

export interface DomainHealth {
    dnsValid: boolean;
    sslValid: boolean;
    sslExpiry?: Date;
    responseTime?: number;
    error?: string;
}

// Parking/junk indicators found in HTML HEAD responses
const PARKING_INDICATORS = [
    'domain is for sale', 'buy this domain', 'questo dominio è in vendita',
    'domain parked', 'godaddy', 'sedo.com', 'dan.com', 'afternic',
    'hugedomains', 'domain name is available', 'acquista questo dominio',
    'is available for purchase', 'parking', 'domaincontrol.com',
    'sedoparking', 'bodis.com', 'above.com', 'register this domain',
];

export class DomainValidator {
    /**
     * Task 36: Check if domain resolves via DNS
     */
    static async checkDNS(domain: string, timeoutMs: number = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            const hostname = this.extractHostname(domain);
            if (!hostname) {
                resolve(false);
                return;
            }

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, timeoutMs);

            dns.resolve(hostname, (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(!err);
            });
        });
    }

    /**
     * Bulk DNS check with high concurrency.
     * Returns only domains that resolve.
     */
    static async bulkCheckDNS(domains: string[], concurrency: number = 500, timeoutMs: number = 3000): Promise<string[]> {
        const results: string[] = [];
        const batches: string[][] = [];

        for (let i = 0; i < domains.length; i += concurrency) {
            batches.push(domains.slice(i, i + concurrency));
        }

        for (const batch of batches) {
            const checks = await Promise.all(
                batch.map(async (domain) => {
                    const ok = await this.checkDNS(domain, timeoutMs);
                    return ok ? domain : null;
                })
            );
            results.push(...checks.filter((d): d is string => !!d));
        }

        return results;
    }

    /**
     * Parking Page Filter: HEAD request + body sniff to detect parked domains.
     * Returns true if the domain appears to be a real website (not parked).
     */
    static async isNotParked(domain: string, timeoutMs: number = 8000): Promise<boolean> {
        const hostname = this.extractHostname(domain);
        if (!hostname) return false;

        const url = domain.startsWith('http') ? domain : `https://${hostname}`;

        try {
            const resp = await axios.get(url, {
                timeout: timeoutMs,
                maxRedirects: 3,
                validateStatus: () => true,
                responseType: 'text',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html',
                },
            });

            const body = typeof resp.data === 'string' ? resp.data.slice(0, 5000).toLowerCase() : '';

            // Empty or very short body = likely parked
            if (body.length < 100) return false;

            // Check for parking indicators
            for (const indicator of PARKING_INDICATORS) {
                if (body.includes(indicator)) {
                    Logger.info(`[DomainValidator] Parking detected for ${hostname}: "${indicator}"`);
                    return false;
                }
            }

            return true;
        } catch (err: any) {
            // Timeouts and DNS failures → domain is unreachable, don't waste a browser slot
            const code = err?.code || '';
            const msg = (err?.message || '').toLowerCase();
            if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
                code === 'ECONNREFUSED' || msg.includes('timeout')) {
                return false;
            }
            // Other transient errors (e.g. SSL handshake) — allow through cautiously
            return true;
        }
    }

    /**
     * Task 37: Analyze SSL certificate
     */
    static async checkSSL(url: string): Promise<{
        valid: boolean;
        expiry?: Date;
        error?: string;
    }> {
        return new Promise((resolve) => {
            try {
                const hostname = this.extractHostname(url);
                if (!hostname) {
                    resolve({ valid: false, error: 'Invalid URL' });
                    return;
                }

                const options = {
                    hostname,
                    port: 443,
                    method: 'HEAD',
                    timeout: 5000,
                };

                const req = https.request(options, (res) => {
                    const socket = res.socket as any;
                    if (socket.getPeerCertificate) {
                        const cert = socket.getPeerCertificate();
                        if (cert && cert.valid_to) {
                            const expiry = new Date(cert.valid_to);
                            resolve({
                                valid: expiry > new Date(),
                                expiry,
                            });
                            return;
                        }
                    }
                    resolve({ valid: true });
                });

                req.on('error', (e) => {
                    resolve({ valid: false, error: e.message });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({ valid: false, error: 'Timeout' });
                });

                req.end();
            } catch (e) {
                resolve({ valid: false, error: (e as Error).message });
            }
        });
    }

    /**
     * Full domain health check
     */
    static async checkHealth(url: string): Promise<DomainHealth> {
        const startTime = Date.now();

        const [dnsValid, sslResult] = await Promise.all([
            this.checkDNS(url),
            this.checkSSL(url),
        ]);

        return {
            dnsValid,
            sslValid: sslResult.valid,
            sslExpiry: sslResult.expiry,
            responseTime: Date.now() - startTime,
            error: sslResult.error,
        };
    }

    /**
     * Extract hostname from URL
     */
    private static extractHostname(url: string): string | null {
        try {
            // Add protocol if missing
            const fullUrl = url.startsWith('http') ? url : `https://${url}`;
            return new URL(fullUrl).hostname;
        } catch {
            return null;
        }
    }
}
