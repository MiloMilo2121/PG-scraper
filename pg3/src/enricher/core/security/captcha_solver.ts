/**
 * 🔓 CAPTCHA SOLVER
 * Integrates 2Captcha API for bypassing CAPTCHAs
 * 
 * neutralizeGatekeeper - Solve captcha challenges
 * 
 * Used when encountering blocks on high-security targets like UfficioCamerale
 */

import { Page } from 'puppeteer';
import axios from 'axios';
import { Logger } from '../../utils/logger';
import { config } from '../../config';

// Environment config
const CAPTCHA_API_KEY = process.env.CAPTCHA_2_API_KEY || process.env.TWOCAPTCHA_API_KEY;
const CAPTCHA_MAX_ATTEMPTS = config.captcha.maxAttempts || 30;

export class CaptchaSolver {
    private static readonly API_URL = 'https://2captcha.com';

    /**
     * neutralizeGatekeeper - Detect and solve captcha
     */
    public static async neutralizeGatekeeper(page: Page): Promise<boolean> {
        if (!CAPTCHA_API_KEY) {
            Logger.warn('No 2Captcha API key configured. Cannot solve captcha.');
            return false;
        }

        try {
            // Detect captcha type
            const captchaType = await this.detectCaptchaType(page);

            if (!captchaType) {
                return false; // No captcha detected
            }

            Logger.info(`[CaptchaSolver] 🕵️ Detected ${captchaType}. Solving...`);

            switch (captchaType) {
                case 'turnstile':
                    return await this.solveTurnstile(page);
                case 'recaptcha-v2':
                    return await this.solveRecaptchaV2(page);
                case 'recaptcha-v3':
                    return await this.solveRecaptchaV3(page);
                case 'hcaptcha':
                    return await this.solveHCaptcha(page);
                case 'image':
                    return await this.solveImageCaptcha(page);
                default:
                    Logger.warn(`[CaptchaSolver] Unknown captcha type: ${captchaType}`);
                    return false;
            }
        } catch (error) {
            Logger.error('[CaptchaSolver] Failed', { error: error as Error });
            return false;
        }
    }

    /**
     * Detect captcha type on page
     */
    private static async detectCaptchaType(page: Page): Promise<string | null> {
        return await page.evaluate(() => {
            // Cloudflare Turnstile
            if (document.querySelector('.cf-turnstile') ||
                document.querySelector('iframe[src*="challenges.cloudflare.com"]')) {
                return 'turnstile';
            }

            // Check for reCAPTCHA v2
            if (document.querySelector('.g-recaptcha') ||
                document.querySelector('iframe[src*="recaptcha/api2"]')) {
                return 'recaptcha-v2';
            }

            // Check for reCAPTCHA v3
            if (document.querySelector('script[src*="recaptcha/enterprise"]') ||
                document.querySelector('script[src*="recaptcha/api.js?render="]')) {
                return 'recaptcha-v3';
            }

            // Check for hCaptcha
            if (document.querySelector('.h-captcha') ||
                document.querySelector('iframe[src*="hcaptcha"]')) {
                return 'hcaptcha';
            }

            // Check for image captcha (generic)
            if (document.querySelector('img[src*="captcha"]') ||
                document.querySelector('input[name*="captcha"]')) {
                return 'image';
            }

            return null;
        });
    }

