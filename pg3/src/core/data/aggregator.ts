
export class Aggregator {
    public static merge(results: any[]): any[] {
        const merged = new Map();
        for (const res of results) {
            const key = res.company_name; // Simple key
            if (!merged.has(key)) {
                merged.set(key, res);
            } else {
                // deep merge properties
                merged.set(key, { ...merged.get(key), ...res });
            }
        }
        return Array.from(merged.values());
    }
}
