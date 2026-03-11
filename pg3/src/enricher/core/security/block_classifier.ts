/**
 * 🛡️ BLOCK CLASSIFIER
 * Centralized block-type detection and telemetry.
 * Replaces scattered inline block checks across scraper_client, search_provider, etc.
 *
 * Law 008: Silence is failure — every block is classified, recorded, and traceable.
 * Law 609: Screenshot debugging — records forensic reason codes.
 */

import { Logger } from '../../utils/logger';

/** Enumeration of block types encountered during scraping. */
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

/** Structured signature of a detected block event. */
export interface BlockSignature {
    type: BlockType;
    source: string;
    domain: string;
    timestamp: number;
    raw_signal?: string;
    waf_family?: 'cloudflare' | 'datadome' | 'generic_waf';
    challenge_type?: string;
}

/**
 * Centralized block classifier with per-domain telemetry tracking.
 */
export class BlockClassifier {
    /** Per-domain block count tracking for adaptive pacing. */
    private static domainBlockCounts = new Map<string, Map<BlockType, number>>();

    /**
     * Classify a response into a block type based on HTTP status and body content.
     *
     * @param statusCode - HTTP status code (0 for connection errors)
     * @param body - Response body text
     * @param url - The target URL
     * @param source - Source identifier (e.g., 'google', 'scrape_do', 'direct')
     * @returns BlockSignature with classified type
     */
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
                  challenge_type: cloudflareType === BlockType.CLOUDFLARE_TURNSTILE ? 'turnstile' : 'challenge'
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
                  challenge_type: challengeType
              };
          }

          // Status-based classification
          if (statusCode === 429) {
              return { type: BlockType.RATE_LIMIT_429, source, domain, timestamp, raw_signal: '429', waf_family: 'generic_waf', challenge_type: 'rate_limit' };
          }

        if (statusCode === 403) {
            // Distinguish WAF from CAPTCHA on 403
              if (BlockClassifier.hasCaptchaSignals(lowerBody)) {
                  return { type: BlockType.CAPTCHA, source, domain, timestamp, raw_signal: '403+captcha_signals', waf_family: 'generic_waf', challenge_type: 'captcha' };
              }
              return { type: BlockType.WAF_403, source, domain, timestamp, raw_signal: '403', waf_family: 'generic_waf', challenge_type: 'block' };
          }

        if (statusCode === 0) {
            return { type: BlockType.CONNECTION_REFUSED, source, domain, timestamp, raw_signal: 'connection_error' };
        }

        // Body-based classification (for 200s that are actually blocks)
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

    /**
     * Classify an error (e.g., from network failures, timeouts).
     */
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

    /**
     * Record a block event for telemetry tracking.
     */
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

    /**
     * Get block profile for a domain — used by adaptive pacing.
     */
    static getBlockProfile(domain: string): Map<BlockType, number> {
        return BlockClassifier.domainBlockCounts.get(domain) ?? new Map();
    }

    /**
     * Get total block count for a domain across all types.
     */
    static getTotalBlocks(domain: string): number {
        const profile = BlockClassifier.getBlockProfile(domain);
        let total = 0;
        // Law 209: Array.from is safer than iterator for ts-node/downlevel
        for (const count of Array.from(profile.values())) {
            total += count;
        }
        return total;
    }

    /**
     * Check if a domain is considered "hot" (too many recent blocks).
     * Used for circuit-breaker decisions (Law 902).
     */
    static isDomainHot(domain: string, threshold: number = 5): boolean {
        return BlockClassifier.getTotalBlocks(domain) >= threshold;
    }

    /**
     * Reset block counters for a domain (e.g., after cooldown period).
     */
    static resetDomain(domain: string): void {
        BlockClassifier.domainBlockCounts.delete(domain);
    }

    /** Reset all block tracking data. */
    static resetAll(): void {
        BlockClassifier.domainBlockCounts.clear();
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

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
            'turnstile',
            'unusual traffic',
            'traffico insolito',
            '/sorry/',
            'verify you are human',
            'verifica di essere umano',
            'challenge-platform',
            'cf-challenge',
            'challenge-form',
        ];
        return CAPTCHA_INDICATORS.some(indicator => lowerBody.includes(indicator));
    }

      private static hasChallengeSignals(lowerBody: string): boolean {
          const CHALLENGE_INDICATORS = [
              'access denied',
              'accesso negato',
              'forbidden',
            'please enable javascript',
            'checking your browser',
            'just a moment',
            'attention required',
            'bot detection',
            'automated access',
          ];
          return CHALLENGE_INDICATORS.some(indicator => lowerBody.includes(indicator));
      }

      private static detectCloudflare(lowerBody: string): BlockType.CLOUDFLARE_TURNSTILE | BlockType.CLOUDFLARE_CHALLENGE | null {
          if (
              lowerBody.includes('cf-turnstile') ||
              lowerBody.includes('challenges.cloudflare.com/turnstile') ||
              lowerBody.includes('cf-turnstile-response')
          ) {
              return BlockType.CLOUDFLARE_TURNSTILE;
          }

          if (
              lowerBody.includes('cf-ray') ||
              lowerBody.includes('challenge-platform') ||
              lowerBody.includes('cf-challenge') ||
              lowerBody.includes('just a moment') ||
              lowerBody.includes('attention required')
          ) {
              return BlockType.CLOUDFLARE_CHALLENGE;
          }

          return null;
      }

      private static detectDataDome(lowerBody: string): BlockType.DATADOME_DEVICE_CHECK | BlockType.DATADOME_CAPTCHA | BlockType.DATADOME_BLOCK | null {
          if (
              lowerBody.includes('geo.captcha-delivery.com') ||
              lowerBody.includes('captcha-delivery.com') ||
              lowerBody.includes('datadome captcha')
          ) {
              return BlockType.DATADOME_CAPTCHA;
          }

          if (
              lowerBody.includes('js.datadome.co/tags.js') ||
              lowerBody.includes('device check') && lowerBody.includes('datadome')
          ) {
              return BlockType.DATADOME_DEVICE_CHECK;
          }

          if (
              lowerBody.includes('protected by datadome') ||
              lowerBody.includes('datadome') && lowerBody.includes('access denied')
          ) {
              return BlockType.DATADOME_BLOCK;
          }

          return null;
      }
  }
