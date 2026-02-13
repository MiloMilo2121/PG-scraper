
import { config } from '../enricher/config';

console.log('--- LLM Config Debug ---');
console.log('Z_AI_API_KEY present:', !!config.llm.z_ai.apiKey);
console.log('OPENAI_API_KEY present:', !!config.llm.apiKey);
console.log('Default Model:', config.llm.model);
console.log('Fast Model:', config.llm.fastModel);
console.log('Smart Model:', config.llm.smartModel);
