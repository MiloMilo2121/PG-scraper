/**
 * GENETIC FINGERPRINTER v3 - "Invisible Crowd"
 * Evolves browser identities using real evolutionary algorithms.
 *
 * NINJA CORE - Simplified mirror of pg3 version for PG1 hunters.
 * Uses same gene structure and consistency rules.
 */

import type { EvasionConfig } from './evasion';

// ── Embedded UA + trait data (no cross-package imports) ──────────────

interface UAEntry {
    userAgent: string;
    browser: 'chrome' | 'firefox' | 'safari' | 'edge';
    os: 'windows' | 'macos' | 'linux' | 'ios' | 'android';
    mobile: boolean;
    weight: number;
    browserVersion: string;
}

const UA_DATABASE: UAEntry[] = [
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', browser: 'chrome', os: 'windows', mobile: false, weight: 15, browserVersion: '131.0.0.0' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36', browser: 'chrome', os: 'windows', mobile: false, weight: 18, browserVersion: '132.0.0.0' },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', browser: 'chrome', os: 'macos', mobile: false, weight: 10, browserVersion: '131.0.0.0' },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36', browser: 'chrome', os: 'macos', mobile: false, weight: 12, browserVersion: '132.0.0.0' },
    { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', browser: 'chrome', os: 'linux', mobile: false, weight: 3, browserVersion: '131.0.0.0' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', browser: 'edge', os: 'windows', mobile: false, weight: 5, browserVersion: '131.0.0.0' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0', browser: 'firefox', os: 'windows', mobile: false, weight: 4, browserVersion: '134.0' },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15', browser: 'safari', os: 'macos', mobile: false, weight: 5, browserVersion: '18.2' },
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 2560, height: 1440 },
];

const WEBGL_MAP: Record<string, { vendor: string; renderer: string }> = {
    windows: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    macos: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' },
    linux: { vendor: 'Google Inc. (Mesa)', renderer: 'ANGLE (Mesa, Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)' },
};

// ── Gene Interface ───────────────────────────────────────────────────

export interface BrowserGene {
    id: string;
    uaIndex: number;
    userAgent: string;
    viewport: { width: number; height: number };
    locale: string;
    hardwareConcurrency: number;
    deviceMemory: number;
    os: string;
    browser: string;
    score: number;
    domainScores: Record<string, number>;
    generations: number;
    age: number;
}

// ── Fingerprinter ────────────────────────────────────────────────────

export class GeneticFingerprinter {
    private static instance: GeneticFingerprinter;
    private population: BrowserGene[] = [];
    private operationsCount = 0;
    private readonly EVOLUTION_INTERVAL = 50;
    private recentResults: boolean[] = [];
    private mutationRate = 0.2;

    private constructor() {
        this.initializePopulation();
    }

    public static getInstance(): GeneticFingerprinter {
        if (!GeneticFingerprinter.instance) {
            GeneticFingerprinter.instance = new GeneticFingerprinter();
        }
        return GeneticFingerprinter.instance;
    }

    private initializePopulation() {
        for (let i = 0; i < 25; i++) {
            this.population.push(this.createRandomGene());
        }
        console.log(`[Genetic] Initialized population of ${this.population.length} fingerprints (v3)`);
    }

