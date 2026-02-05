/**
 * 🥷 BROWSER FACTORY v2
 * The stealth browser launcher with genetic fingerprinting
 * 
 * NINJA CORE - Adapted for PG1 Shadow Hunter
 */

import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as os from 'os';
import * as path from 'path';

import { GeneticFingerprinter } from './genetic_fingerprinter';
import { HumanBehavior } from './human_behavior';
import { BrowserEvasion } from './evasion';
import { ProxyManager } from './proxy_manager';

// Add stealth plugin
puppeteer.use(StealthPlugin());

export class BrowserFactory {
    private static instance: BrowserFactory;
    private browser: Browser | null = null;
    private userDataDir: string;
    private launchPromise: Promise<Browser> | null = null;
    private activePages: Set<Page> = new Set();
    private instanceId: string;
    private lastHealthCheck: number = Date.now();

    private static readonly MAX_CONCURRENCY = 25;
    private static MAX_TABS_PER_BROWSER = 8;
    public static ACTIVE_INSTANCES = 0;

    constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
        this.userDataDir = path.join(process.cwd(), 'temp_profiles', `browser_${this.instanceId}`);
    }

    public static getInstance(): BrowserFactory {
        if (!BrowserFactory.instance) {
            BrowserFactory.instance = new BrowserFactory();
            // Zombie cleanup
            ['exit', 'SIGINT', 'SIGTERM'].forEach(signal => {
                process.on(signal, () => BrowserFactory.instance.close());
            });
        }
        return BrowserFactory.instance;
    }

    public async isHealthy(): Promise<boolean> {
        if (!this.browser) return false;
        try {
            if (!this.browser.isConnected()) return false;
            const memUsage = process.memoryUsage();
            const totalMem = os.totalmem();
            const usedPercent = (memUsage.heapUsed / totalMem) * 100;
            return usedPercent < 80;
        } catch (e) {
            return false;
        }
    }

    private async ensureHealthy(): Promise<void> {
        if (Date.now() - this.lastHealthCheck < 30000 && this.browser?.isConnected()) return;
        if (!(await this.isHealthy())) {
            console.log(`[BrowserFactory:${this.instanceId}] 🔄 Restarting unhealthy browser...`);
            await this.close();
            await this.initiateShadowProtocol();
        }
    }

    /**
     * initiateShadowProtocol - Launch stealth browser
     */
    public async initiateShadowProtocol(): Promise<Browser> {
        if (this.browser?.isConnected()) return this.browser;
        if (this.launchPromise) return this.launchPromise;

        this.launchPromise = (async () => {
            if (BrowserFactory.ACTIVE_INSTANCES >= BrowserFactory.MAX_CONCURRENCY) {
                await new Promise(r => setTimeout(r, 2000));
            }

            const freeMem = os.freemem() / 1024 / 1024;
            console.log(`[BrowserFactory:${this.instanceId}] 🚀 initiateShadowProtocol (Free RAM: ${Math.round(freeMem)}MB)`);

            let executablePath = process.env.CHROME_PATH;
            if (!executablePath && os.platform() === 'linux') {
                const paths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
                const fs = require('fs');
                for (const p of paths) {
                    if (fs.existsSync(p)) {
                        executablePath = p;
                        break;
                    }
                }
            }

            try {
                const browser = await puppeteer.launch({
                    headless: true,
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
                        '--disable-features=Translate,BackForwardCache',
                        '--disable-background-networking',
                        '--disable-extensions',
                        '--window-size=1920,1080',
                        '--single-process',
                        '--no-zygote'
                    ]
                }) as unknown as Browser;

                this.browser = browser;
                BrowserFactory.ACTIVE_INSTANCES++;
                this.lastHealthCheck = Date.now();
                return browser;
            } catch (error) {
                console.error(`[BrowserFactory:${this.instanceId}] ❌ Shadow Protocol Failed:`, error);
                throw error;
            }
        })();

        try {
            return await this.launchPromise;
        } finally {
            this.launchPromise = null;
        }
    }

    // Alias for compatibility
    public async launch(): Promise<Browser> {
        return this.initiateShadowProtocol();
    }

    public async newPage(): Promise<Page> {
        await this.ensureHealthy();
        if (!this.browser) await this.initiateShadowProtocol();

        while (this.activePages.size >= BrowserFactory.MAX_TABS_PER_BROWSER) {
            await new Promise(r => setTimeout(r, 1000));
            for (const page of this.activePages) {
                if (page.isClosed()) this.activePages.delete(page);
            }
        }

        const page = await this.browser!.newPage();
        this.activePages.add(page);
        page.once('close', () => this.activePages.delete(page));

        // 🧬 GENETIC EVOLUTION
        const fingerprinter = GeneticFingerprinter.getInstance();
        const gene = fingerprinter.getBestGene();
        (page as any).__geneId = gene.id;

        await page.setUserAgent(gene.userAgent);
        await page.setViewport({
            width: gene.viewport.width,
            height: gene.viewport.height,
            isMobile: gene.userAgent.includes('Mobile'),
            hasTouch: gene.userAgent.includes('Mobile')
        });

        await page.setExtraHTTPHeaders({
            'Accept-Language': gene.locale === 'it-IT'
                ? 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
                : 'en-US,en;q=0.9,it;q=0.8',
        });

        await page.evaluateOnNewDocument((concurrency) => {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => concurrency,
            });
        }, gene.hardwareConcurrency);

        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);

        // Apply evasion
        await BrowserEvasion.apply(page);

        return page;
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
    }

    public async forceKill(): Promise<void> {
        if (this.browser?.process()?.pid) {
            try {
                process.kill(this.browser.process()!.pid!, 'SIGKILL');
            } catch (e) { }
        }
    }
}

// Export singleton
export const browserFactory = BrowserFactory.getInstance();
