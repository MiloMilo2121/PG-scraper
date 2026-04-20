import { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { ResourceManager, PhaseType } from '../../utils/resource_manager';
import { GeneticFingerprinter } from './genetic_fingerprinter';
// Task 8 & 9: Human Behavior
import { ProxyManager } from './proxy_manager';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { BrowserEvasion } from './evasion';
import { CookieConsent } from './cookie_consent';

// 🛡️ Stealth Plugin: Re-enabled with safety valve (Law 308: Fingerprint Spoofing)
// Original disable was for ERR_INVALID_AUTH_CREDENTIALS (proxy-auth conflict).
if (process.env.DISABLE_STEALTH !== 'true') {
    chromium.use(StealthPlugin());
}

function getSandboxArgs(): string[] {
    const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
    const isRoot = process.getuid && process.getuid() === 0;
    return (inDocker || isRoot) ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
}

export class BrowserFactory {
    private static instance: BrowserFactory;
    private browser: Browser | null = null;
    private launchPromise: Promise<Browser> | null = null;
    private activeContexts: Set<BrowserContext> = new Set();
    private instanceId: string;
    private lastHealthCheck: number = Date.now();
    private browserCounted = false;

    // Configuration
    private static readonly MAX_CONCURRENCY = config.browser.maxConcurrency;
    private static MAX_TABS_PER_BROWSER = 8;
    public static ACTIVE_INSTANCES = 0;
    public static instances: Set<BrowserFactory> = new Set();
    private static shutdownHooksRegistered = false;

    constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
        BrowserFactory.instances.add(this);
    }

    public static getInstance(): BrowserFactory {
        if (!BrowserFactory.instance) {
            BrowserFactory.instance = new BrowserFactory();
            BrowserFactory.registerShutdownHooks();
        }
        return BrowserFactory.instance;
    }

    private static registerShutdownHooks(): void {
        if (BrowserFactory.shutdownHooksRegistered) {
            return;
        }
        BrowserFactory.shutdownHooksRegistered = true;

        const shutdown = () => {
            if (BrowserFactory.instance) {
                void BrowserFactory.instance.close();
            }
        };

        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        process.once('beforeExit', shutdown);
    }


    /**
     * Task 11: Health check - verify browser is responsive
     */
    public async isHealthy(): Promise<boolean> {
        if (!this.browser) return false;

        try {
            if (!this.browser.isConnected()) {
                Logger.warn('[BrowserFactory] Browser disconnected');
                return false;
            }
            const memUsage = process.memoryUsage();
            const totalMem = os.totalmem();
            const usedPercent = (memUsage.heapUsed / totalMem) * 100;

            if (usedPercent > 80) {
                Logger.warn(`[BrowserFactory] Memory usage at ${usedPercent.toFixed(1)}%, restarting browser...`);
                return false;
            }
            return true;
        } catch (e) {
            Logger.error('[BrowserFactory] Health check error', { error: e as Error });
            return false;
        }
    }

    private async ensureHealthy(): Promise<void> {
        if (Date.now() - this.lastHealthCheck < 30000 && this.browser?.isConnected()) return;
        if (!(await this.isHealthy())) {
            Logger.info(`[BrowserFactory:${this.instanceId}] Restarting unhealthy browser`);
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
            Logger.info(`[BrowserFactory:${this.instanceId}] Spawning Playwright browser`, { free_ram_mb: Math.round(freeMem) });
            this.instanceId = Math.random().toString(36).substring(7);

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
                } catch (e) {
                    Logger.warn('Error while searching for Chrome executable', { error: e as Error });
                }
            }

            // Proxy validation (Playwright passes the actual proxy config at the Context level)
            const proxyManager = ProxyManager.getInstance();
            if ((config as any).scrapeDo?.enforce) {
                const p = proxyManager.getPlaywrightProxy('https://www.google.com');
                if (!p) {
                    // BUG-01 FIX: Hard-fail if proxy is enforced but missing (Law 005: Assume Malice)
                    const msg = `[BrowserFactory:${this.instanceId}] SCRAPE_DO_ENFORCE=true but no proxy available. Refusing to launch unprotected browser.`;
                    Logger.error(msg);
                    throw new Error(msg);
                }
            }

            try {
                let browser: Browser;
                if (config.browser.mode === 'remote') {
                    if (!config.browser.remoteEndpoint) throw new Error('Remote endpoint not configured');
                    Logger.info(`[BrowserFactory] ☁️ Connecting to Remote Swarm at ${config.browser.remoteEndpoint}...`);
                    browser = await chromium.connectOverCDP(config.browser.remoteEndpoint) as Browser;
                    Logger.info('[BrowserFactory] ✅ Connected to Remote Swarm.');
                } else {
                    browser = await chromium.launch({
                        headless: true,
                        timeout: 60000,
                        executablePath: executablePath,
                        args: [
                            ...getSandboxArgs(),
                            '--disable-infobars',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--disable-blink-features=AutomationControlled',
                            '--limit-chrome-features-to-only-platform-essential',
                            '--disable-background-networking',
                            '--disable-ipc-flooding-protection',
                            '--disable-renderer-backgrounding',
                            '--window-size=1920,1080',
                        ]
                    }) as Browser;
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
                Logger.error(`[BrowserFactory:${this.instanceId}] Launch failed`, { error: error as Error });
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

        while (this.activeContexts.size >= BrowserFactory.MAX_TABS_PER_BROWSER) {
            await new Promise(r => setTimeout(r, 1000));
        }

        try {
            // 🧬 GENETIC EVOLUTION v3: Full trait-consistent fingerprinting
            const fingerprinter = GeneticFingerprinter.getInstance();
            const gene = fingerprinter.getBestGene();
            const geneConfig = GeneticFingerprinter.getInstance().geneToConfig(gene);

            // PROXY INTEGRATION moves to Context
            const proxyManager = ProxyManager.getInstance();
            let proxyConfig: any = {};
            if (process.env.DISABLE_PROXY !== 'true') {
                const proxy = proxyManager.getPlaywrightProxy('https://www.google.com');
                if (proxy) {
                    proxyConfig.proxy = {
                        server: proxy.server,
                        username: proxy.username,
                        password: proxy.password
                    };
                    Logger.info(`[BrowserFactory:${this.instanceId}] Context using Proxy: ${proxy.server}`);
                }
            } else {
                Logger.warn(`[BrowserFactory:${this.instanceId}] PROXY DISABLED via env var`);
            }

            const context = await this.browser!.newContext({
                ...proxyConfig,
                userAgent: geneConfig.userAgent,
                viewport: {
                    width: geneConfig.viewport.width,
                    height: geneConfig.viewport.height,
                },
                isMobile: geneConfig.isMobile,
                hasTouch: geneConfig.isMobile,
                ignoreHTTPSErrors: true,
                extraHTTPHeaders: {
                    'Accept-Language': geneConfig.acceptLanguage,
                    'Upgrade-Insecure-Requests': '1',
                    ...geneConfig.clientHintsHeaders,
                }
            });

            this.activeContexts.add(context);
            context.setDefaultTimeout(config.scraping.timeout);
            context.setDefaultNavigationTimeout(config.scraping.pageLoadTimeout);

            // Mock Hardware Concurrency
            await context.addInitScript((concurrency: number) => {
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => concurrency,
                });
            }, geneConfig.hardwareConcurrency);

            const page = await context.newPage();

            // Attach gene ID to page for feedback loop
            (page as any).__geneId = gene.id;
            (page as any).__context = context;

            // Handle accidental page disconnects gracefully
            page.once('close', () => {
                this.activeContexts.delete(context);
                context.close().catch(() => { });
            });

            // Anti-Fingerprinting v3: Full evasion with gene-derived config
            await BrowserEvasion.apply(page, geneConfig.evasionConfig);
            // Cookie Consent
            await CookieConsent.handle(page);

            return page;
        } catch (error) {
            Logger.error(`[BrowserFactory] Error during newPage setup`, { error: error as Error });
            throw error;
        }
    }

    public async forceKill(targetBrowser: Browser | null = this.browser): Promise<void> {
        // Force kill logic for Playwright CDP server is difficult without the underlying PID of chromium, 
        // but typically Playwright cleans up properly on close(). 
        // We will do a grace close and nullify.
        if (targetBrowser && targetBrowser === this.browser) {
            this.browser = null;
        }
        if (this.browserCounted) {
            BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
            this.browserCounted = false;
        }
        if (targetBrowser) {
            targetBrowser.close().catch(e => {
                Logger.warn('[BrowserFactory] Failed to force close browser', { error: e as Error });
            });
        }
    }

    public async closePage(page: Page): Promise<void> {
        const CLOSE_TIMEOUT_MS = 5000;

        // Extract context and remove from active tracking
        const context = (page as any).__context as BrowserContext;
        if (context) {
            this.activeContexts.delete(context);
        }

        if (page.isClosed()) {
            return;
        }

        try {
            await Promise.race([
                page.close(), // closes page, which triggers the close listener that closes context
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error('Page close timeout')), CLOSE_TIMEOUT_MS)
                ),
            ]);
        } catch (e) {
            Logger.warn('Failed to close page cleanly', { error: e as Error });
        } finally {
            if (context) {
                context.close().catch(() => { });
            }
        }
    }

    public async close(): Promise<void> {
        for (const context of [...this.activeContexts]) {
            await context.close().catch(() => { });
        }
        this.activeContexts.clear();

        if (this.browser) {
            const browserToClose = this.browser;
            this.browser = null;
            if (this.browserCounted) {
                BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
                this.browserCounted = false;
            }

            try {
                // Timeout-wrapped close: if Chromium hangs, fall back to forceKill after 10s
                await Promise.race([
                    browserToClose.close(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('browser.close() timeout')), 10_000)
                    ),
                ]);
            } catch {
                await this.forceKill(browserToClose);
            }
        }

        ProxyManager.getInstance().dispose();
    }
}