    private createRandomGene(): BrowserGene {
        const uaIndex = this.weightedRandomUAIndex();
        const ua = UA_DATABASE[uaIndex];
        return {
            id: Math.random().toString(36).substring(2, 10),
            uaIndex,
            userAgent: ua.userAgent,
            viewport: VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)],
            locale: Math.random() > 0.8 ? 'en-US' : 'it-IT',
            hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
            deviceMemory: [4, 8, 16][Math.floor(Math.random() * 3)],
            os: ua.os,
            browser: ua.browser,
            score: 0,
            domainScores: {},
            generations: 0,
            age: 0,
        };
    }

    public getBestGene(): BrowserGene {
        // Adaptive epsilon-greedy
        const successRate = this.getSuccessRate();
        const exploreRate = Math.max(0.05, Math.min(0.3, 1 - successRate));
        if (Math.random() < exploreRate) {
            return this.population[Math.floor(Math.random() * this.population.length)];
        }
        // Tournament selection
        const candidates = Array.from({ length: 3 }, () =>
            this.population[Math.floor(Math.random() * this.population.length)]
        );
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }

    /**
     * Convert gene to full evasion config for BrowserEvasion.apply()
     */
    public geneToEvasionConfig(gene: BrowserGene): EvasionConfig {
        const webgl = WEBGL_MAP[gene.os] || WEBGL_MAP.macos;
        const ua = UA_DATABASE[gene.uaIndex];
        const majorVersion = ua.browserVersion.split('.')[0];

        // Build Client Hints
        let brands: Array<{ brand: string; version: string }> = [];
        if (ua.browser === 'chrome') {
            brands = [
                { brand: 'Chromium', version: majorVersion },
                { brand: 'Google Chrome', version: majorVersion },
                { brand: 'Not?A_Brand', version: '99' },
            ];
        } else if (ua.browser === 'edge') {
            brands = [
                { brand: 'Chromium', version: majorVersion },
                { brand: 'Microsoft Edge', version: majorVersion },
                { brand: 'Not?A_Brand', version: '99' },
            ];
        }

        const platformMap: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
        const platform = platformMap[gene.os] || 'Windows';

        return {
            webglVendor: webgl.vendor,
            webglRenderer: webgl.renderer,
            timezone: gene.locale === 'it-IT' ? 'Europe/Rome' : 'America/New_York',
            locale: gene.locale,
            os: gene.os as any,
            browser: gene.browser as any,
            connectionType: 'wifi',
            connectionDownlink: 10 + Math.random() * 50,
            connectionRtt: 20 + Math.random() * 60,
            screenWidth: gene.viewport.width,
            screenHeight: gene.viewport.height,
            screenDepth: 24,
            deviceMemory: gene.deviceMemory,
            maxTouchPoints: 0,
            clientHints: brands.length > 0 ? {
                brands,
                isMobile: false,
                platform,
                architecture: gene.os === 'macos' ? 'arm' : 'x86',
                bitness: '64',
                fullVersionList: brands.map(b => ({ ...b, version: b.version + '.0.0.0' })),
                platformVersion: gene.os === 'windows' ? '15.0.0' : '13.6.0',
            } : undefined,
        };
    }

    public reportSuccess(geneId: string, domain?: string) {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score += 2;
            gene.age++;
            if (domain) {
                const key = domain.replace(/^www\./, '').toLowerCase();
                gene.domainScores[key] = (gene.domainScores[key] || 0) + 2;
            }
            this.recentResults.push(true);
            if (this.recentResults.length > 100) this.recentResults.shift();
            this.checkEvolution();
        }
    }

    public reportFailure(geneId: string, domain?: string) {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score -= 5;
            gene.age++;
            if (domain) {
                const key = domain.replace(/^www\./, '').toLowerCase();
                gene.domainScores[key] = (gene.domainScores[key] || 0) - 5;
            }
            this.recentResults.push(false);
            if (this.recentResults.length > 100) this.recentResults.shift();
            this.checkEvolution();
        }
    }

    private getSuccessRate(): number {
        if (this.recentResults.length < 10) return 0.7;
        return this.recentResults.filter(r => r).length / this.recentResults.length;
    }

    private checkEvolution() {
        this.operationsCount++;
        if (this.operationsCount >= this.EVOLUTION_INTERVAL) {
            this.evolve();
            this.operationsCount = 0;
        }
    }

    private evolve() {
        const rate = this.getSuccessRate();
        this.mutationRate = rate < 0.6 ? 0.4 : rate > 0.85 ? 0.1 : 0.2;

        console.log(`[Genetic] EVOLUTION (mutation: ${this.mutationRate}, success: ${(rate * 100).toFixed(0)}%)`);

        const sorted = [...this.population].sort((a, b) => b.score - a.score);
        const surviveCount = Math.floor(this.population.length * 0.7);
        const survivors = sorted.slice(0, surviveCount);

        const children: BrowserGene[] = [];
        for (let i = 0; i < this.population.length - surviveCount; i++) {
            const pA = survivors[Math.floor(Math.random() * survivors.length)];
            const pB = survivors[Math.floor(Math.random() * survivors.length)];
            const pick = <T>(a: T, b: T): T => Math.random() < 0.5 ? a : b;

            const child: BrowserGene = {
                id: Math.random().toString(36).substring(2, 10),
                uaIndex: pick(pA.uaIndex, pB.uaIndex),
                userAgent: UA_DATABASE[pick(pA.uaIndex, pB.uaIndex)].userAgent,
                viewport: pick(pA.viewport, pB.viewport),
                locale: pick(pA.locale, pB.locale),
                hardwareConcurrency: pick(pA.hardwareConcurrency, pB.hardwareConcurrency),
                deviceMemory: pick(pA.deviceMemory, pB.deviceMemory),
                os: UA_DATABASE[pick(pA.uaIndex, pB.uaIndex)].os,
                browser: UA_DATABASE[pick(pA.uaIndex, pB.uaIndex)].browser,
                score: 0,
                domainScores: {},
                generations: Math.max(pA.generations, pB.generations) + 1,
                age: 0,
            };

            // Mutate
            if (Math.random() < this.mutationRate) child.uaIndex = this.weightedRandomUAIndex();
            if (Math.random() < this.mutationRate) child.viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

            const ua = UA_DATABASE[child.uaIndex];
            child.userAgent = ua.userAgent;
            child.os = ua.os;
            child.browser = ua.browser;

            children.push(child);
        }

        this.population = [...survivors, ...children];
        console.log(`[Genetic] Evolution complete. Best: ${survivors[0]?.score ?? 0}`);
    }

    private weightedRandomUAIndex(): number {
        const total = UA_DATABASE.reduce((s, e) => s + e.weight, 0);
        let r = Math.random() * total;
        for (let i = 0; i < UA_DATABASE.length; i++) {
            r -= UA_DATABASE[i].weight;
            if (r <= 0) return i;
        }
        return 0;
    }
}
