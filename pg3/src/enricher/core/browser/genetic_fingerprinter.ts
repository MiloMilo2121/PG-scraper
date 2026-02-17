import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';

// Mocking external dependencies for self-containment if files are missing, 
// OR importing them if they exist. Assuming they are in local files based on context.
// Ideally these should be imported from a central config or constants file.

interface Fingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
    platform: string;
    locale: string;
    timezone: string;
    acceptLanguage: string;
    hardwareConcurrency: number;
    isMobile: boolean;
    evasionConfig: any;
    clientHintsHeaders: any;
}

interface UAData {
    ua: string;
    platform: string;
    mobile: boolean;
    weight: number;
}

const UA_DATABASE: UAData[] = [
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', platform: 'mac', mobile: false, weight: 10 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', platform: 'win', mobile: false, weight: 10 },
    { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', platform: 'linux', mobile: false, weight: 5 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15', platform: 'mac', mobile: false, weight: 8 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0', platform: 'win', mobile: false, weight: 7 }
];

interface BrowserGene {
    id: string;
    userAgent: string;
    viewport: { width: number; height: number };
    locale: string;
    hardwareConcurrency: number;
    deviceMemory?: number; // RAM in GB (e.g. 4, 8, 16)
    score: number; // Fitness score (Successes - Failures)
    generations: number;
    uaIndex?: number;
}

const BASE_USER_AGENTS = UA_DATABASE.map(u => u.ua);

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 2560, height: 1440 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 } // Mobile
];

export class GeneticFingerprinter {
    private static instance: GeneticFingerprinter;
    private population: BrowserGene[] = [];
    private currentFingerprint: Fingerprint | null = null;
    private operationsCount = 0;
    private readonly EVOLUTION_INTERVAL = 50; // Evolve every 50 requests
    private readonly STORAGE_PATH = path.join(process.cwd(), 'data', 'genetic_population.json');

    private constructor() {
        this.loadPopulation();
        if (this.population.length === 0) {
            this.initializePopulation();
        }
    }

    public static getInstance(): GeneticFingerprinter {
        if (!GeneticFingerprinter.instance) {
            GeneticFingerprinter.instance = new GeneticFingerprinter();
        }
        return GeneticFingerprinter.instance;
    }

    private initializePopulation() {
        // Create initial population
        for (let i = 0; i < 20; i++) {
            this.population.push(this.createRandomGene());
        }
        Logger.info(`[Genetic] Initialized population of ${this.population.length} fingerprints.`);
        this.savePopulation();
    }

