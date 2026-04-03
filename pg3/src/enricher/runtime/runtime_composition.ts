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
import { HTTP_PROVIDER_ORDER, SERP_PROVIDER_ORDER } from '../../shared-runtime/routing/provider_catalog';
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

function createRuntimeCore() {
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
    const router = new CostRouter(cache, ledger, buildProviderMap(), {
        SERP: SERP_PROVIDER_ORDER,
        PROXY_FETCH: HTTP_PROVIDER_ORDER,
    });
    const bleedingCtrl = new StopTheBleedingController(ledger, valve, pool);

    return { ledger, cache, valve, pool, registry, router, bleedingCtrl };
}

function createRuntimePipeline(core: ReturnType<typeof createRuntimeCore>): MasterPipeline {
    const gate = new PreVerifyGate(core.cache, core.ledger);
    const buffer = new EnrichmentBuffer(core.cache);
    const dedup = new SerpDeduplicator(core.router, new QuerySanitizer(), buffer);
    const oracleGuard = new LLMOracleGuard(core.cache, core.valve);

    return new MasterPipeline({
        normalizer: new InputNormalizer(),
        registry: core.registry,
        gate,
        dedup,
        oracleGuard,
        bleedingCtrl: core.bleedingCtrl,
        valve: core.valve,
        bilancioHunter: new BilancioHunter(core.router),
        linkedinSniper: new LinkedInSniper(core.router),
        browserPool: core.pool,
        costRouter: core.router,
        postProcessor: new EnrichmentPostProcessor(core.pool),
        pecHunter: new PecHunter(core.pool, core.router),
    });
}

export async function createOmegaRuntime(): Promise<OmegaRuntime> {
    const core = createRuntimeCore();
    const pipeline = createRuntimePipeline(core);

    return {
        ...core,
        pipeline,
        cleanup: async () => {
            core.valve.cleanup();
            core.ledger.cleanup();
            core.router.cleanup();
            await core.pool.destroyAll();
        },
    };
}
