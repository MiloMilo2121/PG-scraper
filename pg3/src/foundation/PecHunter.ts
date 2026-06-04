import { BrowserPool } from './BrowserPool';
import { NormalizedInput } from './InputNormalizer';
import { Logger } from '../enricher/utils/logger';
import { CostRouter } from '../shared-runtime/routing/CostRouter';

interface ContactSignals {
    pec: string | null;
    email: string | null;
    employees?: string | null;
    source?: string | null;
}

export class PecHunter {
    private browserPool: BrowserPool;
    private costRouter?: CostRouter;
    private static readonly standardEmailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi;
    private static readonly cloudflareEmailRegex = /data-cfemail="([0-9a-fA-F]+)"/g;
    private static readonly mailtoRegex = /mailto:([^"'?#\s>]+)/gi;
    private static readonly obfuscatedEmailRegex = /([a-zA-Z0-9._%+\-]+)\s*(?:\[at\]|\(at\)|\sat\s|&#64;|@)\s*([a-zA-Z0-9.\-]+)\s*(?:\[dot\]|\(dot\)|\sdot\s|&#46;|\.)\s*([a-zA-Z]{2,})/gi;
    private static readonly preferredSubpages = [
        '',
        '/contatti',
        '/privacy',
        '/chi-siamo',
    ];
    private static readonly roleWeights: Record<string, number> = {
        agenzia: 6,
        amministrazione: 5,
        commerciale: 5,
        contatto: 4,
        contact: 4,
        immobiliare: 4,
        sales: 4,
        studio: 4,
        contatti: 3,
        office: 3,
        hello: 2,
        info: 1,
    };
    private static readonly softPenaltyPrefixes = [
        'dpo',
        'privacy',
        'gdpr',
        'legal',
        'compliance',
        'segnalazioni',
        'webmaster',
    ];
    private static readonly hardRejectLocalPatterns = [
        'noreply',
        'no-reply',
        'mailer-daemon',
        'postmaster',
        'hostmaster',
        'cpanel_notice',
        'cpanel',
        'autodiscover',
        'wordpress',
        'bounce',
        'do-not-reply',
    ];

    // Pattern to match common Italian PEC domains
    private static pecRegex = /[a-zA-Z0-9.\-_+]+@(?:pec|legalmail|cert|sicurezzapostale|telecompost|postecert)[a-zA-Z0-9.\-_]*\.[a-zA-Z]{2,}/gi;

    constructor(browserPool: BrowserPool, costRouter?: CostRouter) {
        this.browserPool = browserPool;
        this.costRouter = costRouter;
    }

    /**
     * Attempts to find a PEC email from the target website using the browser pool.
     * It scans the homepage first. If no PEC is found, it attempts to check /contatti and /privacy.
     */
    public async hunt(companyId: string, input: NormalizedInput, discoveredUrl: string): Promise<ContactSignals> {
        Logger.info(`[PecHunter] 🕵️ Hunting for Contacts (PEC/Email) on: ${discoveredUrl}`);
        let pec: string | null = null;
        let email: string | null = null;
        let source: string | null = null;
        const seen = new Set<string>();

        let enrichment_employees: string | null = null;
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
                if (pageRes.employees && !enrichment_employees) {
                    enrichment_employees = pageRes.employees;
                }
                if ((pageRes.pec || pageRes.email) && pageRes.source) {
                    source = pageRes.source;
                }
                if (pec && email && enrichment_employees) {
                    break;
                }
            }

            if ((!pec || !email) && this.costRouter) {
                for (const pageUrl of PecHunter.buildCandidateUrls(discoveredUrl)) {
                    if (seen.has(`fallback:${pageUrl}`)) {
                        continue;
                    }
                    seen.add(`fallback:${pageUrl}`);

                    const pageRes = await this.scanPageViaFallback(pageUrl, companyId, discoveredUrl);
                    if (pageRes.pec) {
                        pec = PecHunter.prioritizeEmails([pec, pageRes.pec].filter(Boolean) as string[], discoveredUrl).pec;
                    }
                    if (pageRes.email) {
                        email = PecHunter.prioritizeEmails([email, pageRes.email].filter(Boolean) as string[], discoveredUrl).email;
                    }
                    if ((pageRes.pec || pageRes.email) && pageRes.source) {
                        source = pageRes.source;
                    }
                    if (pec || email) {
                        break;
                    }
                }
            }

            if (!pec && !email) {
                Logger.warn(`[PecHunter] ❌ No Contacts found for ${input.company_name}.`);
            }
            return { pec, email, employees: enrichment_employees, source };

        } catch (e: any) {
            Logger.warn(`[PecHunter] Error hunting Contacts for ${input.company_name}: ${e.message}`);
            return { pec: null, email: null, source: null };
        }
    }

    private async scanPage(url: string, rootUrl: string): Promise<ContactSignals> {
        let pec: string | null = null;
        let email: string | null = null;
        try {
            const nav = await this.browserPool.navigateSafe(url);
            if (nav.status === 'OK' && nav.html) {
                const candidates = PecHunter.extractEmails(nav.html);
                const preferred = PecHunter.prioritizeEmails(candidates, rootUrl);
                pec = preferred.pec;
                email = preferred.email;

                // Stage 4 integration: Opportunistic extraction
                const { OpportunisticExtractor } = require('./OpportunisticExtractor');
                const opportunistic = OpportunisticExtractor.extract(nav.html, url);
                const pageEmployees = opportunistic.dipendenti;

                if (pec) Logger.info(`[PecHunter] ✅ FOUND PEC on ${url}: ${pec}`);
                if (email) Logger.info(`[PecHunter] ✅ FOUND EMAIL on ${url}: ${email}`);
                if (pageEmployees) Logger.info(`[PecHunter] ✅ FOUND EMPLOYEES on ${url}: ${pageEmployees}`);

                return { pec, email, employees: pageEmployees, source: pec || email ? 'website_contact_scan' : null };
            }
        } catch (e) {
            // Silence sub-page loading errors (e.g., 404s on /contatti)
        }
        return { pec, email, source: pec || email ? 'website_contact_scan' : null };
    }

    private async scanPageViaFallback(url: string, companyId: string, rootUrl: string): Promise<ContactSignals> {
        if (!this.costRouter) {
            return { pec: null, email: null, source: null };
        }

        try {
            const response = await this.costRouter.route<{ data?: string }>('PROXY_FETCH', {
                url,
                options: { timeoutMs: 30000 },
            }, {
                companyId,
                maxTier: 3,
                skipCache: true,
            });

            const html = response.data?.data || '';
            if (!html) {
                return { pec: null, email: null, source: null };
            }

            const candidates = PecHunter.extractEmails(html);
            const preferred = PecHunter.prioritizeEmails(candidates, rootUrl);
            if (preferred.pec) Logger.info(`[PecHunter] ✅ FOUND PEC via ${response.provider} on ${url}: ${preferred.pec}`);
            if (preferred.email) Logger.info(`[PecHunter] ✅ FOUND EMAIL via ${response.provider} on ${url}: ${preferred.email}`);

            return {
                pec: preferred.pec,
                email: preferred.email,
                source: preferred.pec || preferred.email ? response.provider : null,
            };
        } catch {
            return { pec: null, email: null, source: null };
        }
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
        const rootDomain = PecHunter.getRegistrableDomain(rootHost);
        const pecCandidates = candidates.filter((candidate) => PecHunter.isPecEmail(candidate));
        const standardCandidates = candidates.filter((candidate) => !pecCandidates.includes(candidate));

        const rank = (candidate: string): number => {
            const [local = '', domain = ''] = candidate.split('@');
            const domainHost = domain.toLowerCase();
            const domainRoot = PecHunter.getRegistrableDomain(domainHost);
            let score = 0;
            if (rootDomain && domainRoot === rootDomain) {
                score += 12;
            } else if (rootHost && (domainHost === rootHost || rootHost.endsWith(`.${domainHost}`) || domainHost.endsWith(`.${rootHost}`))) {
                score += 8;
            }
            for (const [prefix, weight] of Object.entries(PecHunter.roleWeights)) {
                if (local.startsWith(prefix)) {
                    score += weight;
                    break;
                }
            }
            if (PecHunter.softPenaltyPrefixes.some((prefix) => local.startsWith(prefix))) score -= 6;
            if (local.includes('noreply') || local.includes('no-reply')) score -= 12;
            if (candidate.includes('sentry')) score -= 12;
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
        const [local = ''] = candidate.split('@');
        if (PecHunter.hardRejectLocalPatterns.some((pattern) => local.includes(pattern))) {
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

    private static getRegistrableDomain(host: string): string {
        const cleaned = host.replace(/^www\./, '').toLowerCase();
        const parts = cleaned.split('.').filter(Boolean);
        if (parts.length <= 2) {
            return cleaned;
        }

        const last = parts[parts.length - 1];
        const secondLast = parts[parts.length - 2];
        const useThreePartSuffix = last.length === 2 && secondLast.length <= 3;
        return useThreePartSuffix
            ? parts.slice(-3).join('.')
            : parts.slice(-2).join('.');
    }
}
