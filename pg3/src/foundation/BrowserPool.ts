import { chromium, Browser, BrowserContext, Page } from 'playwright';
const crypto = require('crypto');
import { CostLedger } from './CostLedger';

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
    }) {
        this.maxInstances = options.maxInstances || 3;
        this.maxReqsPerInstance = options.maxRequestsPerInstance || 50;
        this.navTimeoutMs = options.navigationTimeout || 8000;
        this.blockResources = options.blockResources || ['image', 'stylesheet', 'font', 'media'];
        this.ledger = options.ledger;
        this.proxyUrl = process.env.PROXY_RESIDENTIAL_URL;

        this.registerCleanupHooks();
    }

    private registerCleanupHooks() {
        const cleanup = async () => {
            console.log('[BrowserPool] Process exiting. Destroying all Playwright contexts...');
            await this.destroyAll();
            process.exit(0);
        };
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
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

    private async createInstance(): Promise<ContextInstance> {
        const id = crypto.randomUUID().substring(0, 8);
        const browser = await this.ensureBrowser();

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
        });

        // Block heavy resources via Playwright's route() API
        // This is the Playwright equivalent of puppeteer's setRequestInterception
        const blockPattern = this.blockResources.map(r => `**/*.${r === 'image' ? '{png,jpg,jpeg,gif,webp,svg,ico}' : r === 'stylesheet' ? 'css' : r === 'font' ? '{woff,woff2,ttf,otf,eot}' : r === 'media' ? '{mp4,webm,ogg,mp3,wav}' : r}`);

        await context.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (this.blockResources.includes(resourceType)) {
                route.abort().catch(() => { });
            } else {
                route.continue().catch(() => { });
            }
        });

        const page = await context.newPage();

        return {
            id,
            context,
            page,
            created_at: Date.now(),
            requests_served: 0,
            is_busy: false,
        };
    }

    private async acquireInstance(): Promise<ContextInstance> {
        // Find available
        let available = this.instances.find(i => !i.is_busy);

        if (!available && this.instances.length < this.maxInstances) {
            // Can spawn a new one
            available = await this.createInstance();
            this.instances.push(available);
            available.is_busy = true;
            return available;
        }

        if (!available) {
            // Wait logic
            const start = Date.now();
            while (Date.now() - start < 10000) {
                await new Promise(r => setTimeout(r, 200));
                available = this.instances.find(i => !i.is_busy);
                if (available) {
                    available.is_busy = true;
                    return available;
                }
            }
            throw new BrowserPoolExhaustedError();
        }

        available.is_busy = true;
        return available;
    }

    private async recycleInstance(instance: ContextInstance) {
        try {
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
            instance = await this.acquireInstance();
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

        try {
            const response = await instance.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navTimeoutMs });
            finalUrl = instance.page.url();

            if (response) {
                const statusHttp = response.status();
                if (statusHttp === 403 || statusHttp === 429) {
                    status = 'BLOCKED';
                } else {
                    const headers = response.headers();
                    if (headers['cf-ray']) {
                        // Check if it's a Cloudflare challenge page
                        const bodyText = await instance.page.evaluate(() => document.body.innerText);
                        if (bodyText.includes('Just a moment...') || bodyText.includes('Attention Required!')) {
                            status = 'CF_CHALLENGE';
                        }
                    }
                }
            }

            if (status === 'OK') {
                html = await instance.page.content();
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

        // Determine if we need to recycle
        if (instance.requests_served >= this.maxReqsPerInstance || status === 'ERROR') {
            await this.recycleInstance(instance);
        } else {
            instance.is_busy = false; // release
        }

        // Log Cost/Health
        await this.ledger.log({
            timestamp: new Date().toISOString(), module: 'BrowserPool', provider: 'playwright',
            tier: 2, task_type: 'PROXY_FETCH', cost_eur: 0, cache_hit: false, cache_level: 'MISS',
            duration_ms: duration, success: status === 'OK', error: status === 'OK' ? undefined : status
        });

        return {
            status,
            html,
            finalUrl,
            blocked_resources: 10, // Approx
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
