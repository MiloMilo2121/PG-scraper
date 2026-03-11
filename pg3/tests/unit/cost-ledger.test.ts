import { afterEach, describe, expect, it } from 'vitest';
import { CostLedger } from '../../src/foundation/CostLedger';

describe('CostLedger punitive snapshots', () => {
    let ledger: CostLedger | null = null;

    afterEach(() => {
        ledger?.cleanup();
        ledger = null;
    });

    it('excludes non-punitive browser pool errors from punitive health snapshots', async () => {
        ledger = new CostLedger({ persistToDisk: false });

        await ledger.log({
            timestamp: new Date().toISOString(),
            module: 'BrowserPool',
            provider: 'playwright',
            tier: 2,
            task_type: 'PROXY_FETCH',
            cost_eur: 0,
            cache_hit: false,
            cache_level: 'MISS',
            duration_ms: 1000,
            success: false,
            error: 'CF_CHALLENGE',
            error_class: 'browser_pool',
            punitive: false,
        });

        await ledger.log({
            timestamp: new Date().toISOString(),
            module: 'CostRouter',
            provider: 'SERPER-1',
            tier: 0,
            task_type: 'SERP',
            cost_eur: 0.001,
            cache_hit: false,
            cache_level: 'MISS',
            duration_ms: 300,
            success: false,
            error: '429',
            error_class: 'provider_rate_limit',
            punitive: true,
        });

        const punitive = ledger.getHealthSnapshot(300, { punitiveOnly: true });
        expect(punitive.total_calls).toBe(1);
        expect(punitive.error_rate).toBe(1);

        const full = ledger.getHealthSnapshot(300);
        expect(full.total_calls).toBe(2);
        expect(full.error_rate).toBe(1);
    });
});
