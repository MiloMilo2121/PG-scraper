require('dotenv').config();

import { MasterPipeline } from './MasterPipeline';
import { InputNormalizer } from './InputNormalizer';
import { ShadowRegistry } from './ShadowRegistry';
import { PreVerifyGate } from './PreVerifyGate';
import { SerpDeduplicator } from './SerpDeduplicator';
import { LLMOracleGuard } from './LLMOracleGuard';
import { StopTheBleedingController } from './StopTheBleedingController';
import { BackpressureValve } from './BackpressureValve';
import { BilancioHunter } from './BilancioHunter';
import { LinkedInSniper } from './LinkedInSniper';
import { BrowserPool } from './BrowserPool';
import { MemoryFirstCache } from './MemoryFirstCache';
import { CostLedger } from './CostLedger';
import { CostRouter } from './CostRouter';
import { EnrichmentBuffer } from './EnrichmentBuffer';
import { QuerySanitizer } from './QuerySanitizer';
import { EnrichmentPostProcessor } from './EnrichmentPostProcessor';
import { PecHunter } from './PecHunter';
import { config } from '../enricher/config';
import { buildProviderMap } from './provider_catalog';

export interface OmegaRuntime {
    ledger: CostLedger;
    cache: MemoryFirstCache;
    valve: BackpressureValve;
    pool: BrowserPool;
    registry: ShadowRegistry;
    router: CostRouter;
    pipeline: MasterPipeline;
    cleanup(): Promise<void>;
}

export async function createOmegaRuntime(): Promise<OmegaRuntime> {
    const ledger = new CostLedger({ filePath: config.runtime.costLedgerPath });
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
    const valve = new BackpressureValve({ ledger });
    const pool = new BrowserPool({
        ledger,
        sessionStateDir: config.runtime.browserSessionDir,
    });
    const registry = new ShadowRegistry('omega_shadow.sqlite');
    const router = new CostRouter(cache, ledger, buildProviderMap());
    const gate = new PreVerifyGate(cache, ledger);
    const buffer = new EnrichmentBuffer(cache);
    const dedup = new SerpDeduplicator(router, new QuerySanitizer(), buffer);
    const oracleGuard = new LLMOracleGuard(cache, valve);
    const bleedingCtrl = new StopTheBleedingController(ledger, valve, pool);
    const pipeline = new MasterPipeline({
        normalizer: new InputNormalizer(),
        registry,
        gate,
        dedup,
        oracleGuard,
        bleedingCtrl,
        valve,
        bilancioHunter: new BilancioHunter(dedup),
        linkedinSniper: new LinkedInSniper(dedup, valve),
        browserPool: pool,
        costRouter: router,
        postProcessor: new EnrichmentPostProcessor(pool),
        pecHunter: new PecHunter(pool),
    });

    return {
        ledger,
        cache,
        valve,
        pool,
        registry,
        router,
        pipeline,
        cleanup: async () => {
            valve.cleanup();
            ledger.cleanup();
            router.cleanup();
            await pool.destroyAll();
        },
    };
}
