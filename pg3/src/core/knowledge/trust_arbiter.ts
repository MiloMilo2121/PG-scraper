
export enum DataSource {
    WEBSITE_DIRECT = 'WEBSITE_DIRECT',
    PAGINEGIALLE = 'PAGINEGIALLE',
    GOOGLE_MAPS = 'GOOGLE_MAPS',
    GENERIC_SERP = 'GENERIC_SERP',
    LLM_INFERENCE = 'LLM_INFERENCE'
}

export interface DataPoint<T> {
    value: T;
    source: DataSource;
    timestamp: number;
    confidence?: number;
}

export class TrustArbiter {
    private static instance: TrustArbiter;

    // Weights: Higher is more trusted
    private readonly TRUST_SCORES: Record<DataSource, number> = {
        [DataSource.WEBSITE_DIRECT]: 0.95,
        [DataSource.PAGINEGIALLE]: 0.85,
        [DataSource.GOOGLE_MAPS]: 0.80,
        [DataSource.GENERIC_SERP]: 0.50,
        [DataSource.LLM_INFERENCE]: 0.40
    };

    private constructor() { }

    public static getInstance(): TrustArbiter {
        if (!TrustArbiter.instance) {
            TrustArbiter.instance = new TrustArbiter();
        }
        return TrustArbiter.instance;
    }

    /**
     * Resolves a conflict by choosing the value with the highest weighted score.
     * Considers: Source Trust + Recency + Confidence
     */
    public resolve<T>(candidates: DataPoint<T>[]): T | null {
        if (!candidates || candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0].value;

        let bestCandidate = candidates[0];
        let maxScore = -1;

        // Group by normalized value to handle voting (e.g. "VIA ROMA" vs "Via Roma")
        const votes = new Map<string, number>();
        const valueMap = new Map<string, T>();

        for (const candidate of candidates) {
            // Normalize for grouping (simplistic string check)
            const key = String(candidate.value).trim().toLowerCase()
                .replace(/\s+/g, ' ') // normalize spaces
                .replace(/[,.]/g, ''); // remove punctuation

            valueMap.set(key, candidate.value);

            // Calculate Score
            const baseTrust = this.TRUST_SCORES[candidate.source] || 0.5;

            // Recency Decay: Lose 5% trust per year (approx formula)
            // Just a placeholder heuristic: younger logic wins
            const ageInDay = (Date.now() - candidate.timestamp) / (1000 * 60 * 60 * 24);
            const recencyFactor = Math.max(0.8, 1 - (ageInDay * 0.0001));

            const finalScore = baseTrust * recencyFactor * (candidate.confidence || 1);

            const currentVote = votes.get(key) || 0;
            votes.set(key, currentVote + finalScore);
        }

        // Find winner
        let winningKey = '';
        let highestTotalScore = -1;

        votes.forEach((score, key) => {
            if (score > highestTotalScore) {
                highestTotalScore = score;
                winningKey = key;
            }
        });

        return valueMap.get(winningKey) || null;
    }
}
