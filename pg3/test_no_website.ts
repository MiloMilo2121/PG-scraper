import { createOmegaRuntime } from './src/enricher/runtime/runtime_factory';

async function test() {
    console.log("Testing Cirelli Alfonso...");
    const runtime = await createOmegaRuntime();
    const { pipeline } = runtime;

    const input = {
        company_name: "Cirelli Alfonso",
        city: "Legnago",
        provincia: "VR",
        company_name_variants: [],
    };

    // disable enrichment to only test discovery
    (pipeline as any).postDiscoveryEnrichment = {
        run: async () => ({
            financial: null, decisionMaker: null, employees: null, isEstimatedEmployees: false, vat: null, pec: null, email: null,
            stageOutcomes: {}
        })
    };

    try {
        const result = await pipeline.processCompany(input as any, 0);
        console.log("Result:");
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
    
    process.exit(0);
}

test().catch(console.error);
