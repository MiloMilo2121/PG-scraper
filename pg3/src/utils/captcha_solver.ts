
import { gotScraping } from 'got-scraping';
import { Logger } from './logger';

export class CaptchaSolver {
    private static instance: CaptchaSolver;
    private apiKey: string;

    private constructor() {
        this.apiKey = process.env.TWOCAPTCHA_API_KEY || '';
    }

    static getInstance(): CaptchaSolver {
        if (!CaptchaSolver.instance) {
            CaptchaSolver.instance = new CaptchaSolver();
        }
        return CaptchaSolver.instance;
    }

    isEnabled(): boolean {
        return !!this.apiKey;
    }

    /**
     * Solves a normal image captcha
     */
    async solveImage(base64Image: string): Promise<string | null> {
        if (!this.isEnabled()) return null;

        try {
            Logger.info('[CaptchaSolver] 🧩 Sending captcha to 2Captcha...');

            // 1. Submit
            const submitRes = await gotScraping.post('http://2captcha.com/in.php', {
                json: {
                    key: this.apiKey,
                    method: 'base64',
                    body: base64Image,
                    json: 1
                }
            }).json<any>();

            if (submitRes.status !== 1) {
                Logger.error(`[CaptchaSolver] Submission failed: ${submitRes.request}`);
                return null;
            }

            const requestId = submitRes.request;

            // 2. Poll for result
            let attempts = 0;
            while (attempts < 20) {
                await new Promise(r => setTimeout(r, 2000)); // Wait 2s
                attempts++;

                const resultRes = await gotScraping.get(`http://2captcha.com/res.php?key=${this.apiKey}&action=get&id=${requestId}&json=1`).json<any>();

                if (resultRes.status === 1) {
                    Logger.info(`[CaptchaSolver] ✅ Solved: ${resultRes.request}`);
                    return resultRes.request;
                }

                if (resultRes.request !== 'CAPCHA_NOT_READY') {
                    Logger.warn(`[CaptchaSolver] Error polling: ${resultRes.request}`);
                    return null;
                }
            }

            return null;
        } catch (e) {
            Logger.error(`[CaptchaSolver] Network error: ${e}`);
            return null;
        }
    }
}
