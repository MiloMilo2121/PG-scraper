/**
 * Shared block classifier for browser runtime and network guards.
 * This keeps browser/runtime consumers off enricher internals while preserving
 * the same classification semantics.
 */

import { Logger } from '../logging/Logger';

export enum BlockType {
    CAPTCHA = 'CAPTCHA',
    WAF_403 = 'WAF_403',
    RATE_LIMIT_429 = 'RATE_LIMIT_429',
    CHALLENGE_PAGE = 'CHALLENGE_PAGE',
    CLOUDFLARE_TURNSTILE = 'CLOUDFLARE_TURNSTILE',
    CLOUDFLARE_CHALLENGE = 'CLOUDFLARE_CHALLENGE',
    DATADOME_DEVICE_CHECK = 'DATADOME_DEVICE_CHECK',
    DATADOME_CAPTCHA = 'DATADOME_CAPTCHA',
    DATADOME_BLOCK = 'DATADOME_BLOCK',
    TIMEOUT = 'TIMEOUT',
    CONNECTION_REFUSED = 'CONNECTION_REFUSED',
    EMPTY_RESPONSE = 'EMPTY_RESPONSE',
    NONE = 'NONE',
}

export interface BlockSignature {
    type: BlockType;
    source: string;
    domain: string;
    timestamp: number;
    raw_signal?: string;
    waf_family?: 'cloudflare' | 'datadome' | 'generic_waf';
    challenge_type?: string;
}

export class BlockClassifier {
    private static domainBlockCounts = new Map<string, Map<BlockType, number>>();

    static classify(
        statusCode: number,
        body: string,
        url: string,
        source: string = 'unknown',
    ): BlockSignature {
        const domain = BlockClassifier.extractDomain(url);
        const lowerBody = body.toLowerCase();
        const timestamp = Date.now();

        const cloudflareType = BlockClassifier.detectCloudflare(lowerBody);
        if (cloudflareType) {
            return {
                type: cloudflareType,
                source,
                domain,
                timestamp,
                raw_signal: cloudflareType === BlockType.CLOUDFLARE_TURNSTILE ? 'cloudflare_turnstile' : 'cloudflare_challenge',
                waf_family: 'cloudflare',
                challenge_type: cloudflareType === BlockType.CLOUDFLARE_TURNSTILE ? 'turnstile' : 'challenge',
            };
        }

        const dataDomeType = BlockClassifier.detectDataDome(lowerBody);
        if (dataDomeType) {
            const challengeType = dataDomeType === BlockType.DATADOME_DEVICE_CHECK
                ? 'device_check'
                : dataDomeType === BlockType.DATADOME_CAPTCHA
                    ? 'captcha'
                    : 'block';
            return {
                type: dataDomeType,
                source,
                domain,
                timestamp,
                raw_signal: `datadome_${challengeType}`,
                waf_family: 'datadome',
                challenge_type: challengeType,
            };
        }

        if (statusCode === 429) {
            return { type: BlockType.RATE_LIMIT_429, source, domain, timestamp, raw_signal: '429', waf_family: 'generic_waf', challenge_type: 'rate_limit' };
        }

        if (statusCode === 403) {
            if (BlockClassifier.hasCaptchaSignals(lowerBody)) {
                return { type: BlockType.CAPTCHA, source, domain, timestamp, raw_signal: '403+captcha_signals', waf_family: 'generic_waf', challenge_type: 'captcha' };
            }
            return { type: BlockType.WAF_403, source, domain, timestamp, raw_signal: '403', waf_family: 'generic_waf', challenge_type: 'block' };
        }

        if (statusCode === 0) {
            return { type: BlockType.CONNECTION_REFUSED, source, domain, timestamp, raw_signal: 'connection_error' };
        }

        if (BlockClassifier.hasCaptchaSignals(lowerBody)) {
            return { type: BlockType.CAPTCHA, source, domain, timestamp, raw_signal: 'captcha_in_body', waf_family: 'generic_waf', challenge_type: 'captcha' };
        }

        if (BlockClassifier.hasChallengeSignals(lowerBody)) {
            return { type: BlockType.CHALLENGE_PAGE, source, domain, timestamp, raw_signal: 'challenge_page', waf_family: 'generic_waf', challenge_type: 'challenge' };
        }

        if (body.length < 200 && statusCode >= 200 && statusCode < 300) {
            return { type: BlockType.EMPTY_RESPONSE, source, domain, timestamp, raw_signal: `body_len=${body.length}` };
        }

        return { type: BlockType.NONE, source, domain, timestamp };
    }

