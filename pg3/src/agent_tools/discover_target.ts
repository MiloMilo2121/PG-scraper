import { InputNormalizer } from '../foundation/InputNormalizer';
import { InputWebsiteCandidate } from '../foundation/InputWebsiteCandidate';

// Micro-Executor: discover_target
// Purpose: Normalize company input and validate/classify a provided URL.
// NOTE: This does NOT perform active discovery (SERP, HyperGuesser).
//       For full discovery, use run_pipeline_module or the worker queue.
// Usage: npx tsx src/agent_tools/discover_target.ts --query "Azienda SPA" --url "azienda.it" --piva "01234567890"

async function main() {
    const args = process.argv.slice(2);
    let query = '';
    let url = '';
    let piva = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--query' && args[i + 1]) query = args[i + 1];
        if (args[i] === '--url' && args[i + 1]) url = args[i + 1];
        if (args[i] === '--piva' && args[i + 1]) piva = args[i + 1];
    }

    if (!query && !url) {
        console.log(JSON.stringify({ status: 'ERROR', error: 'ERR_INVALID_ARGS', message: 'Fornire almeno --query o --url' }));
        process.exit(1);
    }

    try {
        const normalizer = new InputNormalizer();
        const rawInput: Record<string, string> = {};
        if (query) rawInput.company_name = query;
        if (url) rawInput.website = url;
        if (piva) rawInput.vat_code = piva;

        const normalized = normalizer.normalize(rawInput);

        let candidates: string[] = [];
        let classification = 'NO_URL_PROVIDED';
        let reasonCode: string | undefined = undefined;

        if (normalized.website) {
            const assessment = InputWebsiteCandidate.assess(normalized.website);
            candidates = assessment.candidates || [];
            classification = assessment.classification;
            reasonCode = assessment.reasonCode;
        }

        const result = {
            status: 'SUCCESS',
            normalizedInput: {
                company_name: normalized.company_name,
                company_name_variants: normalized.company_name_variants,
                city: normalized.city,
                provincia: normalized.provincia,
                website: normalized.website,
                vat_code: normalized.vat_code,
                email: normalized.email,
                email_domain: normalized.email_domain,
                phone: normalized.phone,
                quality_score: normalized.quality_score,
            },
            domainAssessment: {
                classification,
                reasonCode: reasonCode || null,
                candidates
            }
        };

        console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.log(JSON.stringify({ status: 'ERROR', error: 'ERR_INTERNAL_FAULT', message: err.message }));
        process.exit(1);
    }
}

main();
