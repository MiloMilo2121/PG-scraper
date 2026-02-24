
import { LLMService } from '../enricher/core/ai/llm_service';
import { Logger } from '../enricher/utils/logger';
import * as dotenv from 'dotenv';
import { config } from '../enricher/config';

dotenv.config();

async function verifyFlash() {
    console.log(`🚀 Verifying GLM-4.7-flash FREE (${config.llm.fastModel})...`);

    try {
        const client = LLMService.getClient();
        const start = Date.now();
        const response = await client.chat.completions.create({
            model: 'glm-4.7-flash',
            messages: [{ role: 'user', content: 'Say hello' }],
        });
        const duration = Date.now() - start;

        console.log(`✅ Response: ${response.choices[0].message.content}`);
        console.log(`⏱️ Duration: ${duration}ms`);

    } catch (error) {
        console.error("❌ Failed:", error);
    }
}

verifyFlash();
