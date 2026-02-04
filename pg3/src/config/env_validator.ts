
import * as dotenv from 'dotenv';
dotenv.config();

export class EnvValidator {
    public static validate() {
        const required = ['OPENAI_API_KEY', 'REDIS_HOST']; // Add more as needed
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            console.warn(`[EnvValidator] ⚠️ Missing Variables: ${missing.join(', ')}. App may fail.`);
            // process.exit(1); // Optional: Strict mode
        } else {
            console.log('[EnvValidator] ✅ Environment valid.');
        }
    }
}
