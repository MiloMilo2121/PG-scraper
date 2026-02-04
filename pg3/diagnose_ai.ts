
import { HyperGuesser } from './src/core/discovery/hyper_guesser_v2';
import { LLMValidator } from './src/core/discovery/llm_validator';
import { CompanyInput } from './src/core/company_types';

async function main() {
    console.log('--- DIAGNOSTIC START ---');

    // 1. Mock Company (Pavireflex)
    const company: CompanyInput = {
        company_name: "Pavireflex",
        address: "Via Maestri del Lavoro, 6",
        city: "Bargano",
        province: "LO",
        zip_code: "",
        region: "Lombardia",
        country: "IT",
        vat_code: "", // MISSING VAT IS THE CHALLENGE
        category: "Rivestimenti e pavimenti"
    } as any;

    // 2. Test HyperGuesser V2
    console.log('\n[1] Testing HyperGuesser V2...');
    const guesses = HyperGuesser.generate(company.company_name, company.city, company.province, company.category || '');
    const expected = "https://pavireflex.it";
    const found = guesses.includes(expected) || guesses.includes("https://www.pavireflex.it");

    console.log(`Guessed ${guesses.length} domains.`);
    if (found) {
        console.log(`✅ SUCCESS: Found target domain: ${expected}`);
    } else {
        console.log(`❌ FAILED: Did NOT find ${expected}`);
        console.log('Sample guesses:', guesses.slice(0, 5));
    }

    // 3. Test LLM Validator (GPT-4o-mini)
    console.log('\n[2] Testing LLM Validator (gpt-4o-mini)...');
    const mockContent = `
        Pavireflex S.r.l.
        Pavimenti industriali in calcestruzzo e resina.
        Levigatura pavimenti.
        Sede operativa: Via Maestri del Lavoro 6, Bargano (Lodi).
        Contattaci per un preventivo.
    `;

    const result = await LLMValidator.validate("https://pavireflex.it", mockContent, company);
    console.log('LLM Result:', JSON.stringify(result, null, 2));

    if (result.valid) {
        console.log('✅ SUCCESS: LLM validated the content correctly.');
    } else {
        console.log(`❌ FAILED: LLM rejected valid content. Reason: ${result.reason}`);
    }

    console.log('--- DIAGNOSTIC END ---');
}

main().catch(console.error);
