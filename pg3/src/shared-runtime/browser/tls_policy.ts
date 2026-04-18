function parseBooleanEnv(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseAllowlist(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase());
}

function normalizeHost(targetUrl: string): string | null {
    try {
        return new URL(targetUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return null;
    }
}

function hostMatchesPattern(host: string, pattern: string): boolean {
    if (!pattern) {
        return false;
    }

    const normalizedPattern = pattern.startsWith('https://') || pattern.startsWith('http://')
        ? normalizeHost(pattern) || pattern
        : pattern;

    if (normalizedPattern.startsWith('*.')) {
        const suffix = normalizedPattern.slice(2);
        return host === suffix || host.endsWith(`.${suffix}`);
    }

    if (normalizedPattern.includes('*')) {
        const escaped = normalizedPattern
            .split('*')
            .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*');
        return new RegExp(`^${escaped}$`, 'i').test(host);
    }

    return host === normalizedPattern || host.endsWith(`.${normalizedPattern}`);
}

function isTlsRelaxationEnabled(): boolean {
    return parseBooleanEnv(process.env.TLS_RELAX_ENABLED)
        || parseBooleanEnv(process.env.TLS_RELAX_EMERGENCY_ENABLED)
        || parseBooleanEnv(process.env.TLS_RELAX_ALLOW_INSECURE);
}

export function shouldRelaxTlsForUrl(targetUrl: string): boolean {
    if (!isTlsRelaxationEnabled()) {
        return false;
    }

    const host = normalizeHost(targetUrl);
    if (!host) {
        return false;
    }

    const allowlist = [
        ...parseAllowlist(process.env.TLS_RELAX_ALLOWLIST),
        ...parseAllowlist(process.env.TLS_RELAX_TARGET_ALLOWLIST),
        ...parseAllowlist(process.env.TLS_RELAX_HOST_ALLOWLIST),
    ];

    if (allowlist.length === 0) {
        return false;
    }

    return allowlist.some((pattern) => hostMatchesPattern(host, pattern));
}
