import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { Logger } from '../../utils/logger';
import { Mutex } from 'async-mutex';
import * as net from 'net';
import { TorError } from '../../../utils/errors';
import { config } from '../../config';

// Enable stealth
puppeteer.use(StealthPlugin());

export class TorBrowser {
    private static instance: TorBrowser;
    private browser: Browser | null = null;
    private lastUsed: number = Date.now();
    private activePages: number = 0;

    // 🔒 Mutex for thread-safe rotation (Law 104)
    private rotationLock = new Mutex();

    private readonly ROTATION_COOLDOWN_MS = 10000;
    private lastRotationTime = 0;

    // 🔌 Circuit-breaker for Tor ControlPort availability
    private controlPortAvailable: boolean | null = null; // null = not checked yet
    private controlPortCheckTime = 0;
    private readonly CONTROL_PORT_RECHECK_MS = 60000; // Re-check every 60s
    private consecutiveFailures = 0;
    private readonly MAX_FAILURES_BEFORE_DISABLE = 2;

    private constructor() { }

    public static getInstance(): TorBrowser {
        if (!TorBrowser.instance) {
            TorBrowser.instance = new TorBrowser();
        }
        return TorBrowser.instance;
    }

    /**
     * 🔌 Check if Tor ControlPort (9051) is reachable.
     * Result is cached for CONTROL_PORT_RECHECK_MS to avoid repeated probes.
     */
    public async isControlPortAvailable(): Promise<boolean> {
        const now = Date.now();
        if (this.controlPortAvailable !== null && (now - this.controlPortCheckTime) < this.CONTROL_PORT_RECHECK_MS) {
            return this.controlPortAvailable;
        }

        try {
            await this.probeControlPort();
            this.controlPortAvailable = true;
            this.consecutiveFailures = 0;
            Logger.info('[TorBrowser] ✅ ControlPort 9051 is reachable');
        } catch {
            this.controlPortAvailable = false;
            Logger.warn('[TorBrowser] ❌ ControlPort 9051 is NOT reachable. Tor rotation disabled until next check.');
        }
        this.controlPortCheckTime = now;
        return this.controlPortAvailable;
    }

