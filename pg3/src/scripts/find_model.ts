
import { LLMService } from '../enricher/core/ai/llm_service';
import * as dotenv from 'dotenv';
import { config } from '../enricher/config';

dotenv.config();

const CANDIDATES = [
    'glm-4.7-flash',      // FREE
    'glm-4.5-flash',      // FREE
    'glm-4.7-flashx',     // Paid flash
    'glm-4.7',            // Mid-tier
    'glm-5',              // Flagship
];

async function findWorkingModel() {
    console.log("🚀 Testing Z.ai Model Candidates...");
    const client = LLMService.getClient();

    for (const model of CANDIDATES) {
        process.stdout.write(`Testing ${model.padEnd(20)} ... `);
        try {
            const response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5
            });
            console.log(`✅ SUCCESS!`);
            return; // Found one!
        } catch (error: any) {
            if (error?.error?.code === '1211' || error?.status === 400) {
                console.log(`❌ Not Found`);
            } else {
                console.log(`❌ Error: ${error.message}`);
            }
        }
    }
    console.log("❌ All candidates failed.");
}

findWorkingModel();
