
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
import { ProxyManager } from './proxy_manager';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { BrowserEvasion } from './evasion';
import { CookieConsent } from './cookie_consent';

// Add plugin
puppeteer.use(StealthPlugin());

function getSandboxArgs(): string[] {
    const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
    return inDocker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
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
    private static readonly MAX_CONCURRENCY = config.browser.maxConcurrency;
    private static MAX_TABS_PER_BROWSER = 8;
    public static ACTIVE_INSTANCES = 0;
    public static instances: Set<BrowserFactory> = new Set();
    private static shutdownHooksRegistered = false;

    constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
        this.userDataDir = path.join(process.cwd(), 'temp_profiles', `browser_${this.instanceId}`);
        this.currentProfilePath = this.userDataDir; // FIX: Assign for cleanup in close()
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
            Logger.info(`[BrowserFactory:${this.instanceId}] Spawning browser`, { free_ram_mb: Math.round(freeMem) });
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
                } catch (e) {
                    Logger.warn('Error while searching for Chrome executable', { error: e as Error });
                }
            }

            // PROXY INTEGRATION
            const proxyManager = ProxyManager.getInstance();
            // Default to High Security proxy (Residential) for the browser instance
            // We assume this browser will be primarily used for Google/UfficioCamerale in Phase 1/2
            const proxyArgs = proxyManager.getLaunchArgsForUrl('https://www.google.com');

            if (proxyArgs.length > 0) {
                Logger.info(`[BrowserFactory:${this.instanceId}] 🛡️ Launching with Proxy: ${proxyArgs[0]}`);
            } else {
                Logger.warn(`[BrowserFactory:${this.instanceId}] ⚠️ No Proxy configured! Running raw (DIRECT).`);
            }

            try {
                let browser;
                if (config.browser.mode === 'remote') {
                    Logger.info(`[BrowserFactory] ☁️ Connecting to Remote Swarm at ${config.browser.remoteEndpoint}...`);
                    browser = await puppeteer.connect({
                        browserWSEndpoint: config.browser.remoteEndpoint,
                        defaultViewport: null
                    }) as unknown as Browser;
                    Logger.info('[BrowserFactory] ✅ Connected to Remote Swarm.');
                } else {
                    browser = await puppeteer.launch({
                        headless: true,
                        timeout: 60000,
                        protocolTimeout: 60000,
                        userDataDir: this.userDataDir,
                        executablePath: executablePath,
                        args: [
                            ...proxyArgs, // <--- PROXY ARGS
                            ...getSandboxArgs(),
                            '--disable-infobars',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--disable-blink-features=AutomationControlled',
                            '--limit-chrome-features-to-only-platform-essential',
                            '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
                            '--disable-background-networking',
                            '--disable-breakpad',
                            '--disable-component-extensions-with-background-pages',
                            '--disable-extensions',
                            '--disable-ipc-flooding-protection',
                            '--disable-renderer-backgrounding',
                            '--enable-features=NetworkService,NetworkServiceInProcess',
                            '--window-size=1920,1080',
                            '--single-process',
                            '--no-zygote'
                        ]
                    }) as unknown as Browser;
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

        // PROXY AUTHENTICATION
        // We use google.com to get the Residential credentials if available
        await ProxyManager.getInstance().authenticateProxy(page, 'https://www.google.com');

        // Task 12: Page timeout recovery
        page.setDefaultTimeout(config.scraping.timeout);
        page.setDefaultNavigationTimeout(config.scraping.pageLoadTimeout);

        // Task: Anti-Fingerprinting
        await BrowserEvasion.apply(page);
        // Task: Cookie Consent
        await CookieConsent.handle(page);

        return page;
    }

    public async forceKill(targetBrowser: Browser | null = this.browser): Promise<void> {
        if (targetBrowser && targetBrowser.process()) {
            const pid = targetBrowser.process()?.pid;
            if (pid) {
                try {
                    Logger.warn(`[BrowserFactory] Force killing browser process`, { pid });
                    process.kill(pid, 'SIGKILL');
                } catch (e) {
                    Logger.warn('[BrowserFactory] Failed to force kill process', { pid, error: e as Error });
                }
            }
        }

        if (targetBrowser && targetBrowser === this.browser) {
            this.browser = null;
        }
        if (this.browserCounted) {
            BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
            this.browserCounted = false;
        }
    }

    public async closePage(page: Page): Promise<void> {
        try {
            if (!page.isClosed()) await page.close();
        } catch (e) {
            Logger.warn('Failed to close page cleanly', { error: e as Error });
        }
        this.activePages.delete(page);
    }

    public async close(): Promise<void> {
        for (const page of this.activePages) {
            try {
                if (!page.isClosed()) await page.close();
            } catch (error) {
                Logger.warn('Failed to close active page during shutdown', { error: error as Error });
            }
        }
        this.activePages.clear();

        if (this.browser) {
            const browserToClose = this.browser;
            this.browser = null;
            if (this.browserCounted) {
                BrowserFactory.ACTIVE_INSTANCES = Math.max(0, BrowserFactory.ACTIVE_INSTANCES - 1);
                this.browserCounted = false;
            }

            try {
                await browserToClose.close();
            } catch {
                await this.forceKill(browserToClose);
            }
        }

        // Cleanup temporary profile
        if (this.currentProfilePath) {
            try {
                if (fs.existsSync(this.currentProfilePath)) {
                    fs.rmSync(this.currentProfilePath, { recursive: true, force: true });
                }
            } catch (e) {
                Logger.warn('Failed to clean temporary browser profile', { error: e as Error });
            }
            this.currentProfilePath = null;
        }

        ProxyManager.getInstance().dispose();
    }
}
