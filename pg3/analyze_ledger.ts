import * as fs from 'fs';
import * as path from 'path';

const logPath = path.join(__dirname, 'cost_ledger_test10.jsonl');
const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim().length > 0);

const entries = lines.map(l => JSON.parse(l));

// Get the last 5 minutes of executions (our test run)
const lastTimestampStr = entries[entries.length - 1].timestamp;
const lastTimestamp = new Date(lastTimestampStr).getTime();
const testEntries = entries.filter(e => new Date(e.timestamp).getTime() > lastTimestamp - (5 * 60 * 1000));

let totalCost = 0;
let totalDuration = 0;
let errors = 0;
let hits = 0;
let browserSpawns = 0;
const providerStats: Record<string, { calls: number, cost: number, errors: number, avgMs: number }> = {};

for (const e of testEntries) {
    totalCost += e.cost_eur || 0;
    totalDuration += e.duration_ms || 0;
    if (!e.success) errors++;
    if (e.cache_hit) hits++;

    if (e.provider === 'puppeteer') browserSpawns++;

    if (!providerStats[e.provider]) {
        providerStats[e.provider] = { calls: 0, cost: 0, errors: 0, avgMs: 0 };
    }
    const stat = providerStats[e.provider];
    stat.calls++;
    stat.cost += (e.cost_eur || 0);
    if (!e.success) stat.errors++;
    stat.avgMs += e.duration_ms || 0;
}

for (const p in providerStats) {
    providerStats[p].avgMs = providerStats[p].avgMs / providerStats[p].calls;
}

console.log(JSON.stringify({
    total_calls: testEntries.length,
    total_cost: totalCost,
    cache_hits: hits,
    error_rate: (errors / testEntries.length) * 100,
    browser_blocks: browserSpawns,
    avg_duration_all_ms: totalDuration / testEntries.length,
    providers: providerStats
}, null, 2));
