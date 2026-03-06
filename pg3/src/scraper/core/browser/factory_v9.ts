/**
 * 🏭 OMEGA V9: THE GHOST FACTORY
 * Task 3.1: Dual-Architecture Browser Orchestration
 * 
 * Engine Modes:
 * 1. PATCHRIGHT (80% Traffic): Fast, memory-efficient Chromium fork. Hides CDP leaks.
 *    Used for standard targets and intermediate WAFs.
 * 2. CAMOUFOX (20% Traffic): Heavyweight Firefox C++ fork. Mathematically perfect stealth.
 *    Used for extreme targets (Kasada, DataDome) and behavioral biometrics validation.
 */

import { Browser, BrowserContext, Page, chromium, firefox } from 'playwright';
import * as os from 'os';
import * as fs from 'fs';

import { ResourceManager, PhaseType } from '../../utils/resource_manager';
import { GeneticFingerprinter } from './genetic_fingerprinter';
import { ProxyManagerV9 } from './proxy_manager_v9';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { BrowserEvasion } from './evasion';
import { CookieConsent } from './cookie_consent';
import { createHumanMouse, HumanMouse } from './human_mouse';

export enum EngineType {
    PATCHRIGHT = 'PATCHRIGHT',
    CAMOUFOX = 'CAMOUFOX'
}

export class BrowserFactoryV9 {
    private static instance: BrowserFactoryV9;
    private patchrightInstance: Browser | null = null;
    private camoufoxInstance: Browser | null = null;

    // Concurrency Controls
    private activeContexts: Set<BrowserContext> = new Set();
    private instanceId: string;
    public static ACTIVE_CONTEXTS_COUNT = 0;
    private static readonly MAX_CONCURRENCY = config.browser.maxConcurrency || 10;

    private constructor() {
        this.instanceId = Math.random().toString(36).substring(7);
        BrowserFactoryV9.registerShutdownHooks();
        Logger.info(`🏭 [BrowserFactory:V9] Initialized. Awaiting engine ignition.`);
    }

    public static getInstance(): BrowserFactoryV9 {
        if (!BrowserFactoryV9.instance) {
            BrowserFactoryV9.instance = new BrowserFactoryV9();
        }
        return BrowserFactoryV9.instance;
    }

