import { createOmegaRuntime } from '../enricher/runtime/runtime_factory';
import { BilancioHunter } from '../foundation/BilancioHunter';
import { PecHunter } from '../foundation/PecHunter';
import { LinkedInSniper } from '../foundation/LinkedInSniper';
import { InputNormalizer } from '../foundation/InputNormalizer';
import crypto from 'crypto';

// Micro-Executor: enrich_target
// Purpose: Trigger enrichment modules (Financial, Contacts, Social) for a validated domain.
// Usage: npx tsx src/agent_tools/enrich_target.ts --url "https://azienda.it" --modules "financial,pec,social" --company-name "Azienda SPA" --piva "01234567890"

async function main() {
    const args = process.argv.slice(2);
    let url = '';
    let modulesStr = '';
    let companyName = '';
    let piva = '';
    let city = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--url' && args[i + 1]) url = args[i + 1];
        if (args[i] === '--modules' && args[i + 1]) modulesStr = args[i + 1];
        if (args[i] === '--company-name' && args[i + 1]) companyName = args[i + 1];
        if (args[i] === '--piva' && args[i + 1]) piva = args[i + 1];
        if (args[i] === '--city' && args[i + 1]) city = args[i + 1];
    }

    if (!url) {
        console.log(JSON.stringify({ status: 'ERROR', reason_code: 'ERR_INVALID_ARGS', message: 'Fornire --url' }));
        process.exit(1);
    }

    const modules = modulesStr.split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
    if (modules.length === 0) {
        console.log(JSON.stringify({ status: 'ERROR', reason_code: 'ERR_INVALID_ARGS', message: 'Fornire --modules' }));
        process.exit(1);
    }

    let runtime;
    try {
        // Build the runtime context needed by the Hunters
        runtime = await createOmegaRuntime();
        const normalizer = new InputNormalizer();
        
        let targetName = companyName;
        // Fallback: extract base domain token if name is completely missing.
        // Hunters need at least a name to build search queries effectively.
        if (!targetName) {
            try {
                targetName = new URL(url).hostname.replace(/^www\./i, '').split('.')[0];
            } catch {
                targetName = url;
            }
        }

        const normalizedInput = normalizer.normalize({
            company_name: targetName,
            website: url,
            vat_code: piva,
            city: city
        });

        const companyId = crypto.randomUUID();
        const results: any = {};
        const errors: any = {};
        const executedModules: string[] = [];

        // --- 1. FINANCIAL ENRICHMENT ---
        if (modules.includes('financial')) {
            try {
                const bilancioHunter = new BilancioHunter(runtime.router);
                const finData = await bilancioHunter.hunt(companyId, normalizedInput);
                results.financial = finData;
                executedModules.push('financial');
            } catch (err: any) {
                errors.financial = err.message;
            }
        }

        // --- 2. PEC & CONTACTS ENRICHMENT ---
        if (modules.includes('pec') || modules.includes('email') || modules.includes('contacts')) {
            try {
                // PecHunter requires BrowserPool and CostRouter
                const pecHunter = new PecHunter(runtime.pool, runtime.router);
                const contacts = await pecHunter.hunt(companyId, normalizedInput, url);
                results.contacts = contacts;
                executedModules.push('contacts');
            } catch (err: any) {
                errors.contacts = err.message;
            }
        }

        // --- 3. SOCIAL / DECISION MAKER ENRICHMENT ---
        if (modules.includes('social') || modules.includes('linkedin') || modules.includes('decision_maker')) {
            try {
                const linkedinSniper = new LinkedInSniper(runtime.router);
                const dm = await linkedinSniper.snipe(companyId, normalizedInput, url);
                results.decision_maker = dm;
                executedModules.push('social');
            } catch (err: any) {
                errors.social = err.message;
            }
        }

        // Calculate final status per the OMEGA Codex (Zero Silent Drops)
        const hasErrors = Object.keys(errors).length > 0;
        const allFailed = executedModules.length === 0 || (hasErrors && executedModules.length === Object.keys(errors).length);
        const status = allFailed ? 'ERROR' : (hasErrors ? 'PARTIAL' : 'SUCCESS');
        
        let reasonCode = 'ENRICHMENT_COMPLETED';
        if (allFailed) {
            reasonCode = 'ERR_ALL_MODULES_FAILED';
        } else if (hasErrors) {
            reasonCode = 'PARTIAL_MODULES_FAILED';
        } else {
            const hasData = results.financial || (results.contacts && (results.contacts.pec || results.contacts.email)) || results.decision_maker;
            if (!hasData) reasonCode = 'NO_DATA_FOUND';
            else reasonCode = 'DATA_EXTRACTED';
        }

        const ledgerSummary = await runtime.ledger.getSummary();
        const costEstimateEur = ledgerSummary.total_cost_eur;

        console.log(JSON.stringify({
            status,
            reason_code: reasonCode,
            modules_requested: modules,
            modules_executed: executedModules,
            data: results,
            errors: Object.keys(errors).length > 0 ? errors : undefined,
            cost_estimate_eur: costEstimateEur,
            notes: "V1 Execution: Directly wiring BilancioHunter, PecHunter, LinkedInSniper. No MasterPipeline refactor required."
        }, null, 2));

    } catch (err: any) {
        console.log(JSON.stringify({ status: 'ERROR', reason_code: 'ERR_INTERNAL_RUNTIME', message: err.message }));
        process.exit(1);
    } finally {
        if (runtime) {
            await runtime.cleanup();
            // Wait a brief moment to ensure all async I/O in destructors settles
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        process.exit(0);
    }
}

main();
