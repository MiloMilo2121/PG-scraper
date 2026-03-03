/**
 * Structured User Agent Database v2
 * Updated Feb 2026 - Chrome 131+, Firefox 134+, Safari 18+, Edge 131+
 *
 * Each entry contains metadata for downstream consistency checks:
 * Client Hints, WebGL profiles, screen properties, etc.
 */

export interface UAEntry {
    userAgent: string;
    browser: 'chrome' | 'firefox' | 'safari' | 'edge';
    browserVersion: string;
    os: 'windows' | 'macos' | 'linux' | 'ios' | 'android';
    osVersion: string;
    mobile: boolean;
    weight: number; // Market share weighting for selection probability
}

export const UA_DATABASE: UAEntry[] = [
    // ── Desktop Chrome (Windows) ─────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '131.0.0.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 15,
    },
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '132.0.0.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 18,
    },
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '133.0.0.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 12,
    },

    // ── Desktop Chrome (Mac) ─────────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '131.0.0.0', os: 'macos', osVersion: '10.15.7', mobile: false, weight: 10,
    },
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '132.0.0.0', os: 'macos', osVersion: '10.15.7', mobile: false, weight: 12,
    },
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '133.0.0.0', os: 'macos', osVersion: '14.3', mobile: false, weight: 8,
    },

    // ── Desktop Chrome (Linux) ───────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '131.0.0.0', os: 'linux', osVersion: '', mobile: false, weight: 3,
    },
    {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        browser: 'chrome', browserVersion: '132.0.0.0', os: 'linux', osVersion: '', mobile: false, weight: 3,
    },

    // ── Desktop Edge (Windows) ───────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        browser: 'edge', browserVersion: '131.0.0.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 5,
    },
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
        browser: 'edge', browserVersion: '132.0.0.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 5,
    },

    // ── Desktop Firefox (Windows) ────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
        browser: 'firefox', browserVersion: '134.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 4,
    },
    {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
        browser: 'firefox', browserVersion: '133.0', os: 'windows', osVersion: '10.0', mobile: false, weight: 3,
    },

    // ── Desktop Firefox (Mac) ────────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
        browser: 'firefox', browserVersion: '134.0', os: 'macos', osVersion: '10.15', mobile: false, weight: 2,
    },

    // ── Desktop Safari (Mac) ─────────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
        browser: 'safari', browserVersion: '18.2', os: 'macos', osVersion: '10.15.7', mobile: false, weight: 5,
    },
    {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
        browser: 'safari', browserVersion: '18.3', os: 'macos', osVersion: '14.3', mobile: false, weight: 4,
    },

    // ── Mobile Safari (iPhone) ───────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
        browser: 'safari', browserVersion: '18.2', os: 'ios', osVersion: '18.2', mobile: true, weight: 4,
    },
    {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        browser: 'safari', browserVersion: '18.1', os: 'ios', osVersion: '18.1', mobile: true, weight: 3,
    },
    {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1',
        browser: 'safari', browserVersion: '17.7', os: 'ios', osVersion: '17.7', mobile: true, weight: 2,
    },

    // ── Mobile Chrome (Android) ──────────────────────────────────────
    {
        userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        browser: 'chrome', browserVersion: '131.0.0.0', os: 'android', osVersion: '15', mobile: true, weight: 3,
    },
    {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
        browser: 'chrome', browserVersion: '132.0.0.0', os: 'android', osVersion: '14', mobile: true, weight: 3,
    },
    {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        browser: 'chrome', browserVersion: '131.0.0.0', os: 'android', osVersion: '14', mobile: true, weight: 2,
    },
];

// ── WebGL profiles keyed by OS ───────────────────────────────────────
export interface WebGLProfile {
    vendor: string;
    renderer: string;
}

