import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
const crypto = require('crypto');
import { CostLedger } from './CostLedger';
import { BlockClassifier, BlockType } from '../enricher/core/security/block_classifier';
import { config } from '../enricher/config';

export interface NavigationResult {
    status: 'OK' | 'TIMEOUT' | 'BLOCKED' | 'CF_CHALLENGE' | 'ERROR';
    html: string | null;
    finalUrl: string | null;
    blocked_resources: number;
    duration_ms: number;
    browser_id: string;
}

interface ContextInstance {
    id: string;
    context: BrowserContext;
    page: Page;
    session_key: string;
    storage_state_path: string;
    loaded_from_storage_state: boolean;
    blocked_resources_current_nav: number;
    created_at: number;
    requests_served: number;
    last_error?: string;
    is_busy: boolean;
}

export class BrowserPoolExhaustedError extends Error {
    constructor() {
        super('BrowserPoolExhaustedError: Wait for available browser exceeded 10s.');
        this.name = 'BrowserPoolExhaustedError';
    }
}

/**
 * BrowserPool V2 — Playwright Edition
 * 
 * Architecture:
 * - Single shared Browser instance (chromium.launch)
 * - Multiple isolated BrowserContexts (each with unique fingerprint, cookies, storage)
 * - Request interception via context.route() to block heavy resources
 * - Auto-recycle contexts after N requests to prevent memory leaks
 */
export class BrowserPool {
    private browser: Browser | null = null;
    private instances: ContextInstance[] = [];
    private maxInstances: number;
    private maxReqsPerInstance: number;
    private navTimeoutMs: number;
    private blockResources: string[];
    private proxyUrl: string | undefined;
    private sessionStateDir: string;

    // Stats
    private recycledTotal = 0;
    private errorsTotal = 0;
    private ledger: CostLedger;

    constructor(options: {
        maxInstances?: number;
        maxRequestsPerInstance?: number;
        navigationTimeout?: number;
        blockResources?: string[];
        ledger: CostLedger;
        sessionStateDir?: string;
        manageProcessSignals?: boolean;
    }) {
        this.maxInstances = options.maxInstances || 3;
        this.maxReqsPerInstance = options.maxRequestsPerInstance || 50;
        this.navTimeoutMs = options.navigationTimeout || 8000;
        this.blockResources = options.blockResources || ['image', 'font', 'media'];
        this.ledger = options.ledger;
        this.proxyUrl = process.env.PROXY_RESIDENTIAL_URL;
        this.sessionStateDir = options.sessionStateDir || config.runtime.browserSessionDir;

        fs.mkdirSync(this.sessionStateDir, { recursive: true });

        if (options.manageProcessSignals) {
            this.registerCleanupHooks();
        }
    }

    private registerCleanupHooks() {
        let cleanupStarted = false;
        const cleanup = async (signal: string) => {
            if (cleanupStarted) {
                return;
            }
            cleanupStarted = true;
            console.log(`[BrowserPool] ${signal} received. Destroying all Playwright contexts...`);
            await this.destroyAll().catch(() => undefined);
        };
        process.on('SIGTERM', () => {
            void cleanup('SIGTERM');
        });
        process.on('SIGINT', () => {
            void cleanup('SIGINT');
        });
    }

