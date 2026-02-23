import { UnifiedDiscoveryService, DiscoveryMode } from './src/enricher/core/discovery/unified_discovery_service';
import { CompanyInput } from './src/enricher/types';
import { Logger } from './src/enricher/utils/logger';

async function main() {
    Logger.info("Starting Maximum Precision Discovery Test (Phase 1 / FAST_RUN1)");
    Logger.info("=================================================================");

    const company: CompanyInput = {
        id: "test-max-precision-1",
        piva: "00159560366", // Ferrari S.p.A.
        company_name: "Ferrari S.p.A.",
        city: "Maranello",
        province: "MO",
        address: "Via Abetone Inferiore, 4",
        category: "Produzione di autoveicoli"
    };

    Logger.info("Target Company:", company);
    Logger.info("Mode: FAST_RUN1 (High Precision, Low Candidates, No Nuclear)");

    const service = new UnifiedDiscoveryService();

    try {
        const startTime = Date.now();
        // Lancia in FAST_RUN1 per massima precisione
        const result = await service.discover(company, DiscoveryMode.FAST_RUN1);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        Logger.info("=================================================================");
        Logger.info(`⏱️  Duration: ${duration}s`);
        Logger.info(`🎯 Final Status:  ${result.status} (Method: ${result.method})`);
        Logger.info(`🔗 URL:           ${result.url}`);
        Logger.info(`📊 Confidence:    ${result.confidence.toFixed(2)} / 1.00`);
        Logger.info(`🌊 Wave:          ${result.wave}`);
        if (result.metrics) {
            Logger.info(`Layers Attempted: ${result.metrics.layersAttempted.join(' -> ')}`);
        }

    } catch (e: any) {
        Logger.error("Test failed with error:", { error: e.message });
    }
}

main().then(() => {
    Logger.info("Test completed.");
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
