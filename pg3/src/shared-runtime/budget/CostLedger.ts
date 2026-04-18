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
    error_class?: 'provider_auth' | 'provider_rate_limit' | 'provider_overloaded' | 'provider_block' | 'semantic_empty' | 'transport' | 'browser_pool' | 'unknown';
    punitive?: boolean;
    company_id?: string;
    waf_family?: 'cloudflare' | 'datadome' | 'generic_waf';
    challenge_type?: string;
    session_lane_id?: string;
    cookie_reuse_hit?: boolean;
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

export interface HealthSnapshotOptions {
    punitiveOnly?: boolean;
    excludeModules?: string[];
}

export interface CostLedgerOptions {
    directory?: string;
    filePath?: string;
    flushIntervalMs?: number;
    persistToDisk?: boolean;
}

export class CostLedger {
    private ringBuffer: LedgerEntry[] = [];
    private readonly MAX_BUFFER_SIZE = 1000;
    private logFilePath: string | null;
    private pendingWrites: LedgerEntry[] = [];
    private writeInterval: NodeJS.Timeout | null = null;
    private readonly persistToDisk: boolean;

    constructor(logDirectoryOrOptions: string | CostLedgerOptions = {}) {
        const options: CostLedgerOptions = typeof logDirectoryOrOptions === 'string'
            ? { directory: logDirectoryOrOptions }
            : logDirectoryOrOptions;

        this.persistToDisk = options.persistToDisk !== false;
        const directory = options.directory || path.join(process.cwd(), 'data');
        this.logFilePath = this.persistToDisk
            ? (options.filePath || path.join(directory, 'cost_ledger.jsonl'))
            : null;

        if (this.logFilePath) {
            fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
            this.writeInterval = setInterval(() => this.flush(), options.flushIntervalMs || 5000);
            this.writeInterval.unref?.();
        }
    }

    public async log(entry: LedgerEntry): Promise<void> {
        const normalized: LedgerEntry = {
            ...entry,
            punitive: entry.punitive ?? !entry.success,
        };

        // Add to ring buffer
        this.ringBuffer.push(normalized);
        if (this.ringBuffer.length > this.MAX_BUFFER_SIZE) {
            this.ringBuffer.shift(); // Remove oldest
        }

        if (this.persistToDisk) {
            this.pendingWrites.push(normalized);
            if (this.pendingWrites.length >= 50) {
                this.flush();
            }
        }
    }

    private flush() {
        if (!this.logFilePath || this.pendingWrites.length === 0) return;
        const data = this.pendingWrites.map(e => JSON.stringify(e)).join('\n') + '\n';
        this.pendingWrites = [];
        try {
            fs.appendFileSync(this.logFilePath, data, 'utf8');
        } catch (err) {
            console.error('[CostLedger] Failed to flush to disk', err);
        }
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

    public getHealthSnapshot(windowSeconds: number = 30, options: HealthSnapshotOptions = {}): HealthSnapshot {
        const now = Date.now();
        const cutoff = now - (windowSeconds * 1000);

        const recentEntries = this.ringBuffer
            .filter((e) => new Date(e.timestamp).getTime() > cutoff)
            .filter((e) => !(options.excludeModules || []).includes(e.module));
        const snapshotEntries = options.punitiveOnly
            ? recentEntries.filter((e) => e.punitive !== false)
            : recentEntries;

        if (snapshotEntries.length === 0) {
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

        for (const entry of snapshotEntries) {
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
        const errorRate = errors / snapshotEntries.length;

        const unhealthyProviders = Object.entries(providerErrors)
            .filter(([_, stats]) => stats.total >= 5 && (stats.errors / stats.total) > 0.3)
            .map(([provider, _]) => provider);

        return {
            window_seconds: windowSeconds,
            total_calls: snapshotEntries.length,
            error_rate: errorRate,
            avg_duration_ms: totalDuration / snapshotEntries.length,
            p95_duration_ms: p95,
            cost_eur: cost,
            cache_hit_rate: cacheHits / snapshotEntries.length,
            providers_unhealthy: unhealthyProviders,
            backpressure_recommended: errorRate > 0.4 || (totalDuration / snapshotEntries.length) > 5000
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
        if (this.writeInterval) {
            clearInterval(this.writeInterval);
            this.writeInterval = null;
        }
        this.flush();
    }
}