export const WEBGL_PROFILES: Record<string, WebGLProfile[]> = {
    windows: [
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ],
    macos: [
        { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' },
        { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
        { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M3, OpenGL 4.1)' },
    ],
    linux: [
        { vendor: 'Google Inc. (Mesa)', renderer: 'ANGLE (Mesa, Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)' },
        { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5)' },
    ],
    ios: [
        { vendor: 'Apple Inc.', renderer: 'Apple GPU' },
    ],
    android: [
        { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
        { vendor: 'ARM', renderer: 'Mali-G715 Immortalis MC11' },
    ],
};

// ── Desktop viewport presets ─────────────────────────────────────────
export interface ViewportPreset {
    width: number;
    height: number;
    mobile: boolean;
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
    // Desktop
    { width: 1920, height: 1080, mobile: false },
    { width: 1366, height: 768, mobile: false },
    { width: 1440, height: 900, mobile: false },
    { width: 1536, height: 864, mobile: false },
    { width: 2560, height: 1440, mobile: false },
    { width: 1680, height: 1050, mobile: false },
    // Mobile
    { width: 390, height: 844, mobile: true },  // iPhone 14/15 Pro
    { width: 393, height: 852, mobile: true },  // iPhone 15
    { width: 412, height: 915, mobile: true },  // Samsung Galaxy S24
    { width: 360, height: 800, mobile: true },  // Common Android
];

// ── Locale/Timezone mapping ──────────────────────────────────────────
export interface LocaleConfig {
    locale: string;
    timezone: string;
    acceptLanguage: string;
}

export const LOCALE_CONFIGS: LocaleConfig[] = [
    { locale: 'it-IT', timezone: 'Europe/Rome', acceptLanguage: 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7' },
    { locale: 'en-US', timezone: 'America/New_York', acceptLanguage: 'en-US,en;q=0.9' },
    { locale: 'en-GB', timezone: 'Europe/London', acceptLanguage: 'en-GB,en;q=0.9,en-US;q=0.8' },
    { locale: 'de-DE', timezone: 'Europe/Berlin', acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' },
    { locale: 'fr-FR', timezone: 'Europe/Paris', acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' },
];

// ── Speech Synthesis voices per OS ───────────────────────────────────
export const SPEECH_VOICES: Record<string, Array<{ name: string; lang: string; default: boolean }>> = {
    macos: [
        { name: 'Samantha', lang: 'en-US', default: true },
        { name: 'Alex', lang: 'en-US', default: false },
        { name: 'Alice', lang: 'it-IT', default: false },
        { name: 'Thomas', lang: 'fr-FR', default: false },
        { name: 'Anna', lang: 'de-DE', default: false },
        { name: 'Karen', lang: 'en-AU', default: false },
    ],
    windows: [
        { name: 'Microsoft David', lang: 'en-US', default: true },
        { name: 'Microsoft Zira', lang: 'en-US', default: false },
        { name: 'Microsoft Elsa', lang: 'it-IT', default: false },
        { name: 'Microsoft Katja', lang: 'de-DE', default: false },
        { name: 'Microsoft Hortense', lang: 'fr-FR', default: false },
    ],
    linux: [
        { name: 'English (America)', lang: 'en-US', default: true },
        { name: 'Italian', lang: 'it-IT', default: false },
    ],
    ios: [
        { name: 'Samantha', lang: 'en-US', default: true },
        { name: 'Alice', lang: 'it-IT', default: false },
    ],
    android: [
        { name: 'Google US English', lang: 'en-US', default: true },
        { name: 'Google italiano', lang: 'it-IT', default: false },
    ],
};

// ── Client Hints helper ──────────────────────────────────────────────
export interface ClientHintsData {
    secChUa: string;
    secChUaPlatform: string;
    secChUaMobile: string;
    secChUaArch: string;
    secChUaBitness: string;
    secChUaModel: string;
    secChUaFullVersionList: string;
    platform: string;
    brands: Array<{ brand: string; version: string }>;
    fullVersionList: Array<{ brand: string; version: string }>;
    architecture: string;
    bitness: string;
    isMobile: boolean;
    platformVersion: string;
}

export function buildClientHints(entry: UAEntry): ClientHintsData {
    const majorVersion = entry.browserVersion.split('.')[0];

    // Map OS to platform name for Client Hints
    const platformMap: Record<string, string> = {
        windows: 'Windows',
        macos: 'macOS',
        linux: 'Linux',
        ios: 'iOS',
        android: 'Android',
    };
    const platform = platformMap[entry.os] || 'Windows';

    // Architecture
    const archMap: Record<string, string> = {
        windows: 'x86',
        macos: 'arm',
        linux: 'x86',
        ios: 'arm',
        android: 'arm',
    };
    const architecture = archMap[entry.os] || 'x86';
    const bitness = entry.mobile ? '32' : '64';

    // Platform version
    const platformVersionMap: Record<string, string> = {
        windows: '15.0.0',
        macos: entry.osVersion.includes('14') ? '14.3.0' : '13.6.0',
        linux: '6.5.0',
        ios: entry.osVersion.replace(/_/g, '.') + '.0',
        android: entry.osVersion + '.0',
    };
    const platformVersion = platformVersionMap[entry.os] || '10.0.0';

    // Build brands based on browser type
    let brands: Array<{ brand: string; version: string }>;
    let fullVersionList: Array<{ brand: string; version: string }>;

    if (entry.browser === 'chrome') {
        brands = [
            { brand: 'Chromium', version: majorVersion },
            { brand: 'Google Chrome', version: majorVersion },
            { brand: 'Not?A_Brand', version: '99' },
        ];
        fullVersionList = [
            { brand: 'Chromium', version: entry.browserVersion },
            { brand: 'Google Chrome', version: entry.browserVersion },
            { brand: 'Not?A_Brand', version: '99.0.0.0' },
        ];
    } else if (entry.browser === 'edge') {
        brands = [
            { brand: 'Chromium', version: majorVersion },
            { brand: 'Microsoft Edge', version: majorVersion },
            { brand: 'Not?A_Brand', version: '99' },
        ];
        fullVersionList = [
            { brand: 'Chromium', version: entry.browserVersion },
            { brand: 'Microsoft Edge', version: entry.browserVersion },
            { brand: 'Not?A_Brand', version: '99.0.0.0' },
        ];
    } else {
        // Firefox and Safari don't support Client Hints the same way,
        // but we still provide them for consistency in case headers are checked
        brands = [
            { brand: 'Not?A_Brand', version: '99' },
        ];
        fullVersionList = [
            { brand: 'Not?A_Brand', version: '99.0.0.0' },
        ];
    }

    const formatBrands = (b: Array<{ brand: string; version: string }>) =>
        b.map(x => `"${x.brand}";v="${x.version}"`).join(', ');

    return {
        secChUa: formatBrands(brands),
        secChUaPlatform: `"${platform}"`,
        secChUaMobile: entry.mobile ? '?1' : '?0',
        secChUaArch: `"${architecture}"`,
        secChUaBitness: `"${bitness}"`,
        secChUaModel: entry.mobile ? `""` : `""`,
        secChUaFullVersionList: formatBrands(fullVersionList),
        platform,
        brands,
        fullVersionList,
        architecture,
        bitness,
        isMobile: entry.mobile,
        platformVersion,
    };
}

// ── Backward-compatible exports ──────────────────────────────────────
export const USER_AGENTS = UA_DATABASE.map(e => e.userAgent);

export function getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getWeightedRandomUA(): UAEntry {
    const totalWeight = UA_DATABASE.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;
    for (const entry of UA_DATABASE) {
        random -= entry.weight;
        if (random <= 0) return entry;
    }
    return UA_DATABASE[0];
}
