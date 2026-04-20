import { Page } from 'playwright';

export class CookieConsent {
    public static async handle(page: Page): Promise<void> {
        try {
            await page.evaluate(() => {
                // Priority: selector-based (faster)
                const selectors = [
                    '#onetrust-accept-btn-handler',      // OneTrust (PG uses this)
                    '#cmp-button-accept',
                    '.iubenda-cs-accept-btn',
                    'button[sc-const="accept_all"]',
                    'button[aria-label="Accept all"]',
                    'button[aria-label="Accetta tutto"]',
                    'button.btn-primary[id*="accept"]',
                    'button[class*="accept"][class*="cookie"]',
                ];
                for (const sel of selectors) {
                    const btn = document.querySelector<HTMLElement>(sel);
                    if (btn) { btn.click(); return; }
                }

                // Fallback: text-based scan
                const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"]'));
                const target = allBtns.find(b => {
                    const txt = b.textContent?.toLowerCase().trim() ?? '';
                    return txt === 'accetto' || txt === 'accetta' || txt === 'accetta tutto'
                        || txt === 'acconsento' || txt === 'accept all' || txt === 'i accept';
                });
                target?.click();
            });
        } catch { /* non-critical */ }
    }
}
