import { describe, expect, it, beforeEach } from 'vitest';
import { BlockClassifier, BlockType } from '../../src/enricher/core/security/block_classifier';

describe('BlockClassifier', () => {

    beforeEach(() => {
        BlockClassifier.resetAll();
    });

    // =========================================================================
    // STATUS CODE CLASSIFICATION
    // =========================================================================

    it('classifies 429 as RATE_LIMIT_429', () => {
        const sig = BlockClassifier.classify(429, '', 'https://google.com/search?q=test', 'google');
        expect(sig.type).toBe(BlockType.RATE_LIMIT_429);
        expect(sig.domain).toBe('google.com');
        expect(sig.source).toBe('google');
    });

    it('classifies 403 without CAPTCHA signals as WAF_403', () => {
        const sig = BlockClassifier.classify(403, '<html>Forbidden</html>', 'https://example.it', 'direct');
        expect(sig.type).toBe(BlockType.WAF_403);
    });

    it('classifies 403 with CAPTCHA signals as CAPTCHA', () => {
        const sig = BlockClassifier.classify(
            403,
            '<html>Please complete the CAPTCHA to continue</html>',
            'https://google.com',
            'direct'
        );
        expect(sig.type).toBe(BlockType.CAPTCHA);
    });

    it('classifies connection error (status 0) as CONNECTION_REFUSED', () => {
        const sig = BlockClassifier.classify(0, '', 'https://dead-site.it', 'direct');
        expect(sig.type).toBe(BlockType.CONNECTION_REFUSED);
    });

    // =========================================================================
    // BODY-BASED CLASSIFICATION
    // =========================================================================

    it('detects CAPTCHA signals in 200 response body', () => {
        const captchaBody = `
            <html>
                <div class="cf-challenge">
                    <h2>Traffico insolito rilevato</h2>
                    <div id="turnstile-container"></div>
                </div>
            </html>
        `;
        const sig = BlockClassifier.classify(200, captchaBody, 'https://target.it', 'scrape_do');
        expect(sig.type).toBe(BlockType.CAPTCHA);
    });

    it('detects challenge page signals', () => {
        const challengeBody = '<html><body>Checking your browser before accessing...</body></html>';
        const sig = BlockClassifier.classify(200, challengeBody, 'https://target.it', 'direct');
        expect(sig.type).toBe(BlockType.CHALLENGE_PAGE);
    });

    it('detects empty response body', () => {
        const sig = BlockClassifier.classify(200, '', 'https://target.it', 'direct');
        expect(sig.type).toBe(BlockType.EMPTY_RESPONSE);
    });

    it('returns NONE for clean 200 response', () => {
        const cleanBody = `
            <html>
                <head><title>Rossi Impianti SRL - Home</title></head>
                <body>
                    <h1>Benvenuti</h1>
                    <p>Siamo specializzati in impianti elettrici a Milano.</p>
                    <p>P.IVA 12345678901</p>
                    <p>Tel: 02 1234567</p>
                </body>
            </html>
        `;
        const sig = BlockClassifier.classify(200, cleanBody, 'https://rossi-impianti.it', 'direct');
        expect(sig.type).toBe(BlockType.NONE);
    });

    // =========================================================================
    // ERROR CLASSIFICATION
    // =========================================================================

    it('classifies timeout errors', () => {
        const sig = BlockClassifier.classifyError(
            new Error('Navigation timeout exceeded: 30000ms'),
            'https://slow-site.it',
            'browser'
        );
        expect(sig.type).toBe(BlockType.TIMEOUT);
    });

    it('classifies connection refused errors', () => {
        const sig = BlockClassifier.classifyError(
            new Error('connect ECONNREFUSED 1.2.3.4:443'),
            'https://dead.it',
            'direct'
        );
        expect(sig.type).toBe(BlockType.CONNECTION_REFUSED);
    });

    // =========================================================================
    // TELEMETRY TRACKING
    // =========================================================================

    it('tracks per-domain block counts', () => {
        const sig1 = BlockClassifier.classify(429, '', 'https://google.com', 'search');
        BlockClassifier.recordBlock(sig1);
        BlockClassifier.recordBlock(sig1);

        const sig2 = BlockClassifier.classify(403, '<html>Forbidden</html>', 'https://google.com', 'search');
        BlockClassifier.recordBlock(sig2);

        const profile = BlockClassifier.getBlockProfile('google.com');
        expect(profile.get(BlockType.RATE_LIMIT_429)).toBe(2);
        expect(profile.get(BlockType.WAF_403)).toBe(1);
    });

    it('reports domain as hot after threshold blocks', () => {
        for (let i = 0; i < 5; i++) {
            const sig = BlockClassifier.classify(429, '', 'https://example.it', 'test');
            BlockClassifier.recordBlock(sig);
        }
        expect(BlockClassifier.isDomainHot('example.it')).toBe(true);
        expect(BlockClassifier.isDomainHot('clean.it')).toBe(false);
    });

    it('resets domain block counts', () => {
        const sig = BlockClassifier.classify(429, '', 'https://example.it', 'test');
        BlockClassifier.recordBlock(sig);
        expect(BlockClassifier.getTotalBlocks('example.it')).toBe(1);

        BlockClassifier.resetDomain('example.it');
        expect(BlockClassifier.getTotalBlocks('example.it')).toBe(0);
    });

    it('does not record NONE type blocks', () => {
        // Body must exceed 200 chars to avoid EMPTY_RESPONSE classification
        const longBody = '<html><body>' + 'Contenuto normale della pagina aziendale con informazioni dettagliate. '.repeat(5) + '</body></html>';
        const sig = BlockClassifier.classify(200, longBody, 'https://ok.it', 'test');
        BlockClassifier.recordBlock(sig);
        expect(BlockClassifier.getTotalBlocks('ok.it')).toBe(0);
    });

    // =========================================================================
    // DOMAIN EXTRACTION
    // =========================================================================

    it('strips www prefix from domain', () => {
        const sig = BlockClassifier.classify(429, '', 'https://www.example.it', 'test');
        expect(sig.domain).toBe('example.it');
    });

    it('handles invalid URLs gracefully', () => {
        const sig = BlockClassifier.classify(429, '', 'not-a-url', 'test');
        expect(sig.domain).toBe('unknown');
    });
});
