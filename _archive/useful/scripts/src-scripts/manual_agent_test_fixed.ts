
import { UnifiedDiscoveryService, DiscoveryMode } from '../enricher/core/discovery/unified_discovery_service';
import { AgentRunner } from '../enricher/core/agent/agent_runner';
import { Logger } from '../enricher/utils/logger';
import { CompanyInput } from '../enricher/types';

// Simple mock/spy to detect if AgentRunner.run is called without full mocking framework
const originalRun = AgentRunner.run;
let agentCalled = false;

AgentRunner.run = async (page, goal) => {
    agentCalled = true;
    Logger.info(`[TEST SPY] 🕵️ AgentRunner.run CALLED with goal: "${goal}"`);
    // call original
    return originalRun.call(AgentRunner, page, goal);
};

async function main() {
    Logger.info("🧪 STARTING MANUAL AGENT TEST (PROVA)");

    // Target: A real website, but we will rely on it NOT having the P.IVA easily visible on home/meta
    // so confidence drops below 0.4.
    // However, finding such a site reliably is hard.
    // Instead, I will use a known site but pass a company name that is slightly off or obscure to lower match score?
    // No, better to test the logic directly.

    // Let's use a dummy company that won't match well with the content of a real site (e.g. google.com)
    // BUT wait, if it doesn't match well, it might just return 0 confidence and exit.
    // We need 0 < confidence < 0.4.

    // To GUARANTEE the test works as a proof of concept for the code change, 
    // I will use a trick: I will monkey-patch the CompanyMatcher.evaluate in this script
    // to force a return value of confidence 0.35 for the first URL check.

    const { CompanyMatcher } = require('../enricher/core/discovery/company_matcher');
    const originalEvaluate = CompanyMatcher.evaluate;

    CompanyMatcher.evaluate = (company: CompanyInput, url: string, text: string, title: string) => {
        Logger.info(`[TEST SPY] 🕵️ CompanyMatcher.evaluate called for ${url}`);
        if (url.includes('example.com') || url.includes('iana.org')) {
            Logger.info(`[TEST SPY] 📉 Forcing LOW CONFIDENCE (0.35) to trigger Agent...`);
            return {
                confidence: 0.35,
                reason: "Forced low confidence for testing",
                signals: { domainCoverage: 0, titleMatch: false },
                scrapedVat: null,
                matchedPhone: null
            };
        }
        return originalEvaluate(company, url, text, title);
    };

    const service = new UnifiedDiscoveryService();
    const company: CompanyInput = {
        company_name: "Test Low Confidence Company",
        city: "Milano",
        website: "https://example.com" // Simple, fast, safe
    };

    Logger.info(`Testing company: ${company.company_name} with website: ${company.website}`);

    try {
        if (!company.website) throw new Error("Website is required");
        // We use verifyUrl directly to skip discovery waves and go straight to deepVerify
        const result = await service.verifyUrl(company.website, company);

        Logger.info("---------------------------------------------------");
        Logger.info("🏁 TEST RESULT");
        Logger.info(`Final Confidence: ${result?.confidence}`);
        Logger.info(`Agent Triggered: ${agentCalled ? "YES ✅" : "NO ❌"}`);
        Logger.info(`Output Status: ${result?.status}`);

        if (agentCalled && result?.confidence >= 0.35) {
            console.log("SUCCESS: Agent was triggered correctly!");
        } else {
            console.error("FAILURE: Agent was NOT triggered or confidence mismatch.");
            process.exit(1);
        }

    } catch (error) {
        Logger.error("Test Failed with error", { error: error as Error });
        process.exit(1);
    }
}

main();
