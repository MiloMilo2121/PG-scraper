/**
 * 🌐 DOMAIN VALIDATOR
 * Tasks 36-37: DNS/Ping check and SSL analysis
 */

import * as dns from 'dns';
import * as https from 'https';
import { Logger } from './logger';

export interface DomainHealth {
    dnsValid: boolean;
    sslValid: boolean;
    sslExpiry?: Date;
    responseTime?: number;
    error?: string;
}

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
