import { MemoryFirstCache } from './MemoryFirstCache';
import { CostLedger } from './CostLedger';
import * as http from 'http';
import * as https from 'https';

export type VerificationResult = 'VERIFIED' | 'VERIFIED_SEMANTIC' | 'NEEDS_BROWSER' | 'REJECTED' | 'PARKED';

const PARKING_SIGNATURES = [
    'domain is for sale',
    'sedo.com',
    'is parked',
    'this domain name',
    'hugedomains',
    'dan.com',
    'domain name has been registered',
    'buy this domain',
    'dominio in vendita',
    'questo dominio',
    'afternic.com',
    'godaddy parking',
    'namecheap parking',
    'sedoparking.com',
    'domainmarket.com',
    'domain parking',
    'bodis.com',
    'above.com',
    'dominio disponibile',
    'register4less',
    'parkingcrew',
    'dominio scaduto',
    'expired domain',
    'underconstruction',
    'coming soon</title>',  // <title>Coming Soon</title>
];

export class PreVerifyGate {
    private cache: MemoryFirstCache;
    private ledger: CostLedger;

    constructor(cache: MemoryFirstCache, ledger: CostLedger) {
        this.cache = cache;
        this.ledger = ledger;
    }

    public async check(url: string, piva?: string, companyName?: string): Promise<VerificationResult> {
        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname;

            // STAGE 0: Cache Fast-Path
            const isParked = await this.cache.redisOnly('omega:parked', domain);
            if (isParked) return 'PARKED';

            const isCf = await this.cache.redisOnly('omega:cloudflare', domain);
            if (isCf) return 'NEEDS_BROWSER';

            // STAGE 1: HTTP HEAD (0ms cost, detects Cloudflare)
            const headStatus = await this.performHeadCheck(url);
            if (headStatus === 'CF_DETECTED') {
                await this.cache.setRedisOnly('omega:cloudflare', domain, true, 86400 * 7); // 7 days
                return 'NEEDS_BROWSER';
            }
            if (headStatus === 'FAILED') {
                return 'REJECTED';
            }

            // STAGE 2: Parking Detection (First 1KB)
            const isParkedPage = await this.performParkingCheck(url);
            if (isParkedPage) {
                await this.cache.setRedisOnly('omega:parked', domain, true, 86400 * 7);
                return 'PARKED';
            }

            // STAGE 2.5: THE GOLDEN GATE (Fast Deterministic Rules)
            // Fetch raw HTML (capped to 500KB) and apply Zero-Cost heuristics.
            const goldenStatus = await this.performGoldenGateCheck(url, piva, companyName);
            if (goldenStatus === 'CF_DETECTED') {
                await this.cache.setRedisOnly('omega:cloudflare', domain, true, 86400 * 7);
                return 'NEEDS_BROWSER';
            }
            if (goldenStatus === 'VERIFIED') {
                return 'VERIFIED';
            }

            // STAGE 3: Quick Jina Fetch (P.IVA match if available)
            if (piva) {
                const jinaHit = await this.checkJinaForPiva(url, piva);
                if (jinaHit === 'CF_DETECTED') {
                    await this.cache.setRedisOnly('omega:cloudflare', domain, true, 86400 * 7);
                    return 'NEEDS_BROWSER';
                }
                if (jinaHit === 'VERIFIED') {
                    return 'VERIFIED';
                }
            }

            // STAGE 3B: Semantic Name Matching (when PIVA unavailable)
            // If no PIVA, use company name + domain heuristics to verify ownership
            if (!piva && companyName) {
                const semanticResult = await this.checkSemanticNameMatch(url, companyName);
                if (semanticResult === 'CF_DETECTED') {
                    await this.cache.setRedisOnly('omega:cloudflare', domain, true, 86400 * 7);
                    return 'NEEDS_BROWSER';
                }
                if (semanticResult === 'VERIFIED') {
                    return 'VERIFIED_SEMANTIC';
                }
            }

            // STAGE 4: Fallback
            return 'NEEDS_BROWSER';

        } catch (err) {
            console.error('[PreVerifyGate] Check failed for', url, err);
            return 'NEEDS_BROWSER';
        }
    }

    private performHeadCheck(url: string): Promise<'OK' | 'CF_DETECTED' | 'FAILED'> {
        return new Promise((resolve) => {
            const parsed = new URL(url);
            const lib = parsed.protocol === 'https:' ? https : http;
            const req = lib.request(url, { method: 'HEAD', timeout: 3000 }, (res) => {
                const headers = res.headers;

                // Cloudflare Fingerprints
                if (
                    headers['cf-ray'] ||
                    (headers['server'] && headers['server'].toString().toLowerCase() === 'cloudflare') ||
                    headers['cf-cache-status'] ||
                    (headers['set-cookie'] && headers['set-cookie'].some(c => c.includes('__cf_bm') || c.includes('cf_clearance')))
                ) {
                    resolve('CF_DETECTED');
                    return;
                }

                if (res.statusCode && res.statusCode >= 400 && res.statusCode !== 403) {
                    resolve('FAILED'); // 404, 500, etc. 403 might just be bot block, so we pass it to browser
                    return;
                }

                resolve('OK');
            });

            req.on('error', () => resolve('FAILED'));
            req.on('timeout', () => { req.destroy(); resolve('FAILED'); });
            req.end();
        });
    }

    private performParkingCheck(url: string): Promise<boolean> {
        return new Promise((resolve) => {
            let resolved = false;
            const safeResolve = (value: boolean) => {
                if (!resolved) {
                    resolved = true;
                    resolve(value);
                }
            };

            const parsed = new URL(url);
            const lib = parsed.protocol === 'https:' ? https : http;

            const req = lib.request(url, { method: 'GET', timeout: 3000 }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > 2048) {
                        res.destroy(); // Abort early, we only need the start
                    }
                });

                res.on('end', () => {
                    const content = data.toLowerCase();
                    const isParked = PARKING_SIGNATURES.some(sig => content.includes(sig));
                    safeResolve(isParked);
                });

                res.on('close', () => {
                    const content = data.toLowerCase();
                    const isParked = PARKING_SIGNATURES.some(sig => content.includes(sig));
                    safeResolve(isParked);
                });
            });

            req.on('error', () => safeResolve(false));
            req.on('timeout', () => { req.destroy(); safeResolve(false); });
            req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            req.end();
        });
    }

    /**
     * STAGE 2.5: THE GOLDEN GATE
     * Downloads raw HTML (fast) to run zero-cost heuristics without AI or external APIs.
     * Implements Gemma 1 (VAT check), Gemma 4 (OG:Image), and Gemma 6 (Strict Domain Match).
     */
    private async performGoldenGateCheck(url: string, piva?: string, companyName?: string): Promise<'VERIFIED' | 'CF_DETECTED' | 'MISS'> {
        const start = Date.now();
        return new Promise((resolve) => {
            let resolved = false;
            const safeResolve = async (val: 'VERIFIED' | 'CF_DETECTED' | 'MISS', reason?: string) => {
                if (!resolved) {
                    resolved = true;
                    if (val === 'VERIFIED') {
                        console.log(`[GoldenGate] 🏆 INSTANT VERIFY for ${url} (Reason: ${reason})`);
                        await this.ledger.log({
                            timestamp: new Date().toISOString(),
                            module: 'PreVerifyGate', provider: 'golden-check', tier: 0, task_type: 'HEAD',
                            cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: true
                        });
                    }
                    resolve(val);
                }
            };

            const parsed = new URL(url);
            const lib = parsed.protocol === 'https:' ? https : http;

            const req = lib.request(url, { method: 'GET', timeout: 5000 }, (res) => {
                const headers = res.headers;
                // Cloudflare Fingerprint Check
                if (headers['cf-ray'] || (headers['server'] && headers['server'].toString().toLowerCase() === 'cloudflare')) {
                    safeResolve('CF_DETECTED');
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > 500000) { // Read max 500KB to prevent memory flood
                        res.destroy();
                    }
                });

                const handleData = () => {
                    if (data.includes('Checking your browser') || data.includes('Just a moment...')) {
                        safeResolve('CF_DETECTED');
                        return;
                    }

                    const bodyText = data.toLowerCase();

                    // --- 1. THE GOLDEN VAT SIGNAL ---
                    if (piva) {
                        const cleanPiva = piva.replace(/[^0-9]/g, '');
                        // Fast regex-free stripping for html -> number
                        const bodyNumbers = bodyText.replace(/[^0-9]/g, '');
                        if (cleanPiva.length === 11 && bodyNumbers.includes(cleanPiva)) {
                            safeResolve('VERIFIED', 'GOLDEN_VAT_MATCH');
                            return;
                        }
                    }

                    // --- 2. OG:IMAGE BRAND DETECTOR ---
                    if (companyName) {
                        const ogImageRegex = /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i;
                        const match = data.match(ogImageRegex);
                        if (match) {
                            const imgUrl = match[1].toLowerCase();
                            // Simplify company name (remove srl, spa, and alphanumeric only)
                            const simplifiedName = companyName
                                .toLowerCase()
                                .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&|snc|srl|sas|spa/gi, '')
                                .replace(/[^a-z0-9]/g, '');

                            if (simplifiedName.length >= 4 && imgUrl.includes(simplifiedName)) {
                                safeResolve('VERIFIED', 'OG_IMAGE_BRAND_MATCH');
                                return;
                            }
                        }

                        // --- 3. DOMAIN STRICT SYNTAX ---
                        // Re-implemented here because it's deterministic.
                        const simplifiedName = companyName
                            .toLowerCase()
                            .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&|snc|srl|sas|spa/gi, '')
                            .replace(/[^a-z0-9]/g, '');
                        const domainHost = parsed.hostname.replace('www.', '').split('.')[0];

                        if (simplifiedName.length >= 4 && domainHost === simplifiedName) {
                            // Domain is a perfect match. If we find at least a contact signal or privacy policy, confirm it.
                            if (bodyText.includes('partita iva') || bodyText.includes('p.iva') || bodyText.includes('privacy policy')) {
                                safeResolve('VERIFIED', 'DOMAIN_STRICT_SYNTAX');
                                return;
                            }
                        }
                    }

                    safeResolve('MISS');
                };

                res.on('end', handleData);
                res.on('close', handleData);
            });

            req.on('error', () => safeResolve('MISS'));
            req.on('timeout', () => { req.destroy(); safeResolve('MISS'); });
            req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            req.end();
        });
    }

    private async checkJinaForPiva(url: string, piva: string): Promise<'VERIFIED' | 'CF_DETECTED' | 'MISS'> {
        const start = Date.now();
        return new Promise((resolve) => {
            const jinaUrl = `https://r.jina.ai/${url}`;
            const req = https.request(jinaUrl, { method: 'GET', timeout: 5000 }, (res) => {
                let data = '';

                res.on('data', (chunk) => { data += chunk; });
                res.on('end', async () => {
                    const duration = Date.now() - start;
                    let success = false;

                    if (data.includes('Checking your browser') || data.includes('Just a moment...')) {
                        await this.ledger.log({
                            timestamp: new Date().toISOString(),
                            module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                            cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: false, error: 'CF_DETECTED', error_class: 'provider_block', punitive: true
                        });
                        resolve('CF_DETECTED');
                        return;
                    }

                    // Clean PIVA to match whatever format it might be in
                    const cleanPiva = piva.replace(/[^0-9]/g, '');
                    if (data.includes(cleanPiva)) {
                        success = true;
                    }

                    await this.ledger.log({
                        timestamp: new Date().toISOString(),
                        module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                        cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: true
                    });

                    resolve(success ? 'VERIFIED' : 'MISS');
                });
            });

            req.on('error', async (err) => {
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'NET_ERROR', error_class: 'transport', punitive: true
                });
                resolve('MISS');
            });

            req.on('timeout', async () => {
                req.destroy();
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'TIMEOUT', error_class: 'transport', punitive: true
                });
                resolve('MISS');
            });

            req.setHeader('Authorization', `Bearer ${process.env.JINA_API_KEY || ''}`);
            req.end();
        });
    }

    /**
     * Compute semantic match score between company name and page content.
     * Returns a score from 0.0 to 1.0 combining:
     * - Token overlap in body text (weighted by token length)
     * - Page title matching (strong signal)
     * - Domain name similarity
     */
    private computeSemanticScore(url: string, companyName: string, siteText: string): {
        score: number;
        matchedTokens: string[];
        signals: string[];
    } {
        const siteTextLower = siteText.toLowerCase();
        const signals: string[] = [];

        // Strip legal suffixes for matching
        const strippedName = companyName
            .toLowerCase()
            .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&|snc|srl|sas|spa/gi, '')
            .trim();

        // Filter tokens: minimum 4 chars to avoid false positives on common short words
        // Exception: keep tokens of 3 chars ONLY if the company name has <= 2 tokens total
        const allTokens = strippedName.split(/\s+/).filter(t => t.length >= 2);
        const nameTokens = allTokens.length <= 2
            ? allTokens.filter(t => t.length >= 3)
            : allTokens.filter(t => t.length >= 4);

        if (nameTokens.length === 0) {
            return { score: 0, matchedTokens: [], signals: ['NO_TOKENS'] };
        }

        // 1. Body text token matching (weighted by token length)
        const matchedTokens = nameTokens.filter(token => siteTextLower.includes(token));
        const tokenMatchRatio = matchedTokens.length / nameTokens.length;

        // Weight longer token matches more heavily
        let weightedScore = 0;
        let totalWeight = 0;
        for (const token of nameTokens) {
            const weight = Math.min(token.length / 5, 2.0); // longer tokens = higher weight
            totalWeight += weight;
            if (siteTextLower.includes(token)) {
                weightedScore += weight;
            }
        }
        const weightedRatio = totalWeight > 0 ? weightedScore / totalWeight : 0;

        // 2. Page title matching (extract <title> from Jina markdown output)
        // Jina typically outputs: "Title: Some Page Title\n..."
        let titleScore = 0;
        const titleMatch = siteText.match(/^(?:Title:|#)\s*(.+)/im);
        if (titleMatch) {
            const titleLower = titleMatch[1].toLowerCase();
            const titleTokensMatched = nameTokens.filter(t => titleLower.includes(t));
            titleScore = nameTokens.length > 0 ? titleTokensMatched.length / nameTokens.length : 0;
            if (titleScore > 0) signals.push(`TITLE_MATCH(${titleTokensMatched.join('+')})`);
        }

        // 3. Domain similarity
        let domainScore = 0;
        try {
            const domain = new URL(url).hostname.replace('www.', '').split('.')[0].toLowerCase();
            const nameSlug = strippedName.replace(/[^a-z0-9]/g, '');
            // Exact match
            if (domain === nameSlug) {
                domainScore = 1.0;
                signals.push('DOMAIN_EXACT');
            }
            // Contains match
            else if (nameSlug.length >= 4 && (domain.includes(nameSlug) || nameSlug.includes(domain))) {
                domainScore = 0.7;
                signals.push('DOMAIN_CONTAINS');
            }
            // Prefix match (first 6+ chars)
            else if (nameSlug.length >= 6 && domain.startsWith(nameSlug.substring(0, 6))) {
                domainScore = 0.5;
                signals.push('DOMAIN_PREFIX');
            }
        } catch { /* invalid URL */ }

        // 4. P.IVA / VAT presence (Italian business sites almost always have this)
        const hasPiva = /p\.?\s*iva|partita\s*iva|c\.?\s*f\.?\s*[\s:]/i.test(siteTextLower);
        if (hasPiva) signals.push('HAS_PIVA_LABEL');

        // Combined score: weighted average of signals
        // Title match is a very strong signal, domain match is strong, body match is baseline
        const combinedScore = Math.min(1.0,
            (weightedRatio * 0.45) +
            (titleScore * 0.30) +
            (domainScore * 0.20) +
            (hasPiva ? 0.05 : 0)
        );

        return {
            score: combinedScore,
            matchedTokens,
            signals
        };
    }

    private async checkSemanticNameMatch(url: string, companyName: string): Promise<'VERIFIED' | 'CF_DETECTED' | 'MISS'> {
        const start = Date.now();
        return new Promise((resolve) => {
            const jinaUrl = `https://r.jina.ai/${url}`;
            const req = https.request(jinaUrl, { method: 'GET', timeout: 4000 }, (res) => {
                let data = '';
                let resolved = false;
                const safeResolve = (val: 'VERIFIED' | 'CF_DETECTED' | 'MISS') => {
                    if (!resolved) { resolved = true; resolve(val); }
                };

                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > 15000) {
                        res.destroy(); // First 15KB for richer title + body matching
                    }
                });

                const handleData = async () => {
                    const duration = Date.now() - start;

                    if (data.includes('Checking your browser') || data.includes('Just a moment...')) {
                        await this.ledger.log({
                            timestamp: new Date().toISOString(),
                            module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                            cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: false, error: 'CF_DETECTED', error_class: 'provider_block', punitive: true
                        });
                        safeResolve('CF_DETECTED');
                        return;
                    }

                    const { score, matchedTokens, signals } = this.computeSemanticScore(url, companyName, data);

                    // Adaptive threshold: if we have domain match, lower the bar
                    const hasDomainSignal = signals.some(s => s.startsWith('DOMAIN_'));
                    const threshold = hasDomainSignal ? 0.35 : 0.50;
                    const verified = score >= threshold;

                    await this.ledger.log({
                        timestamp: new Date().toISOString(),
                        module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                        cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: true
                    });

                    if (verified) {
                        console.log(`[PreVerifyGate] ✅ Semantic match: score=${score.toFixed(2)} tokens=${matchedTokens.join('+')} signals=[${signals.join(',')}] for "${companyName}" on ${url}`);
                    }

                    safeResolve(verified ? 'VERIFIED' : 'MISS');
                };

                res.on('end', handleData);
                res.on('close', handleData);
            });

            req.on('error', async () => {
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'NET_ERROR', error_class: 'transport', punitive: true
                });
                resolve('MISS');
            });

            req.on('timeout', async () => {
                req.destroy();
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'TIMEOUT', error_class: 'transport', punitive: true
                });
                resolve('MISS');
            });

            req.setHeader('Authorization', `Bearer ${process.env.JINA_API_KEY || ''}`);
            req.end();
        });
    }
}