    /**
     * Solve Cloudflare Turnstile
     */
    private static async solveTurnstile(page: Page): Promise<boolean> {
        // Get sitekey
        const sitekey = await page.evaluate(() => {
            const el = document.querySelector('.cf-turnstile') || document.querySelector('[data-sitekey]');
            return el?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) {
            Logger.warn('[CaptchaSolver] Could not find Turnstile sitekey');
            return false;
        }

        const pageUrl = page.url();
        Logger.info(`[CaptchaSolver] Solving Turnstile for ${pageUrl} (key: ${sitekey})`);

        const taskId = await this.createTask({
            method: 'turnstile',
            sitekey: sitekey,
            pageurl: pageUrl,
        });

        if (!taskId) return false;

        const solution = await this.waitForSolution(taskId);
        if (!solution) return false;

        // Inject solution
        await page.evaluate((token: string) => {
            const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
            if (input) {
                input.value = token;
            }
            // Execute callback if present (heuristic)
            if ((window as any).turnstile) {
                try {
                    // Try to reset or render? No, usually providing token in input is enough for form submit
                    // Sometimes we need to click "Verify"
                } catch { }
            }
        }, solution);

        Logger.info('[CaptchaSolver] Turnstile solved. Waiting for navigation...');
        // Usually Turnstile auto-redirects after token injection? Or we might need to submit form.
        // We press "Verify" or waiting.
        await new Promise(r => setTimeout(r, 2000));

        return true;
    }

    /**
     * Solve reCAPTCHA v2
     */
    private static async solveRecaptchaV2(page: Page): Promise<boolean> {
        const sitekey = await page.evaluate(() => {
            const el = document.querySelector('.g-recaptcha');
            return el?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) return false;

        const taskId = await this.createTask({
            method: 'userrecaptcha',
            googlekey: sitekey,
            pageurl: page.url(),
        });

        if (!taskId) return false;

        const solution = await this.waitForSolution(taskId);
        if (!solution) return false;

        await page.evaluate((token: string) => {
            const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement;
            if (textarea) {
                textarea.value = token;
                textarea.style.display = 'block';
            }
            // Try callback
            if ((window as any).___grecaptcha_cfg?.clients) {
                const clients = (window as any).___grecaptcha_cfg.clients;
                for (const key in clients) {
                    try { clients[key].callback(token); } catch { }
                }
            }
        }, solution);

        Logger.info('[CaptchaSolver] reCAPTCHA v2 solved');
        return true;
    }

    private static async solveRecaptchaV3(page: Page): Promise<boolean> {
        Logger.info('[CaptchaSolver] reCAPTCHA v3 requires enterprise solving - skipping');
        return false;
    }

    private static async solveHCaptcha(page: Page): Promise<boolean> {
        Logger.info('[CaptchaSolver] hCaptcha solving not implemented');
        return false;
    }

    private static async solveImageCaptcha(page: Page): Promise<boolean> {
        // Todo: Screenshot element -> base64 -> solve
        Logger.info('[CaptchaSolver] Image captcha solving not implemented');
        return false;
    }

    /**
     * Create task on 2Captcha
     */
    private static async createTask(params: Record<string, string>): Promise<string | null> {
        const url = `${this.API_URL}/in.php`;
        const payload = {
            key: CAPTCHA_API_KEY,
            json: 1,
            ...params
        };

        try {
            const response = await axios.post(url, null, { params: payload });
            const data = response.data;

            if (data.status === 1) {
                return data.request;
            }
            Logger.error('[CaptchaSolver] Task creation failed', { error_text: data.error_text });
            return null;
        } catch (error) {
            Logger.error('[CaptchaSolver] API error', { error: error as Error });
            return null;
        }
    }

    /**
     * Wait for solution from 2Captcha
     */
    private static async waitForSolution(taskId: string): Promise<string | null> {
        const url = `${this.API_URL}/res.php`;
        const params = {
            key: CAPTCHA_API_KEY,
            action: 'get',
            id: taskId,
            json: 1
        };

        for (let i = 0; i < CAPTCHA_MAX_ATTEMPTS; i++) {
            await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds

            try {
                const response = await axios.get(url, { params });
                const data = response.data;

                if (data.status === 1) {
                    return data.request;
                }

                if (data.request !== 'CAPCHA_NOT_READY') {
                    Logger.error('[CaptchaSolver] Polling error', { request: data.request });
                    return null;
                }
            } catch (error) {
                Logger.error('[CaptchaSolver] Polling failed', { error: error as Error });
            }
        }

        Logger.error('[CaptchaSolver] Timeout waiting for solution');
        return null;
    }
}