    private createRandomGene(): BrowserGene {
        const uaIdx = Math.floor(Math.random() * BASE_USER_AGENTS.length);
        return {
            id: Math.random().toString(36).substring(7),
            userAgent: BASE_USER_AGENTS[uaIdx],
            viewport: VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)],
            locale: Math.random() > 0.8 ? 'en-US' : 'it-IT',
            hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
            deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
            score: 0,
            generations: 0,
            uaIndex: uaIdx
        };
    }

    public getBestGene(): BrowserGene {
        // Epsilon-greedy strategy: 
        // 10% Exploration (Random Gene)
        // 90% Exploitation (Best Gene)
        if (Math.random() < 0.1) {
            return this.population[Math.floor(Math.random() * this.population.length)];
        }

        // Sort by score descending and pick top 1
        const sorted = [...this.population].sort((a, b) => b.score - a.score);
        return sorted[0];
    }

    public reportSuccess(geneId: string) {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score += 2; // Reward
            this.checkEvolution();
        }
    }

    public reportFailure(geneId: string) {
        const gene = this.population.find(g => g.id === geneId);
        if (gene) {
            gene.score -= 5; // Heavy Penalty for blocks
            this.checkEvolution();
        }
    }

    private checkEvolution() {
        this.operationsCount++;
        if (this.operationsCount >= this.EVOLUTION_INTERVAL) {
            this.performEvolutionCycle(); // Call the new evolution cycle
            this.operationsCount = 0;
            this.savePopulation();
        }
    }

    // ── Evolution Logic ───────────────────────────────────────────────

    public evolve(previousSuccess?: boolean): Fingerprint {
        // If successful, strengthen the current traits in the population
        if (previousSuccess && this.currentFingerprint) {
            // Find similar gene and boost
            const gene = this.population.find(g =>
                g.uaIndex === UA_DATABASE.findIndex(u => u.ua === this.currentFingerprint?.userAgent)
            );
            if (gene) {
                gene.score += 10;
                gene.generations++;
            }
        }

        // Selection: weighted random based on score
        const uaIndex = this.weightedRandomUAIndex();
        const gene = this.population[uaIndex] || this.population[0];

        // Mutation
        if (Math.random() < 0.2) { // Mutation rate logic
            // Mutate hardware concurrency or other traits
            gene.hardwareConcurrency = Math.random() > 0.5 ? 4 : 8;
        }

        // Use UA from gene or fallback
        const ua = UA_DATABASE[uaIndex] || UA_DATABASE[0];

        // Generate valid fingerprint components
        const loc = this.getLocaleForUA(ua.ua);
        const evasionConfig = this.getEvasionConfig(ua.ua);
        const clientHintsHeaders = this.generateClientHints(ua);

        this.currentFingerprint = {
            userAgent: ua.ua,
            viewport: this.getRandomViewport(ua.mobile),
            platform: ua.platform,
            locale: loc.locale,
            timezone: loc.timezone,
            acceptLanguage: loc.acceptLanguage,
            hardwareConcurrency: gene.hardwareConcurrency,
            isMobile: ua.mobile,
            evasionConfig,
            clientHintsHeaders,
        };

        return this.currentFingerprint;
    }

    private performEvolutionCycle() {
        Logger.info('[Genetic] 🧬 EVOLUTION EVENT TRIGGERED 🧬');

        // 1. Sort by fitness
        const sorted = [...this.population].sort((a, b) => b.score - a.score);

        // 2. Kill the weak (Bottom 30%)
        const survivors = sorted.slice(0, Math.floor(this.population.length * 0.7));

        // 3. Breed (Crossover & Mutation)
        const children: BrowserGene[] = [];
        const breedingSlots = this.population.length - survivors.length;

        for (let i = 0; i < breedingSlots; i++) {
            const parentA = survivors[i % survivors.length];
            // Randomly pair with another strong survivor
            const parentB = survivors[Math.floor(Math.random() * survivors.length)];

            const child = { ...parentA }; // Clone Parent A basic stats
            child.id = Math.random().toString(36).substring(7);
            child.generations++;
            child.score = 0; // Reset score

            // Crossover: Take Viewport from Parent B?
            if (Math.random() > 0.5) child.viewport = parentB.viewport;

            // Mutation: 20% chance to change a trait randomly
            if (Math.random() < 0.2) child.userAgent = BASE_USER_AGENTS[Math.floor(Math.random() * BASE_USER_AGENTS.length)];
            if (Math.random() < 0.2) child.viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

            children.push(child);
        }

        this.population = [...survivors, ...children];
        Logger.info(`[Genetic] Evolution complete. Best gene score: ${survivors[0].score}`);
    }

    private savePopulation() {
        try {
            const dir = path.dirname(this.STORAGE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.STORAGE_PATH, JSON.stringify(this.population, null, 2));
        } catch (e) {
            Logger.warn('[Genetic] Failed to save population', { error: e as Error });
        }
    }

    private loadPopulation() {
        try {
            if (fs.existsSync(this.STORAGE_PATH)) {
                const data = fs.readFileSync(this.STORAGE_PATH, 'utf-8');
                this.population = JSON.parse(data);
                Logger.info(`[Genetic] Loaded ${this.population.length} genes from storage.`);
            }
        } catch (e) {
            Logger.warn('[Genetic] Failed to load population, starting fresh', { error: e as Error });
        }
    }

    // ── Compatibility Helpers ─────────────────────────────────────────

    public geneToConfig(gene: BrowserGene): any {
        const ua = UA_DATABASE.find(u => u.ua === gene.userAgent) || UA_DATABASE[0];
        return {
            userAgent: gene.userAgent,
            viewport: gene.viewport,
            locale: gene.locale,
            timezone: 'Europe/Rome', // Simplified for now
            args: [
                `--user-agent=${gene.userAgent}`,
                `--window-size=${gene.viewport.width},${gene.viewport.height}`,
                `--lang=${gene.locale}`,
            ]
        };
    }

    // ── Helper Implementations ────────────────────────────────────────

    private weightedRandomUAIndex(): number {
        const totalWeight = this.population.reduce((sum, e) => sum + e.score, 0);
        if (totalWeight <= 0) return Math.floor(Math.random() * this.population.length);

        let random = Math.random() * totalWeight;
        for (let i = 0; i < this.population.length; i++) {
            random -= this.population[i].score;
            if (random <= 0) return i;
        }
        return 0; // Fallback in case of floating point inaccuracies or all scores are 0
    }

    private getLocaleForUA(ua: string): { locale: string; timezone: string; acceptLanguage: string } {
        // Simplified for example, could be more complex based on UA or other factors
        if (ua.includes('Macintosh') || ua.includes('iPad') || ua.includes('iPhone')) {
            return { locale: 'it-IT', timezone: 'Europe/Rome', acceptLanguage: 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7' };
        }
        return { locale: 'it-IT', timezone: 'Europe/Rome', acceptLanguage: 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7' };
    }

    private getEvasionConfig(ua: string): any {
        // Example evasion config, could be dynamic based on UA or platform
        return {
            windowChrome: true,
            navigatorPermissions: true,
            navigatorPlugins: true,
            webglVendor: true,
        };
    }

    private generateClientHints(ua: UAData): any {
        // Example client hints based on UAData
        return {
            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'sec-ch-ua-mobile': ua.mobile ? '?1' : '?0',
            'sec-ch-ua-platform': `"${ua.platform === 'win' ? 'Windows' : ua.platform === 'mac' ? 'macOS' : 'Linux'}"`,
        };
    }

    private getRandomViewport(isMobile: boolean): { width: number; height: number } {
        if (isMobile) return { width: 390, height: 844 }; // Specific mobile viewport
        // Filter out mobile viewports for desktop
        const desktopViewports = VIEWPORTS.filter(v => v.width > 500);
        return desktopViewports[Math.floor(Math.random() * desktopViewports.length)];
    }
}
