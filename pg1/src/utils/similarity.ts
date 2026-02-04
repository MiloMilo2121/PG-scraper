export class StringUtils {

    static jaccardIndex(s1: string, s2: string): number {
        const set1 = new Set(this.tokenize(s1));
        const set2 = new Set(this.tokenize(s2));

        if (set1.size === 0 && set2.size === 0) return 1;
        if (set1.size === 0 || set2.size === 0) return 0;

        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }

    static tokenOverlap(tokens1: string[], text: string): number {
        if (tokens1.length === 0) return 0;
        const textTokens = new Set(this.tokenize(text));
        let hits = 0;
        for (const t of tokens1) {
            if (textTokens.has(t)) hits++;
        }
        return hits / tokens1.length;
    }

    private static tokenize(text: string): string[] {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(t => t.length > 2); // Filter short words
    }
}