    private async ensureBrowser(): Promise<Browser> {
        if (!this.browser || !this.browser.isConnected()) {
            const launchOptions: any = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            };

            // Route all browser traffic through the residential proxy if configured
            if (this.proxyUrl) {
                launchOptions.proxy = { server: this.proxyUrl };
            }

            this.browser = await chromium.launch(launchOptions);
        }
        return this.browser;
    }

    private getSessionKey(url: string): string {
        try {
            const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
            const parts = hostname.split('.').filter(Boolean);
            if (parts.length >= 2) {
                return parts.slice(-2).join('.');
            }
            return hostname || 'generic';
        } catch {
            return 'generic';
        }
    }

    private getStorageStatePath(sessionKey: string): string {
        const safeKey = sessionKey.replace(/[^a-z0-9.-]/gi, '_');
        return path.join(this.sessionStateDir, `${safeKey}.json`);
    }

    private async persistStorageState(instance: ContextInstance): Promise<void> {
        try {
            await instance.context.storageState({ path: instance.storage_state_path });
        } catch {
            // Ignore state persistence failures; browsing can continue cold.
        }
    }

    private async createInstance(sessionKey: string = 'generic'): Promise<ContextInstance> {
        const id = crypto.randomUUID().substring(0, 8);
        const browser = await this.ensureBrowser();
        const storageStatePath = this.getStorageStatePath(sessionKey);
        const hasStorageState = fs.existsSync(storageStatePath);

        // Each context is fully isolated (cookies, localStorage, fingerprint)
        const context = await browser.newContext({
            // Randomize viewport for anti-fingerprinting
            viewport: {
                width: 1280 + Math.floor(Math.random() * 200),
                height: 720 + Math.floor(Math.random() * 200),
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'it-IT',
            timezoneId: 'Europe/Rome',
            ignoreHTTPSErrors: true,
            ...(hasStorageState ? { storageState: storageStatePath } : {}),
        });

        const page = await context.newPage();

        const instance: ContextInstance = {
            id,
            context,
            page,
            session_key: sessionKey,
            storage_state_path: storageStatePath,
            loaded_from_storage_state: hasStorageState,
            blocked_resources_current_nav: 0,
            created_at: Date.now(),
            requests_served: 0,
            is_busy: false,
        };

        await context.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (this.blockResources.includes(resourceType)) {
                instance.blocked_resources_current_nav++;
                route.abort().catch(() => { });
            } else {
                route.continue().catch(() => { });
            }
        });

        return instance;
    }

    private async acquireInstance(url: string): Promise<ContextInstance> {
        const sessionKey = this.getSessionKey(url);

        let available = this.instances.find(i => !i.is_busy && i.session_key === sessionKey);
        if (available) {
            available.is_busy = true;
            return available;
        }

        if (this.instances.length < this.maxInstances) {
            available = await this.createInstance(sessionKey);
            this.instances.push(available);
            available.is_busy = true;
            return available;
        }

        const reusableOtherLane = this.instances.find(i => !i.is_busy);
        if (reusableOtherLane) {
            await this.recycleInstance(reusableOtherLane);
            available = await this.createInstance(sessionKey);
            this.instances.push(available);
            available.is_busy = true;
            return available;
        }

        const start = Date.now();
        while (Date.now() - start < 10000) {
            await new Promise(r => setTimeout(r, 200));
            available = this.instances.find(i => !i.is_busy && i.session_key === sessionKey);
            if (available) {
                available.is_busy = true;
                return available;
            }

            const freeOtherLane = this.instances.find(i => !i.is_busy);
            if (freeOtherLane) {
                await this.recycleInstance(freeOtherLane);
                available = await this.createInstance(sessionKey);
                this.instances.push(available);
                available.is_busy = true;
                return available;
            }
        }

        throw new BrowserPoolExhaustedError();
    }

    private async recycleInstance(instance: ContextInstance) {
        try {
            await this.persistStorageState(instance);
            await Promise.race([
                instance.context.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout closing context')), 5000))
            ]);
        } catch (e) {
            // Context may already be closed — ignore
        }

        this.instances = this.instances.filter(i => i.id !== instance.id);
        this.recycledTotal++;
    }

    public async navigateSafe(url: string, pivaToFind?: string): Promise<NavigationResult> {
        let instance: ContextInstance;
        try {
            instance = await this.acquireInstance(url);
        } catch (e) {
            return {
                status: 'ERROR', html: null, finalUrl: null, blocked_resources: 0,
                duration_ms: 0, browser_id: 'unknown'
            };
        }

        const start = Date.now();
        let status: NavigationResult['status'] = 'OK';
        let html: string | null = null;
        let finalUrl: string | null = null;
        let wafFamily: 'cloudflare' | 'datadome' | 'generic_waf' | undefined;
        let challengeType: string | undefined;
        const cookieReuseHit = instance.loaded_from_storage_state || instance.requests_served > 0;
        instance.blocked_resources_current_nav = 0;

        try {
            const response = await instance.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navTimeoutMs });
            finalUrl = instance.page.url();
            html = await instance.page.content();

            if (!url.startsWith('about:')) {
                const blockSig = BlockClassifier.classify(
                    response?.status() || 200,
                    html,
                    finalUrl || url,
                    'browser_pool'
                );
                wafFamily = blockSig.waf_family;
                challengeType = blockSig.challenge_type;

                if (blockSig.type === BlockType.CLOUDFLARE_CHALLENGE || blockSig.type === BlockType.CLOUDFLARE_TURNSTILE) {
                    status = 'CF_CHALLENGE';
                } else if (blockSig.type !== BlockType.NONE) {
                    status = 'BLOCKED';
                }
            }
            if (status !== 'OK') {
                html = null;
            }

        } catch (err: any) {
            this.errorsTotal++;
            instance.last_error = err.message;
            if (err.message.includes('Timeout') || err.name === 'TimeoutError') {
                status = 'TIMEOUT';
            } else {
                status = 'ERROR';
            }
        }

        const duration = Date.now() - start;
        instance.requests_served++;
        await this.persistStorageState(instance);
        instance.loaded_from_storage_state = true;

        // Determine if we need to recycle
        if (instance.requests_served >= this.maxReqsPerInstance || status === 'ERROR') {
            await this.recycleInstance(instance);
        } else {
            instance.is_busy = false; // release
        }

        // Log Cost/Health
        await this.ledger.log({
            timestamp: new Date().toISOString(), module: 'BrowserPool', provider: 'playwright',
              tier: 2, task_type: 'PROXY_FETCH', cost_eur: config.costing.localBrowserNavCostEur, cache_hit: false, cache_level: 'MISS',
              duration_ms: duration,
              success: status === 'OK',
              error: status === 'OK' ? undefined : status,
              error_class: status === 'OK' ? undefined : 'browser_pool',
              punitive: false,
              waf_family: wafFamily,
              challenge_type: challengeType,
              session_lane_id: instance.session_key,
              cookie_reuse_hit: cookieReuseHit,
          });

          return {
              status,
              html,
              finalUrl,
              blocked_resources: instance.blocked_resources_current_nav,
              duration_ms: duration,
              browser_id: instance.id
          };
      }

    public async destroyAll(): Promise<{ killed: number; lockfiles_deleted: number }> {
        let killed = 0;

        for (const inst of [...this.instances]) {
            await this.recycleInstance(inst);
            killed++;
        }

        // Close the shared browser instance
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) { }
            this.browser = null;
        }

        return { killed, lockfiles_deleted: 0 };
    }

    public getPoolStatus() {
        return {
            total: this.instances.length,
            available: this.instances.filter(i => !i.is_busy).length,
            busy: this.instances.filter(i => i.is_busy).length,
            recycled_total: this.recycledTotal,
            errors_total: this.errorsTotal
        };
    }
}
