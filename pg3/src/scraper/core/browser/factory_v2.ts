
import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { ResourceManager, PhaseType } from '../../utils/resource_manager';
import { getRandomUserAgent } from './ua_db';
import { GeneticFingerprinter } from './genetic_fingerprinter';
// Task 8 & 9: Human Behavior
import { HumanBehavior } from './human_behavior';
import { config } from '../../config';
import { BrowserEvasion } from './evasion';
import { CookieConsent } from './cookie_consent';
import { Logger } from '../../utils/logger';
// Task 16: Proxy Integration
import { ProxyManager } from '../../../enricher/core/browser/proxy_manager';

// 🛡️ Stealth Plugin: Re-enabled with safety valve (Law 308: Fingerprint Spoofing)
// Original disable was for Zygote/Sandbox conflict.
// Use DISABLE_STEALTH=true if proxy-auth issues recur.
if (process.env.DISABLE_STEALTH !== 'true') {
    puppeteer.use(StealthPlugin());
}

function getSandboxArgs(): string[] {
    // FORCE ARGS FOR DEBUGGING
    console.log('[BrowserFactory] Forcing no-sandbox args');
    return ['--no-sandbox', '--disable-setuid-sandbox'];
}

export class BrowserFactory {
    private static instance: BrowserFactory;
    private browser: Browser | null = null;
    private userDataDir: string;
    private launchPromise: Promise<Browser> | null = null;
    private activePages: Set<Page> = new Set();
    private instanceId: string;
    private lastHealthCheck: number = Date.now();
    private currentProfilePath: string | null = null;
    private browserCounted = false;

    // Configuration
    private static readonly MAX_CONCURRENCY = 10; // Stabilized for server
    private static MAX_TABS_PER_BROWSER = 8;
    public static ACTIVE_INSTANCES = 0;
    public static instances: Set<BrowserFactory> = new Set();

    constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
        this.userDataDir = path.join(process.cwd(), 'temp_profiles', `browser_${this.instanceId}`);
        this.currentProfilePath = this.userDataDir;
        BrowserFactory.instances.add(this);
    }

    public static getInstance(): BrowserFactory {
        if (!BrowserFactory.instance) {
            BrowserFactory.instance = new BrowserFactory();
            // Zombie Cleanup
            ['exit', 'SIGINT', 'SIGTERM'].forEach(signal => {
                process.on(signal, () => BrowserFactory.instance.close());
            });
        }
        return BrowserFactory.instance;
    }


    /**
     * Task 11: Health check - verify browser is responsive
     */
    public async isHealthy(): Promise<boolean> {
        if (!this.browser) return false;

        try {
            if (!this.browser.isConnected()) {
                console.warn(`[BrowserFactory] ⚠️ Browser disconnected!`);
                return false;
            }
            const memUsage = process.memoryUsage();
            const totalMem = os.totalmem();
            const usedPercent = (memUsage.heapUsed / totalMem) * 100;

            if (usedPercent > 80) {
                console.warn(`[BrowserFactory] ⚠️ Memory usage at ${usedPercent.toFixed(1)}%, restarting browser...`);
                return false;
            }
            return true;
        } catch (e) {
            console.error('[BrowserFactory] Health check error:', e);
            return false;
        }
    }

    private async ensureHealthy(): Promise<void> {
        if (Date.now() - this.lastHealthCheck < 30000 && this.browser?.isConnected()) return;
        if (!(await this.isHealthy())) {
            console.log(`[BrowserFactory:${this.instanceId}] 🔄 Restarting unhealthy browser... (Healthy: false)`);
            await this.close();
            await this.launch();
        }
    }

    public async launch(): Promise<Browser> {
        if (this.browser?.isConnected()) return this.browser;
        if (this.launchPromise) return this.launchPromise;

        this.launchPromise = (async () => {
            // Rate limit launch
            if (BrowserFactory.ACTIVE_INSTANCES >= BrowserFactory.MAX_CONCURRENCY) {
                await new Promise(r => setTimeout(r, 2000));
            }

            const freeMem = os.freemem() / 1024 / 1024;
            console.log(`[BrowserFactory:${this.instanceId}] 🚀 Spawning Browser (Free RAM: ${Math.round(freeMem)}MB)`);
            this.currentProfilePath = this.userDataDir;

            // Task 10: Cloak webdriver
            let executablePath = process.env.CHROME_PATH;
            if (!executablePath && os.platform() === 'linux') {
                try {
                    const paths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
                    for (const p of paths) {
                        if (fs.existsSync(p)) {
                            executablePath = p;
                            break;
                        }
                    }
                } catch (e) { console.error('Error finding chrome:', e); }
            }

            try {
                let browser;

                // 🌐 PROXY INTEGRATION: Get proxy args for hard targets
                const proxyManager = ProxyManager.getInstance();
                const proxyArgs = proxyManager.getLaunchArgsForUrl('https://paginegialle.it');
                if (proxyArgs.length > 0) {
                    Logger.info(`[BrowserFactory] 🌐 Using proxy: ${proxyArgs[0]}`);
                }

                if (config.browser.mode === 'remote') {
                    Logger.info(`[BrowserFactory] ☁️ Connecting to Remote Swarm at ${config.browser.remoteEndpoint}...`);
                    browser = await puppeteer.connect({
                        browserWSEndpoint: config.browser.remoteEndpoint,
                        defaultViewport: null
                    }) as unknown as Browser;
                    Logger.info('[BrowserFactory] ✅ Connected to Remote Swarm.');
                } else {
                    const args = [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--ignore-certificate-errors',
                        '--ignore-certificate-errors-spki-list',
                        // '--disable-dev-shm-usage', // Removing to match debug script
                    ];

                    // 🌐 PROXY SUPPORT
                    const disableProxy = process.env.DISABLE_PROXY === 'true';

                    if (config.proxy.residentialUrl && !disableProxy) {
                        try {
                            const url = new URL(config.proxy.residentialUrl);
                            args.push(`--proxy-server=${url.protocol}//${url.host}`);
                        } catch (e) {
                            Logger.warn(`[BrowserFactory] Invalid proxy URL: ${config.proxy.residentialUrl}`);
                        }
                    } else if (disableProxy) {
                        Logger.warn('[BrowserFactory] ⚠️ Proxy disabled via environment variable.');
                    }

                    // Add any specific proxy from ProxyManager if needed (though config.proxy usually covers it)
                    if (proxyArgs.length > 0) {
                        // checks if not already added
                        if (!args.some(a => a.startsWith('--proxy-server'))) {
                            args.push(proxyArgs[0]);
                        }
                    }

                    try {
                        Logger.info(`[BrowserFactory:${this.instanceId}] Spawning browser`);
                        if (config.proxy.residentialUrl) {
                            Logger.info(`[BrowserFactory:${this.instanceId}] 🛡️ Launching with Proxy: ${config.proxy.residentialUrl}`);
                        }

                        Logger.info(`[BrowserFactory] Final Args: ${JSON.stringify(args)}`);
                        browser = await puppeteer.launch({
                            headless: true,
                            args: args,
                            executablePath: process.env.CHROME_BIN || undefined,
                            defaultViewport: null,
                            ignoreHTTPSErrors: true,
                            // userDataDir: this.userDataDir, // Disable custom profile to match debug script and avoid collisions
                        } as any) as unknown as Browser;
                    } catch (e) {
                        Logger.error('[BrowserFactory] Launch failed', { error: e });
                        throw e;
                    }
                }

                this.browser = browser;
                this.browserCounted = true;
                BrowserFactory.ACTIVE_INSTANCES++;
                browser.once('disconnected', () => {
                    if (this.browserCounted) {
                        BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
                        this.browserCounted = false;
                    }
                    if (this.browser === browser) {
                        this.browser = null;
                    }
                });
                this.lastHealthCheck = Date.now();
                return browser;
            } catch (error) {
                console.error(`[BrowserFactory:${this.instanceId}] ❌ Launch Failed:`, error);
                throw error;
            }
        })();

        try {
            return await this.launchPromise;
        } finally {
            this.launchPromise = null;
        }
    }

    public async newPage(): Promise<Page> {
        await this.ensureHealthy();
        if (!this.browser) await this.launch();

        // Dynamic Tab Pooling
        const resourceManager = ResourceManager.getInstance();
        const recommendedTabs = resourceManager.getRecommendedConcurrency(PhaseType.BROWSER);
        BrowserFactory.MAX_TABS_PER_BROWSER = Math.max(1, recommendedTabs);

        while (this.activePages.size >= BrowserFactory.MAX_TABS_PER_BROWSER) {
            await new Promise(r => setTimeout(r, 1000));
            for (const page of this.activePages) {
                if (page.isClosed()) this.activePages.delete(page);
            }
        }

        const page = await this.browser!.newPage();
        this.activePages.add(page);
        page.once('close', () => this.activePages.delete(page));

        // 🧬 GENETIC EVOLUTION: Task 1
        const fingerprinter = GeneticFingerprinter.getInstance();
        const gene = fingerprinter.getBestGene();

        // Attach gene ID to page for feedback loop
        (page as any).__geneId = gene.id;

        await page.setUserAgent(gene.userAgent);

        await page.setViewport({
            width: gene.viewport.width,
            height: gene.viewport.height,
            isMobile: gene.userAgent.includes('Mobile') || gene.userAgent.includes('Android'),
            hasTouch: gene.userAgent.includes('Mobile') || gene.userAgent.includes('Android')
        });

        // Add headers from gene locale
        await page.setExtraHTTPHeaders({
            'Accept-Language': gene.locale === 'it-IT'
                ? 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
                : 'en-US,en;q=0.9,it;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua-Platform': gene.userAgent.includes('Mac') ? '"macOS"' : '"Windows"'
        });

        // Mock Hardware Concurrency
        await page.evaluateOnNewDocument((concurrency) => {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => concurrency,
            });
        }, gene.hardwareConcurrency);

        // Task 12: Page timeout recovery
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);

        // Task: Anti-Fingerprinting
        await BrowserEvasion.apply(page);

        // Task 16: Proxy Authentication (for authenticated proxies)
        if (process.env.DISABLE_PROXY !== 'true') {
            const proxyManager = ProxyManager.getInstance();
            await proxyManager.authenticateProxy(page, 'https://paginegialle.it');
        }


        // Task: Cookie Consent
        try {
            await CookieConsent.handle(page);
        } catch (e) {
            Logger.warn(`[BrowserFactory] ⚠️ Cookie consent failed (non-critical): ${(e as Error).message}`);
        }

        // 🛡️ MONITOR DETACHED FRAMES
        page.on('error', err => Logger.error(`[BrowserFactory] ❌ Page Error: ${err.message}`));
        page.on('close', () => Logger.info(`[BrowserFactory] 🚪 Page Closed`));
        // page.on('frame detached', ...) can be noisy, but good for debug if needed

        return page;
    }

    public async forceKill(): Promise<void> {
        if (this.browser && this.browser.process()) {
            const pid = this.browser.process()?.pid;
            if (pid) {
                try {
                    console.log(`[BrowserFactory] 💀 Force killing PID ${pid}`);
                    process.kill(pid, 'SIGKILL');
                } catch (e) { }
            }
        }
        this.browser = null;
        if (this.browserCounted) {
            BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
            this.browserCounted = false;
        }
    }

    public async closePage(page: Page): Promise<void> {
        try {
            if (!page.isClosed()) await page.close();
        } catch (e) { }
        this.activePages.delete(page);
    }

    public async close(): Promise<void> {
        for (const page of this.activePages) {
            try {
                if (!page.isClosed()) await page.close();
            } catch { }
        }
        this.activePages.clear();

        if (this.browser) {
            try {
                await this.browser.close();
            } catch { }
            this.browser = null;
            if (this.browserCounted) {
                BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
                this.browserCounted = false;
            }
        }

        // Cleanup temporary profile
        if (this.currentProfilePath) {
            try {
                if (fs.existsSync(this.currentProfilePath)) {
                    fs.rmSync(this.currentProfilePath, { recursive: true, force: true });
                }
            } catch (e) { console.error('Failed to clean profile:', e); }
            this.currentProfilePath = null;
        }
    }
}
