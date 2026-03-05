import { BrowserPool } from './BrowserPool';
import { NormalizedInput } from './InputNormalizer';
import { Logger } from '../enricher/utils/logger';

export class PecHunter {
    private browserPool: BrowserPool;

    // Pattern to match common Italian PEC domains
    private static pecRegex = /[a-zA-Z0-9.\-_+]+@(?:pec|legalmail|cert|sicurezzapostale|telecompost|postecert)[a-zA-Z0-9.\-_]*\.[a-zA-Z]{2,}/gi;

    constructor(browserPool: BrowserPool) {
        this.browserPool = browserPool;
    }

    /**
     * Attempts to find a PEC email from the target website using the browser pool.
     * It scans the homepage first. If no PEC is found, it attempts to check /contatti and /privacy.
     */
    public async hunt(companyId: string, input: NormalizedInput, discoveredUrl: string): Promise<{ pec: string | null, email: string | null }> {
        Logger.info(`[PecHunter] 🕵️ Hunting for Contacts (PEC/Email) on: ${discoveredUrl}`);
        let pec: string | null = null;
        let email: string | null = null;

        try {
            // 1. Check Homepage
            const homepageRes = await this.scanPage(discoveredUrl);
            if (homepageRes.pec) pec = homepageRes.pec;
            if (homepageRes.email) email = homepageRes.email;

            // 2. Fallback: Deep scan on contacts/privacy
            if (!pec || !email) {
                const subpages = ['/contatti', '/privacy'];
                for (const path of subpages) {
                    const subUrl = discoveredUrl.replace(/\/$/, '') + path;
                    const subpageRes = await this.scanPage(subUrl);
                    if (!pec && subpageRes.pec) pec = subpageRes.pec;
                    if (!email && subpageRes.email) email = subpageRes.email;
                    if (pec && email) break;
                }
            }

            if (!pec && !email) {
                Logger.warn(`[PecHunter] ❌ No Contacts found for ${input.company_name}.`);
            }
            return { pec, email };

        } catch (e: any) {
            Logger.warn(`[PecHunter] Error hunting Contacts for ${input.company_name}: ${e.message}`);
            return { pec: null, email: null };
        }
    }

    private async scanPage(url: string): Promise<{ pec: string | null, email: string | null }> {
        let pec: string | null = null;
        let email: string | null = null;
        try {
            const nav = await this.browserPool.navigateSafe(url);
            if (nav.status === 'OK' && nav.html) {
                const text = nav.html.replace(/<[^>]+>/g, ' '); // Strip HTML tags

                // Match PECs
                const pecMatches = text.match(PecHunter.pecRegex);
                if (pecMatches && pecMatches.length > 0) {
                    pec = [...new Set(pecMatches.map(m => m.toLowerCase().trim()))][0] || null;
                }

                // Match Standard Emails (excluding PECs, basic images/sentry)
                const standardRegex = /[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/gi;
                const matches = text.match(standardRegex);
                if (matches && matches.length > 0) {
                    const uniqueEmails = [...new Set(matches.map(m => m.toLowerCase().trim()))];
                    for (const cand of uniqueEmails) {
                        if (!cand.includes('pec') && !cand.includes('legalmail') && !cand.includes('sentry') && !cand.endsWith('.png') && !cand.endsWith('.jpg')) {
                            email = cand;
                            break;
                        }
                    }
                }
                if (pec) Logger.info(`[PecHunter] ✅ FOUND PEC on ${url}: ${pec}`);
                if (email) Logger.info(`[PecHunter] ✅ FOUND EMAIL on ${url}: ${email}`);
            }
        } catch (e) {
            // Silence sub-page loading errors (e.g., 404s on /contatti)
        }
        return { pec, email };
    }
}