    /**
     * Quick TCP probe to ControlPort - connect and immediately close.
     */
    private probeControlPort(): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ port: 9051, host: '127.0.0.1' }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', (err) => {
                socket.destroy();
                reject(err);
            });
            setTimeout(() => {
                socket.destroy();
                reject(new Error('Probe timeout'));
            }, 2000);
        });
    }

    /**
     * Get a page from the Tor browser.
     * Automatically launches or restarts the browser if needed.
     */
    public async getPage(): Promise<Page> {
        await this.ensureBrowser();

        try {
            const page = await this.browser!.newPage();
            this.activePages++;

            // Cleanup listener
            page.once('close', () => {
                this.activePages--;
                this.lastUsed = Date.now();
            });

            return page;
        } catch (e) {
            Logger.warn('[TorBrowser] Failed to create page, restarting...', { error: e as Error });
            await this.forceRestart();
            const page = await this.browser!.newPage();
            this.activePages++;
            return page;
        }
    }

    /**
     * Ensures the browser is running and connected.
     */
    private async ensureBrowser(): Promise<void> {
        if (!this.browser || !this.browser.isConnected()) {
            await this.launch();
        }
    }

    private async launch(): Promise<void> {
        Logger.info('[TorBrowser] Launching Tor-connected browser (socks5://127.0.0.1:9050)...');
        try {
            this.browser = await puppeteer.launch({
                headless: config.browser.headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--proxy-server=socks5://127.0.0.1:9050',
                    '--ignore-certificate-errors',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1920,1080'
                ],
                executablePath: config.browser.chromePath || undefined
            }) as unknown as Browser;

            Logger.info('[TorBrowser] Connected.');
        } catch (e) {
            Logger.error('[TorBrowser] Launch failed', { error: e as Error });
            throw new TorError(`Launch failed: ${(e as Error).message}`, false);
        }
    }

    /**
     * 🔄 ROTATE IP
     * Thread-safe rotation using Mutex.
     * Fails fast if ControlPort is known to be unreachable (circuit-breaker).
     */
    public async rotateIP(): Promise<void> {
        // Circuit-breaker: skip rotation entirely if ControlPort is known down
        if (this.controlPortAvailable === false && (Date.now() - this.controlPortCheckTime) < this.CONTROL_PORT_RECHECK_MS) {
            throw new TorError('Tor ControlPort 9051 is unreachable (circuit-breaker active)', false);
        }

        // Double-check cooldown before acquiring lock to save time
        const timeSinceLast = Date.now() - this.lastRotationTime;
        if (timeSinceLast < this.ROTATION_COOLDOWN_MS) {
            const waitTime = this.ROTATION_COOLDOWN_MS - timeSinceLast + 100;
            Logger.info(`[TorBrowser] ⏳ IP Rotated recently. Waiting ${waitTime}ms for cooldown...`);
            await new Promise(r => setTimeout(r, waitTime));
        }

        return await this.rotationLock.runExclusive(async () => {
            // Check again inside lock (double-checked locking)
            if (Date.now() - this.lastRotationTime < this.ROTATION_COOLDOWN_MS) {
                return;
            }

            Logger.info('[TorBrowser] 🔄 Rotating Tor IP via ControlPort 9051...');

            try {
                await this.sendNewNymSignal();
                this.lastRotationTime = Date.now();
                this.consecutiveFailures = 0;
                this.controlPortAvailable = true;
                Logger.info('[TorBrowser] ✅ IP Rotation Signal Sent');

                // Close browser to force new socket connection on next request
                await this.close();
            } catch (e) {
                this.consecutiveFailures++;
                const msg = (e as Error).message;

                // If ECONNREFUSED, mark ControlPort as down to avoid future retries
                if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND')) {
                    this.controlPortAvailable = false;
                    this.controlPortCheckTime = Date.now();
                    Logger.error('[TorBrowser] ❌ Rotation failed (ControlPort unreachable). Circuit-breaker engaged.', { error: e as Error });
                    throw new TorError(`Rotation failed: ${msg}`, false);
                }

                Logger.error('[TorBrowser] ❌ Rotation failed', { error: e as Error });

                // After repeated failures, engage circuit-breaker
                if (this.consecutiveFailures >= this.MAX_FAILURES_BEFORE_DISABLE) {
                    this.controlPortAvailable = false;
                    this.controlPortCheckTime = Date.now();
                    Logger.warn(`[TorBrowser] Circuit-breaker engaged after ${this.consecutiveFailures} consecutive failures`);
                }

                throw new TorError(`Rotation failed: ${msg}`);
            }
        });
    }

    /**
     * Low-level socket communication with Tor ControlPort
     */
    private sendNewNymSignal(): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ port: 9051, host: '127.0.0.1' }, () => {
                socket.write('AUTHENTICATE ""\r\n');
                socket.write('SIGNAL NEWNYM\r\n');
            });

            let buffer = '';

            socket.on('data', (data) => {
                buffer += data.toString();
                if (buffer.includes('250 OK')) {
                    socket.write('QUIT\r\n');
                    socket.end();
                    resolve();
                }
            });

            socket.on('error', (err) => {
                socket.destroy();
                reject(err);
            });

            socket.on('close', () => {
                if (!buffer.includes('250 OK')) {
                    // If we closed without 250 OK, it might be an issue, but often Tor just closes.
                    // We rely on the error event for failures.
                    resolve();
                }
            });

            // Timeout safety
            setTimeout(() => {
                socket.destroy();
                reject(new Error('Tor ControlPort timeout'));
            }, 5000);
        });
    }

    public async close(): Promise<void> {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {
                Logger.warn('[TorBrowser] Error closing browser', { error: e as Error });
            }
            this.browser = null;
        }
    }

    private async forceRestart(): Promise<void> {
        await this.close();
        await new Promise(r => setTimeout(r, 1000)); // Grace period
        await this.launch();
    }
}
