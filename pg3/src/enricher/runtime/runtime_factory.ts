require('dotenv').config();

import { MasterPipeline } from '../../foundation/MasterPipeline';
import { InputNormalizer } from '../../foundation/InputNormalizer';
import { ShadowRegistry } from '../../foundation/ShadowRegistry';
import { PreVerifyGate } from '../../foundation/PreVerifyGate';
import { SerpDeduplicator } from '../../foundation/SerpDeduplicator';
import { LLMOracleGuard } from '../../foundation/LLMOracleGuard';
import { StopTheBleedingController } from '../../foundation/StopTheBleedingController';
import { BilancioHunter } from '../../foundation/BilancioHunter';
import { LinkedInSniper } from '../../foundation/LinkedInSniper';
import { EnrichmentBuffer } from '../../foundation/EnrichmentBuffer';
import { QuerySanitizer } from '../../foundation/QuerySanitizer';
import { EnrichmentPostProcessor } from '../../foundation/EnrichmentPostProcessor';
import { PecHunter } from '../../foundation/PecHunter';
import { BackpressureValve } from '../../shared-runtime/control/BackpressureValve';
import { BrowserPool } from '../../shared-runtime/browser/BrowserPool';
import { MemoryFirstCache } from '../../shared-runtime/cache/MemoryFirstCache';
import { CostLedger } from '../../shared-runtime/budget/CostLedger';
import { CostRouter } from '../../shared-runtime/routing/CostRouter';
import { buildProviderMap } from './provider_catalog';
import { config } from '../config';

export interface OmegaRuntime {
    ledger: CostLedger;
    cache: MemoryFirstCache;
    valve: BackpressureValve;
    pool: BrowserPool;
    registry: ShadowRegistry;
    router: CostRouter;
    bleedingCtrl: StopTheBleedingController;
    pipeline: MasterPipeline;
    cleanup(): Promise<void>;
}

export async function createOmegaRuntime(): Promise<OmegaRuntime> {
    const ledger = new CostLedger({ filePath: config.runtime.costLedgerPath });
    const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
    const valve = new BackpressureValve({
        ledger,
        initialConcurrency: config.runtime.backpressureInitialConcurrency,
        maxConcurrency: config.runtime.backpressureMaxConcurrency,
    });
    const pool = new BrowserPool({
        ledger,
        maxInstances: config.runtime.browserPoolMaxInstances,
        maxRequestsPerInstance: config.runtime.browserPoolMaxRequestsPerInstance,
        navigationTimeout: config.runtime.browserPoolNavTimeoutMs,
        sessionStateDir: config.runtime.browserSessionDir,
        chromePath: config.browser.chromePath,
        localNavigationCostEur: config.costing.localBrowserNavCostEur,
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
        bilancioHunter: new BilancioHunter(router),
        linkedinSniper: new LinkedInSniper(router),
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
        bleedingCtrl,
        pipeline,
        cleanup: async () => {
            valve.cleanup();
            ledger.cleanup();
            router.cleanup();
            await pool.destroyAll();
        },
    };
}
