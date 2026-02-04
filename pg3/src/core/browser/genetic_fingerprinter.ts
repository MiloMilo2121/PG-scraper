
import { Logger } from '../../utils/logger';

interface BrowserGene {
    id: string;
    userAgent: string;
    viewport: { width: number; height: number };
    locale: string;
    hardwareConcurrency: number;
    score: number; // Fitness score (Successes - Failures)
    generations: number;
}

const BASE_USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 2560, height: 1440 }
];

export class GeneticFingerprinter {
    private static instance: GeneticFingerprinter;
    private population: BrowserGene[] = [];
    private operationsCount = 0;
    private readonly EVOLUTION_INTERVAL = 50; // Evolve every 50 requests

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
        // Create initial population
        for (let i = 0; i < 20; i++) {
            this.population.push(this.createRandomGene());
        }
        Logger.info(`[Genetic] Initialized population of ${this.population.length} fingerprints.`);
    }

    private createRandomGene(): BrowserGene {
        return {
            id: Math.random().toString(36).substring(7),
            userAgent: BASE_USER_AGENTS[Math.floor(Math.random() * BASE_USER_AGENTS.length)],
            viewport: VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)],
            locale: Math.random() > 0.8 ? 'en-US' : 'it-IT', // 80% Italian preference
            hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
            score: 0,
            generations: 0
        };
    }

    public getBestGene(): BrowserGene {
        // Epsilon-greedy strategy: 
        // 10% Exploration (Random Gene)
        // 90% Exploitation (Best Gene)
        if (Math.random() < 0.1) {
            return this.population[Math.floor(Math.random() * this.population.length)];
        }

        // Sort by score descending and pick top 1 (or top 3 weighted)
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
            this.evolve();
            this.operationsCount = 0;
        }
    }

    private evolve() {
        Logger.info('[Genetic] 🧬 EVOLUTION EVENT TRIGGERED 🧬');

        // 1. Sort by fitness
        const sorted = [...this.population].sort((a, b) => b.score - a.score);

        // 2. Kill the weak (Bottom 30%)
        const survivors = sorted.slice(0, Math.floor(this.population.length * 0.7));

        // 3. Breed (Crossover)
        // Take logic: Combine UA of Parent A with Viewport of Parent B? 
        // Or simpler: Clone best performers and mutate slightly
        const children: BrowserGene[] = [];
        const breedingSlots = this.population.length - survivors.length;

        for (let i = 0; i < breedingSlots; i++) {
            const parent = survivors[i % survivors.length]; // Cycle through top survivors
            const child = { ...parent };
            child.id = Math.random().toString(36).substring(7);
            child.generations++;
            child.score = 0; // Reset score for new generation

            // Mutation: 20% chance to change a trait
            if (Math.random() < 0.2) child.userAgent = BASE_USER_AGENTS[Math.floor(Math.random() * BASE_USER_AGENTS.length)];
            if (Math.random() < 0.2) child.viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

            children.push(child);
        }

        this.population = [...survivors, ...children];
        Logger.info(`[Genetic] Evolution complete. Best gene score: ${survivors[0].score}`);
    }
}
