import { BrowserPool } from './BrowserPool';
import { NormalizedInput } from './InputNormalizer';
import { Logger } from '../enricher/utils/logger';

export class PecHunter {
    private browserPool: BrowserPool;
    private static readonly standardEmailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
    private static readonly cloudflareEmailRegex = /data-cfemail="([0-9a-fA-F]+)"/g;
    private static readonly mailtoRegex = /mailto:([^"'?#\s>]+)/gi;
    private static readonly obfuscatedEmailRegex = /([a-zA-Z0-9._%+\-]+)\s*(?:\[at\]|\(at\)|\sat\s|&#64;|@)\s*([a-zA-Z0-9.\-]+)\s*(?:\[dot\]|\(dot\)|\sdot\s|&#46;|\.)\s*([a-zA-Z]{2,})/gi;
    private static readonly preferredSubpages = [
        '',
        '/contatti',
        '/contact',
        '/contacts',
        '/chi-siamo',
        '/azienda',
        '/about',
        '/about-us',
        '/company',
        '/privacy',
        '/legal',
        '/impressum',
    ];
    private static readonly roleWeights: Record<string, number> = {
        amministrazione: 5,
        commerciale: 5,
        sales: 4,
        contatti: 3,
        office: 3,
        hello: 2,
        info: 1,
    };

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
        const seen = new Set<string>();

        try {
            for (const pageUrl of PecHunter.buildCandidateUrls(discoveredUrl)) {
                if (seen.has(pageUrl)) {
                    continue;
                }
                seen.add(pageUrl);

                const pageRes = await this.scanPage(pageUrl, discoveredUrl);
                if (pageRes.pec) {
                    pec = PecHunter.prioritizeEmails([pec, pageRes.pec].filter(Boolean) as string[], discoveredUrl).pec;
                }
                if (pageRes.email) {
                    email = PecHunter.prioritizeEmails([email, pageRes.email].filter(Boolean) as string[], discoveredUrl).email;
                }
                if (pec && email) {
                    break;
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

    private async scanPage(url: string, rootUrl: string): Promise<{ pec: string | null, email: string | null }> {
        let pec: string | null = null;
        let email: string | null = null;
        try {
            const nav = await this.browserPool.navigateSafe(url);
            if (nav.status === 'OK' && nav.html) {
                const candidates = PecHunter.extractEmails(nav.html);
                const preferred = PecHunter.prioritizeEmails(candidates, rootUrl);
                pec = preferred.pec;
                email = preferred.email;

                if (pec) Logger.info(`[PecHunter] ✅ FOUND PEC on ${url}: ${pec}`);
                if (email) Logger.info(`[PecHunter] ✅ FOUND EMAIL on ${url}: ${email}`);
            }
        } catch (e) {
            // Silence sub-page loading errors (e.g., 404s on /contatti)
        }
        return { pec, email };
    }

    private static buildCandidateUrls(discoveredUrl: string): string[] {
        const urls: string[] = [];
        for (const path of PecHunter.preferredSubpages) {
            try {
                const url = path ? new URL(path, discoveredUrl).toString() : discoveredUrl;
                urls.push(url);
            } catch {
                if (!path) {
                    urls.push(discoveredUrl);
                }
            }
        }
        return urls;
    }

    private static extractEmails(html: string): string[] {
        const candidates = new Set<string>();
        const text = PecHunter.decodeHtmlEntities(html)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        for (const match of text.match(PecHunter.pecRegex) || []) {
            candidates.add(match.toLowerCase().trim());
        }
        for (const match of text.match(PecHunter.standardEmailRegex) || []) {
            candidates.add(match.toLowerCase().trim());
        }

        for (const match of html.matchAll(PecHunter.mailtoRegex)) {
            candidates.add(PecHunter.normalizeEmail(match[1]));
        }

        for (const match of html.matchAll(PecHunter.cloudflareEmailRegex)) {
            const decoded = PecHunter.decodeCloudflareEmail(match[1]);
            if (decoded) {
                candidates.add(decoded);
            }
        }

        for (const match of text.matchAll(PecHunter.obfuscatedEmailRegex)) {
            const local = match[1];
            const domain = match[2];
            const tld = match[3];
            candidates.add(PecHunter.normalizeEmail(`${local}@${domain}.${tld}`));
        }

        return [...candidates].filter((candidate) => PecHunter.isUsableEmail(candidate));
    }

    private static prioritizeEmails(candidates: string[], rootUrl: string): { pec: string | null; email: string | null } {
        const rootHost = PecHunter.getHostname(rootUrl);
        const pecCandidates = candidates.filter((candidate) => PecHunter.isPecEmail(candidate));
        const standardCandidates = candidates.filter((candidate) => !pecCandidates.includes(candidate));

        const rank = (candidate: string): number => {
            const [local = '', domain = ''] = candidate.split('@');
            let score = 0;
            if (rootHost && domain.includes(rootHost)) score += 5;
            for (const [prefix, weight] of Object.entries(PecHunter.roleWeights)) {
                if (local.startsWith(prefix)) {
                    score += weight;
                    break;
                }
            }
            if (local.includes('noreply') || local.includes('no-reply')) score -= 10;
            if (candidate.includes('sentry')) score -= 10;
            return score;
        };

        pecCandidates.sort((a, b) => rank(b) - rank(a));
        standardCandidates.sort((a, b) => rank(b) - rank(a));

        return {
            pec: pecCandidates[0] || null,
            email: standardCandidates[0] || null,
        };
    }

    private static decodeCloudflareEmail(hex: string): string | null {
        if (!hex || hex.length < 4 || hex.length % 2 !== 0) {
            return null;
        }

        try {
            const key = Number.parseInt(hex.slice(0, 2), 16);
            let decoded = '';
            for (let i = 2; i < hex.length; i += 2) {
                const value = Number.parseInt(hex.slice(i, i + 2), 16) ^ key;
                decoded += String.fromCharCode(value);
            }
            return PecHunter.normalizeEmail(decoded);
        } catch {
            return null;
        }
    }

    private static decodeHtmlEntities(value: string): string {
        return value
            .replace(/&#64;/gi, '@')
            .replace(/&#46;/gi, '.')
            .replace(/&commat;/gi, '@')
            .replace(/&period;/gi, '.')
            .replace(/&nbsp;/gi, ' ');
    }

    private static normalizeEmail(value: string): string {
        return value
            .trim()
            .replace(/^mailto:/i, '')
            .replace(/[?#].*$/, '')
            .toLowerCase();
    }

    private static isUsableEmail(candidate: string): boolean {
        if (!candidate) {
            return false;
        }
        if (!candidate.includes('@')) {
            return false;
        }
        if (candidate.endsWith('.png') || candidate.endsWith('.jpg') || candidate.endsWith('.jpeg') || candidate.endsWith('.svg')) {
            return false;
        }
        if (candidate.includes('sentry')) {
            return false;
        }
        return true;
    }

    private static isPecEmail(candidate: string): boolean {
        return /(?:pec|legalmail|cert|sicurezzapostale|telecompost|postecert)/i.test(candidate);
    }

    private static getHostname(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return '';
        }
    }
}