    static classifyError(error: Error, url: string, source: string = 'unknown'): BlockSignature {
        const domain = BlockClassifier.extractDomain(url);
        const timestamp = Date.now();
        const message = error.message.toLowerCase();

        if (message.includes('timeout') || message.includes('timed out') || message.includes('navigation timeout')) {
            return { type: BlockType.TIMEOUT, source, domain, timestamp, raw_signal: error.message.slice(0, 200) };
        }

        if (message.includes('econnrefused') || message.includes('econnreset') || message.includes('enotfound')) {
            return { type: BlockType.CONNECTION_REFUSED, source, domain, timestamp, raw_signal: error.message.slice(0, 200) };
        }

        return { type: BlockType.CHALLENGE_PAGE, source, domain, timestamp, raw_signal: error.message.slice(0, 200) };
    }

    static recordBlock(sig: BlockSignature): void {
        if (sig.type === BlockType.NONE) return;

        if (!BlockClassifier.domainBlockCounts.has(sig.domain)) {
            BlockClassifier.domainBlockCounts.set(sig.domain, new Map());
        }

        const domainCounts = BlockClassifier.domainBlockCounts.get(sig.domain)!;
        domainCounts.set(sig.type, (domainCounts.get(sig.type) || 0) + 1);

        Logger.warn(`[BlockClassifier] 🚫 ${sig.type} on ${sig.domain} via ${sig.source}`, {
            raw_signal: sig.raw_signal,
        });
    }

    static getBlockProfile(domain: string): Map<BlockType, number> {
        return BlockClassifier.domainBlockCounts.get(domain) ?? new Map();
    }

    static getTotalBlocks(domain: string): number {
        const profile = BlockClassifier.getBlockProfile(domain);
        let total = 0;
        for (const count of Array.from(profile.values())) {
            total += count;
        }
        return total;
    }

    static isDomainHot(domain: string, threshold: number = 5): boolean {
        return BlockClassifier.getTotalBlocks(domain) >= threshold;
    }

    static resetDomain(domain: string): void {
        BlockClassifier.domainBlockCounts.delete(domain);
    }

    static resetAll(): void {
        BlockClassifier.domainBlockCounts.clear();
    }

    private static extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return 'unknown';
        }
    }

    private static hasCaptchaSignals(lowerBody: string): boolean {
        const CAPTCHA_INDICATORS = [
            'captcha',
            'recaptcha',
            'hcaptcha',
            'verify you are human',
            'verifica di non essere un robot',
            'non sei un robot',
            'conferma di essere umano',
            'bot detection',
            'unusual traffic',
        ];
        return CAPTCHA_INDICATORS.some((indicator) => lowerBody.includes(indicator));
    }

    private static hasChallengeSignals(lowerBody: string): boolean {
        const CHALLENGE_INDICATORS = [
            'challenge',
            'just a moment',
            'verifying your browser',
            'enable javascript',
            'browser is not supported',
            'access denied',
            'temporarily blocked',
        ];
        return CHALLENGE_INDICATORS.some((indicator) => lowerBody.includes(indicator));
    }

    private static detectCloudflare(lowerBody: string): BlockType | null {
        if (!lowerBody.includes('cloudflare')) {
            return null;
        }
        if (lowerBody.includes('turnstile')) {
            return BlockType.CLOUDFLARE_TURNSTILE;
        }
        return BlockType.CLOUDFLARE_CHALLENGE;
    }

    private static detectDataDome(lowerBody: string): BlockType | null {
        if (!lowerBody.includes('datadome')) {
            return null;
        }
        if (lowerBody.includes('device check')) {
            return BlockType.DATADOME_DEVICE_CHECK;
        }
        if (lowerBody.includes('captcha')) {
            return BlockType.DATADOME_CAPTCHA;
        }
        return BlockType.DATADOME_BLOCK;
    }
}
