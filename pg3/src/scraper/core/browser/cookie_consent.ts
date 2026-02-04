
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
        'button:contains("Accetto")',
        '#cmp-button-accept',
        'button.btn-primary[id*="accept"]'
    ];


    public static async handle(page: Page): Promise<void> {
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const target = buttons.find(b => {
                    const txt = b.textContent?.toLowerCase() || '';
                    return txt.includes('accetto') || txt.includes('acconsento') || txt.includes('accetta');
                });
                if (target && (target as HTMLElement).click) (target as HTMLElement).click();
            });


            // Text based fallback (slower)
            // await page.evaluate(() => { ... }) 
        } catch (e) {
            // Ignore errors here, non-critical
        }
    }
}
