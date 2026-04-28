
import { HyperGuesser } from '../enricher/core/discovery/hyper_guesser_v2';
// import { Logger } from '../utils/logger';

async function test() {
    console.log("🔮 Testing HyperGuesser v3 🔮\n");

    const cases = [
        {
            name: "Mario & Figli S.n.c.",
            city: "Milano",
            province: "MI",
            category: "Idraulica",
            expected: ["marioefigli.it", "mariofigli.it"]
        },
        {
            name: "Officine Meccaniche Rossi",
            city: "Torino",
            province: "TO",
            category: "Meccanica",
            expected: ["omr.it", "omrtorino.it"]
        },
        {
            name: "L'Angolo della Pizza",
            city: "Napoli",
            province: "NA",
            category: "Ristorazione",
            expected: ["langolodellapizza.it", "angolodellapizza.it"]
        },
        {
            name: "StartUp Lab",
            city: "Roma",
            province: "RM",
            category: "Incubatore",
            expected: ["startuplab.it", "startuplabincubatore.it"]
        }
    ];

    for (const c of cases) {
        console.log(`--- Testing: ${c.name} (${c.city}) [${c.category}] ---`);
        const results = HyperGuesser.generate(c.name, c.city, c.province, c.category);

        // Print top 5
        console.log("Top 5 candidates:");
        results.slice(0, 5).forEach(r => console.log(`  ${r}`));

        // Check expectations
        const found = c.expected.filter(e => results.includes(`https://${e}`) || results.includes(`http://${e}`) || results.includes(e));
        console.log(`Matches expected: ${found.length}/${c.expected.length}`);
        c.expected.forEach(e => {
            const isPresent = results.some(r => r.includes(e));
            console.log(`  ${e}: ${isPresent ? '✅' : '❌'}`);
        });

        console.log("\n");
    }
}

test();