    private static registerShutdownHooks(): void {
        const shutdown = async () => {
            if (BrowserFactoryV9.instance) {
                Logger.info(`🛑 [BrowserFactory:V9] Tearing down all engines...`);
                await BrowserFactoryV9.instance.closeAll();
            }
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    }

    /**
     * 🚀 Launch a specific engine
     */
    private async launchEngine(engine: EngineType): Promise<Browser> {
        const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
        const isRoot = process.getuid && process.getuid() === 0;
        const sandboxArgs = (inDocker || isRoot) ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

        try {
            if (engine === EngineType.PATCHRIGHT) {
                if (this.patchrightInstance?.isConnected()) return this.patchrightInstance;

                Logger.info(`[BrowserFactory:V9] Igniting PATCHRIGHT Engine (Chromium Stealth)`);
                this.patchrightInstance = await chromium.launch({
                    headless: true,
                    // Note: V9 Assumes 'patchright' binary or module is mapped to 'chromium' via npm alias or path
                    args: [
                        ...sandboxArgs,
                        '--disable-blink-features=AutomationControlled',
                        '--disable-ipc-flooding-protection',
                        '--disable-background-networking',
                        '--window-size=1920,1080',
                    ]
                });
                return this.patchrightInstance;
            }
            else {
                if (this.camoufoxInstance?.isConnected()) return this.camoufoxInstance;

                Logger.info(`[BrowserFactory:V9] Igniting CAMOUFOX Engine (Firefox Extreme Stealth)`);
                this.camoufoxInstance = await firefox.launch({
                    headless: true,
                    // Note: V9 Assumes firefox module is wrapped by Camoufox executable
                    args: [
                        ...sandboxArgs,
                        '--window-size=1920,1080',
                    ]
                });
                return this.camoufoxInstance;
            }
        } catch (error) {
            Logger.error(`❌ [BrowserFactory:V9] Failed to launch ${engine} engine`, { error });
            throw error;
        }
    }

    /**
     * 🌐 Allocates a new context and page dynamically choosing the engine based on Target URL
     */
    public async newPage(targetUrl: string, forceEngine?: EngineType): Promise<{ page: Page, mouse: HumanMouse }> {
        // Enforce concurrency limits
        while (BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT >= BrowserFactoryV9.MAX_CONCURRENCY) {
            await new Promise(r => setTimeout(r, 1000));
        }

        // Engine Routing Logic
        let engineToUse = forceEngine || this.determineEngine(targetUrl);
        const browser = await this.launchEngine(engineToUse);

        try {
            // 🧬 1. Fingerprint Generation
            const geneConfig = GeneticFingerprinter.getInstance().geneToConfig(
                GeneticFingerprinter.getInstance().getBestGene()
            );

            // 🌊 2. Proxy Waterfall Resolution (V9 feature)
            const proxyManager = ProxyManagerV9.getInstance();
            let proxySettings = undefined;

            if (process.env.DISABLE_PROXY !== 'true') {
                const pOpts = proxyManager.getPlaywrightProxy(targetUrl);
                if (pOpts) {
                    proxySettings = {
                        server: pOpts.server,
                        username: pOpts.username,
                        password: pOpts.password
                    };
                    Logger.debug(`[BrowserFactory:V9] Context routed via ${proxySettings.server}`);
                }
            }

            // 📦 3. Context Creation
            const context = await browser.newContext({
                proxy: proxySettings,
                userAgent: geneConfig.userAgent,
                viewport: { width: geneConfig.viewport.width, height: geneConfig.viewport.height },
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
            BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT++;

            context.setDefaultTimeout(config.scraping.timeout || 30000);
            context.setDefaultNavigationTimeout(config.scraping.pageLoadTimeout || 60000);

            // 🛡️ 4. Evasion Injection
            const page = await context.newPage();

            // Apply software layer evasion (mostly for Patchright, Camoufox handles this at C++ level but redundancy is safe)
            await BrowserEvasion.apply(page, geneConfig.evasionConfig);
            await CookieConsent.handle(page);

            // 🖱️ 5. Attach B-Spline Human Mouse
            const humanMouse = createHumanMouse(page);

            // Track state
            (page as any).__context = context;
            page.once('close', () => {
                this.activeContexts.delete(context);
                BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT = Math.max(0, BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT - 1);
                context.close().catch(() => { });
            });

            return { page, mouse: humanMouse };

        } catch (error) {
            Logger.error(`[BrowserFactory:V9] Context creation failed.`, { error });
            throw error;
        }
    }

    /**
     * 🧠 V9 Routing Logic: Determines if target requires Camoufox
     */
    private determineEngine(url: string): EngineType {
        const hostname = new URL(url).hostname.toLowerCase();

        // Known hard targets utilizing advanced behavioral biometrics (Kasada, DataDome)
        const extremeTargets = ['instagram.com', 'tiktok.com', 'kasada.io', 'datadome.co'];

        if (extremeTargets.some(t => hostname.includes(t))) {
            return EngineType.CAMOUFOX;
        }

        // Default to highly efficient Chromium
        return EngineType.PATCHRIGHT;
    }

    public async closePage(page: Page): Promise<void> {
        const context = (page as any).__context as BrowserContext;
        if (context) {
            this.activeContexts.delete(context);
            BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT = Math.max(0, BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT - 1);
        }

        if (!page.isClosed()) {
            try {
                await page.close({ runBeforeUnload: false });
            } catch (e) {
                Logger.warn('[BrowserFactory:V9] Failed to close page cleanly', { error: e });
            }
        }

        if (context) {
            await context.close().catch(() => { });
        }
    }

    public async closeAll(): Promise<void> {
        for (const ctx of this.activeContexts) {
            await ctx.close().catch(() => { });
        }
        this.activeContexts.clear();
        BrowserFactoryV9.ACTIVE_CONTEXTS_COUNT = 0;

        if (this.patchrightInstance) await this.patchrightInstance.close().catch(() => { });
        if (this.camoufoxInstance) await this.camoufoxInstance.close().catch(() => { });

        this.patchrightInstance = null;
        this.camoufoxInstance = null;
    }
}

export const browserFactoryV9 = BrowserFactoryV9.getInstance();
