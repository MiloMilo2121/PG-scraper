import * as fs from 'fs';
import * as path from 'path';

export interface LedgerEntry {
    timestamp: string;
    module: string;
    provider: string;
    tier: number;
    task_type: string;
    cost_eur: number;
    tokens_used?: number;
    cache_hit: boolean;
    cache_level: 'L1' | 'L2' | 'MISS';
    duration_ms: number;
    success: boolean;
    error?: string;
    company_id?: string;
}

export interface HealthSnapshot {
    window_seconds: number;
    total_calls: number;
    error_rate: number;
    avg_duration_ms: number;
    p95_duration_ms: number;
    cost_eur: number;
    cache_hit_rate: number;
    providers_unhealthy: string[];
    backpressure_recommended: boolean;
}

export interface LedgerSummary {
    total_cost_eur: number;
    total_calls: number;
    success_rate: number;
}

export class CostLedger {
    private ringBuffer: LedgerEntry[] = [];
    private readonly MAX_BUFFER_SIZE = 1000;
    private logFilePath: string;
    private pendingWrites: LedgerEntry[] = [];
    private writeInterval: NodeJS.Timeout;

    constructor(logDirectory: string = process.cwd()) {
        this.logFilePath = path.join(logDirectory, 'cost_ledger.jsonl');
        // Batch flush every 5 seconds
        this.writeInterval = setInterval(() => this.flush(), 5000);
    }

    public async log(entry: LedgerEntry): Promise<void> {
        // Add to ring buffer
        this.ringBuffer.push(entry);
        if (this.ringBuffer.length > this.MAX_BUFFER_SIZE) {
            this.ringBuffer.shift(); // Remove oldest
        }

        // Add to file queue
        this.pendingWrites.push(entry);
        if (this.pendingWrites.length >= 50) {
            this.flush();
        }
    }

    private flush() {
        if (this.pendingWrites.length === 0) return;
        const data = this.pendingWrites.map(e => JSON.stringify(e)).join('\n') + '\n';
        this.pendingWrites = [];
        fs.appendFile(this.logFilePath, data, (err) => {
            if (err) console.error('[CostLedger] Failed to flush to disk', err);
        });
    }

    public async getSummary(since?: Date): Promise<LedgerSummary> {
        let totalCost = 0;
        let totalCalls = 0;
        let successCount = 0;

        for (const entry of this.ringBuffer) {
            if (since && new Date(entry.timestamp) < since) continue;
            totalCalls++;
            totalCost += entry.cost_eur;
            if (entry.success) successCount++;
        }

        return {
            total_cost_eur: totalCost,
            total_calls: totalCalls,
            success_rate: totalCalls > 0 ? successCount / totalCalls : 1
        };
    }

    public async getRecentEntries(n: number): Promise<LedgerEntry[]> {
        return this.ringBuffer.slice(-n);
    }

    public async getCostPerCompany(totalCompanies: number): Promise<number> {
        if (totalCompanies === 0) return 0;
        const summary = await this.getSummary();
        return summary.total_cost_eur / totalCompanies;
    }

    public getHealthSnapshot(windowSeconds: number = 30): HealthSnapshot {
        const now = Date.now();
        const cutoff = now - (windowSeconds * 1000);

        const recentEntries = this.ringBuffer.filter(e => new Date(e.timestamp).getTime() > cutoff);

        if (recentEntries.length === 0) {
            return {
                window_seconds: windowSeconds,
                total_calls: 0,
                error_rate: 0,
                avg_duration_ms: 0,
                p95_duration_ms: 0,
                cost_eur: 0,
                cache_hit_rate: 0,
                providers_unhealthy: [],
                backpressure_recommended: false
            };
        }

        let errors = 0;
        let totalDuration = 0;
        let cost = 0;
        let cacheHits = 0;
        const durations: number[] = [];
        const providerErrors: Record<string, { total: number, errors: number }> = {};

        for (const entry of recentEntries) {
            totalDuration += entry.duration_ms;
            durations.push(entry.duration_ms);
            cost += entry.cost_eur;
            if (!entry.success) errors++;
            if (entry.cache_hit) cacheHits++;

            if (!providerErrors[entry.provider]) {
                providerErrors[entry.provider] = { total: 0, errors: 0 };
            }
            providerErrors[entry.provider].total++;
            if (!entry.success) {
                providerErrors[entry.provider].errors++;
            }
        }

        durations.sort((a, b) => a - b);
        const p95Index = Math.floor(durations.length * 0.95);
        const p95 = durations[p95Index] || 0;
        const errorRate = errors / recentEntries.length;

        const unhealthyProviders = Object.entries(providerErrors)
            .filter(([_, stats]) => stats.total >= 5 && (stats.errors / stats.total) > 0.3)
            .map(([provider, _]) => provider);

        return {
            window_seconds: windowSeconds,
            total_calls: recentEntries.length,
            error_rate: errorRate,
            avg_duration_ms: totalDuration / recentEntries.length,
            p95_duration_ms: p95,
            cost_eur: cost,
            cache_hit_rate: cacheHits / recentEntries.length,
            providers_unhealthy: unhealthyProviders,
            backpressure_recommended: errorRate > 0.2 || (totalDuration / recentEntries.length) > 5000
        };
    }

    public getProviderHealth(provider: string): { error_rate: number; avg_ms: number } {
        const entries = this.ringBuffer.filter(e => e.provider === provider);
        if (entries.length === 0) return { error_rate: 0, avg_ms: 0 };

        let errors = 0;
        let totalDuration = 0;
        for (const e of entries) {
            if (!e.success) errors++;
            totalDuration += e.duration_ms;
        }

        return {
            error_rate: errors / entries.length,
            avg_ms: totalDuration / entries.length
        };
    }

    public cleanup() {
        clearInterval(this.writeInterval);
        this.flush();
    }
}
