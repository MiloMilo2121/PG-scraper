import { MemoryFirstCache } from './MemoryFirstCache';

export interface RunnerUpCandidate {
    url: string;
    score: number;
    source: string;
    title: string;
    description: string;
    timestamp: string;
}

export class EnrichmentBuffer {
    private cache: MemoryFirstCache;

    constructor(cache: MemoryFirstCache) {
        this.cache = cache;
    }

    public async saveRunnerUps(companyId: string, candidates: RunnerUpCandidate[]): Promise<void> {
        if (!candidates || candidates.length === 0) return;

        // Use setRedisOnly if L2 is healthy, else wait for l1 fallback in `set`
        try {
            // Retrieve existing
            const existingOpt = await this.cache.get<RunnerUpCandidate[]>('omega:runnerups', companyId);
            let existing: RunnerUpCandidate[] = [];
            if (existingOpt.level !== 'MISS' && existingOpt.value) {
                existing = existingOpt.value;
            }

            // Merge and deduplicate by URL
            const merged = [...existing, ...candidates];
            const uniqueMap = new Map<string, RunnerUpCandidate>();

            for (const cand of merged) {
                if (!uniqueMap.has(cand.url) || cand.score > uniqueMap.get(cand.url)!.score) {
                    uniqueMap.set(cand.url, cand);
                }
            }

            // Keep top 10
            const finalCandidates = Array.from(uniqueMap.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

            // Save to both L1/L2
            await this.cache.set('omega:runnerups', companyId, finalCandidates, 86400 * 30 /* 30 days */);

        } catch (err) {
            console.error(`[EnrichmentBuffer] Failed to save runner-ups for ${companyId}`, err);
        }
    }

    public async getBuffer(companyId: string): Promise<RunnerUpCandidate[]> {
        const result = await this.cache.get<RunnerUpCandidate[]>('omega:runnerups', companyId);
        if (result.level !== 'MISS' && result.value) {
            return result.value;
        }
        return [];
    }

    public async extractLinkedInFromBuffer(companyId: string): Promise<string | null> {
        const buffer = await this.getBuffer(companyId);
        const liCandidate = buffer.find(c => c.url.includes('linkedin.com/'));
        return liCandidate ? liCandidate.url : null;
    }

    public async extractBilancioFromBuffer(companyId: string): Promise<string | null> {
        const buffer = await this.getBuffer(companyId);
        const bilCandidate = buffer.find(c => c.url.endsWith('.pdf'));
        if (bilCandidate) {
            const textContent = (bilCandidate.title + ' ' + bilCandidate.description).toLowerCase();
            if (textContent.includes('bilancio') || textContent.includes('stato patrimoniale')) {
                return bilCandidate.url;
            }
        }
        return null;
    }
}
