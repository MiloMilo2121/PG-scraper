/**
 * 🔓 CAPTCHA SOLVER
 * Integrates 2Captcha API for bypassing CAPTCHAs
 * 
 * neutralizeGatekeeper - Solve captcha challenges
 * 
 * Used when encountering blocks on high-security targets like UfficioCamerale
 */

import { Page } from 'puppeteer';

// Environment config
const CAPTCHA_API_KEY = process.env.CAPTCHA_2_API_KEY || process.env.TWOCAPTCHA_API_KEY;

export class CaptchaSolver {
    private static readonly API_URL = 'https://2captcha.com';

    /**
     * neutralizeGatekeeper - Detect and solve captcha
     */
    public static async neutralizeGatekeeper(page: Page): Promise<boolean> {
        if (!CAPTCHA_API_KEY) {
            console.warn('⚠️ No 2Captcha API key configured. Cannot solve captcha.');
            return false;
        }

        try {
            // Detect captcha type
            const captchaType = await this.detectCaptchaType(page);

            if (!captchaType) {
                return true; // No captcha detected
            }

            console.log(`🔓 Captcha detected: ${captchaType}. Solving...`);

            switch (captchaType) {
                case 'recaptcha-v2':
                    return await this.solveRecaptchaV2(page);
                case 'recaptcha-v3':
                    return await this.solveRecaptchaV3(page);
                case 'hcaptcha':
                    return await this.solveHCaptcha(page);
                case 'image':
                    return await this.solveImageCaptcha(page);
                default:
                    console.warn(`Unknown captcha type: ${captchaType}`);
                    return false;
            }
        } catch (error) {
            console.error('❌ Captcha solving failed:', error);
            return false;
        }
    }

    /**
     * Detect captcha type on page
     */
    private static async detectCaptchaType(page: Page): Promise<string | null> {
        return await page.evaluate(() => {
            // Check for reCAPTCHA v2
            if (document.querySelector('.g-recaptcha') ||
                document.querySelector('iframe[src*="recaptcha"]')) {
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

            // Check for image captcha
            if (document.querySelector('img[src*="captcha"]') ||
                document.querySelector('input[name*="captcha"]')) {
                return 'image';
            }

            return null;
        });
    }

    /**
     * Solve reCAPTCHA v2
     */
    private static async solveRecaptchaV2(page: Page): Promise<boolean> {
        // Get sitekey
        const sitekey = await page.evaluate(() => {
            const el = document.querySelector('.g-recaptcha');
            return el?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) {
            console.warn('Could not find reCAPTCHA sitekey');
            return false;
        }

        const pageUrl = page.url();
        console.log(`🔐 Solving reCAPTCHA v2 for ${pageUrl}`);

        // Submit to 2Captcha
        const taskId = await this.createTask({
            method: 'userrecaptcha',
            googlekey: sitekey,
            pageurl: pageUrl,
        });

        if (!taskId) return false;

        // Wait for solution
        const solution = await this.waitForSolution(taskId);
        if (!solution) return false;

        // Inject solution
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
                    try {
                        clients[key].callback(token);
                    } catch (e) { }
                }
            }
        }, solution);

        console.log('✅ reCAPTCHA v2 solved!');
        return true;
    }

    /**
     * Solve reCAPTCHA v3
     */
    private static async solveRecaptchaV3(page: Page): Promise<boolean> {
        console.log('🔐 reCAPTCHA v3 requires enterprise solving - skipping');
        return false;
    }

    /**
     * Solve hCaptcha
     */
    private static async solveHCaptcha(page: Page): Promise<boolean> {
        const sitekey = await page.evaluate(() => {
            const el = document.querySelector('.h-captcha');
            return el?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) return false;

        const taskId = await this.createTask({
            method: 'hcaptcha',
            sitekey: sitekey,
            pageurl: page.url(),
        });

        if (!taskId) return false;

        const solution = await this.waitForSolution(taskId);
        if (!solution) return false;

        await page.evaluate((token: string) => {
            const textarea = document.querySelector('textarea[name="h-captcha-response"]') as HTMLTextAreaElement;
            if (textarea) textarea.value = token;
        }, solution);

        console.log('✅ hCaptcha solved!');
        return true;
    }

    /**
     * Solve image captcha
     */
    private static async solveImageCaptcha(page: Page): Promise<boolean> {
        console.log('🔐 Image captcha solving not yet implemented');
        return false;
    }

    /**
     * Create task on 2Captcha
     */
    private static async createTask(params: Record<string, string>): Promise<string | null> {
        const url = new URL('/in.php', this.API_URL);
        url.searchParams.append('key', CAPTCHA_API_KEY!);
        url.searchParams.append('json', '1');

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.append(key, value);
        }

        try {
            const response = await fetch(url.toString());
            const data = await response.json();

            if (data.status === 1) {
                return data.request;
            }
            console.error('2Captcha error:', data.error_text);
            return null;
        } catch (error) {
            console.error('Failed to create 2Captcha task:', error);
            return null;
        }
    }

    /**
     * Wait for solution from 2Captcha
     */
    private static async waitForSolution(taskId: string, maxAttempts = 30): Promise<string | null> {
        const url = new URL('/res.php', this.API_URL);
        url.searchParams.append('key', CAPTCHA_API_KEY!);
        url.searchParams.append('action', 'get');
        url.searchParams.append('id', taskId);
        url.searchParams.append('json', '1');

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds

            try {
                const response = await fetch(url.toString());
                const data = await response.json();

                if (data.status === 1) {
                    return data.request;
                }

                if (data.request !== 'CAPCHA_NOT_READY') {
                    console.error('2Captcha error:', data.request);
                    return null;
                }
            } catch (error) {
                console.error('Failed to get 2Captcha solution:', error);
            }
        }

        console.error('2Captcha timeout - solution not ready');
        return null;
    }
}
