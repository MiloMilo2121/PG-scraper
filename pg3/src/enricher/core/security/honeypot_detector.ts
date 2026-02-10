
import * as dns from 'dns/promises';
import { URL } from 'url';
import { Logger } from '../../utils/logger';

export class HoneyPotDetector {
    private static instance: HoneyPotDetector;

    private constructor() { }

    public static getInstance(): HoneyPotDetector {
        if (!HoneyPotDetector.instance) {
            HoneyPotDetector.instance = new HoneyPotDetector();
        }
        return HoneyPotDetector.instance;
    }

    /**
     * Fast DNS check to see if domain is likely valid.
     * Real businesses usually have MX records. Parked domains often don't.
     */
    public async checkDNS(url: string): Promise<{ safe: boolean; reason?: string }> {
        const DNS_TIMEOUT_MS = 5000;
        try {
            const domain = new URL(url).hostname;
            const mx = await Promise.race([
                dns.resolveMx(domain).catch(() => []),
                new Promise<any[]>((resolve) => setTimeout(() => resolve([]), DNS_TIMEOUT_MS)),
            ]);

            // Heuristic: No MX records = Suspicious for a B2B company
            // (Exception: Some valid small scraping targets might stick to basic webmail, so we warn but don't hard block unless other signals align)
            if (mx.length === 0) {
                return { safe: true, reason: 'NO_MX_RECORDS_WARNING' };
            }

            return { safe: true };
        } catch (e) {
            // Check if domain resolves at all
            return { safe: false, reason: 'DNS_RESOLUTION_FAILED' };
        }
    }

    /**
     * Analyzes HTML content for trap indicators.
     */
    public analyzeContent(html: string): { safe: boolean; reason?: string } {
        // 1. Link Farm Detection
        const linkCount = (html.match(/<a /gi) || []).length;
        if (linkCount > 500) {
            return { safe: false, reason: 'LINK_FARM_DETECTED' };
        }

        // 2. Domain Parking Detection
        const lower = html.toLowerCase();
        const parkedKeywords = [
            'domain is for sale',
            'buy this domain',
            'godaddy_parked',
            'sedo_parking',
            'domain parked'
        ];

        for (const kw of parkedKeywords) {
            if (lower.includes(kw)) {
                return { safe: false, reason: 'PARKED_DOMAIN' };
            }
        }

        return { safe: true };
    }
}
