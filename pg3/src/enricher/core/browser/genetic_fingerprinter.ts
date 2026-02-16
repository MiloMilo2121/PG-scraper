/**
 * GENETIC FINGERPRINTER v3 - "Invisible Crowd"
 * Evolves browser identities using real evolutionary algorithms.
 *
 * Features:
 * - 900K+ gene space (expanded traits with consistency enforcement)
 * - True two-parent crossover with tournament selection
 * - Domain-specific fitness tracking
 * - Adaptive mutation rates based on rolling success rate
 * - Population persistence to disk
 * - Crowding distance for diversity maintenance (NSGA-II)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';
import {
    UA_DATABASE, WEBGL_PROFILES, VIEWPORT_PRESETS,
    LOCALE_CONFIGS, buildClientHints,
} from './ua_db';
import type { UAEntry, WebGLProfile, ClientHintsData } from './ua_db';
import type { EvasionConfig } from './evasion';

// ── Gene Interface ───────────────────────────────────────────────────

export interface BrowserGene {
    id: string;
    // Identity
    uaIndex: number;           // Index into UA_DATABASE
    viewportIndex: number;     // Index into VIEWPORT_PRESETS
    localeIndex: number;       // Index into LOCALE_CONFIGS
    // Hardware
    hardwareConcurrency: number;
    deviceMemory: number;
    maxTouchPoints: number;
    // Graphics
    webglProfileKey: string;   // e.g. "windows:0", "macos:2"
    // Network
    connectionType: string;
    connectionDownlink: number;
    connectionRtt: number;
    // Screen
    screenDepth: number;
    // Fitness
    score: number;
    domainScores: Record<string, number>;
    generations: number;
    age: number;               // Total requests served
}

// ── Trait pools ──────────────────────────────────────────────────────

const HARDWARE_CONCURRENCY = [2, 4, 8, 12, 16];
const DEVICE_MEMORY = [2, 4, 8, 16];
const SCREEN_DEPTHS = [24, 32];
const CONNECTION_TYPES = ['4g', 'wifi'] as const;
const CONNECTION_DOWNLINKS: Record<string, { min: number; max: number }> = {
    '4g': { min: 1.5, max: 10 },
    'wifi': { min: 10, max: 100 },
};
const CONNECTION_RTTS: Record<string, { min: number; max: number }> = {
    '4g': { min: 50, max: 300 },
    'wifi': { min: 20, max: 100 },
};

const PERSIST_PATH = path.join(process.cwd(), 'data', 'genetic_population.json');
const POPULATION_VERSION = 3;

// ── Main class ───────────────────────────────────────────────────────

export class GeneticFingerprinter {
    private static instance: GeneticFingerprinter;
    private population: BrowserGene[] = [];
    private operationsCount = 0;
    private readonly POPULATION_SIZE = 30;
    private readonly EVOLUTION_INTERVAL = 50;

    // Adaptive mutation tracking
    private recentResults: boolean[] = [];   // true=success, false=failure
    private readonly ROLLING_WINDOW = 100;
    private mutationRate = 0.2;

    private constructor() {
        if (!this.loadPopulation()) {
            this.initializePopulation();
        }
    }

    public static getInstance(): GeneticFingerprinter {
        if (!GeneticFingerprinter.instance) {
            GeneticFingerprinter.instance = new GeneticFingerprinter();
        }
        return GeneticFingerprinter.instance;
    }

    // ── Population initialization ────────────────────────────────────

    private initializePopulation(): void {
        for (let i = 0; i < this.POPULATION_SIZE; i++) {
            this.population.push(this.createRandomGene());
        }
        Logger.info(`[Genetic] Initialized population of ${this.population.length} fingerprints (v3, ${this.getGeneSpaceSize()} combinations)`);
    }

    private getGeneSpaceSize(): string {
        const total = UA_DATABASE.length * VIEWPORT_PRESETS.length * LOCALE_CONFIGS.length *
            HARDWARE_CONCURRENCY.length * DEVICE_MEMORY.length * SCREEN_DEPTHS.length *
            CONNECTION_TYPES.length;
        return total.toLocaleString();
    }

    private createRandomGene(): BrowserGene {
        const uaIndex = this.weightedRandomUAIndex();
        const ua = UA_DATABASE[uaIndex];

        // Pick viewport consistent with mobile flag
        const matchingViewports = VIEWPORT_PRESETS
            .map((v, i) => ({ ...v, i }))
            .filter(v => v.mobile === ua.mobile);
        const vp = matchingViewports[Math.floor(Math.random() * matchingViewports.length)];

        // Pick locale (80% Italian preference for PagineGialle)
        const localeIndex = Math.random() < 0.8 ? 0 : Math.floor(Math.random() * LOCALE_CONFIGS.length);

        // Pick WebGL profile consistent with OS
        const osProfiles = WEBGL_PROFILES[ua.os] || WEBGL_PROFILES.windows;
        const profileIdx = Math.floor(Math.random() * osProfiles.length);
        const webglProfileKey = `${ua.os}:${profileIdx}`;

        // Connection
        const connType = CONNECTION_TYPES[Math.floor(Math.random() * CONNECTION_TYPES.length)];
        const dlRange = CONNECTION_DOWNLINKS[connType];
        const rttRange = CONNECTION_RTTS[connType];

        const gene: BrowserGene = {
            id: this.generateId(),
            uaIndex,
            viewportIndex: vp.i,
            localeIndex,
            hardwareConcurrency: HARDWARE_CONCURRENCY[Math.floor(Math.random() * HARDWARE_CONCURRENCY.length)],
            deviceMemory: ua.mobile
                ? DEVICE_MEMORY.filter(m => m <= 8)[Math.floor(Math.random() * 3)]
                : DEVICE_MEMORY[Math.floor(Math.random() * DEVICE_MEMORY.length)],
            maxTouchPoints: ua.mobile ? Math.floor(Math.random() * 5) + 1 : 0,
            webglProfileKey,
            connectionType: connType,
            connectionDownlink: +(dlRange.min + Math.random() * (dlRange.max - dlRange.min)).toFixed(1),
            connectionRtt: Math.round(rttRange.min + Math.random() * (rttRange.max - rttRange.min)),
            screenDepth: SCREEN_DEPTHS[Math.floor(Math.random() * SCREEN_DEPTHS.length)],
            score: 0,
            domainScores: {},
            generations: 0,
            age: 0,
        };

        return gene;
    }

    // ── Gene selection ───────────────────────────────────────────────

    public getBestGene(): BrowserGene {
        return this.selectGene();
    }

    public getBestGeneForDomain(domain?: string): BrowserGene {
        return this.selectGene(domain);
    }

    private selectGene(domain?: string): BrowserGene {
        // Epsilon-greedy with adaptive exploration
        const exploreRate = Math.max(0.05, Math.min(0.3, 1 - this.getSuccessRate()));
        if (Math.random() < exploreRate) {
            return this.population[Math.floor(Math.random() * this.population.length)];
        }

        // Tournament selection (pick 3, take best)
        return this.tournamentSelect(domain);
    }

    private tournamentSelect(domain?: string): BrowserGene {
        const candidates: BrowserGene[] = [];
        for (let i = 0; i < 3; i++) {
            candidates.push(this.population[Math.floor(Math.random() * this.population.length)]);
        }

        const scoreFn = domain
            ? (g: BrowserGene) => (g.domainScores[domain] ?? 0) + g.score * 0.3
            : (g: BrowserGene) => g.score;

        candidates.sort((a, b) => scoreFn(b) - scoreFn(a));
        return candidates[0];
    }

    // ── Feedback ─────────────────────────────────────────────────────

    public reportSuccess(geneId: string, domain?: string): void {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score += 2;
            gene.age++;
            if (domain) {
                const key = this.normalizeDomain(domain);
                gene.domainScores[key] = (gene.domainScores[key] || 0) + 2;
            }
            this.recentResults.push(true);
            if (this.recentResults.length > this.ROLLING_WINDOW) this.recentResults.shift();
            this.updateMutationRate();
            this.checkEvolution();
        }
    }

    public reportFailure(geneId: string, domain?: string): void {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score -= 5;
            gene.age++;
            if (domain) {
                const key = this.normalizeDomain(domain);
                gene.domainScores[key] = (gene.domainScores[key] || 0) - 5;
            }
            this.recentResults.push(false);
            if (this.recentResults.length > this.ROLLING_WINDOW) this.recentResults.shift();
            this.updateMutationRate();
            this.checkEvolution();
        }
    }

    private normalizeDomain(domain: string): string {
        return domain.replace(/^www\./, '').toLowerCase();
    }

    // ── Adaptive mutation ────────────────────────────────────────────

    private getSuccessRate(): number {
        if (this.recentResults.length < 10) return 0.7; // Assume decent until we have data
        return this.recentResults.filter(r => r).length / this.recentResults.length;
    }

    private updateMutationRate(): void {
        const rate = this.getSuccessRate();
        if (rate < 0.6) {
            this.mutationRate = 0.4;   // High exploration
        } else if (rate > 0.85) {
            this.mutationRate = 0.1;   // Low exploration, exploit winners
        } else {
            this.mutationRate = 0.2;   // Default
        }
    }

    // ── Evolution ────────────────────────────────────────────────────

    private checkEvolution(): void {
        this.operationsCount++;
        if (this.operationsCount >= this.EVOLUTION_INTERVAL) {
            this.evolve();
            this.operationsCount = 0;
        }
    }

    private evolve(): void {
        Logger.info(`[Genetic] EVOLUTION EVENT (mutation rate: ${this.mutationRate}, success rate: ${(this.getSuccessRate() * 100).toFixed(0)}%)`);

        // 1. Compute crowding distances for diversity
        const crowding = this.computeCrowdingDistance();

        // 2. Compute combined fitness (score + diversity bonus)
        const fitnessPairs = this.population.map(g => ({
            gene: g,
            fitness: g.score + 0.3 * (crowding.get(g.id) || 0),
        }));
        fitnessPairs.sort((a, b) => b.fitness - a.fitness);

        // 3. Survivors: top 70%
        const surviveCount = Math.floor(this.POPULATION_SIZE * 0.7);
        const survivors = fitnessPairs.slice(0, surviveCount).map(p => p.gene);

        // 4. Breed children via crossover + mutation
        const children: BrowserGene[] = [];
        const childCount = this.POPULATION_SIZE - surviveCount;

        for (let i = 0; i < childCount; i++) {
            const parentA = this.tournamentSelect();
            const parentB = this.tournamentSelect();
            let child = this.crossover(parentA, parentB);
            child = this.mutate(child);
            children.push(child);
        }

        this.population = [...survivors, ...children];
        this.savePopulation();

        const bestScore = survivors[0]?.score ?? 0;
        Logger.info(`[Genetic] Evolution complete. Pop: ${this.population.length}, Best: ${bestScore}, Mutation: ${this.mutationRate}`);
    }

    // ── Crossover ────────────────────────────────────────────────────

    private crossover(parentA: BrowserGene, parentB: BrowserGene): BrowserGene {
        const pick = <T>(a: T, b: T): T => Math.random() < 0.5 ? a : b;

        const child: BrowserGene = {
            id: this.generateId(),
            uaIndex: pick(parentA.uaIndex, parentB.uaIndex),
            viewportIndex: pick(parentA.viewportIndex, parentB.viewportIndex),
            localeIndex: pick(parentA.localeIndex, parentB.localeIndex),
            hardwareConcurrency: pick(parentA.hardwareConcurrency, parentB.hardwareConcurrency),
            deviceMemory: pick(parentA.deviceMemory, parentB.deviceMemory),
            maxTouchPoints: pick(parentA.maxTouchPoints, parentB.maxTouchPoints),
            webglProfileKey: pick(parentA.webglProfileKey, parentB.webglProfileKey),
            connectionType: pick(parentA.connectionType, parentB.connectionType),
            connectionDownlink: pick(parentA.connectionDownlink, parentB.connectionDownlink),
            connectionRtt: pick(parentA.connectionRtt, parentB.connectionRtt),
            screenDepth: pick(parentA.screenDepth, parentB.screenDepth),
            score: 0,
            domainScores: {},
            generations: Math.max(parentA.generations, parentB.generations) + 1,
            age: 0,
        };

        this.enforceConsistency(child);
        return child;
    }

    // ── Mutation ─────────────────────────────────────────────────────

    private mutate(gene: BrowserGene): BrowserGene {
        const r = () => Math.random() < this.mutationRate;

        if (r()) gene.uaIndex = this.weightedRandomUAIndex();
        if (r()) gene.localeIndex = Math.floor(Math.random() * LOCALE_CONFIGS.length);
        if (r()) gene.hardwareConcurrency = HARDWARE_CONCURRENCY[Math.floor(Math.random() * HARDWARE_CONCURRENCY.length)];
        if (r()) gene.deviceMemory = DEVICE_MEMORY[Math.floor(Math.random() * DEVICE_MEMORY.length)];
        if (r()) gene.screenDepth = SCREEN_DEPTHS[Math.floor(Math.random() * SCREEN_DEPTHS.length)];
        if (r()) {
            gene.connectionType = CONNECTION_TYPES[Math.floor(Math.random() * CONNECTION_TYPES.length)];
            const dlRange = CONNECTION_DOWNLINKS[gene.connectionType];
            const rttRange = CONNECTION_RTTS[gene.connectionType];
            gene.connectionDownlink = +(dlRange.min + Math.random() * (dlRange.max - dlRange.min)).toFixed(1);
            gene.connectionRtt = Math.round(rttRange.min + Math.random() * (rttRange.max - rttRange.min));
        }

        this.enforceConsistency(gene);
        return gene;
    }

    // ── Consistency enforcement ──────────────────────────────────────

    private enforceConsistency(gene: BrowserGene): void {
        const ua = UA_DATABASE[gene.uaIndex];
        if (!ua) {
            gene.uaIndex = 0;
            return this.enforceConsistency(gene);
        }

        // Viewport must match mobile flag
        const vp = VIEWPORT_PRESETS[gene.viewportIndex];
        if (!vp || vp.mobile !== ua.mobile) {
            const matching = VIEWPORT_PRESETS
                .map((v, i) => ({ ...v, i }))
                .filter(v => v.mobile === ua.mobile);
            gene.viewportIndex = matching[Math.floor(Math.random() * matching.length)].i;
        }

        // WebGL must match OS
        const [profileOs] = gene.webglProfileKey.split(':');
        if (profileOs !== ua.os) {
            const osProfiles = WEBGL_PROFILES[ua.os] || WEBGL_PROFILES.windows;
            const idx = Math.floor(Math.random() * osProfiles.length);
            gene.webglProfileKey = `${ua.os}:${idx}`;
        }

        // Touch points: 0 for desktop, 1-5 for mobile
        if (ua.mobile && gene.maxTouchPoints === 0) {
            gene.maxTouchPoints = Math.floor(Math.random() * 5) + 1;
        } else if (!ua.mobile) {
            gene.maxTouchPoints = 0;
        }

        // Device memory: mobile max 8GB
        if (ua.mobile && gene.deviceMemory > 8) {
            gene.deviceMemory = 8;
        }

        // Connection consistency
        const dlRange = CONNECTION_DOWNLINKS[gene.connectionType] || CONNECTION_DOWNLINKS['wifi'];
        if (gene.connectionDownlink < dlRange.min || gene.connectionDownlink > dlRange.max) {
            gene.connectionDownlink = +(dlRange.min + Math.random() * (dlRange.max - dlRange.min)).toFixed(1);
        }
    }

    // ── Crowding distance (NSGA-II style) ────────────────────────────

    private computeCrowdingDistance(): Map<string, number> {
        const distances = new Map<string, number>();
        this.population.forEach(g => distances.set(g.id, 0));

        // Trait dimensions to measure diversity
        const dimensions: Array<(g: BrowserGene) => number> = [
            g => g.uaIndex,
            g => g.viewportIndex,
            g => g.localeIndex,
            g => g.hardwareConcurrency,
            g => g.deviceMemory,
            g => g.connectionRtt,
            g => g.screenDepth,
        ];

        for (const dim of dimensions) {
            const sorted = [...this.population].sort((a, b) => dim(a) - dim(b));
            if (sorted.length < 3) continue;

            const range = dim(sorted[sorted.length - 1]) - dim(sorted[0]);
            if (range === 0) continue;

            // Boundary individuals get max distance
            distances.set(sorted[0].id, Infinity);
            distances.set(sorted[sorted.length - 1].id, Infinity);

            for (let i = 1; i < sorted.length - 1; i++) {
                const current = distances.get(sorted[i].id) || 0;
                if (current === Infinity) continue;
                const contribution = (dim(sorted[i + 1]) - dim(sorted[i - 1])) / range;
                distances.set(sorted[i].id, current + contribution);
            }
        }

        // Normalize: cap infinite distances
        const maxFinite = Math.max(1, ...[...distances.values()].filter(v => v !== Infinity));
        for (const [id, val] of distances) {
            if (val === Infinity) distances.set(id, maxFinite * 2);
        }

        return distances;
    }

    // ── Persistence ──────────────────────────────────────────────────

    private savePopulation(): void {
        try {
            const dir = path.dirname(PERSIST_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                version: POPULATION_VERSION,
                timestamp: Date.now(),
                mutationRate: this.mutationRate,
                recentResults: this.recentResults.slice(-50),
                population: this.population,
            };
            fs.writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2));
        } catch (e) {
            Logger.warn('[Genetic] Failed to persist population', { error: e as Error });
        }
    }

    private loadPopulation(): boolean {
        try {
            if (!fs.existsSync(PERSIST_PATH)) return false;
            const raw = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf-8'));
            if (raw.version !== POPULATION_VERSION) {
                Logger.info('[Genetic] Population version mismatch, reinitializing');
                return false;
            }
            this.population = raw.population;
            this.mutationRate = raw.mutationRate || 0.2;
            this.recentResults = raw.recentResults || [];

            // Validate all genes reference valid UA indexes
            const valid = this.population.every(g =>
                g.uaIndex >= 0 && g.uaIndex < UA_DATABASE.length &&
                g.viewportIndex >= 0 && g.viewportIndex < VIEWPORT_PRESETS.length
            );
            if (!valid) {
                Logger.warn('[Genetic] Persisted population has invalid indexes, reinitializing');
                return false;
            }

            Logger.info(`[Genetic] Loaded population of ${this.population.length} from disk (gen avg: ${this.avgGenerations()})`);
            return true;
        } catch (e) {
            Logger.warn('[Genetic] Failed to load population', { error: e as Error });
            return false;
        }
    }

    // ── Gene → Config converter ──────────────────────────────────────

    /**
     * Convert a BrowserGene into everything the browser factory needs
     */
    public geneToConfig(gene: BrowserGene): {
        userAgent: string;
        viewport: { width: number; height: number };
        locale: string;
        timezone: string;
        acceptLanguage: string;
        hardwareConcurrency: number;
        isMobile: boolean;
        evasionConfig: EvasionConfig;
        clientHintsHeaders: Record<string, string>;
    } {
        const ua = UA_DATABASE[gene.uaIndex];
        const vp = VIEWPORT_PRESETS[gene.viewportIndex];
        const loc = LOCALE_CONFIGS[gene.localeIndex];
        const clientHints = buildClientHints(ua);

        // Resolve WebGL profile
        const [profileOs, profileIdx] = gene.webglProfileKey.split(':');
        const profiles = WEBGL_PROFILES[profileOs] || WEBGL_PROFILES.windows;
        const webgl = profiles[parseInt(profileIdx)] || profiles[0];

        // Screen size: slightly larger than viewport to account for browser chrome
        const screenW = vp.mobile ? vp.width : Math.max(vp.width, 1920);
        const screenH = vp.mobile ? vp.height : Math.max(vp.height, 1080);

        const evasionConfig: EvasionConfig = {
            webglVendor: webgl.vendor,
            webglRenderer: webgl.renderer,
            timezone: loc.timezone,
            locale: loc.locale,
            clientHints,
            os: ua.os,
            browser: ua.browser,
            connectionType: gene.connectionType,
            connectionDownlink: gene.connectionDownlink,
            connectionRtt: gene.connectionRtt,
            screenWidth: screenW,
            screenHeight: screenH,
            screenDepth: gene.screenDepth,
            deviceMemory: gene.deviceMemory,
            maxTouchPoints: gene.maxTouchPoints,
        };

        // Client Hints HTTP headers
        const clientHintsHeaders: Record<string, string> = {
            'Sec-CH-UA': clientHints.secChUa,
            'Sec-CH-UA-Platform': clientHints.secChUaPlatform,
            'Sec-CH-UA-Mobile': clientHints.secChUaMobile,
        };

        return {
            userAgent: ua.userAgent,
            viewport: { width: vp.width, height: vp.height },
            locale: loc.locale,
            timezone: loc.timezone,
            acceptLanguage: loc.acceptLanguage,
            hardwareConcurrency: gene.hardwareConcurrency,
            isMobile: ua.mobile,
            evasionConfig,
            clientHintsHeaders,
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private weightedRandomUAIndex(): number {
        const totalWeight = UA_DATABASE.reduce((sum, e) => sum + e.weight, 0);
        let random = Math.random() * totalWeight;
        for (let i = 0; i < UA_DATABASE.length; i++) {
            random -= UA_DATABASE[i].weight;
            if (random <= 0) return i;
        }
        return 0;
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 10);
    }

    private avgGenerations(): string {
        if (this.population.length === 0) return '0';
        return (this.population.reduce((s, g) => s + g.generations, 0) / this.population.length).toFixed(1);
    }

    // ── Stats (for monitoring) ───────────────────────────────────────

    public getStats(): {
        populationSize: number;
        avgScore: number;
        bestScore: number;
        successRate: number;
        mutationRate: number;
        avgGeneration: number;
    } {
        const scores = this.population.map(g => g.score);
        return {
            populationSize: this.population.length,
            avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            bestScore: Math.max(...scores),
            successRate: this.getSuccessRate(),
            mutationRate: this.mutationRate,
            avgGeneration: this.population.reduce((s, g) => s + g.generations, 0) / this.population.length,
        };
    }
}
