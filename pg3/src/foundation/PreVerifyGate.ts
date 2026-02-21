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
    'domain name has been registered'
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
                            cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: false, error: 'CF_DETECTED'
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
                        cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success
                    });

                    resolve(success ? 'VERIFIED' : 'MISS');
                });
            });

            req.on('error', async (err) => {
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: err.message
                });
                resolve('MISS');
            });

            req.on('timeout', async () => {
                req.destroy();
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'TIMEOUT'
                });
                resolve('MISS');
            });

            req.setHeader('Authorization', `Bearer ${process.env.JINA_API_KEY || ''}`);
            req.end();
        });
    }

    private async checkSemanticNameMatch(url: string, companyName: string): Promise<'VERIFIED' | 'CF_DETECTED' | 'MISS'> {
        const start = Date.now();
        return new Promise((resolve) => {
            const jinaUrl = `https://r.jina.ai/${url}`;
            const req = https.request(jinaUrl, { method: 'GET', timeout: 4000 }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                    if (data.length > 10000) {
                        res.destroy(); // Only need first 10KB for name matching
                    }
                });

                const handleData = async () => {
                    const duration = Date.now() - start;

                    if (data.includes('Checking your browser') || data.includes('Just a moment...')) {
                        await this.ledger.log({
                            timestamp: new Date().toISOString(),
                            module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                            cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: false, error: 'CF_DETECTED'
                        });
                        resolve('CF_DETECTED');
                        return;
                    }

                    // Normalize both sides for fuzzy matching
                    const siteTextLower = data.toLowerCase();
                    const nameTokens = companyName
                        .toLowerCase()
                        .replace(/s\.?r\.?l\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?r\.?l\.?s\.?|unipersonale|in liquidazione|di |\&|snc|srl|sas|spa/gi, '')
                        .trim()
                        .split(/\s+/)
                        .filter(t => t.length >= 3); // Only meaningful tokens

                    // Count how many name tokens appear in the site text
                    const matchedTokens = nameTokens.filter(token => siteTextLower.includes(token));
                    const matchRatio = nameTokens.length > 0 ? matchedTokens.length / nameTokens.length : 0;

                    // Also check domain vs company name
                    const domain = new URL(url).hostname.replace('www.', '').split('.')[0].toLowerCase();
                    const nameSlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const domainMatchesName = nameSlug.includes(domain) || domain.includes(nameSlug.substring(0, Math.min(nameSlug.length, 8)));

                    const verified = matchRatio >= 0.6 || (matchRatio >= 0.4 && domainMatchesName);

                    await this.ledger.log({
                        timestamp: new Date().toISOString(),
                        module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                        cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: duration, success: verified
                    });

                    if (verified) {
                        console.log(`[PreVerifyGate] ✅ Semantic match: ${matchedTokens.join('+')} (${(matchRatio * 100).toFixed(0)}%) for "${companyName}" on ${url}`);
                    }

                    resolve(verified ? 'VERIFIED' : 'MISS');
                };

                res.on('end', handleData);
                res.on('close', handleData);
            });

            req.on('error', async () => {
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'NET_ERROR'
                });
                resolve('MISS');
            });

            req.on('timeout', async () => {
                req.destroy();
                await this.ledger.log({
                    timestamp: new Date().toISOString(),
                    module: 'PreVerifyGate', provider: 'jina-semantic', tier: 1, task_type: 'LLM_PARSE',
                    cost_eur: 0, cache_hit: false, cache_level: 'MISS', duration_ms: Date.now() - start, success: false, error: 'TIMEOUT'
                });
                resolve('MISS');
            });

            req.setHeader('Authorization', `Bearer ${process.env.JINA_API_KEY || ''}`);
            req.end();
        });
    }
}
