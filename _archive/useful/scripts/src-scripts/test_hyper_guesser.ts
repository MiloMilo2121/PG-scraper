
import { HyperGuesser } from '../enricher/core/discovery/hyper_guesser_v2';
import { Logger } from '../enricher/utils/logger';

// Mock Logger to avoid clutter
Logger.info = (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || '');
Logger.warn = (msg: string, meta?: any) => console.log(`[WARN] ${msg}`, meta || '');

function test(name: string, city: string, province: string, category: string) {
    console.log(`\n--- Testing: ${name} (${city}) [${category}] ---`);
    const domains = HyperGuesser.generate(name, city, province, category);
    console.log(`Generated ${domains.length} candidates.`);

    // Print top 20
    console.log("Top 10:");
    domains.slice(0, 10).forEach(d => console.log(`  ${d}`));

    // Check for specific expected patterns
    const acronymCode = name.split(' ').filter(w => w.length >= 2).map(w => w[0]).join('').toLowerCase();
    const hasAcronym = domains.some(d => d.includes(acronymCode));
    console.log(`Acronym '${acronymCode}' strategy present? ${hasAcronym ? '✅' : '❌'}`);

    const hasHyphen = domains.some(d => d.includes('-'));
    console.log(`Hyphenated strategy present? ${hasHyphen ? '✅' : '❌'}`);

    const hasCity = domains.some(d => d.includes(city.toLowerCase().replace(/\s/g, '')));
    console.log(`City strategy present? ${hasCity ? '✅' : '❌'}`);
}

test("Officine Meccaniche Rossi", "Milano", "MI", "Meccanica");
test("A.B.C. Costruzioni", "Roma", "RM", "Edilizia");
test("Tessitura Serica Srl", "Como", "CO", "Tessile");
