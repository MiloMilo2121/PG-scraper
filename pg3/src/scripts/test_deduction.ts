
import { AIService } from '../enricher/core/ai/service';
import { Logger } from '../enricher/utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

// Mock HTML for a precision machining company that DOESN'T explicitly say "Manufacturing"
const MOCK_HTML = `
<html>
<head><title>Rossi Meccanica S.r.l.</title></head>
<body>
    <h1>Rossi Meccanica: Precision since 1980</h1>
    <p>We specialize in 5-axis CNC milling and turning for the automotive sector.</p>
    <p>Our fleet includes Mazak and DMG Mori centers.</p>
    <p>ISO 9001:2015 certified quality.</p>
    <div>
        <h2>Services</h2>
        <ul>
            <li>Prototyping</li>
            <li>Small batch production</li>
            <li>Surface grinding</li>
        </ul>
    </div>
    <footer>Contact: info@rossimeccanica.it | P.IVA 12345678901</footer>
</body>
</html>
`;

async function testDeduction() {
    console.log("🚀 Testing Deductive Reasoning with GLM-5...");

    const service = new AIService();

    try {
        const start = Date.now();
        const result = await service.classifyBusiness(MOCK_HTML, "Rossi Meccanica S.r.l.");
        const duration = Date.now() - start;

        console.log(`\n✅ RESULT:`);
        console.log(JSON.stringify(result, null, 2));
        console.log(`⏱️ Duration: ${duration}ms`);

    } catch (error) {
        console.error("❌ Failed:", error);
    }
}

testDeduction();
