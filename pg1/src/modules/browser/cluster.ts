import { Cluster } from 'puppeteer-cluster';
import { logger } from '../observability';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { GeneticFingerprinter } from './genetic_fingerprinter';
import { BrowserEvasion } from './evasion';

puppeteer.use(StealthPlugin());

function getSandboxArgs(): string[] {
    const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
    return inDocker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
}

export class ClusterManager {
    private static instance: Cluster | null = null;

    public static async getInstance(): Promise<Cluster> {
        if (!this.instance) {
            logger.log('info', 'Initializing Puppeteer Cluster (v3 anti-detect)...');

            this.instance = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_CONTEXT,
                maxConcurrency: 5,
                puppeteer,
                puppeteerOptions: {
                    headless: true,
                    ignoreHTTPSErrors: true,
                    args: [
                        ...getSandboxArgs(),
                        '--disable-dev-shm-usage',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-features=Translate,BackForwardCache,AcceptCHFrame',
                        '--disable-background-networking',
                        '--disable-breakpad',
                        '--window-size=1920,1080',
                    ],
                } as any,
                monitor: false,
                timeout: 30000,
                retryLimit: 2,
                retryDelay: 1000,
            });

            this.instance.on('taskerror', (err, data) => {
                logger.log('error', `Cluster task error: ${err.message}`, { data });
            });
        }
        return this.instance;
    }

    public static async close() {
        if (this.instance) {
            await this.instance.idle();
            await this.instance.close();
            this.instance = null;
        }
    }

    /**
     * Fetch with full anti-detection (v3)
     * Uses genetic fingerprinter + evasion suite on every page
     */
    public static async fetch(url: string): Promise<{ content: string; status: number; finalUrl: string }> {
        const cluster = await this.getInstance();

        try {
            const result = await cluster.execute(url, async ({ page, data: targetUrl }) => {
                // Apply genetic fingerprint
                const fingerprinter = GeneticFingerprinter.getInstance();
                const gene = fingerprinter.getBestGene();
                const ua = gene.uaIndex !== undefined
                    ? (fingerprinter as any).constructor.name // Use the gene's UA
                    : null;

                // Get the UA string from the gene
                const geneUA = (gene as any).uaIndex !== undefined
                    ? gene // v3 gene with uaIndex
                    : gene;

                // Set viewport
                await page.setViewport({
                    width: gene.viewport.width,
                    height: gene.viewport.height,
                });

                // Set headers
                const acceptLang = gene.locale === 'it-IT'
                    ? 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
                    : 'en-US,en;q=0.9,it;q=0.8';
                await page.setExtraHTTPHeaders({ 'Accept-Language': acceptLang });

                // Get UA string from gene
                // The pg1 gene has uaIndex - look up from the embedded DB
                const uaString = this.getUAFromGene(gene);
                await page.setUserAgent(uaString);

                // Apply full evasion suite
                const evasionConfig = fingerprinter.geneToEvasionConfig(gene);
                await BrowserEvasion.apply(page, evasionConfig);

                // Tag gene for feedback
                (page as any).__geneId = gene.id;

                const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                const content = await page.content();
                const status = response?.status() || 200;
                const finalUrl = page.url();

                // Auto-report to genetic fingerprinter
                const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
                if (status >= 200 && status < 400) {
                    fingerprinter.reportSuccess(gene.id, domain);
                } else if (status === 403 || status === 429 || status === 503) {
                    fingerprinter.reportFailure(gene.id, domain);
                }

                return { content, status, finalUrl };
            });

            return result;
        } catch (e: any) {
            logger.log('error', `Cluster fetch failed for ${url}: ${e.message}`);
            return { content: '', status: 0, finalUrl: url };
        }
    }

    // Embedded UA lookup for the pg1 gene
    private static readonly UA_STRINGS = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    ];

    private static getUAFromGene(gene: any): string {
        if (typeof gene.uaIndex === 'number' && gene.uaIndex < this.UA_STRINGS.length) {
            return this.UA_STRINGS[gene.uaIndex];
        }
        // Fallback
        return this.UA_STRINGS[0];
    }
}
