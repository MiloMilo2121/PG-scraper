
import { Page } from 'puppeteer';

export class CookieConsent {
    private static commonSelectors = [
        'button[id="L2AGLb"]', // Google Agree
        '#onetrust-accept-btn-handler', // OneTrust
        '.iubenda-cs-accept-btn', // Iubenda
        'button[sc-const="accept_all"]', // Generic
        'button.cookie-agree',
        'button.btn-accept',
        'a.cc-btn.cc-dismiss',
        'button[aria-label="Accept all"]',
        'form[action*="consent"] button'
    ];

    public static async handle(page: Page): Promise<void> {
        try {
            // Fast check first
            const frame = page.mainFrame();
            for (const selector of this.commonSelectors) {
                try {
                    const btn = await frame.$(selector);
                    if (btn) {
                        if (await btn.isVisible()) {
                            await btn.click();
                            // console.log(`[Cookie] Clicked ${selector}`);
                            return; // Usually one is enough
                        }
                    }
                } catch { }
            }

            // Text based fallback (slower)
            // await page.evaluate(() => { ... }) 
        } catch (e) {
            // Ignore errors here, non-critical
        }
    }
}
