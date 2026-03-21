import { ContentFilter } from '../enricher/core/discovery/content_filter';

const MESSAGING_OR_REDIRECT_HOSTS = new Set([
    'wa.me',
    'whatsapp.com',
    'api.whatsapp.com',
    'chat.whatsapp.com',
    't.me',
    'telegram.me',
    'linktr.ee',
]);

export type InputWebsiteClassification =
    | 'VALID'
    | 'INVALID'
    | 'DIRECTORY_OR_SOCIAL'
    | 'MESSAGING_OR_REDIRECT';

export interface AssessedInputWebsite {
    classification: InputWebsiteClassification;
    normalizedUrl?: string;
    candidates: string[];
    reasonCode?: string;
}

export class InputWebsiteCandidate {
    public static assess(rawUrl?: string): AssessedInputWebsite {
        const normalizedUrl = this.normalize(rawUrl);
        if (!normalizedUrl) {
            return {
                classification: 'INVALID',
                candidates: [],
                reasonCode: rawUrl ? 'INPUT_WEBSITE_INVALID' : undefined,
            };
        }

        if (this.isMessagingOrRedirect(normalizedUrl)) {
            return {
                classification: 'MESSAGING_OR_REDIRECT',
                normalizedUrl,
                candidates: [],
                reasonCode: 'INPUT_WEBSITE_MESSAGING_OR_REDIRECT',
            };
        }

        if (ContentFilter.isDirectoryOrSocial(normalizedUrl)) {
            return {
                classification: 'DIRECTORY_OR_SOCIAL',
                normalizedUrl,
                candidates: [],
                reasonCode: 'INPUT_WEBSITE_DIRECTORY_OR_SOCIAL',
            };
        }

        return {
            classification: 'VALID',
            normalizedUrl,
            candidates: this.buildCandidates(normalizedUrl),
        };
    }

    private static normalize(rawUrl?: string): string | undefined {
        if (!rawUrl || !rawUrl.trim()) {
            return undefined;
        }

        const trimmed = rawUrl.trim();
        const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;

        try {
            const parsed = new URL(withProtocol);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return undefined;
            }

            parsed.hash = '';
            parsed.search = '';
            parsed.username = '';
            parsed.password = '';
            parsed.hostname = parsed.hostname.toLowerCase();
            parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');

            const port = parsed.port ? `:${parsed.port}` : '';
            return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}`;
        } catch {
            return undefined;
        }
    }

    private static isMessagingOrRedirect(url: string): boolean {
        try {
            const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
            return MESSAGING_OR_REDIRECT_HOSTS.has(hostname);
        } catch {
            return false;
        }
    }

    private static buildCandidates(normalizedUrl: string): string[] {
        const parsed = new URL(normalizedUrl);
        const hostWithoutWww = parsed.hostname.replace(/^www\./, '');
        const registrableHost = this.toRegistrableHost(hostWithoutWww);
        const path = parsed.pathname || '';
        const hasMeaningfulPath = path !== '' && path !== '/';
        const seen = new Set<string>();
        const candidates: string[] = [];

        const pushCandidate = (protocol: string, hostname: string, includePath: boolean) => {
            const base = `${protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ''}`;
            const candidate = includePath && hasMeaningfulPath ? `${base}${path}` : base;
            if (!seen.has(candidate)) {
                seen.add(candidate);
                candidates.push(candidate);
            }
        };

        pushCandidate(parsed.protocol, parsed.hostname, true);
        pushCandidate(parsed.protocol, parsed.hostname, false);

        if (parsed.protocol === 'http:') {
            pushCandidate('https:', parsed.hostname, true);
            pushCandidate('https:', parsed.hostname, false);
        }

        if (hostWithoutWww !== parsed.hostname) {
            pushCandidate(parsed.protocol, hostWithoutWww, true);
            pushCandidate(parsed.protocol, hostWithoutWww, false);
            if (parsed.protocol === 'http:') {
                pushCandidate('https:', hostWithoutWww, true);
                pushCandidate('https:', hostWithoutWww, false);
            }
        } else if (hostWithoutWww.includes('.')) {
            const wwwHost = `www.${hostWithoutWww}`;
            pushCandidate(parsed.protocol, wwwHost, true);
            pushCandidate(parsed.protocol, wwwHost, false);
            if (parsed.protocol === 'http:') {
                pushCandidate('https:', wwwHost, true);
                pushCandidate('https:', wwwHost, false);
            }
        }

        if (registrableHost && registrableHost !== hostWithoutWww) {
            pushCandidate(parsed.protocol, registrableHost, false);
            if (parsed.protocol === 'http:') {
                pushCandidate('https:', registrableHost, false);
            }

            const registrableWithWww = `www.${registrableHost}`;
            pushCandidate(parsed.protocol, registrableWithWww, false);
            if (parsed.protocol === 'http:') {
                pushCandidate('https:', registrableWithWww, false);
            }
        }

        return candidates;
    }

    private static toRegistrableHost(hostname: string): string | undefined {
        const labels = hostname
            .split('.')
            .map((label) => label.trim().toLowerCase())
            .filter(Boolean);

        if (labels.length < 3) {
            return hostname;
        }

        const commonCountrySecondLevelDomains = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
        const lastLabel = labels[labels.length - 1];
        const penultimateLabel = labels[labels.length - 2];

        if (lastLabel.length === 2 && commonCountrySecondLevelDomains.has(penultimateLabel) && labels.length >= 3) {
            return labels.slice(-3).join('.');
        }

        return labels.slice(-2).join('.');
    }
}
