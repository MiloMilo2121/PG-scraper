import { Page } from 'playwright';
import { request } from 'undici';
import { Logger } from '../logging/Logger';

const CAPTCHA_API_KEY = process.env.CAPTCHA_2_API_KEY || process.env.TWOCAPTCHA_API_KEY;
const CAPTCHA_MAX_ATTEMPTS = Number.parseInt(process.env.CAPTCHA_MAX_ATTEMPTS || '30', 10);

export class CaptchaSolver {
    private static readonly API_URL = 'https://2captcha.com';

    public static async neutralizeGatekeeper(page: Page): Promise<boolean> {
        if (!CAPTCHA_API_KEY) {
            Logger.warn('No 2Captcha API key configured. Cannot solve captcha.');
            return false;
        }

        try {
            const captchaType = await this.detectCaptchaType(page);
            if (!captchaType) {
                return false;
            }

            Logger.info(`[CaptchaSolver] Detected ${captchaType}. Solving...`);

            switch (captchaType) {
                case 'turnstile':
                    return await this.solveTurnstile(page);
                case 'recaptcha-v2':
                    return await this.solveRecaptchaV2(page);
                case 'recaptcha-v3':
                    return await this.solveRecaptchaV3();
                case 'hcaptcha':
                    return await this.solveHCaptcha();
                case 'image':
                    return await this.solveImageCaptcha();
                default:
                    Logger.warn(`[CaptchaSolver] Unknown captcha type: ${captchaType}`);
                    return false;
            }
        } catch (error) {
            Logger.error('[CaptchaSolver] Failed', { error: error as Error });
            return false;
        }
    }

    private static async detectCaptchaType(page: Page): Promise<string | null> {
        return await page.evaluate(() => {
            if (document.querySelector('.cf-turnstile') ||
                document.querySelector('iframe[src*="challenges.cloudflare.com"]')) {
                return 'turnstile';
            }

            if (document.querySelector('.g-recaptcha') ||
                document.querySelector('iframe[src*="recaptcha/api2"]')) {
                return 'recaptcha-v2';
            }

            if (document.querySelector('script[src*="recaptcha/enterprise"]') ||
                document.querySelector('script[src*="recaptcha/api.js?render="]')) {
                return 'recaptcha-v3';
            }

            if (document.querySelector('.h-captcha') ||
                document.querySelector('iframe[src*="hcaptcha"]')) {
                return 'hcaptcha';
            }

            if (document.querySelector('img[src*="captcha"]') ||
                document.querySelector('input[name*="captcha"]')) {
                return 'image';
            }

            return null;
        });
    }

    private static async solveTurnstile(page: Page): Promise<boolean> {
        const sitekey = await page.evaluate(() => {
            const element = document.querySelector('.cf-turnstile') || document.querySelector('[data-sitekey]');
            return element?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) {
            Logger.warn('[CaptchaSolver] Could not find Turnstile sitekey');
            return false;
        }

        const taskId = await this.createTask({
            method: 'turnstile',
            sitekey,
            pageurl: page.url(),
        });

        if (!taskId) {
            return false;
        }

        const solution = await this.waitForSolution(taskId);
        if (!solution) {
            return false;
        }

        await page.evaluate((token: string) => {
            const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
            if (input) {
                input.value = token;
            }
        }, solution);

        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
    }

    private static async solveRecaptchaV2(page: Page): Promise<boolean> {
        const sitekey = await page.evaluate(() => {
            const element = document.querySelector('.g-recaptcha');
            return element?.getAttribute('data-sitekey') || null;
        });

        if (!sitekey) {
            return false;
        }

        const taskId = await this.createTask({
            method: 'userrecaptcha',
            googlekey: sitekey,
            pageurl: page.url(),
        });

        if (!taskId) {
            return false;
        }

        const solution = await this.waitForSolution(taskId);
        if (!solution) {
            return false;
        }

        await page.evaluate((token: string) => {
            const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement | null;
            if (textarea) {
                textarea.value = token;
                textarea.style.display = 'block';
            }
            if ((window as any).___grecaptcha_cfg?.clients) {
                const clients = (window as any).___grecaptcha_cfg.clients;
                for (const key in clients) {
                    try {
                        clients[key].callback(token);
                    } catch {
                        // Ignore missing callbacks.
                    }
                }
            }
        }, solution);

        Logger.info('[CaptchaSolver] reCAPTCHA v2 solved');
        return true;
    }

    private static async solveRecaptchaV3(): Promise<boolean> {
        Logger.info('[CaptchaSolver] reCAPTCHA v3 requires enterprise solving - skipping');
        return false;
    }

    private static async solveHCaptcha(): Promise<boolean> {
        Logger.info('[CaptchaSolver] hCaptcha solving not implemented');
        return false;
    }

    private static async solveImageCaptcha(): Promise<boolean> {
        Logger.info('[CaptchaSolver] Image captcha solving not implemented');
        return false;
    }

    private static async createTask(params: Record<string, string>): Promise<string | null> {
        const payload = {
            key: CAPTCHA_API_KEY || '',
            json: '1',
            ...params
        };

        try {
            const queryString = new URLSearchParams({ ...payload } as Record<string, string>).toString();
            const response = await request(`${this.API_URL}/in.php?${queryString}`, {
                method: 'GET',
                bodyTimeout: 10000,
            });
            const data = await response.body.json() as any;

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

    private static async waitForSolution(taskId: string): Promise<string | null> {
        const params = {
            key: CAPTCHA_API_KEY || '',
            action: 'get',
            id: taskId,
            json: '1'
        };

        for (let i = 0; i < CAPTCHA_MAX_ATTEMPTS; i++) {
            await new Promise((resolve) => setTimeout(resolve, 5000));

            try {
                const queryString = new URLSearchParams({ ...params } as Record<string, string>).toString();
                const response = await request(`${this.API_URL}/res.php?${queryString}`, {
                    method: 'GET',
                    bodyTimeout: 10000,
                });
                const data = await response.body.json() as any;

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
