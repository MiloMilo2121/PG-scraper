
import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as os from 'os';
import { ResourceManager, PhaseType } from '../../utils/resource_manager';
import { getRandomUserAgent } from '../discovery/ua_db';
import { GeneticFingerprinter } from './genetic_fingerprinter';
// Task 8 & 9: Human Behavior
import { HumanBehavior } from './human_behavior';
import { config } from '../../config';
import { BrowserEvasion } from './evasion';
import { CookieConsent } from './cookie_consent';
import { Logger } from '../../utils/logger';

// Add plugin
puppeteer.use(StealthPlugin());

export class BrowserFactory {
    private static instance: BrowserFactory;
    private browser: Browser | null = null;
    private userDataDir: string;
    private launchPromise: Promise<Browser> | null = null;
    private activePages: Set<Page> = new Set();
    private instanceId: string;
    private lastHealthCheck: number = Date.now();
    private currentProfilePath: string | null = null;

    // Configuration
    private static readonly MAX_CONCURRENCY = 10; // Stabilized for server
    private static MAX_TABS_PER_BROWSER = 8;
    public static ACTIVE_INSTANCES = 0;
    public static instances: Set<BrowserFactory> = new Set();

    constructor(userDataDir: string = './temp_profiles/singleton_browser_turbo') {
        this.userDataDir = userDataDir;
        this.instanceId = Math.random().toString(36).substring(7);
        BrowserFactory.instances.add(this);
    }

    public static getInstance(userDataDir?: string): BrowserFactory {
        if (!BrowserFactory.instance) {
            BrowserFactory.instance = new BrowserFactory(userDataDir);
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

            // Task 10: Cloak webdriver
            let executablePath = process.env.CHROME_PATH;
            if (!executablePath && os.platform() === 'linux') {
                try {
                    const paths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
                    const fs = require('fs');
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
                if (config.browser.mode === 'remote') {
                    Logger.info(`[BrowserFactory] ☁️ Connecting to Remote Swarm at ${config.browser.remoteEndpoint}...`);
                    browser = await puppeteer.connect({
                        browserWSEndpoint: config.browser.remoteEndpoint,
                        defaultViewport: null
                    }) as unknown as Browser;
                    Logger.info('[BrowserFactory] ✅ Connected to Remote Swarm.');
                } else {
                    browser = await puppeteer.launch({
                        headless: config.browser.headless ? true : false,



                        timeout: 60000,
                        protocolTimeout: 60000,
                        userDataDir: this.userDataDir,
                        executablePath: executablePath,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
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
                BrowserFactory.ACTIVE_INSTANCES++;
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
        // Task: Cookie Consent
        await CookieConsent.handle(page);

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
            BrowserFactory.ACTIVE_INSTANCES--;
        }

        // Cleanup temporary profile
        if (this.currentProfilePath) {
            try {
                const fs = require('fs');
                if (fs.existsSync(this.currentProfilePath)) {
                    fs.rmSync(this.currentProfilePath, { recursive: true, force: true });
                }
            } catch (e) { console.error('Failed to clean profile:', e); }
            this.currentProfilePath = null;
        }
    }
}
