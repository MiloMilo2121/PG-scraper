import { connect } from 'puppeteer-real-browser';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { CostLedger } from './CostLedger';
import { Page, Browser } from 'puppeteer';

export interface NavigationResult {
    status: 'OK' | 'TIMEOUT' | 'BLOCKED' | 'CF_CHALLENGE' | 'ERROR';
    html: string | null;
    finalUrl: string | null;
    blocked_resources: number;
    duration_ms: number;
    browser_id: string;
}

interface BrowserInstance {
    id: string;
    page: Page;
    browser: Browser;
    profilePath: string;
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

export class BrowserPool {
    private instances: BrowserInstance[] = [];
    private maxInstances: number;
    private maxReqsPerInstance: number;
    private navTimeoutMs: number;
    private blockResources: string[];
    // Event-based wait queue: resolvers called when an instance becomes available.
    // Replaces the previous 200ms-interval busy-wait — zero CPU overhead while waiting.
    private waitQueue: Array<() => void> = [];

    // Stats
    private recycledTotal = 0;
    private errorsTotal = 0;
    private ledger: CostLedger;

    constructor(options: {
        maxInstances?: number;
        maxRequestsPerInstance?: number;
        navigationTimeout?: number;
        recycleOnError?: boolean;
        blockResources?: string[];
        ledger: CostLedger;
    }) {
        this.maxInstances = options.maxInstances || 3;
        this.maxReqsPerInstance = options.maxRequestsPerInstance || 50;
        this.navTimeoutMs = options.navigationTimeout || 8000;
        this.blockResources = options.blockResources || ['image', 'stylesheet', 'font', 'media'];
        this.ledger = options.ledger;

        this.registerCleanupHooks();
    }

    private registerCleanupHooks() {
        const cleanup = async () => {
            console.log('[BrowserPool] Process exiting. Destroying all Chrome instances...');
            await this.destroyAll();
            process.exit(0);
        };
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);
    }

    private async createInstance(): Promise<BrowserInstance> {
        const id = crypto.randomUUID().substring(0, 8);
        const profilePath = path.join('/tmp', `omega-browser-${id}`);

        if (!fs.existsSync(profilePath)) {
            fs.mkdirSync(profilePath, { recursive: true });
        }

        const { browser, page } = await connect({
            headless: false, // PRB only accepts boolean. 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--no-zygote',
                `--user-data-dir=${profilePath}`
            ],
            customConfig: {},
            turnstile: true, // Auto-solve Cloudflare Turnstile if present
            disableXvfb: false,
            ignoreAllFlags: false
        });

        // Setup Request Interception to block heavy resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (this.blockResources.includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        return {
            id,
            browser: browser as unknown as Browser, // Types from puppeteer-real-browser can be a bit funky
            page: page as unknown as Page,
            profilePath,
            created_at: Date.now(),
            requests_served: 0,
            is_busy: false
        };
    }

    private async acquireInstance(): Promise<BrowserInstance> {
        // Fast path: an idle instance already exists
        const available = this.instances.find(i => !i.is_busy);
        if (available) {
            available.is_busy = true;
            return available;
        }

        // Pool not full yet: spawn a new browser
        if (this.instances.length < this.maxInstances) {
            const fresh = await this.createInstance();
            this.instances.push(fresh);
            fresh.is_busy = true;
            return fresh;
        }

        // Pool full and all busy: wait for a release notification (event-based, zero polling).
        // The waiter is resolved by releaseInstance() when any browser becomes free.
        return new Promise<BrowserInstance>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                const idx = this.waitQueue.indexOf(tryAcquire);
                if (idx !== -1) this.waitQueue.splice(idx, 1);
                reject(new BrowserPoolExhaustedError());
            }, 10_000);

            const tryAcquire = () => {
                const inst = this.instances.find(i => !i.is_busy);
                if (inst) {
                    clearTimeout(timeoutHandle);
                    inst.is_busy = true;
                    resolve(inst);
                } else {
                    // Edge case: notified but still none available (concurrent acquires).
                    // Re-queue ourselves for the next release.
                    this.waitQueue.push(tryAcquire);
                }
            };

            this.waitQueue.push(tryAcquire);
        });
    }

    /** Marks an instance as available and wakes the next waiter, if any. */
    private releaseInstance(instance: BrowserInstance): void {
        instance.is_busy = false;
        const next = this.waitQueue.shift();
        if (next) next();
    }

    private async recycleInstance(instance: BrowserInstance) {
        try {
            // Try graceful close with 5s timeout
            await Promise.race([
                instance.browser.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout closing browser')), 5000))
            ]);
        } catch (e) {
            // Force kill
            try {
                // Find and kill process by profile directory argument
                execSync(`ps aux | grep chrome | grep ${instance.profilePath} | awk '{print $2}' | xargs kill -9 2>/dev/null`);
            } catch (kille) {
                // Ignore
            }
        }

        // Wipe profile dir
        if (fs.existsSync(instance.profilePath)) {
            fs.rmSync(instance.profilePath, { recursive: true, force: true });
        }

        this.instances = this.instances.filter(i => i.id !== instance.id);
        this.recycledTotal++;
    }

    public async navigateSafe(url: string, pivaToFind?: string): Promise<NavigationResult> {
        let instance: BrowserInstance;
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
                } else if (response.headers()['cf-ray']) {
                    // Check if it's a block page vs a normal served CF page
                    const bodyText = await instance.page.evaluate(() => document.body.innerText);
                    if (bodyText.includes('Just a moment...') || bodyText.includes('Attention Required!')) {
                        status = 'CF_CHALLENGE';
                    }
                }
            }

            if (status === 'OK') {
                html = await instance.page.content();
            }

        } catch (err: any) {
            this.errorsTotal++;
            instance.last_error = err.message;
            if (err.message.includes('Timeout')) {
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
            // recycleInstance removes the instance from the pool; wake any waiter so it can
            // either grab another idle instance or spawn a new one.
            const next = this.waitQueue.shift();
            if (next) next();
        } else {
            this.releaseInstance(instance);
        }

        // Log Cost/Health
        await this.ledger.log({
            timestamp: new Date().toISOString(), module: 'BrowserPool', provider: 'puppeteer',
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
        let lockfiles_deleted = 0;

        for (const inst of [...this.instances]) {
            await this.recycleInstance(inst);
            killed++;
            lockfiles_deleted++;
        }

        // Global sweep for zombies
        try {
            execSync(`pkill -f "chrome.*omega-browser"`);
        } catch (e) { }

        try {
            const tmpDirs = fs.readdirSync('/tmp').filter(d => d.startsWith('omega-browser-'));
            for (const d of tmpDirs) {
                fs.rmSync(path.join('/tmp', d), { recursive: true, force: true });
                lockfiles_deleted++;
            }
        } catch (e) { }

        return { killed, lockfiles_deleted };
    }

    public getPoolStatus() {
        return {
            total: this.instances.length,
            available: this.instances.filter(i => !i.is_busy).length,
            busy: this.instances.filter(i => i.is_busy).length,
            waiters: this.waitQueue.length,
            recycled_total: this.recycledTotal,
            errors_total: this.errorsTotal
        };
    }
}
