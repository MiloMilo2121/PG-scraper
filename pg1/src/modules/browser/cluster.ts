import { Cluster } from 'puppeteer-cluster';
import { logger } from '../observability';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

function getSandboxArgs(): string[] {
    const inDocker = process.env.RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv');
    return inDocker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
}

export class ClusterManager {
    private static instance: Cluster | null = null;
    // We keep track of active tasks if needed, but cluster handles concurrency

    public static async getInstance(): Promise<Cluster> {
        if (!this.instance) {
            logger.log('info', 'Initializing Puppeteer Cluster...');

            this.instance = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_CONTEXT, // Use Incognito Pages (Contexts)
                maxConcurrency: 5, // Optimized for speed (was 2)
                puppeteer,
                puppeteerOptions: {
                    headless: true,
                    ignoreHTTPSErrors: true,
                    args: [
                        ...getSandboxArgs(),
                        '--disable-dev-shm-usage',
                        '--disable-features=site-per-process'
                    ],
                    // defaultViewport: null
                } as any,
                monitor: false, // Set to true for debug CLI output
                timeout: 30000, // Task timeout
                retryLimit: 2,
                retryDelay: 1000,
            });

            // Generic error handler
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
     * Generic fetch method to replace PuppeteerWrapper.fetch
     * Instead of returning a page, it queues a task and waits for the result.
     */
    public static async fetch(url: string): Promise<{ content: string; status: number; finalUrl: string }> {
        const cluster = await this.getInstance();

        try {
            // execute task directly using execution callback
            const result = await cluster.execute(url, async ({ page, data: targetUrl }) => {
                // Set Viewport
                await page.setViewport({ width: 1920, height: 1080 });

                // Set Italian Language
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
                });

                // User Agent Logic
                let uaString = '';
                if (targetUrl.includes('bing.com') || targetUrl.includes('google.com')) {
                    // Use fixed, reliable UA for Search Engines to ensure consistent DOM
                    uaString = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                } else {
                    // Use dynamic UA for target sites to avoid blocking
                    const UserAgent = require('user-agents');
                    const ua = new UserAgent({ deviceCategory: 'desktop' });
                    uaString = ua.toString();
                }

                await page.setUserAgent(uaString);

                const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                const content = await page.content();
                const status = response?.status() || 200;
                const finalUrl = page.url();

                return { content, status, finalUrl };
            });

            return result;
        } catch (e: any) {
            logger.log('error', `Cluster fetch failed for ${url}: ${e.message}`);
            return { content: '', status: 0, finalUrl: url };
        }
    }
}
